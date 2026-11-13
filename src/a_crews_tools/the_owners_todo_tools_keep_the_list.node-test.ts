// The two tools that keep the owner's to-do list, and the ask the pane reads it through (martha#316).
//
// The tools decide nothing of their own: the declaration's table says who may keep the list
// (../keep_the_owners_todo_list), the row is written as this launch's member and never as a name the call carries, and
// the list lives in the crew's row streams, so a session that starts after a refresh reads the list its predecessor
// left. Each test names the mutant of the design that it kills.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, mock, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, OWNER } from '../declare_crew/declare_crew.ts'
import { soloDeclaration } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import {
  ACT_ASKED_OF_OWNER,
  OWNER_TODO_ADD,
  OWNER_TODO_DONE,
  OWNER_TODO_STREAM,
  SWEEP_INTERVAL_MS,
  THE_OWNERS_TODO_ASK,
  theOpenRows,
} from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { recordIngestion, refuseExecutionAfterUngatedText, startFreshSession } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { rowStreamsDirectory, STREAM_DIRECTORY_MODE } from '../row_streams_directory/row_streams_directory.ts'
import { CREW_TOOL_NAMES, crewToolsOver, type CrewTools } from './a_crews_tools.ts'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-owners-todo-tools-'))
after(() => removeTheTree(homeOfAll))

const NOW = 7_000_000

/** A team whose table lets only the owner and its lead assign work. */
const A_TEAM = {
  version: DECLARATION_VERSION,
  owner: 'an owner',
  members: [
    { name: 'Lead', role: 'lead' },
    { name: 'Pallas', role: 'builder' },
  ],
  mode: { name: 'team', roles: ['lead', 'builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER, 'lead']])) },
  channel_read_seconds: 30,
}

/** One crew's place: its checkout, its declaration and its row streams, in a directory no other test shares. */
interface APlace {
  readonly root: string
  readonly rows: string
  readonly documents: { read(path: string): Promise<string> }
}

let placesSoFar = 0
function aPlace(declaration: unknown): APlace {
  placesSoFar += 1
  const home = join(homeOfAll, `place-${placesSoFar}`)
  const root = join(home, 'checkout')
  const rows = join(home, CREW_ROWS_PLACE)
  mkdirSync(root, { recursive: true })
  mkdirSync(rows, { mode: STREAM_DIRECTORY_MODE })
  const declared = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const documents = {
    read: async (path: string) => {
      if (path === declared) return JSON.stringify(declaration)
      throw Object.assign(new Error(`no document at ${path}`), { code: 'ENOENT' })
    },
  }
  return { root, rows, documents }
}

/** The tools `member` calls over `place`, as a launch would hand them, with `run` its processes. */
function toolsOf(place: APlace, member: string, run?: (request: ProcessRequest) => Promise<ProcessOutcome>): CrewTools {
  return crewToolsOver({
    member,
    ledger: { clock: { now: () => NOW }, stores: { rows: rowStreamsDirectory(place.rows) } },
    beats: dashboardRowsIn(join(place.rows, '..', 'beats')),
    root: place.root,
    documents: place.documents,
    stores: { crew: crewFilesDirectory(join(place.rows, '..', 'crew-store')) },
    ...(run === undefined ? {} : { processes: { run, runNow: () => ({ exit_code: null, stdout: '', stderr: '' }), identityOf: () => null } }),
  })
}

const AN_ACT = {
  id: 'set-the-secret',
  title: 'Set the release secret',
  commands: [{ command: 'gh secret set HEX_API_KEY -R macula-io/martha', does: 'sets the secret the release job reads' }],
}

const theStream = async (place: APlace) => rowStreamsDirectory(place.rows).read(OWNER_TODO_STREAM)

test('#316: the two tools are registered under their own names', () => {
  for (const name of [OWNER_TODO_ADD, OWNER_TODO_DONE]) assert.ok((CREW_TOOL_NAMES as readonly string[]).includes(name), `${name} is not a tool the crew registers`)
})

test('#316 test 6: a member the table does not let assign work is refused, and the stream is unchanged', async () => {
  const place = aPlace(A_TEAM)
  const answered = await toolsOf(place, 'Pallas').answer(OWNER_TODO_ADD, AN_ACT, 'a-session')
  assert.ok('refused' in answered, 'a builder put an act on the owner\'s list though its table lets only the owner and its lead assign work')
  assert.match(answered.refused, /may not keep the owner's list: this crew's table lets owner, lead assign work/)
  assert.deepEqual(await theStream(place), [], 'a refused add wrote into the stream')
})

test('#316 test 6: the row is written as the launch\'s member, even when the call names another', async () => {
  const place = aPlace(A_TEAM)
  const answered = await toolsOf(place, 'Lead').answer(OWNER_TODO_ADD, { ...AN_ACT, added_by: 'the owner', addedBy: 'the owner' }, 'a-session')
  assert.ok('answer' in answered, `the lead could not add: ${'refused' in answered ? answered.refused : ''}`)
  assert.deepEqual(theOpenRows(await theStream(place)).map((row) => row.added_by), ['Lead'], 'the row says it is from a name the call carried')
})

test('#316 test 7: a row added before a refresh is on the list after it', async () => {
  const place = aPlace(soloDeclaration('an owner'))
  assert.ok('answer' in (await toolsOf(place, 'builder').answer(OWNER_TODO_ADD, AN_ACT, 'the-first-session')), 'the builder could not add')
  const after_the_refresh = toolsOf(place, 'builder')
  const pane = await after_the_refresh.answer(THE_OWNERS_TODO_ASK, {}, 'the-next-session')
  assert.ok('answer' in pane, `the pane's ask was refused: ${'refused' in pane ? pane.refused : ''}`)
  assert.deepEqual((JSON.parse(pane.answer) as { rows: { id: string }[] }).rows.map((row) => row.id), [AN_ACT.id], 'the list was lost across a refresh')
})

test('#316: the reviewer of an init crew takes off an act the builder added, by hand', async () => {
  const place = aPlace(soloDeclaration('an owner'))
  await toolsOf(place, 'builder').answer(OWNER_TODO_ADD, AN_ACT, 'a-session')
  const answered = await toolsOf(place, 'reviewer').answer(OWNER_TODO_DONE, { id: AN_ACT.id }, 'a-session')
  assert.ok('answer' in answered, `the reviewer could not take the act off: ${'refused' in answered ? answered.refused : ''}`)
  assert.deepEqual(theOpenRows(await theStream(place)), [], 'the act stayed on the list')
})

test('#316 ruling: with the strict gate on, a tainted session is refused owner_todo_add', () => {
  const tainted = recordIngestion(startFreshSession(), [{ path: 'A6', from_node_id: 'b'.repeat(64) }])
  const decided = refuseExecutionAfterUngatedText({ tool: `mcp__martha__${OWNER_TODO_ADD}`, session: tainted, policy: { may_send_executable_text: [] }, strict_gate: true })
  assert.equal(decided.allow, false, 'a session holding an outsider\'s text may put a command on the owner\'s list with the gate on')
})

test('#316: the sweep runs once per SWEEP_INTERVAL_MS, and takes off the act its check says is done', async () => {
  const place = aPlace(soloDeclaration('an owner'))
  const runs: ProcessRequest[] = []
  const tools = toolsOf(place, 'builder', async (request) => (runs.push(request), { exit_code: 0, stdout: 'true\n', stderr: '' }))
  await tools.answer(OWNER_TODO_ADD, { ...AN_ACT, check: { pr_merged: { repo: 'macula-io/martha', number: 400 } } }, 'a-session')
  mock.timers.enable({ apis: ['setInterval'] })
  const stop = tools.startSweeping()
  try {
    mock.timers.tick(SWEEP_INTERVAL_MS - 1)
    await settle()
    assert.equal(runs.length, 0, 'the sweep ran before its interval')
    mock.timers.tick(1)
    await waitFor(() => runs.length === 1)
  } finally {
    stop()
    mock.timers.reset()
  }
  await waitFor(async () => theOpenRows(await theStream(place)).length === 0)
  assert.equal((await theStream(place)).filter((stored) => stored.row['kind'] === ACT_ASKED_OF_OWNER).length, 1, 'the sweep wrote a second act')
})

test('#316 r2: a member the table does not let keep the list runs no check when it sweeps', async () => {
  const place = aPlace(A_TEAM)
  const added = await toolsOf(place, 'Lead').answer(OWNER_TODO_ADD, { ...AN_ACT, check: { pr_merged: { repo: 'macula-io/martha', number: 400 } } }, 'a-session')
  assert.ok('answer' in added, `the lead could not add the act: ${'refused' in added ? added.refused : ''}`)
  const runs: ProcessRequest[] = []
  const builder = toolsOf(place, 'Pallas', async (request) => (runs.push(request), { exit_code: 0, stdout: 'true\n', stderr: '' }))
  mock.timers.enable({ apis: ['setInterval'] })
  const stop = builder.startSweeping()
  try {
    mock.timers.tick(SWEEP_INTERVAL_MS)
    await settle()
  } finally {
    stop()
    mock.timers.reset()
  }
  assert.equal(runs.length, 0, 'a member the table refuses ran the list\'s check')
  assert.equal(theOpenRows(await theStream(place)).length, 1, 'a member the table refuses took an act off the list')
})

/** How many turns of the event loop a wait gives the sweep: far more than a sweep over one row takes. */
const TURNS = 100

/** One turn of the event loop, on real time: a sweep's reads and its process each finish in some. */
const aTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** Lets everything the sweep started finish, so a run that was going to happen has happened. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < TURNS; turn++) await aTurn()
}

/** Waits until `holds` answers true; fails after TURNS turns. */
async function waitFor(holds: () => boolean | Promise<boolean>): Promise<void> {
  for (let turn = 0; turn < TURNS; turn++) {
    if (await holds()) return
    await aTurn()
  }
  assert.fail('what the sweep was to do did not happen')
}
