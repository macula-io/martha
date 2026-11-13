// The model tools a member calls, and the orders they leave for the mod (martha#315).
//
// What this proves that the slice's own tests cannot: the whole way round — the tool a member calls, the record in the
// crew store the next session reads, the one order the mod is answered with, and the row the owner watches. A switch is
// not a thing the tool does to the host: the tool keeps a record and returns, and the HOST's model command runs after
// the turn, from an order the mod asks for. So a switch that is never asked for is never directed, a directed switch is
// answered once, and the row says the new model only when the mod reports the command resolved.
//
// The mutant each test kills is named in its title.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, REVIEW_MODEL } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { CREW_ROWS_PLACE, openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { CARRY_A_MODEL, CARRY_A_TEXT, THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { modelPlace, theModelMarker, theModelOf, type TheModel } from '../switch_a_members_model/switch_a_members_model.ts'
import {
  CREW_TOOL_NAMES,
  crewToolsOver,
  PARK_A_MEMBER,
  THE_TOOLS_ASK,
  RETURN_TO_YOUR_OWN_MODEL,
  REFRESH_THIS_SESSION,
  SWITCH_YOUR_MODEL,
  THE_MODEL_REPORT_ASK,
  type CrewTools,
} from './a_crews_tools.ts'

/** The models this test's host runs (martha#315): the vocabulary a declaration's `review_model` is read against. */
const HOST_MODELS = ['sonnet', 'opus', 'fable']
/** The model the member is launched on, and the one the declaration gives it as its own. */
const OWN_MODEL = 'sonnet'
/** The crew's reviewer model: the other model a switch is allowed to name. */
const THE_REVIEWER_MODEL = 'fable'
const MEMBER = 'builder'
const THE_PACKAGE = 'macula-io/martha#315'
const ANOTHER_PACKAGE = 'macula-io/martha#999'
const THE_REASON = 'the review is on the other model'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-model-tools-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** One crew the test made: its member's tools, where its own store is, and the clock every row write is ordered by. */
interface ACrew {
  readonly tools: CrewTools
  readonly crew: string
  /** The crew's dashboard rows, read the way the owner's pane reads them. */
  readonly theRow: () => Record<string, unknown> | null
  /** Moves the clock on, so the next row write is newer than the one before it, as a real launcher's is. */
  readonly aTurnLater: () => void
}

/** The question the mod puts to the launcher, as a real one does at a turn's end. */
const questionOf = (turn_id: string): Record<string, unknown> => ({ usage: { context: { percent: 5 }, cost: { usd: 0.1 } }, turn_id, answer: '' })

/** Gives the crew's declaration what the tool reads: this member's own model, and the crew's reviewer model. */
function declareTheModels(root: string, memberModel: string | null): void {
  const declaration = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const held = JSON.parse(readFileSync(declaration, 'utf8')) as { members: { name: string; model?: string }[]; house_rules?: Record<string, unknown> }
  for (const member of held.members) {
    if (member.name !== MEMBER) continue
    // A member the declaration gives no model of its own runs on the host's default (martha#315 r=2), which is the one
    // state a switch could never come back from.
    if (memberModel === null) delete member.model
    else member.model = memberModel
  }
  held.house_rules = { ...(held.house_rules ?? {}), [REVIEW_MODEL]: THE_REVIEWER_MODEL }
  writeFileSync(declaration, `${JSON.stringify(held, null, 2)}\n`)
}

let crewsSoFar = 0
async function aCrewOfTools(memberModel: string | null = OWN_MODEL): Promise<ACrew> {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crew = join(home, 'the-crew-files')
  const clock = { at: 1_000 }
  mkdirSync(root, { recursive: true })
  mkdirSync(join(home, 'row'), { recursive: true })
  mkdirSync(join(home, CREW_ROWS_PLACE), { recursive: true })
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const declared = await declareSoloCrew({ root, owner: 'an owner', state, documents, models: HOST_MODELS })
  assert.ok(declared.declared, `the test could not declare a crew: ${declared.declared ? '' : declared.refusal}`)
  declareTheModels(root, memberModel)
  const beats = dashboardRowsIn(join(home, 'row'))
  const tools = crewToolsOver({
    member: MEMBER,
    ledger: { clock: { now: () => clock.at }, stores: { rows: rowStreamsDirectory(join(home, CREW_ROWS_PLACE)) } },
    beats,
    root,
    documents,
    stores: { crew: crewFilesDirectory(crew) },
    models: HOST_MODELS,
    launched_on: OWN_MODEL,
  })
  return { tools, crew, theRow: () => beats.read(MEMBER) as Record<string, unknown> | null, aTurnLater: () => (clock.at += 60_000) }
}

/** This member's model record, as a later session and the owner read it. */
function theRecordOf(crew: string): TheModel {
  const place = modelPlace({ stores: { crew: crewFilesDirectory(crew) } })
  assert.ok(!('refusal' in place), `the crew's store refused its model place: ${'refusal' in place ? place.refusal : ''}`)
  return theModelOf(place, MEMBER)
}

/** Switches this member, and says so if the test could not: what every test below starts from. */
async function switched(tools: CrewTools, package_name = THE_PACKAGE): Promise<string> {
  const answered = await tools.answer(SWITCH_YOUR_MODEL, { model: THE_REVIEWER_MODEL, package: package_name, reason: THE_REASON }, 'a-session')
  assert.ok('answer' in answered, `the test could not switch the member: ${'refused' in answered ? answered.refused : ''}`)
  return answered.answer
}

/** The order the mod is answered with on its next question. */
async function theOrderTheModGets(crew: ACrew): Promise<Record<string, unknown>> {
  crew.aTurnLater()
  const answered = await crew.tools.answer(THE_REFRESH_ASK, questionOf(`t-${crew.theRow()?.at ?? 0}`), 'a-session')
  assert.ok('answer' in answered, `the flow refused the question: ${'refused' in answered ? answered.refused : ''}`)
  return JSON.parse(answered.answer) as Record<string, unknown>
}

test('#315: the switch tool moves the member onto a model the declaration names, and says when it comes back', async () => {
  const crew = await aCrewOfTools()
  const told = await switched(crew.tools)
  assert.match(told, new RegExp(`Switching to ${THE_REVIEWER_MODEL} for ${THE_PACKAGE} at the end of this turn`), 'the member was not told which model it moves to, or when')
  assert.match(told, new RegExp(`back to ${OWN_MODEL} when you park`), 'the member was not told which model it comes back to')
  assert.match(told, new RegExp(RETURN_TO_YOUR_OWN_MODEL), 'the member was told nothing about the tool that brings it home')
  const record = theRecordOf(crew.crew)
  assert.equal(record.kind, 'switched', 'the switch was directed at the member and no record of it was kept')
  assert.deepEqual(record.kind === 'switched' ? record.marker : null, {
    switched: true, model: THE_REVIEWER_MODEL, home: OWN_MODEL, package: THE_PACKAGE, why: THE_REASON, since: new Date(1_000).toISOString(), directed: false,
  }, 'the record a later session reads is not the switch that was made')
})

test('#315: a switch to a model the declaration does not name is refused by name, and the record is left as it was (mutant: allow-list removed)', async () => {
  const crew = await aCrewOfTools()
  const answered = await crew.tools.answer(SWITCH_YOUR_MODEL, { model: 'haiku', package: THE_PACKAGE, reason: THE_REASON }, 'a-session')
  assert.ok('refused' in answered, 'a switch to a model the declaration does not name was accepted')
  assert.match(answered.refused, new RegExp(`${OWN_MODEL}, ${THE_REVIEWER_MODEL}`), 'the refusal does not name the models the declaration does')
  assert.deepEqual(theRecordOf(crew.crew), { kind: 'home', last_marker: null }, 'a refused switch left a record behind')
  // And nothing is directed either: the refusal is the whole answer.
  assert.notEqual((await theOrderTheModGets(crew)).carry, CARRY_A_MODEL, 'a refused switch was directed at the host anyway')
})

test('#315: the switch is answered as one model order, and the next question carries nothing of it (mutant: the record kept undirected)', async () => {
  const crew = await aCrewOfTools()
  await switched(crew.tools)
  assert.deepEqual(await theOrderTheModGets(crew), { carry: CARRY_A_MODEL, model: THE_REVIEWER_MODEL }, 'the recorded switch was not answered as the order that makes it real')
  const record = theRecordOf(crew.crew)
  assert.equal(record.kind === 'switched' ? record.marker.directed : null, true, 'the switch was handed over without the record saying so, so it is directed again on every turn')
  assert.notEqual((await theOrderTheModGets(crew)).carry, CARRY_A_MODEL, 'the same switch was handed over twice')
})

test('#315: a member that parks is brought home on the next turn\'s order (mutant: the park trigger removed)', async () => {
  const crew = await aCrewOfTools()
  await switched(crew.tools)
  // The end of that turn: the order goes out, so the session really is on the other model when it parks.
  await theOrderTheModGets(crew)
  const parked = await crew.tools.answer(PARK_A_MEMBER, { reason: 'the package is at a safe point' }, 'a-session')
  assert.ok('answer' in parked, `the park was refused: ${'refused' in parked ? parked.refused : ''}`)
  assert.match(parked.answer, new RegExp(`Back to ${OWN_MODEL}`), 'the park did not tell the member it comes home')
  assert.equal(theRecordOf(crew.crew).kind, 'home', 'a parking member kept the switch')
  assert.deepEqual(await theOrderTheModGets(crew), { carry: CARRY_A_MODEL, model: OWN_MODEL }, 'the return a park made was not directed at the host, so the session stays on the stronger model')
})

test('#315: a report on another package brings the member home, and one on the switch\'s own package does not (mutant: the report trigger removed)', async () => {
  const moved = await aCrewOfTools()
  await switched(moved.tools, THE_PACKAGE)
  await theOrderTheModGets(moved)
  const reported = await moved.tools.answer('report_progress', { task: 'the other piece of work', step: 0, of: 2, package: ANOTHER_PACKAGE }, 'a-session')
  assert.ok('answer' in reported, `the report was refused: ${'refused' in reported ? reported.refused : ''}`)
  assert.match(reported.answer, new RegExp(`you reported progress on ${ANOTHER_PACKAGE}`), 'a member that moved on to other work was not told it comes home')
  assert.equal(theRecordOf(moved.crew).kind, 'home', 'a member that moved on to another package kept the switch')

  const staying = await aCrewOfTools()
  await switched(staying.tools, THE_PACKAGE)
  await theOrderTheModGets(staying)
  const again = await staying.tools.answer('report_progress', { task: 'the review itself', step: 1, of: 2, package: THE_PACKAGE }, 'a-session')
  assert.ok('answer' in again, `the report was refused: ${'refused' in again ? again.refused : ''}`)
  assert.equal(theRecordOf(staying.crew).kind, 'switched', 'a report on the package the switch was made for took the member off the model that work needs')
})

test('#315: the return tool brings a switched member home, and a member at home is told there is nothing to direct (mutant: the return tool removed)', async () => {
  const crew = await aCrewOfTools()
  const atHome = await crew.tools.answer(RETURN_TO_YOUR_OWN_MODEL, { reason: 'nothing to come back from' }, 'a-session')
  assert.ok('answer' in atHome, `the return was refused for a member at home: ${'refused' in atHome ? atHome.refused : ''}`)
  assert.match(atHome.answer, /on its own model already/, 'a member at home was not told there is nothing to direct')
  assert.notEqual((await theOrderTheModGets(crew)).carry, CARRY_A_MODEL, 'a member at home was directed at a model nothing switched')

  await switched(crew.tools)
  await theOrderTheModGets(crew)
  const returned = await crew.tools.answer(RETURN_TO_YOUR_OWN_MODEL, { reason: 'the review is done' }, 'a-session')
  assert.ok('answer' in returned, `the return was refused: ${'refused' in returned ? returned.refused : ''}`)
  assert.match(returned.answer, new RegExp(`Back to ${OWN_MODEL} at the end of this turn`), 'the member was not told it is going home, or when')
  assert.equal(theRecordOf(crew.crew).kind, 'home', 'a member that asked to come home kept the switch')
  assert.deepEqual(await theOrderTheModGets(crew), { carry: CARRY_A_MODEL, model: OWN_MODEL }, 'the return a member asked for was not directed at the host')
})

// A member can change its mind in the turn it switched: the record was written, the order that makes it real has not
// gone out yet, so the session never moved. The record must go home and no order may follow it — otherwise the member
// is told "no switch is recorded" while the record keeps one, and the end of the turn moves it anyway.
test('#315: a return before the switch was told to the host comes home, and orders no move (mutant: an undirected return ignored)', async () => {
  const crew = await aCrewOfTools()
  await switched(crew.tools)
  const returned = await crew.tools.answer(RETURN_TO_YOUR_OWN_MODEL, { reason: 'I changed my mind' }, 'a-session')
  assert.ok('answer' in returned, `the return was refused: ${'refused' in returned ? returned.refused : ''}`)
  assert.doesNotMatch(returned.answer, /on its own model already/, 'a member with a recorded switch was told that no switch is recorded')
  assert.equal(theRecordOf(crew.crew).kind, 'home', 'a member that came back before its switch went out kept the switch, so the end of the turn moves it to the model it refused')
  assert.notEqual((await theOrderTheModGets(crew)).carry, CARRY_A_MODEL, 'a session that never moved was ordered onto the model it is already on')
})

// The turn that carries two orders (martha#315 r=2): a switch is recorded, and a refresh falls due in the same turn. The
// flow keeps the handover prompt it decided on as its own state, so answering the turn with the model order in its place
// leaves a flow in handing_over that nobody was told to hand over, and every later turn is answered `none`.
test('#315 r2: a refresh due in the turn a switch is made goes out, and the switch is directed on the next turn (mutant: the model order sent in the refresh act\'s place)', async () => {
  const crew = await aCrewOfTools()
  await switched(crew.tools)
  const asked = await crew.tools.answer(REFRESH_THIS_SESSION, { reason: 'the package is at a safe point' }, 'a-session')
  assert.ok('answer' in asked, `the refresh was refused: ${'refused' in asked ? asked.refused : ''}`)

  // This turn's one order is the flow's own: the prompt it has already committed to.
  const first = await theOrderTheModGets(crew)
  assert.equal(first.carry, CARRY_A_TEXT, 'the handover prompt the refresh flow committed to was replaced by the model order, so the member was never told to hand over')
  assert.match(String(first.text), /handover/i, 'the order sent in the refresh act\'s place is not the handover prompt')

  // And the switch was not dropped: it kept `directed: false`, so the next turn's question carries it, once.
  const held = theRecordOf(crew.crew)
  assert.equal(held.kind === 'switched' ? held.marker.directed : null, false, 'the switch was marked directed while its order was held back, so it is never sent')
  assert.deepEqual(await theOrderTheModGets(crew), { carry: CARRY_A_MODEL, model: THE_REVIEWER_MODEL }, 'the switch held back for the refresh act was never directed')
  assert.notEqual((await theOrderTheModGets(crew)).carry, CARRY_A_MODEL, 'the same switch was directed twice')
})

// A switch that could never be undone (martha#315 r=2): the member declares no model of its own, so its return would be
// to the host's own default, which Martha cannot name. The session would stay on the other model for every package
// after this one, and the row would say nothing about it.
test('#315 r2: a switch for a member that declares no model of its own is refused by name, and nothing is recorded (mutant: the home-model refusal removed)', async () => {
  const crew = await aCrewOfTools(null)
  const answered = await crew.tools.answer(SWITCH_YOUR_MODEL, { model: THE_REVIEWER_MODEL, package: THE_PACKAGE, reason: THE_REASON }, 'a-session')
  assert.ok('refused' in answered, 'a member that declares no model of its own was switched to one it could never come back from')
  assert.match(answered.refused, new RegExp(`${MEMBER} declares no model`), 'the refusal does not name the member that declares no model')
  assert.match(answered.refused, new RegExp(`declare ${MEMBER}'s model`), 'the refusal does not say what to do about it')
  assert.deepEqual(theRecordOf(crew.crew), { kind: 'home', last_marker: null }, 'a refused switch left a record behind')
  assert.notEqual((await theOrderTheModGets(crew)).carry, CARRY_A_MODEL, 'the host was ordered onto a model the member could never be brought back from')
})

test('#315: the row says a switched model only once the mod reports the host resolved it (mutant: the row written from the order)', async () => {
  const crew = await aCrewOfTools()
  const reported = await crew.tools.answer('report_progress', { task: 'the package', step: 0, of: 2, package: THE_PACKAGE }, 'a-session')
  assert.ok('answer' in reported, `the report was refused: ${'refused' in reported ? reported.refused : ''}`)
  assert.equal((crew.theRow()?.host as Record<string, unknown>).model, OWN_MODEL, 'the row does not say the model the member was launched on')

  await switched(crew.tools)
  assert.equal((crew.theRow()?.host as Record<string, unknown>).model, OWN_MODEL, 'the row said the new model before the host made the switch')
  await theOrderTheModGets(crew)
  assert.equal((crew.theRow()?.host as Record<string, unknown>).model, OWN_MODEL, 'the row said the new model on the order alone, so a command that failed would have been reported as a switch')

  // The report comes back from the host after the turn's order went out, so it is a later write than the order's row.
  crew.aTurnLater()
  const noted = await crew.tools.answer(THE_MODEL_REPORT_ASK, { model: THE_REVIEWER_MODEL }, 'a-session')
  assert.ok('answer' in noted, `the launcher's model report was refused: ${'refused' in noted ? noted.refused : ''}`)
  assert.equal((crew.theRow()?.host as Record<string, unknown>).model, THE_REVIEWER_MODEL, 'the report the host resolved its command with did not reach the row')})

test('#315: the launcher\'s model report names a model, and a report that names none is refused', async () => {
  const crew = await aCrewOfTools()
  const answered = await crew.tools.answer(THE_MODEL_REPORT_ASK, { model: '  ' }, 'a-session')
  assert.ok('refused' in answered, 'a model report naming no model was noted')
  assert.match(answered.refused, /names it/, 'the refusal does not say what a model report must carry')
})

test('#315: both model tools are among the crew\'s tools, and each is the single act its name says', async () => {
  const crew = await aCrewOfTools()
  for (const tool of [SWITCH_YOUR_MODEL, RETURN_TO_YOUR_OWN_MODEL]) {
    assert.ok((CREW_TOOL_NAMES as readonly string[]).includes(tool), `${tool} is not one of the crew's tools`)
  }
  const asked = await crew.tools.answer(THE_TOOLS_ASK, {}, 'a-session')
  assert.ok('answer' in asked, 'the launcher answered the tools ask with no tools')
  const registered = JSON.parse(asked.answer) as readonly { name: string; inputSchema: { required?: readonly string[] } }[]
  // One tool, one act (martha#343): the switch takes the model it moves to, the return takes none, so neither can be
  // read as the other.
  assert.deepEqual(registered.find((one) => one.name === SWITCH_YOUR_MODEL)?.inputSchema.required, ['model', 'package', 'reason'], 'the switch does not ask for the model, the package and why')
  assert.deepEqual(registered.find((one) => one.name === RETURN_TO_YOUR_OWN_MODEL)?.inputSchema.required, ['reason'], 'the return asks for more than why it comes home')
  assert.equal(theModelMarker(MEMBER), `${MEMBER}.model.json`, 'the record is named something other than the member')
})
