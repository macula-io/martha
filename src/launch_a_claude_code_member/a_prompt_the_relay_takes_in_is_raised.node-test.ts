// A prompt the relay takes in is raised to the launch's turn listeners (martha#253, slice 0).
//
// Before this slice, `promptSubmitted` gave a kept turn to `takeInTurn` and to nobody else, so a listener in a live
// member never heard anything: the crew channel's "taken in" could never become true. These cases drive the relay
// itself, as the host drives it over the socket, and assert what a listener hears — and that a prompt the relay
// refuses is raised to no one.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OWNERS_MARKDOWN, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import type { ArrivingTurn } from '../host_contract/host_contract.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { turnsRaised } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import { memberRelay, type MemberRelay } from './answer_the_relay.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { removeTheTree } from './relay_copy.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

/** One member's places under a directory the test removes. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-253-raised-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'row-streams')
  mkdirSync(rows, { mode: 0o700 })
  return { home, checkout, rows }
}

const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, '.claude', CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** The relay for one member, with the raising this launch would hold. */
function relayFor(places: Places, turns: ReturnType<typeof turnsRaised>): MemberRelay {
  return memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(places.rows)),
    launch: { host: CLAUDE_CODE, launch_dir: places.checkout, stop_dir: places.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel({}),
    hookSettings: hookSettingsWatch({
      user: join(places.home, '.claude', 'settings.json'),
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
    turns,
    stopMember: () => {},
  })
}

/** Starts one session on the relay, as the host's SessionStart hook does. */
async function startedSession(relay: MemberRelay, session_id: string): Promise<void> {
  const started = await relay.answer('session_started', { session_id, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
  assert.equal(started.answered, true)
}

test('#253: a prompt a mod submitted reaches a turn listener as a result a mod delivered', async (t) => {
  const places = placesOf(t)
  const turns = turnsRaised()
  const heard: ArrivingTurn[] = []
  turns.onTurn((turn) => void heard.push(turn))
  const relay = relayFor(places, turns)
  await startedSession(relay, 'session-a')

  const answered = await relay.answer('prompt_submitted', { session_id: 'session-a', text: '[crew 1] A: a hand-off', origin: { kind: 'plugin', name: 'martha' } })

  assert.equal(answered.answered, true)
  assert.deepEqual(heard, [{ text: '[crew 1] A: a hand-off', arrival: { source: 'mcp_result' } }], 'the listener never heard the turn the relay took in, so a message handed to a member can never be counted as taken in')
})

test('#253: the owner typing reaches a listener as the owner', async (t) => {
  const places = placesOf(t)
  const turns = turnsRaised()
  const heard: ArrivingTurn[] = []
  turns.onTurn((turn) => void heard.push(turn))
  const relay = relayFor(places, turns)
  await startedSession(relay, 'session-b')

  await relay.answer('prompt_submitted', { session_id: 'session-b', text: 'do the next thing', origin: { kind: 'composer' } })

  assert.deepEqual(heard, [{ text: 'do the next thing', arrival: { source: 'owner_typed' } }])
})

test('#253: a prompt the relay refuses is raised to no one', async (t) => {
  const places = placesOf(t)
  const turns = turnsRaised()
  const heard: ArrivingTurn[] = []
  turns.onTurn((turn) => void heard.push(turn))
  const relay = relayFor(places, turns)

  // No session was started, so the relay refuses the prompt: a raised refusal would count a message as taken in that
  // the member never took in.
  const answered = await relay.answer('prompt_submitted', { session_id: 'never-started', text: '[crew 1] A: a hand-off', origin: { kind: 'plugin' } })

  assert.equal(answered.answered, true)
  assert.equal((answered.body as { refused?: string }).refused !== undefined, true)
  assert.deepEqual(heard, [])
})
