// The three tools that keep the Supervisor's standing items, and the owner's pane that shows them (martha#317).
//
// The tools decide nothing of their own: #316's table answer says who may record and close, every member may read,
// the item is written as this launch's member and never as a name the call carries, and the items live in the crew's
// row streams. A ruling recorded there never unlocks a landing: no landing slice reads the stream.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER } from '../declare_crew/declare_crew.ts'
import { THE_OWNERS_TODO_ASK } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import {
  DUE,
  NOTHING_STANDS,
  STANDING,
  STANDING_ADD,
  STANDING_CLOSE,
  STANDING_HEADING,
  STANDING_STREAM,
  theStandingItems,
} from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { recordIngestion, refuseExecutionAfterUngatedText, startFreshSession } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { CREW_TOOL_NAMES, CREW_TOOLS, crewToolsOver, type CoreToolAnswer, type CrewTools } from './a_crews_tools.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-standing-tools-'))
after(() => removeTheTree(homeOfAll))

const NOW = Date.UTC(2026, 10, 20, 9, 0, 0)

/** A team whose table lets only the owner and the lead assign work. */
const A_TEAM = {
  version: DECLARATION_VERSION,
  owner: 'an owner',
  members: [
    { name: 'Supervisor', role: 'lead' },
    { name: 'Pallas', role: 'builder' },
  ],
  mode: { name: 'team', roles: ['lead', 'builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER, 'lead']])) },
  channel_read_seconds: 30,
}

interface APlace {
  readonly root: string
  readonly rows: string
}

let placesSoFar = 0
function aPlace(): APlace {
  placesSoFar += 1
  const home = join(homeOfAll, `place-${placesSoFar}`)
  const root = join(home, 'checkout')
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(root, { recursive: true })
  mkdirSync(rows, { mode: STREAM_DIRECTORY_MODE })
  const declared = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  documentsOf.set(root, async (path) => {
    if (path === declared) return JSON.stringify(A_TEAM)
    throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
  })
  return { root, rows }
}

const documentsOf = new Map<string, (path: string) => Promise<string>>()

/** The tools `member` calls over `place`, as a launch would hand them. */
function toolsOf(place: APlace, member: string): CrewTools {
  return crewToolsOver({
    member,
    ledger: { clock: { now: () => NOW }, stores: { rows: rowStreamsDirectory(place.rows) } },
    beats: dashboardRowsIn(join(place.rows, '..', 'beats')),
    root: place.root,
    documents: { read: documentsOf.get(place.root)! },
    stores: { crew: crewFilesDirectory(join(place.rows, '..', 'crew-store')) },
  })
}

const A_HOLD = { kind: 'held', id: 'martha-353', item: 'PR 353', reason: 'lands after the demo', until: '2026-11-20' }
const A_RULING = { kind: 'decided', id: 'martha-319', rule: 'two packages', date: '2026-11-13', words: 'yes, land macula-io/martha 1111111..2222222' }

const theStream = async (place: APlace) => rowStreamsDirectory(place.rows).read(STANDING_STREAM)
const answerOf = (said: CoreToolAnswer): string => {
  assert.ok('answer' in said, 'refused' in said ? said.refused : '')
  return said.answer
}

test('the three tools are registered under their own names, each with a schema', () => {
  for (const name of [STANDING_ADD, STANDING_CLOSE, STANDING]) {
    assert.ok((CREW_TOOL_NAMES as readonly string[]).includes(name), `${name} is not a tool the crew registers`)
    assert.ok(CREW_TOOLS.some((tool) => tool.name === name), `${name} has no registered schema`)
  }
})

test('a member the table does not let assign work may not record or close, and the stream is unchanged', async () => {
  const place = aPlace()
  const added = await toolsOf(place, 'Pallas').answer(STANDING_ADD, A_HOLD, 'a-session')
  assert.ok('refused' in added, 'a builder recorded a hold though its table lets only the owner and the lead assign work')
  assert.match(added.refused, /may not record or close standing items: this crew's table lets owner, lead assign work/)
  answerOf(await toolsOf(place, 'Supervisor').answer(STANDING_ADD, A_HOLD, 'a-session'))
  const closed = await toolsOf(place, 'Pallas').answer(STANDING_CLOSE, { id: A_HOLD.id, evidence: 'the demo is over' }, 'a-session')
  assert.ok('refused' in closed, 'a builder closed the Supervisor\'s hold')
  assert.equal((await theStream(place)).length, 1, 'a refused call wrote into the stream')
})

test('every member reads what stands, and an item is written as the launch\'s member, not a name the call carries', async () => {
  const place = aPlace()
  answerOf(await toolsOf(place, 'Supervisor').answer(STANDING_ADD, { ...A_RULING, recorded_by: 'the owner' }, 'a-session'))
  assert.deepEqual(theStandingItems(await theStream(place)).map((item) => item.recorded_by), ['Supervisor'])
  const read = answerOf(await toolsOf(place, 'Pallas').answer(STANDING, {}, 'a-session'))
  assert.match(read, /^- DECIDED, recorded by Supervisor: 2026-11-13 "yes, land macula-io\/martha 1111111\.\.2222222" \(martha-319\): two packages\.$/)
})

test('standing with nothing recorded says so', async () => {
  assert.equal(answerOf(await toolsOf(aPlace(), 'Pallas').answer(STANDING, {}, 'a-session')), NOTHING_STANDS)
})

test('the owner\'s pane shows the items under the to-do list, a hold on its day reading DUE, and counts their lines', async () => {
  const place = aPlace()
  const empty = JSON.parse(answerOf(await toolsOf(place, 'Pallas').answer(THE_OWNERS_TODO_ASK, {}, 'a-session'))) as { standing: string[]; lines: number }
  assert.deepEqual(empty.standing, [], 'nothing stands, yet the pane draws a standing block')
  answerOf(await toolsOf(place, 'Supervisor').answer(STANDING_ADD, A_HOLD, 'a-session'))
  const pane = JSON.parse(answerOf(await toolsOf(place, 'Pallas').answer(THE_OWNERS_TODO_ASK, {}, 'a-session'))) as { standing: string[]; lines: number }
  assert.equal(pane.standing[0], STANDING_HEADING)
  assert.ok(pane.standing[1]?.includes(`(${DUE})`), String(pane.standing[1]))
  assert.equal(pane.lines, empty.lines + pane.standing.length, 'the pane asks the host for too few lines to draw the items')
})

test('with the strict gate on, a session holding an outsider\'s text is refused standing_add', () => {
  const tainted = recordIngestion(startFreshSession(), [{ path: 'A6', from_node_id: 'b'.repeat(64) }])
  const decided = refuseExecutionAfterUngatedText({ tool: `mcp__martha__${STANDING_ADD}`, session: tainted, policy: { may_send_executable_text: [] }, strict_gate: true })
  assert.equal(decided.allow, false, 'a tainted session may record a ruling with the gate on')
})

// --- design test 8: a ruling is the Supervisor's record of the owner's words, never the owner's yes -----------------

/** The slices that land work or check a range for the owner's yes (martha#256), and the glue that calls them. */
const THE_LANDING_SLICES = [
  'check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts',
  'land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts',
  'find_the_work_a_verdict_passed/find_the_work_a_verdict_passed.ts',
]

/** The function in the crew's tools that answers each landing tool, which must not reach the stream either. */
const THE_LANDING_ANSWERS = ['verifyTheRange', 'landTheBatch', 'fastForwardOntoTheApprovedTip']

const SOURCE = join(import.meta.dirname, '..')

test('no landing slice reads the standing stream, so a recorded ruling cannot unlock a landing (mutant: a landing slice that reads it)', () => {
  for (const slice of THE_LANDING_SLICES) {
    const text = readFileSync(join(SOURCE, slice), 'utf8')
    assert.ok(!text.includes('keep_the_supervisors_standing_items'), `${slice} imports the standing items`)
    assert.ok(!text.includes(`'${STANDING_STREAM}'`), `${slice} names the standing stream`)
  }
})

test('no answer of a landing tool in the crew\'s tools reaches the standing items', () => {
  const tools = readFileSync(join(SOURCE, 'a_crews_tools', 'a_crews_tools.ts'), 'utf8')
  for (const name of THE_LANDING_ANSWERS) {
    const start = tools.indexOf(`async function ${name}(`)
    assert.ok(start >= 0, `${name} is not in the crew's tools`)
    const body = tools.slice(start, tools.indexOf('\n}\n', start))
    for (const reach of ['theItemsThatStand', 'STANDING_STREAM', 'theStandingItems']) assert.ok(!body.includes(reach), `${name} reaches ${reach}`)
  }
})
