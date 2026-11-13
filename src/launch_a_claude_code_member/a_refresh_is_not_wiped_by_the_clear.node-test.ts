// A refreshed session inherits its predecessor's record, whichever of the host's two events names it first (martha#255,
// design test 6 and Mercurius's O1).
//
// A `/clear` the mod ran starts a new session id, and the host reports that start as a `clear` — declared `fresh`. On
// its own that is a wipe: the successor would read a handover written by a tainted predecessor with an empty record, and
// the taint would be laundered by the crew's own rhythm. So while the crew's flow is clearing, the first event that
// names the new session makes it a `crew_refresh` with the recorded predecessor, and a later `clear` start for a
// session already made leaves it alone.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { memberRelay, type MemberRelay } from './answer_the_relay.ts'
import { CLAUDE_CODE } from './launch_a_claude_code_member.ts'
import { removeTheTree } from './relay_copy.ts'
import { sessionRecordsIn } from './session_records_in_rows.ts'

interface Places {
  readonly home: string
  readonly checkout: string
  readonly rows: string
}

const SESSION = 'the-session-before'
const SUCCESSOR = 'the-session-after'

/** One member's places under a directory the test removes. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-255-refresh-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(rows, { mode: 0o700 })
  return { home, checkout, rows }
}

const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, DEFAULT_CONFIG_DIR, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** The crew's tools, of which this test uses only the one question the flow is asked through the launcher. */
function aCrewClearingFrom(predecessor: string | null): CrewTools {
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    theLineToHandAtStart: async () => null,
    thePredecessorOf: async (session_id) => (session_id === SUCCESSOR ? predecessor : null),
  }
}

/** The relay for one member, over a crew's own tools. */
function relayFor(places: Places, crew: CrewTools, sessions?: Map<string, never>): MemberRelay {
  return memberRelay(
    {
      records: sessionRecordsIn(rowStreamsDirectory(places.rows)),
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
      crew,
      stopMember: () => {},
    },
    sessions as Map<string, never> | undefined,
  )
}

/** What the launch kept for a session, read back off the disk the launcher flushed it to. */
async function theRecordOf(places: Places, session_id: string) {
  const records = sessionRecordsIn(rowStreamsDirectory(places.rows))
  await records.load(session_id)
  return records.store.read(session_id)
}

test('#255: the host’s own `clear` start is made the crew’s refresh, and inherits the predecessor', async (t) => {
  const places = placesOf(t)
  const relay = relayFor(places, aCrewClearingFrom(SESSION))
  assert.equal((await relay.answer('session_started', { session_id: SESSION, source: 'startup' })).answered, true)
  // The predecessor took one thing in, which is what a successor has to inherit.
  await relay.answer('prompt_submitted', { session_id: SESSION, text: 'a ring from a stranger', origin: { kind: 'plugin' } })
  const before = await theRecordOf(places, SESSION)
  assert.equal(before?.ingested.length, 1, 'the predecessor took nothing in, so there would be nothing to inherit')

  const started = await relay.answer('session_started', { session_id: SUCCESSOR, source: 'clear' })
  assert.equal(started.answered, true, 'the successor’s start was refused')
  const after = await theRecordOf(places, SUCCESSOR)
  assert.equal(after?.ingested.length, 1, 'the successor inherited none of what its predecessor took in')
  assert.deepEqual(after?.ingested, before?.ingested, 'the successor’s record is not its predecessor’s')
})

test('#255: a second `clear` start for a session already made a refresh does not wipe what it inherited', async (t) => {
  const places = placesOf(t)
  const relay = relayFor(places, aCrewClearingFrom(SESSION))
  await relay.answer('session_started', { session_id: SESSION, source: 'startup' })
  await relay.answer('prompt_submitted', { session_id: SESSION, text: 'a ring from a stranger', origin: { kind: 'plugin' } })
  await relay.answer('session_started', { session_id: SUCCESSOR, source: 'clear' })
  // The same start, reported again after the refresh: it must leave the inherited record as it is.
  const again = await relay.answer('session_started', { session_id: SUCCESSOR, source: 'clear' })
  assert.equal(again.answered, true)
  assert.equal((await theRecordOf(places, SUCCESSOR))?.ingested.length, 1, 'a second clear start wiped the inherited record')
})

test('#255: a repeat start answers as taken and leaves the record it inherited as it was', async (t) => {
  const places = placesOf(t)
  const relay = relayFor(places, aCrewClearingFrom(SESSION))
  await relay.answer('session_started', { session_id: SESSION, source: 'startup' })
  await relay.answer('prompt_submitted', { session_id: SESSION, text: 'a ring from a stranger', origin: { kind: 'plugin' } })
  const before = await theRecordOf(places, SESSION)
  await relay.answer('session_started', { session_id: SUCCESSOR, source: 'clear' })
  // The same start reported again. A session whose record is begun a second time is refused that begin and reads from
  // then on as one whose record was lost, so a successor that only kept the right NUMBER of ingestions would still
  // have handed its handover to a session that trusts none of them.
  assert.equal((await relay.answer('session_started', { session_id: SUCCESSOR, source: 'clear' })).answered, true)
  assert.deepEqual(
    (await theRecordOf(places, SUCCESSOR))?.ingested,
    before?.ingested,
    'a repeat start replaced the record the successor inherited with one that reads as lost',
  )
})

test('#255: with no clear in flight, a `clear` start is still a fresh session', async (t) => {
  const places = placesOf(t)
  const relay = relayFor(places, aCrewClearingFrom(null))
  await relay.answer('session_started', { session_id: SESSION, source: 'startup' })
  await relay.answer('prompt_submitted', { session_id: SESSION, text: 'a ring from a stranger', origin: { kind: 'plugin' } })
  await relay.answer('session_started', { session_id: SUCCESSOR, source: 'clear' })
  assert.equal((await theRecordOf(places, SUCCESSOR))?.ingested.length, 0, 'a clear with no crew refresh behind it inherited a record')
})

test('#255: a prompt from the successor is taken in even when it arrives before the host’s start of it', async (t) => {
  const places = placesOf(t)
  const relay = relayFor(places, aCrewClearingFrom(SESSION))
  await relay.answer('session_started', { session_id: SESSION, source: 'startup' })
  await relay.answer('prompt_submitted', { session_id: SESSION, text: 'a ring from a stranger', origin: { kind: 'plugin' } })
  // The mod submits the resume prompt the moment its clear returns, which can be before the host's own start is heard.
  const taken = await relay.answer('prompt_submitted', { session_id: SUCCESSOR, text: 'You are the member. Read your handover at …', origin: { kind: 'plugin' } })
  assert.equal(taken.answered, true, 'the resume prompt was refused for a session the crew had just made')
  const after = await theRecordOf(places, SUCCESSOR)
  assert.equal(after?.ingested.length, 2, 'the successor kept neither its predecessor’s record nor its own first prompt')
})
