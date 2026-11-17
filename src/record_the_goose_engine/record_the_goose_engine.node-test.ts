// The engine drift check bites (macula-io/martha#541, package 10): `--check` passes on an engine tree that says what
// the committed recording says, and fails, naming the fact, on one that does not. CI runs this file in its own job on
// every PR with no engine checkout: the tree is written from the recording's own facts, so the checker is proven on
// every tip and only the scheduled comparison depends on the fork.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'

import { CLOSED_VOCABULARY, OPEN_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { NOTE } from '../record_claude_code_host/carry_over_what_is_restated_by_hand.ts'
import { engineFilesSaying } from '../know_the_goose_engines_facts/an_engine_source_from_its_facts.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { ENGINE_PARTS, ENGINE_PLACES, type EngineFacts } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'

const RECORDER = fileURLToPath(new URL('./record_the_goose_engine.ts', import.meta.url))
const CHECK = '--check'
const { [NOTE]: _ignoredWhy, engine_commit: RECORDED_COMMIT, ...RECORDED_FACTS } = RECORDED_GOOSE_ENGINE
/** A commit that is not the recorded one: the commit is where facts were read, not a fact. */
const ANOTHER_COMMIT = [...RECORDED_COMMIT].reverse().join('')
/** The recorded subagent vocabulary turned the other way: closed when it is open, open when it is closed. */
const OTHER_SUBAGENT_MODELS: ModelVocabulary = RECORDED_FACTS.subagent_models.kind === OPEN_VOCABULARY
  ? { kind: CLOSED_VOCABULARY, names: ['a-listed-model', 'another-listed-model'] }
  : { kind: OPEN_VOCABULARY, names: [] }

/** Writes a tree that says `facts` under a fresh directory the test removes, and returns the directory. */
function aCheckoutSaying(t: TestContext, facts: EngineFacts, drop: string | undefined = undefined): string {
  const checkout = mkdtempSync(join(tmpdir(), 'martha-goose-engine-'))
  t.after(() => removeTheTree(checkout))
  for (const [path, text] of Object.entries(engineFilesSaying(facts))) {
    if (path === drop) continue
    mkdirSync(dirname(join(checkout, path)), { recursive: true })
    writeFileSync(join(checkout, path), text)
  }
  return checkout
}

function check(checkout: string, commit = RECORDED_COMMIT): { readonly status: number | null; readonly stdout: string } {
  const ran = spawnSync(process.execPath, [RECORDER, CHECK, checkout, commit], { encoding: 'utf8' })
  return { status: ran.status, stdout: ran.stdout }
}

test('an engine that says what the recording says passes, and the output names both versions and commits', (t) => {
  const ran = check(aCheckoutSaying(t, RECORDED_FACTS))
  assert.equal(ran.status, 0, ran.stdout)
  assert.equal(ran.stdout, `recorded ${RECORDED_FACTS.engine_version} at ${RECORDED_COMMIT}, engine ${RECORDED_FACTS.engine_version} at ${RECORDED_COMMIT}\n`)
})

test('another commit that changes no fact is no drift, and the output says how far the two commits are apart', (t) => {
  const ran = check(aCheckoutSaying(t, RECORDED_FACTS), ANOTHER_COMMIT)
  assert.equal(ran.status, 0, ran.stdout)
  assert.match(ran.stdout, new RegExp(`at ${ANOTHER_COMMIT}\\n$`))
})

test('another engine version fails by the version alone', (t) => {
  const ran = check(aCheckoutSaying(t, { ...RECORDED_FACTS, engine_version: `${RECORDED_FACTS.engine_version}.1` }))
  assert.equal(ran.status, 1)
  assert.match(ran.stdout, /\ndiffers: engine_version\n$/)
})

test('an extension whose default changed fails by platform_extensions, so the launch never trusts an old switch list', (t) => {
  const [first, ...rest] = RECORDED_FACTS.platform_extensions
  assert.ok(first !== undefined)
  const ran = check(aCheckoutSaying(t, { ...RECORDED_FACTS, platform_extensions: [{ ...first, default_enabled: !first.default_enabled }, ...rest] }))
  assert.equal(ran.status, 1)
  assert.match(ran.stdout, /\ndiffers: platform_extensions\n$/)
})

test('a permission answer the engine adds fails by permission_options', (t) => {
  const added = [...RECORDED_FACTS.permission_options, `${RECORDED_FACTS.permission_options[0] ?? ''}_for_a_while`]
  const ran = check(aCheckoutSaying(t, { ...RECORDED_FACTS, permission_options: added }))
  assert.equal(ran.status, 1)
  assert.match(ran.stdout, /\ndiffers: permission_options\n$/)
})

test('a delegate tool whose models change kind fails by subagent_models, so a crew is never read against the old vocabulary', (t) => {
  const ran = check(aCheckoutSaying(t, { ...RECORDED_FACTS, subagent_models: OTHER_SUBAGENT_MODELS }))
  assert.equal(ran.status, 1)
  assert.match(ran.stdout, /\ndiffers: subagent_models\n$/)
})

test('two facts that differ are both named, in order', (t) => {
  const ran = check(aCheckoutSaying(t, { ...RECORDED_FACTS, acp_command: `${RECORDED_FACTS.acp_command}x`, path_root_variable: `${RECORDED_FACTS.path_root_variable}_X` }))
  assert.equal(ran.status, 1)
  assert.match(ran.stdout, /\ndiffers: acp_command, path_root_variable\n$/)
})

test('a place that is gone fails as unreadable, naming its part, and no fact is compared', (t) => {
  const ran = check(aCheckoutSaying(t, RECORDED_FACTS, ENGINE_PLACES.acp_server))
  const part = ENGINE_PARTS.find(({ part: name }) => name.includes('permission'))?.part
  assert.equal(ran.status, 1)
  assert.equal(ran.stdout.split('\n')[1], `unreadable: ${part}`)
  assert.doesNotMatch(ran.stdout, /differs:/)
})

test('a call with no commit, or one that is not 40 hex, is refused before anything is read', (t) => {
  const checkout = aCheckoutSaying(t, RECORDED_FACTS)
  assert.equal(spawnSync(process.execPath, [RECORDER, CHECK, checkout], { encoding: 'utf8' }).status, 2)
  assert.equal(check(checkout, RECORDED_COMMIT.slice(1)).status, 2)
})
