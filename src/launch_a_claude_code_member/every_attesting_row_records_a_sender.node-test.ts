// Every row whose registry attestation is not `none` records a sender when the
// thing that really records it is driven (martha#247).
//
// The registry promises, per row, who vouches for a sender. A row that promises
// one and records nothing costs a member its shell every time text arrives on
// it: that was A4 and A5 until this package, where the station's word was never
// passed from a ring's result. So this drives what really records each such row
// — the gated room read for A1 and A2, the seam for the rows whose producer is
// another repository's (A3, the crew mod's digest) or the launcher's own binder
// (A6), and the relay with a recorded host answer for the two ring rows — and
// hands every ingestion to the coverage check, which names any attested row that
// records no node id. There is no list of rows let off.
//
// The last case takes the ring answers away again and asserts that A4 and A5 are
// then named: without it, a check that had stopped looking would still pass.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { bindNothing, binderOverLaunches, recordMemberLaunch, type MemberLaunchStore } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { rowsWhoseAttestationNothingSupplies } from '../check_every_path_is_gated/check_every_path_is_gated.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OWNERS_MARKDOWN, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { CLAUDE_SERVERS, CLAUDE_SETTINGS, startedWithOf, type StartedWith } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { readRoomThroughItsGate } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { ANSWERS_A_RING, RINGS_AND_RETURNS_THE_ANSWER } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import type { Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { beginSession, PATH_OF_SOURCE, takeInTurn, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'
import { memberRelay, type MemberRelay } from './answer_the_relay.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { removeTheTree } from './relay_copy.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'

// Synthetic node ids and pids, never a real one: this repository is public.
const MEMBER = 'a'.repeat(64)
const OTHER_MEMBER = 'b'.repeat(64)
const LAUNCHED = { member_name: 'Pluto', node_id: OTHER_MEMBER, pid: 4101 }
const STARTED = '900100'

interface RecordedAnswer {
  readonly tool_name: string
  readonly tool_input: Readonly<Record<string, unknown>>
  readonly tool_call_answer: unknown
}

/** The host's own answers for the two ring tools, taken live (../read_a_ring_results_sender). */
const RECORDED_ANSWERS = (
  JSON.parse(readFileSync(new URL('../read_a_ring_results_sender/recorded_host_ring_answers.json', import.meta.url), 'utf8')) as {
    readonly answers: Readonly<Record<string, RecordedAnswer>>
  }
).answers

const bytes = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

/** A launch's approved config that holds every kind of thing a launch can hand the model at start. */
const CARRIED = {
  [CLAUDE_SETTINGS]: bytes({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo from the checkout' }] }] } }),
  [CLAUDE_SERVERS]: bytes({ mcpServers: { probe: { command: 'npx', args: ['-y', 'a-probe-server@1.0.0'] } } }),
}

const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, '.claude', CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** A member's places, under one directory the test removes. */
function placeOf(t: TestContext): { readonly home: string; readonly checkout: string; readonly rows: string } {
  const home = mkdtempSync(join(tmpdir(), 'martha-247-attested-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, 'rows')
  mkdirSync(rows, { mode: 0o700 })
  return { home, checkout, rows }
}

/** A session record store that hands every record written through it to the drive, before anything replaces it. */
function recordingStore(inner: SessionRecordStore, into: Ingestion[]): SessionRecordStore {
  return {
    read: (session_id) => inner.read(session_id),
    write: (session_id, session) => {
      into.push(...session.ingested)
      inner.write(session_id, session)
    },
  }
}

/** The relay for one member, its events answered as the host answers them. */
function relayFor(place: { readonly home: string; readonly checkout: string; readonly rows: string }, store: SessionRecordStore): MemberRelay {
  const records = sessionRecordsIn(rowStreamsDirectory(place.rows))
  return memberRelay({
    records: { ...records, store },
    launch: { host: CLAUDE_CODE, launch_dir: place.checkout, stop_dir: place.home, approved_fingerprints: [] },
    policy: { may_send_executable_text: [] },
    names: { ownNameOf: ownNameOfCalledTool },
    started_with: startedWithTheSwitchesOfTheAdapter(),
    binder: bindNothing,
    handed_at_start: sourcesALaunchHandsTheModel(CARRIED),
    hookSettings: hookSettingsWatch({
      user: join(place.home, '.claude', 'settings.json'),
      home: place.home,
      approved: undefined,
      managed: { ...RECORDED_HOST.managed_settings, dir: join(place.home, 'managed') },
      switches: CLAUDE_CODE_HOOK_SWITCHES,
      markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
    }),
    ownerMemory: ownerMemoryPlaces({ launcher_env: { HOME: place.home }, member_env: { HOME: place.home }, home: place.home, launch_dir: place.checkout, settings_files: [], user_scope: userScopeFor(place.home) }),
    stopMember: () => {},
  })
}

/** What these launches started the host with: the arguments and environment the adapter's declaration names. */
function startedWithTheSwitchesOfTheAdapter(): StartedWith {
  return startedWithOf(CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_READ_ATTACHES_NOTHING.args, CLAUDE_CODE_READ_ATTACHES_NOTHING.env)
}

/**
 * Every ingestion the relay records for two ring answers and for the owner typing
 * at the member's own terminal. Taken as the records are written, not from the
 * last one left behind: a ring answer that records no sender stops the member and
 * the stop keeps a record of its own, so the ingestion is only visible on the way
 * in — which is exactly the case this check has to see.
 */
async function ingestionsTheRelayRecords(t: TestContext, answers: Readonly<Record<string, RecordedAnswer>>): Promise<readonly Ingestion[]> {
  const place = placeOf(t)
  const into: Ingestion[] = []
  const records = sessionRecordsIn(rowStreamsDirectory(place.rows))
  const relay = relayFor(place, recordingStore(records.store, into))
  const sessions: string[] = []

  const session = async (name: string): Promise<string> => {
    const id = `${name}-${sessions.length}`
    sessions.push(id)
    await relay.answer('session_started', { session_id: id, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })
    return id
  }

  const typed = await session('typed')
  await relay.answer('prompt_submitted', { session_id: typed, text: 'hello', origin: { kind: 'composer' } })

  for (const [tool, answer] of Object.entries(answers)) {
    const id = await session(`answer-${tool}`)
    await relay.answer('tool_answered', {
      session_id: id,
      call: { tool: `mcp__macula__${tool}`, ...answer.tool_input },
      answer: answer.tool_call_answer,
    })
  }

  return into
}

/** A1 and A2: the gated room read, with one admitted envelope from a roster member. */
function ingestionsTheRoomReadsRecord(): readonly Ingestion[] {
  const store: SessionRecordStore = { read: () => undefined, write: () => {} }
  const envelopes = [{ message_id: 'm-1', from_node_id: MEMBER, to_node_ids: [OTHER_MEMBER], kind: 'message' as const, attested: true, text: 'hello' }]
  const rosters = { crew: { member_node_ids: [MEMBER] }, shared: { member_node_ids: [MEMBER] } }
  return (['crew_room', 'shared_room'] as const).flatMap(
    (room) =>
      readRoomThroughItsGate({
        session: beginSession(store, `read-${room}`),
        room,
        envelopes,
        rosters,
        self_node_id: OTHER_MEMBER,
      }).session.gate.ingested,
  )
}

/** A3 and A6: the seam, for the rows whose producer is the crew mod's digest or the launcher's own binder. */
function ingestionsTheSeamRecords(): readonly Ingestion[] {
  const store: SessionRecordStore = { read: () => undefined, write: () => {} }
  const launches: MemberLaunchStore = hostForTests({ launches: [{ key: LAUNCHED.member_name, row: LAUNCHED }] }).launcherRecords
  const processes = { identityOf: (pid: number) => (pid === LAUNCHED.pid ? STARTED : null) }
  assert.deepEqual(recordMemberLaunch(launches, processes, LAUNCHED), { recorded: true })
  const binder = binderOverLaunches(launches, processes, () => [{ member_name: LAUNCHED.member_name, node_id: LAUNCHED.node_id }])

  const digest = takeInTurn(beginSession(store, 'digest'), { source: 'backlog_digest', from_identity: MEMBER }, bindNothing)
  const cross = takeInTurn(beginSession(store, 'cross'), { source: 'cross_session', sender: { sending_pid: LAUNCHED.pid } }, binder)
  return [...digest.gate.ingested, ...cross.gate.ingested]
}

test('every row that stands on an attestation records a sender, driven as it really is (martha#247)', async (t) => {
  const recorded = [...(await ingestionsTheRelayRecords(t, RECORDED_ANSWERS)), ...ingestionsTheRoomReadsRecord(), ...ingestionsTheSeamRecords()]
  assert.deepEqual(rowsWhoseAttestationNothingSupplies(recorded), [])
})

test('the drive is not vacuous: without the recorded ring answers, A4 and A5 are named', async (t) => {
  const empty = { [RINGS_AND_RETURNS_THE_ANSWER]: { ...RECORDED_ANSWERS[RINGS_AND_RETURNS_THE_ANSWER], tool_call_answer: undefined }, [ANSWERS_A_RING]: { ...RECORDED_ANSWERS[ANSWERS_A_RING], tool_call_answer: undefined } } as unknown as Readonly<Record<string, RecordedAnswer>>
  const recorded = [...(await ingestionsTheRelayRecords(t, empty)), ...ingestionsTheRoomReadsRecord(), ...ingestionsTheSeamRecords()]
  const named = rowsWhoseAttestationNothingSupplies(recorded).map((gap) => gap.path)
  assert.deepEqual(named.sort(), [PATH_OF_SOURCE.ring, PATH_OF_SOURCE.ring_answer].sort())

  // And the reason reaches the record, from the parse through the turn to the ingestion the
  // refusal reads: a row that says only "null" leaves the member to guess which branch it was.
  for (const path of [PATH_OF_SOURCE.ring, PATH_OF_SOURCE.ring_answer]) {
    const [ring] = recorded.filter((ingest) => ingest.path === path)
    assert.equal(typeof ring?.why, 'string', `${path} records no reason for its missing sender`)
    assert.ok((ring?.why ?? '').length > 0, `${path} records an empty reason`)
  }
})

test('a row whose attestation is none is not asked for a sender, and a row the registry declares no turn source is not either', () => {
  const onANoneRow: Ingestion = { path: 'A10', from_node_id: null }
  assert.deepEqual(rowsWhoseAttestationNothingSupplies([onANoneRow]), [])
})
