// A line Martha puts in the owner's row for a member is the row's until the member takes the matter up, and never a line
// another owner wrote (martha#390 r=1).
//
// This exists because the row's `needs` is one slot, shared with every other line the owner is told — a model switch's
// own (martha#359) above all — and a line nobody takes back sits there for the rest of the row's life: the member runs
// the review again, it passes, and the owner's dashboard still says the stopped review is what needs them. Both rules
// are the row's own now (../show_dashboard_beat), and the second also holds across the launcher's own act, so a stopped
// review can never hide a switch the owner has to answer for.
//
// What only a relay-level test can prove is that the launcher's own allow is the act that takes the line back: the
// review rule is stubbed here, and a relay that stopped calling it would leave the first case's line standing.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import { bindNothing } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { CLAUDE_CODE_READ_ATTACHES_NOTHING, CLAUDE_CODE_SUBAGENT_SPAWN, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { DASHBOARD } from '../declare_crew/declare_crew.ts'
import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { hookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import { DEFAULT_CONFIG_DIR, USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { sourcesALaunchHandsTheModel } from '../claude_code_host/what_a_launch_hands_the_model.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { ownerMemoryPlaces, type OwnerUserScope } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { startedWithOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { holdingTheEnds } from '../refresh_a_member/hold_the_end.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { sessionRecordsIn } from '../session_records_in_rows/session_records_in_rows.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { theRowWithNothingSaid, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { memberRelay, type MemberRelay, type TheMembersTelling } from './answer_the_relay.ts'
import { CLAUDE_CODE, A_TELLING_THAT_DID_NOT_REACH, theMembersTelling } from './launch_a_claude_code_member.ts'
import { readTheNewestRelayJournal, relayJournalKeptIn, RELAY_JOURNAL_PLACE } from './keep_the_relays_journal.ts'
import { removeTheTree } from './relay_copy.ts'

const MEMBER = 'builder'
const SESSION = 'the-session'
/** The crew's reviewer model, as its declaration names it: what makes a review the crew's own. */
const THE_REVIEWER_MODEL = 'opus'
/** The line the launcher puts in the row when a review stops at the reviewer model's limit, in its own words. */
const THE_LINE = `review on claude-opus-5-5: ${THE_REVIEWER_MODEL} is at its limit`
/** The line a second stopped review puts in the same slot: the member ran it again, and it stopped again (martha#390 r=2). */
const THE_SECOND_LINE = `review on claude-opus-5-5: ${THE_REVIEWER_MODEL} is at its limit, on the second try`
/** A line another owner wrote in the same slot: the model switch's, which only the switch takes away (martha#359). */
const THE_OTHER_OWNERS_LINE = 'the owner’s default could not be put back; it is kept under the launch’s name'
/** The moment the test's clock starts at, so a beat a write takes and one it never takes are told apart exactly. */
const THE_MOMENT_TOLD = 1_700_000_000_000
/** How long the member takes to report back, in the clock the test holds: no real time passes. */
const THE_MEMBER_GOT_ROUND_TO_IT = 60_000

interface Places {
  readonly member: string
  readonly home: string
  readonly checkout: string
  readonly rows: string
  readonly dashboard: string
}

/** One member's places under a directory the test removes: its checkout, its channel and its rows. */
function placesOf(t: TestContext): Places {
  const home = mkdtempSync(join(tmpdir(), 'martha-390-row-line-'))
  t.after(() => removeTheTree(home))
  const checkout = join(home, 'checkout')
  mkdirSync(checkout)
  execFileSync('git', ['init', '-q', '.'], { cwd: checkout })
  const rows = join(home, CREW_ROWS_PLACE)
  const dashboard = join(home, DASHBOARD)
  mkdirSync(rows, { mode: 0o700 })
  mkdirSync(dashboard, { mode: 0o700 })
  return { member: MEMBER, home, checkout, rows, dashboard }
}

/** The member's row as the store holds it, or undefined while it holds none. */
const theRowNow = (places: Places): DashboardRow | undefined => dashboardRowsIn(places.dashboard).read(MEMBER) ?? undefined

/** Puts a row in the store as the member's own report would leave it, with `needs` said by whoever the test means. */
function aRowSaying(places: Places, needs: string): void {
  dashboardRowsIn(places.dashboard).change(MEMBER, () => ({ ...theRowWithNothingSaid(), member: MEMBER, session: SESSION, at: 1, needs }))
}

const userScopeFor = (home: string): OwnerUserScope => ({
  markdown_kinds: RECORDED_HOST.markdown_kinds,
  output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
  reported_output_styles_dir: join(home, DEFAULT_CONFIG_DIR, CLAUDE_CODE_OUTPUT_STYLES_FOLDER),
})

/** A crew that lets every call through and reads a subagent spawn as its review on the reviewer model. */
function aCrewWhoseReviewsRunOnItsReviewerModel(): CrewTools {
  return {
    tools: [],
    answer: async () => ({ answer: '' }),
    startBeating: () => () => {},
    startSweeping: () => () => {},
    theLineToHandAtStart: async () => null,
    ends: holdingTheEnds(),
    thePredecessorOf: async () => null,
    theReviewModelOfTheCall: async (call) => (call.tool === CLAUDE_CODE_SUBAGENT_SPAWN.tools[0] ? THE_REVIEWER_MODEL : null),
    theReviewModel: async () => THE_REVIEWER_MODEL,
    noteTheCallsAnswer: () => undefined,
    refusesTheSubagent: async () => undefined,
  }
}

/** The receipts the launcher takes for a call that will run. */
function theReceiptsTaken(): SignedRuns {
  return { callAllowed: () => undefined, callAnswered: () => undefined, run: async () => ({ refused: 'this test runs no signed shape' }) }
}

/** The relay for one member, over the crew's tools, the receipts a call takes, and the telling a line reaches. */
function relayFor(places: Places, crew: CrewTools, telling: TheMembersTelling): MemberRelay {
  return memberRelay({
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
    signed_runs: theReceiptsTaken(),
    telling,
    stopMember: () => {},
  })
}

/** The member's review: the subagent spawn the crew's rule reads as one of its reviews. */
const theReview = () => ({
  session_id: SESSION,
  call: {
    tool: CLAUDE_CODE_SUBAGENT_SPAWN.tools[0]!,
    tool_use_id: 'toolu_the_review',
    [CLAUDE_CODE_SUBAGENT_SPAWN.type_field]: 'Explore',
    [CLAUDE_CODE_SUBAGENT_SPAWN.description_field]: 'review the patch',
  },
})

test('#390 r=1: a line the launcher wrote leaves the row once the member takes its review up again, and is not a beat', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: THE_MOMENT_TOLD })
  t.after(() => t.mock.timers.reset())
  const places = placesOf(t)
  aRowSaying(places, '')
  const telling = theMembersTelling(places)
  const relay = relayFor(places, aCrewWhoseReviewsRunOnItsReviewerModel(), telling)
  await relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })

  telling.theRow(THE_LINE)
  const told = theRowNow(places)
  assert.equal(told?.needs, THE_LINE, 'the line about the stopped review never reached the row, so this test could not see it leave')
  assert.equal(told?.at, THE_MOMENT_TOLD, 'telling the owner a line did not stamp the row with the moment it was told')

  // The member reports back before it takes the review up again: the row's `at` is the beat the telling took, and taking
  // the line back must leave it there, or the owner reads the member as having moved when it has not (martha#380).
  t.mock.timers.tick(THE_MEMBER_GOT_ROUND_TO_IT)
  await relay.answer('tool_called', theReview())
  const after = theRowNow(places)
  assert.equal(after?.needs, '', 'the row still says a review that the member has taken up again needs the owner')
  assert.equal(after?.at, told?.at, 'taking the line back moved the row’s `at`, so the owner reads a beat the member never made')
})

test('#390 r=2: a second stopped review replaces the line the first one wrote in the row', (t) => {
  const places = placesOf(t)
  aRowSaying(places, '')
  const telling = theMembersTelling(places)

  telling.theRow(THE_LINE)
  assert.equal(theRowNow(places)?.needs, THE_LINE, 'the first stopped review never reached the row, so this test could not see it replaced')

  // The member ran the review again and it stopped again: the slot says the newer stop, not the one before it.
  telling.theRow(THE_SECOND_LINE)
  assert.equal(
    theRowNow(places)?.needs,
    THE_SECOND_LINE,
    'the second stopped review left the first line standing, so the owner reads a review the member has already run again',
  )
})

test('#390 r=1: a line the launcher wrote never takes another owner’s line off the row', async (t) => {
  const places = placesOf(t)
  aRowSaying(places, '')
  const telling: TheMembersTelling = theMembersTelling(places)
  const relay = relayFor(places, aCrewWhoseReviewsRunOnItsReviewerModel(), telling)
  await relay.answer('session_started', { session_id: SESSION, source: 'startup', hook_event_name: 'SessionStart', transcript_path: '/nowhere' })

  telling.theRow(THE_LINE)
  assert.equal(theRowNow(places)?.needs, THE_LINE, 'the line about the stopped review never reached an empty row')

  // The switch writes over it, as it may: the slot is one, and its line is the newer news. Taking the launcher's own line
  // back must then leave the switch's where it is — it is not this telling's line any more.
  aRowSaying(places, THE_OTHER_OWNERS_LINE)
  telling.takeTheLineBack()
  assert.equal(theRowNow(places)?.needs, THE_OTHER_OWNERS_LINE, 'taking back a line this launcher wrote removed the line another owner wrote over it')

  // And the other way round: a line the launcher writes never takes another owner's line either.
  telling.theRow(THE_LINE)
  assert.equal(theRowNow(places)?.needs, THE_OTHER_OWNERS_LINE, 'a stopped review took the model switch’s own line off the row, so the owner is never told the switch needs them')

  // Nor does the launcher's own allow, which is the act that otherwise takes the line back.
  await relay.answer('tool_called', theReview())
  assert.equal(theRowNow(places)?.needs, THE_OTHER_OWNERS_LINE, 'the launcher took away a line it never wrote')
})

test('#430: a telling the member\'s store refuses is written down in the journal, not swallowed', async (t) => {
  const places = placesOf(t)
  // A file standing where the rows store would make its directory: every append under it is refused, by the file system.
  const blocked = join(places.home, 'a-file-where-the-store-would-go')
  writeFileSync(blocked, '')
  const journals = join(places.home, RELAY_JOURNAL_PLACE)
  mkdirSync(journals, { mode: 0o700 })
  const journal = relayJournalKeptIn(journals, 'launch-of-the-test')
  const telling = theMembersTelling({ ...places, rows: blocked, journal })

  await telling.theMember(THE_LINE)

  const written = readTheNewestRelayJournal(journals).events
  const noted = written.at(-1)
  assert.equal(noted?.phase, 'noted', `the refused telling left no line of its own in the journal: ${JSON.stringify(written)}`)
  assert.equal(noted?.event, A_TELLING_THAT_DID_NOT_REACH, 'the journal line does not say what the launcher could not do')
  assert.ok((noted?.why ?? '') !== '', 'the journal line carries none of the store\'s own words for the refusal')

  // The refusal is the member's half only: the member is not told twice, and nothing is thrown at the caller that told it.
  const again = await telling.theMember(THE_LINE)
  assert.equal(again, undefined, 'a refused telling answered with something other than nothing')
})
