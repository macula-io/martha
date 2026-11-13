// The nudges a crew's pane draws are the launcher's wiring, not only the rules (martha#320, r=2 R2).
//
// This exists because the rules were tested and the wiring was not: `theNudgesFor` runs the crew's switches, its
// receivers, its cycle finder, its landings and its park markers, and every one of those five could be dropped without a
// test noticing, since each had its own unit test one call away. So each case here goes through the tool the mod
// registers, `see_the_crew`, and reads back the pane's answer as the member would — the answer is the only place the
// five meet.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, MINUTE_MS, OWNER } from '../declare_crew/declare_crew.ts'
import type { CoreToolAnswer, CrewTools } from './a_crews_tools.ts'
import { crewToolsOver } from './a_crews_tools.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { appendToTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { noteMilestone } from '../log_ledger/log_ledger.ts'
import { PARK_A_MEMBER } from './a_crews_tools.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The moment every test reads the pane at. */
const NOW = 1_700_000_000_000
const HOUR = 60 * MINUTE_MS
const STALLED = 60 * MINUTE_MS
const PERSON = 30 * MINUTE_MS
const REVIEW = 45 * MINUTE_MS

/** The member that reads the pane: the mode's table grants it `assign_work`, and it reviews no package. */
const RECEIVER = 'Supervisor'
const MEMBER = 'Vesta'
const OTHER = 'Mars'
const OWNER_NAME = 'the-owner'

/** A hand-off line, as a member writes one. */
const handoff = (package_name: string, round = 1): string =>
  `HANDOFF ${package_name} ${'a'.repeat(40)}..${'b'.repeat(40)} r=${round} ci=none:paths`

/** One member's row, fresh and at work unless the test says otherwise. */
function row(member: string, changes: Partial<DashboardRow> = {}): DashboardRow {
  return {
    member,
    session: `session-${member}`,
    at: NOW - 1_000,
    state: 'working',
    holds: 'macula-io/martha#320',
    task: 'Build the stall nudges',
    progress: { step: 1, of: 4, at: NOW - 1_000 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: '', contextPercent: 20, costUsd: 1 },
    ...changes,
  }
}

/** The declaration a test writes: three members, the receiver's role routing the work, and nudges on by default. */
function theDeclaration(nudges: boolean): string {
  return JSON.stringify({
    version: 1,
    owner: OWNER_NAME,
    members: [
      { name: RECEIVER, role: SUPERVISOR },
      { name: MEMBER, role: 'builder' },
      { name: OTHER, role: 'builder' },
    ],
    mode: {
      name: 'team',
      roles: [SUPERVISOR, 'builder'],
      may: { assign_work: [SUPERVISOR], approve_landing: [OWNER], resume_parked_work: [SUPERVISOR] },
    },
    house_rules: nudges
      ? { nudges: true, stalled_minutes: STALLED / MINUTE_MS, review_minutes: REVIEW / MINUTE_MS, person_minutes: PERSON / MINUTE_MS }
      : { nudges: false },
    channel_read_seconds: 30,
  })
}

/** A crew a test owns: the tools its member calls, its rows, and the ledger its messages and landings go into. */
interface ACrew {
  readonly tools: CrewTools
  readonly beats: DashboardStore
  /** Keeps a member's row, failing the test when the store refuses it. */
  readonly beat: (held: DashboardRow) => void
  readonly ledger: { readonly clock: { now(): number }; readonly stores: { readonly rows: ReturnType<typeof rowStreamsDirectory> } }
  /** Moves the crew's clock, so a message or a landing is written at the moment the test means. */
  readonly at: (moment: number) => void
}

function aCrew(t: TestContext, changes: { readonly member?: string; readonly nudges?: boolean } = {}): ACrew {
  const home = mkdtempSync(join(tmpdir(), 'martha-320-pane-'))
  t.after(() => removeTheTree(home))
  const root = join(home, 'checkout')
  const declared = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  mkdirSync(join(root, DECLARATION_DIRECTORY), { recursive: true })
  writeFileSync(declared, theDeclaration(changes.nudges ?? true))
  const crew = join(home, 'crew-store')
  mkdirSync(crew, { recursive: true })

  const started = hostForTests({ now: NOW - 12 * HOUR })
  const rows = join(home, 'row-streams')
  mkdirSync(rows, { recursive: true, mode: 0o700 })
  const ledger = { clock: started.host.clock, stores: { rows: rowStreamsDirectory(rows) } }
  mkdirSync(join(home, 'row'), { recursive: true, mode: 0o700 })
  const beats = dashboardRowsIn(join(home, 'row'))
  const tools = crewToolsOver({
    member: changes.member ?? RECEIVER,
    ledger,
    beats,
    root,
    documents: { read: (path: string) => readFile(path, 'utf8') },
    stores: { crew: crewFilesDirectory(crew) },
  })
  const at = (moment: number): void => started.advanceClock(moment - started.host.clock.now())
  /** Keeps a row, and fails loudly when the store would not: a row a test wrote but the crew never read proves nothing. */
  const beat = (held: DashboardRow): void => {
    const kept = beats.keep(held)
    assert.ok(kept.kept, `the test's row for ${held.member} was not kept: ${kept.why ?? ''}`)
  }
  return { tools, beats, ledger, at, beat }
}

/** The lines the pane draws that are nudges: the block under the members' rows, and none of the rows themselves. */
function theNudgesDrawn(answer: CoreToolAnswer): readonly string[] {
  assert.ok('answer' in answer, `the pane was refused: ${'refused' in answer ? answer.refused : ''}`)
  return (JSON.parse(answer.answer) as { readonly lines: readonly string[] }).lines.filter((line) => line.startsWith('- '))
}

test('r=2 R2: a crew that reads no nudges draws none, though a member has stalled for hours', async (t) => {
  const crew = aCrew(t, { nudges: false })
  crew.beat(row(MEMBER, { progress: { step: 1, of: 4, at: NOW - 10 * STALLED } }))

  assert.deepEqual(theNudgesDrawn(await crew.tools.answer('see_the_crew', {}, 'a-session')), [], 'a crew that did not switch nudges on was drawn the block anyway')
})

test('r=2 R2: a member the table does not grant the crew\'s work to draws no nudges', async (t) => {
  const crew = aCrew(t, { member: MEMBER })
  crew.beat(row(OTHER, { progress: { step: 1, of: 4, at: NOW - 10 * STALLED } }))

  assert.deepEqual(theNudgesDrawn(await crew.tools.answer('see_the_crew', {}, 'a-session')), [], 'a builder was drawn the Supervisor\'s nudges')
})

test('r=2 R2: two members waiting on each other reach the pane as a cycle', async (t) => {
  const crew = aCrew(t)
  crew.beat(row(MEMBER, { state: 'waiting', waits: { on: OTHER, for: 'a verdict', since: NOW - 10 * HOUR } }))
  crew.beat(row(OTHER, { state: 'waiting', waits: { on: MEMBER, for: 'a clone', since: NOW - 10 * HOUR } }))

  const drawn = theNudgesDrawn(await crew.tools.answer('see_the_crew', {}, 'a-session'))
  assert.equal(drawn.filter((line) => line.startsWith('- deadlock: ')).length, 1, `the cycle was dropped on its way to the pane: ${JSON.stringify(drawn)}`)
})

test('r=2 R2: a landing ends the wait before it and never the hand-off after it, both read from the ledger', async (t) => {
  const crew = aCrew(t)
  // Package A of #320 hands off, lands, and package B of the same issue hands off after it. Package #321 hands off and
  // lands with nobody writing again: only #320's B is a wait, and it is the one the landing must not have ended.
  crew.at(NOW - 6 * HOUR)
  await appendToTheChannel(crew.ledger, { from: MEMBER, to: [OTHER], text: handoff('macula-io/martha#320'), sent_at: NOW - 6 * HOUR })
  crew.at(NOW - 5 * HOUR)
  await appendToTheChannel(crew.ledger, { from: MEMBER, to: [OTHER], text: handoff('macula-io/martha#321'), sent_at: NOW - 5 * HOUR })
  crew.at(NOW - 4 * HOUR)
  await noteMilestone(crew.ledger, { package: 'macula-io/martha#320', member: RECEIVER, milestone: 'package_landed', note: 'a..b' })
  crew.at(NOW - 3 * HOUR)
  await noteMilestone(crew.ledger, { package: 'macula-io/martha#321', member: RECEIVER, milestone: 'package_landed', note: 'a..b' })
  crew.at(NOW - 2 * HOUR)
  await appendToTheChannel(crew.ledger, { from: MEMBER, to: [OTHER], text: handoff('macula-io/martha#320', 2), sent_at: NOW - 2 * HOUR })
  crew.at(NOW)

  const drawn = theNudgesDrawn(await crew.tools.answer('see_the_crew', {}, 'a-session'))
  const reviews = drawn.filter((line) => line.startsWith('- review: '))
  assert.equal(reviews.length, 1, `the landings were not read as landings: ${JSON.stringify(drawn)}`)
  assert.match(reviews[0] ?? '', /#320/, 'the wait drawn is not the hand-off made after the landing')
  assert.doesNotMatch(reviews[0] ?? '', /#321/, 'a package that landed is still drawn as waiting')
})

test('r=2 R2: a member the crew parked is drawn as parked, however busy its row still says it is', async (t) => {
  const crew = aCrew(t)
  const parked = await crew.tools.answer(PARK_A_MEMBER, { reason: 'resting until the owner decides', member: OTHER }, 'a-session')
  assert.ok('answer' in parked, `the crew could not park a member: ${'refused' in parked ? parked.refused : ''}`)
  crew.beat(row(OTHER, { state: 'working', progress: { step: 1, of: 4, at: NOW - 10 * STALLED } }))
  crew.beat(row(MEMBER, { progress: { step: 1, of: 4, at: NOW - 1_000 } }))

  const drawn = theNudgesDrawn(await crew.tools.answer('see_the_crew', {}, 'a-session'))
  assert.deepEqual(drawn.filter((line) => line.includes(OTHER)), [], `a parked member was drawn as stalled: ${JSON.stringify(drawn)}`)
})
