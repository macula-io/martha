// The launcher's own wiring of the audit (martha#321): a member the declaration asks to audit gets its calls run and
// its would-be refusals written where the owner reads them.
//
// What this pins is the line the launcher passes, not the decision (../audit_the_gate_for_a_member's own tests hold
// that): a relay handed the gate's audit folder writes there, and one handed none refuses the call rather than letting
// it run unaudited.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_SHELL_TOOL, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { releasesIn } from '../apply_the_owners_release/apply_the_owners_release.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { memberRelay, type MemberRelay, type MemberRelayPlace } from '../launch_a_claude_code_member/answer_the_relay.ts'
import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { appendStateLine, readStateFile } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The crew's own files, as the host keeps them: these tests read and write them through the launcher's own calls. */
const STATE_LINES = { append: appendStateLine, read: readStateFile }
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { GATE_AUDIT_PLACE, theLinesIn } from './audit_the_gate_for_a_member.ts'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
  readonly audit: string
}

const SESSION = 'the-session'
const MEMBER = 'builder'

/** One member's places under a directory the test removes. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-321-launch-audit-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(rows, { mode: 0o700 })
  const audit = join(home, GATE_AUDIT_PLACE)
  mkdirSync(audit, { mode: 0o700 })
  return { home, checkout, rows, audit }
}

const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, DEFAULT_CONFIG_DIR, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** The relay as the launcher builds it, with the gate's mode and audit folder this launch was given. */
function relayFor(places: Places, gate: MemberRelayPlace['gate'], audit: MemberRelayPlace['audit']): MemberRelay {
  const rows = rowStreamsDirectory(places.rows)
  return memberRelay({
    records: sessionRecordsIn(rows, releasesIn(rows)),
    launch: { host: CLAUDE_CODE, launch_dir: places.checkout, stop_dir: places.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(places.home, DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE),
      home: places.home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(places.home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({
      launcher_env: { HOME: places.home },
      member_env: { HOME: places.home },
      home: places.home,
      launch_dir: places.checkout,
      settings_files: [],
      user_scope: userScopeFor(places.home),
    }),
    ...(gate === undefined ? {} : { gate }),
    ...(audit === undefined ? {} : { audit }),
    stopMember: () => {},
  })
}

/** A session that took in text no policy names: the arrival the gate refuses on. */
async function aSessionAForeignerReached(relay: MemberRelay): Promise<void> {
  await relay.answer('session_started', { session_id: SESSION, source: 'startup' })
  await relay.answer('prompt_submitted', { session_id: SESSION, text: 'a ring from a stranger', origin: { kind: 'plugin' } })
}

const bash = { session_id: SESSION, call: { tool: CLAUDE_CODE_SHELL_TOOL, command: 'id' } }

/** The refusal a call got, as the host reads it. */
const deniedTo = (reply: { readonly answered: boolean }): string => {
  assert.ok('body' in reply && typeof reply.body === 'object' && reply.body !== null && 'deny' in reply.body, 'the call was not denied')
  return String((reply.body as { deny: string }).deny)
}

test('#321: an audited member’s shell call while an agent runs runs and leaves one line, naming the agent', async (t) => {
  const places = placesOf(t)
  const relay = relayFor(places, 'audited', { directory: places.audit, member: MEMBER, lines: STATE_LINES })
  await relay.answer('session_started', { session_id: SESSION, source: 'startup' })
  await relay.answer('subagent_started', { session_id: SESSION, agent_id: 'agent-7' })
  assert.deepEqual(await relay.answer('tool_called', bash), { answered: true, body: { allow: 1 } }, 'an audited member’s call was refused for a reason the owner never named')

  const lines = theLinesIn({ directory: places.audit, member: MEMBER, lines: STATE_LINES })
  assert.ok(!('refusal' in lines))
  assert.equal(lines.length, 1, 'the would-be refusal the agent’s run stands on left no line')
  assert.match(String(lines[0]?.['why']), /agent-7/, 'the line does not name the agent the shell waits on')
})

test('#321: the launcher hands the gate’s audit folder to the relay, and an audited call writes its line there', async (t) => {
  const places = placesOf(t)
  const relay = relayFor(places, 'audited', { directory: places.audit, member: MEMBER, lines: STATE_LINES })
  await aSessionAForeignerReached(relay)
  assert.deepEqual(await relay.answer('tool_called', bash), { answered: true, body: { allow: 1 } })
  const lines = theLinesIn({ directory: places.audit, member: MEMBER, lines: STATE_LINES })
  assert.ok(!('refusal' in lines))
  assert.equal(lines.length, 1, 'the audited call left no line')
})

test('#321: an audited member whose launch kept no audit folder has its call refused, never run unwatched', async (t) => {
  const relay = relayFor(placesOf(t), 'audited', undefined)
  await aSessionAForeignerReached(relay)
  const answer = await relay.answer('tool_called', bash)
  assert.match(deniedTo(answer), /no place to write it/, 'an audited call ran with no audit folder')
})

test('#321: an enforced member’s refusal leaves the audit folder empty', async (t) => {
  const places = placesOf(t)
  const relay = relayFor(places, 'enforced', { directory: places.audit, member: MEMBER, lines: STATE_LINES })
  await aSessionAForeignerReached(relay)
  const answer = await relay.answer('tool_called', bash)
  assert.match(deniedTo(answer), /Nothing executes in this session/)
  assert.deepEqual(theLinesIn({ directory: places.audit, member: MEMBER, lines: STATE_LINES }), [])
})
