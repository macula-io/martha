// Line 9 of the Goose trial (macula-io/martha#614, Done-when 4): the model is offered Developer's tools and the skill
// loader, the approved skill is listed to it, and a typed `/<skill>` reaches it as the user's text. Each is failed by
// name when missing; the model calling the loader is its own choice, so a turn without it is not-observed.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { THE_APPROVED_SKILL } from './a_launch_the_trial_writes/a_launch_the_trial_writes.ts'
import { loadSkillToolIn, THE_TYPED_SKILL, theNinthLineOf } from './the_nine_lines.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

/** The fixture's own loader and tools: a line that typed the engine's real names instead of being handed these fails. */
const LOADER = 'the_fixtures_loader'
const DEVELOPER = ['the_fixtures_write', 'the_fixtures_shell']
const ALLOWED = [...DEVELOPER, LOADER]

const tool = (name: string) => ({ type: 'function', function: { name } })

/** A model request as the engine sends it: a system prompt, the user's words, and the tools it offers. */
function aRequest({ system = `skills you may load: ${THE_APPROVED_SKILL}`, user = THE_TYPED_SKILL, tools = ALLOWED } = {}): string {
  return JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], tools: tools.map(tool) })
}

/** The request after the model called the loader: its call is in the history the engine sends back. */
const theLoaderCalled = (name = LOADER, skill = THE_APPROVED_SKILL): string =>
  JSON.stringify({ messages: [{ role: 'user', content: THE_TYPED_SKILL }, { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: JSON.stringify({ name: skill }) } }] }], tools: ALLOWED.map(tool) })

/** The engine's own title chat: the user's words with no tools offered, which is not the turn's request. */
const theTitleChat = JSON.stringify({ messages: [{ role: 'user', content: `Name this: ${THE_TYPED_SKILL}` }] })

test('the turn offers exactly the allow-list, lists the skill, carries the typed words, and the model loads it: pass (martha#614)', () => {
  const seen = theNinthLineOf([theTitleChat, aRequest(), theLoaderCalled()], ALLOWED)
  assert.equal(seen.verdict, 'pass', seen.say)
  assert.deepEqual(seen.evidence['offered'], ALLOWED)
})

test('a turn where the model did not call the loader is not-observed, never passed (martha#614)', () => {
  const seen = theNinthLineOf([aRequest()], ALLOWED)
  assert.equal(seen.verdict, 'not-observed')
  assert.match(seen.say, new RegExp(`did not call ${LOADER} for it$`))
  assert.equal(theNinthLineOf([aRequest(), theLoaderCalled('another_tool')], ALLOWED).verdict, 'not-observed', 'another tool called is not the loader')
  assert.equal(theNinthLineOf([aRequest(), theLoaderCalled(LOADER, 'another-skill')], ALLOWED).verdict, 'not-observed', 'the loader called for another skill is not the approved one loaded')
})

test('each missing part fails the line by name (martha#614)', () => {
  const cases: ReadonlyArray<readonly [string, readonly string[], RegExp]> = [
    ['the loader not offered', [aRequest({ tools: DEVELOPER }), theLoaderCalled()], new RegExp(`^missing ${LOADER}$`)],
    ['a tool beyond the allow-list', [aRequest({ tools: [...ALLOWED, 'analyze'] }), theLoaderCalled()], /^beyond the allow-list analyze$/],
    ['the skill listed only in the user\'s own words', [aRequest({ system: 'no skills' }), theLoaderCalled()], new RegExp(`^${THE_APPROVED_SKILL} is not listed to the model$`)],
    ['the typed words only in the title chat', [theTitleChat, aRequest({ user: 'something else' })], new RegExp(`^no model request offering tools carried ${THE_TYPED_SKILL} as the user's text$`)],
  ]
  for (const [said, chats, why] of cases) {
    const seen = theNinthLineOf(chats, ALLOWED)
    assert.equal(seen.verdict, 'fail', said)
    assert.match(seen.say, why, said)
  }
})

test("the skill loader's name is read from the engine's source, and an engine naming none is refused by name (martha#614)", (t: TestContext) => {
  const source = mkdtempSync(join(tmpdir(), 'martha-614-loader-'))
  t.after(() => removeTheTree(source))
  assert.throws(() => loadSkillToolIn(source), /names no LOAD_SKILL_TOOL_NAME/)
  const file = join(source, 'crates', 'goose-agent', 'src', 'skills', 'operation.rs')
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, `pub const LOAD_SKILL_TOOL_NAME: &str = "${LOADER}";\n`)
  assert.equal(loadSkillToolIn(source), LOADER)
})
