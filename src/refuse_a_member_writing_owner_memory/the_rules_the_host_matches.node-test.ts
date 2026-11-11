// On the recorded host, every rule the launch writes is one the host's file permission checks match (martha#226).
//
// The rules are a second layer only on a host that matches them, and the host says in its own words which of them it
// never matches. This runs the question the launch asks (host_runs_the_relay's `whatTheHostSaysWithTheseSettings`) on
// the recorded host's own binary: it says nothing about the rules the launch writes, and in the same run it names an
// inert twin of one — so the test shows both that the host matches ours and that the reader sees a rule it would not.
// The relay CI job names the binary in MARTHA_RECORDED_HOST; without it this is skipped.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { RECORDED_HOST_VARIABLE } from '../launch_a_claude_code_member/drive_the_recorded_host.ts'
import { NOT_MATCHED_MARK } from '../claude_code_host/file_permission_rules.ts'
import { whatTheHostSaysWithTheseSettings } from '../launch_a_claude_code_member/host_runs_the_relay.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { hostLinesNamingARule, memoryDenyRules, ownerMemoryPlaces, userScopeUnder } from './refuse_a_member_writing_owner_memory.ts'

const recordedHost = process.env[RECORDED_HOST_VARIABLE]
const skip = recordedHost === undefined && `needs ${RECORDED_HOST_VARIABLE}, the recorded host's binary, which the relay CI job sets`

/** The rule written under the same place as `rule`, but under a tool the file permission checks never use. */
const anInertTwinOf = (rule: string): string => rule.replace(/^\w+\(/, 'Write(')

test('the recorded host matches every rule the launch writes, and names an inert twin of one in the same run (#226)', { skip }, async (t) => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-rules-')))
  t.after(() => removeTheTree(home))
  const env = { HOME: home, PATH: [join(process.execPath, '..'), '/usr/bin', '/bin'].join(':'), TERM: 'xterm-256color' }
  const written = memoryDenyRules(ownerMemoryPlaces({ launcher_env: env, member_env: env, home, launch_dir: home, settings_files: [], user_scope: userScopeUnder(home) }))
  assert.ok(written.length > 0, 'the launch writes rules for an ordinary home')
  const settings = join(home, 'rules.json')

  /** What the host says about `rules`, asked the way a launch asks; refuses to pass on an answer that read no rules. */
  const whatItSaysAbout = async (rules: readonly string[]): Promise<string> => {
    writeFileSync(settings, JSON.stringify({ permissions: { deny: rules } }))
    const printed = await whatTheHostSaysWithTheseSettings(recordedHost ?? '', [], settings, env, home)
    if ('failure' in printed) assert.fail(`the host could not be asked: ${printed.failure}`)
    // The host ends on its own words about having no input, which is the run that read the rules: a host that answered
    // nothing would leave nothing to read, and the assertion below would pass on an empty answer.
    assert.match(printed.stderr, /Input must be provided/, `the host did not reach the point where it reads the rules: ${printed.stderr.slice(-800)}`)
    return printed.stderr
  }

  // The rules the launch writes: the host says nothing about any of them, since every one is one its checks match.
  const said = await whatItSaysAbout(written)
  assert.deepEqual(hostLinesNamingARule(said, written), [], `the host says these can never match: ${hostLinesNamingARule(said, written).join(' | ')}`)

  // The same question, with one rule written under the tool the checks never use: the host names that rule, so the
  // reading above is shown to see a rule the host would ignore. Its line also quotes the corrected rule, which is one of
  // ours, because the host's own complaint says which tool to write it under — so this asserts the twin is named, not
  // that our own rules are left out of that line.
  const inert = anInertTwinOf(written[0] ?? '')
  const twinSaid = await whatItSaysAbout([...written, inert])
  assert.equal(hostLinesNamingARule(twinSaid, [inert]).length, 1, `the host said nothing about an inert rule, so the reading above proves nothing: ${twinSaid.slice(-800)}`)
  assert.match(twinSaid, /Input must be provided/, 'the host read the rules in the run above too')

  // The owner's own settings are read in the same run, and their dead rule on a place this launch denies makes the host
  // quote the launch's own rule as the one to write instead. That is the owner's rule: a launch that read it as ours
  // would leave an owner who protects the place the old way unable to start a member at all (martha#226 r=1).
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: [anInertTwinOf(written[0] ?? '')] } }))
  const ownersSaid = await whatItSaysAbout(written)
  assert.match(ownersSaid, new RegExp(NOT_MATCHED_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the host said nothing about the owner's own dead rule, so this proves nothing: ${ownersSaid.slice(-800)}`)
  assert.deepEqual(hostLinesNamingARule(ownersSaid, written), [], `the owner's own rule is read as one of ours: ${hostLinesNamingARule(ownersSaid, written).join(' | ')}`)
})
