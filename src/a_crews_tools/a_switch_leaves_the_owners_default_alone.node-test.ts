// A member's model switch leaves the owner's own default for new sessions alone (martha#359).
//
// The host's `/model` command saves the switched model into the owner's `<config dir>/settings.json` as the default for
// every new session they start, and it saves asynchronously: its answer comes before the write may have landed. So the
// launcher snapshots that file before the order goes out and puts the owner's own bytes back afterwards, and nothing
// here may be believed from the command's resolution — the file is the only witness.
//
// These are the tests of the mechanism itself, at the launcher's own seam: the production tools, the production order
// and report asks, and the real lock, over a real settings file in a real config directory. The only stand-in is the
// host's save, which a test writes the way the host writes one. The end-to-end proof on the recorded host is
// ../launch_a_claude_code_member/a_switch_does_not_move_the_owners_default.node-test.ts.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { ownersSettingsIn } from '../owners_settings_directory/owners_settings_directory.ts'
import { USER_SETTINGS_FILE } from '../claude_code_host/settings_env_reaching_servers.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, REVIEW_MODEL } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { CREW_ROWS_PLACE, openState, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { modelPlace, theModelOf, type ModelMarker } from '../switch_a_members_model/switch_a_members_model.ts'
import {
  finishAnUnfinishedSwitch,
  finishTheOwnersDefaultAtLaunch,
  guardTheOwnersDefault,
  putTheOwnersModelBack,
  THE_SAVE_WAIT_MS,
  theSaveInTheFile,
  theSaveThatNeverShowed,
  type AGuardedSwitch,
  type OwnersDefaultPlace,
  type TheOwnersModelRecord,
  type TheSaveSeen,
} from '../put_the_owners_model_back/put_the_owners_model_back.ts'
import { CARRY_A_MODEL, THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { theOwnersDefaultKept } from '../switch_a_members_model/switch_a_members_model.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { RETURN_TO_YOUR_OWN_MODEL, SWITCH_YOUR_MODEL, THE_MODEL_REPORT_ASK, crewToolsOver, type CrewTools } from './a_crews_tools.ts'

/** The models a crew names: this member's own, and the one every review runs on. */
const HOST_MODELS = ['sonnet', 'fable']
/** The model the member is launched on, and the crew's reviewer model: the one a switch moves it to. */
const OWN_MODEL = 'sonnet'
const THE_REVIEWER_MODEL = 'fable'
const MEMBER = 'builder'
const THE_PACKAGE = 'macula-io/martha#359'
const THE_REASON = 'the review needs it'
/** The owner's own settings, as they wrote them: one key of their own beside the model, so a restore has more to keep. */
const OWNERS_SETTINGS = { env: { MARTHA_TEST: '1' }, model: OWN_MODEL }
const OWNERS_BYTES = `${JSON.stringify(OWNERS_SETTINGS, null, 2)}\n`

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-owners-default-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** One crew the test made: its member's tools, the crew store, the owner's file, and its row. */
interface ACrewMade {
  readonly tools: CrewTools
  readonly crew: string
  readonly owners: OwnersDefaultPlace
  /** The owner's file's path, which the test writes the host's save into and reads back. */
  readonly settings_file: string
  /** What the owner's settings file held before the switch, null for an owner who never wrote one. */
  readonly owners_settings: Record<string, unknown> | null
  readonly beats: DashboardStore
  readonly theRow: () => Record<string, unknown> | null
  readonly aTurnLater: () => void
}

let crewsSoFar = 0

/**
 * A crew with one member, over a home of its own, and the owner's settings file written as the test says: null for an
 * owner who never wrote one, which is an owner the host makes a file for.
 */
async function aCrew(owners: Record<string, unknown> | null = OWNERS_SETTINGS): Promise<ACrewMade> {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crew = join(home, 'the-crew-files')
  const config_dir = join(home, 'claude')
  const clock = { at: 1_000 }
  for (const made of [root, join(home, 'row'), join(home, CREW_ROWS_PLACE), config_dir]) mkdirSync(made, { recursive: true })
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const declared = await declareSoloCrew({ root, owner: 'an owner', state, documents, models: HOST_MODELS })
  assert.ok(declared.declared, `the test could not declare a crew: ${declared.declared ? '' : declared.refusal}`)
  declareTheModels(root)
  const settings_file = join(config_dir, USER_SETTINGS_FILE)
  const owners_place: OwnersDefaultPlace = { config_dir, file: settings_file, store: ownersSettingsIn(settings_file, state.state_root) }
  if (owners !== null) writeFileSync(settings_file, `${JSON.stringify(owners, null, 2)}\n`)
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
    owners_settings: owners_place,
  })
  return { tools, crew, owners: owners_place, settings_file, owners_settings: owners, beats, theRow: () => beats.read(MEMBER) as Record<string, unknown> | null, aTurnLater: () => (clock.at += 60_000) }
}

/** Gives the crew's declaration its models: this member's own, and the one every review runs on. */
function declareTheModels(root: string): void {
  const declaration = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const held = JSON.parse(readFileSync(declaration, 'utf8')) as { members: { name: string; model?: string }[]; house_rules?: Record<string, unknown> }
  for (const member of held.members) if (member.name === MEMBER) member.model = OWN_MODEL
  held.house_rules = { ...(held.house_rules ?? {}), [REVIEW_MODEL]: THE_REVIEWER_MODEL }
  writeFileSync(declaration, `${JSON.stringify(held, null, 2)}\n`)
}

/** This member's record, as a later launch and the owner read it. */
function theRecordOf(crew: string): ModelMarker | null {
  const place = modelPlace({ stores: { crew: crewFilesDirectory(crew) } })
  assert.ok(!('refusal' in place), `the crew's store refused its model place: ${'refusal' in place ? place.refusal : ''}`)
  const read = theModelOf(place, MEMBER)
  if (read.kind === 'unreadable') assert.fail(read.refusal)
  return read.kind === 'switched' ? read.marker : read.last_marker
}

/** The member asks to switch, and the test says so if it could not: what every case below starts from. */
async function switched(tools: CrewTools): Promise<void> {
  const answered = await tools.answer(SWITCH_YOUR_MODEL, { model: THE_REVIEWER_MODEL, package: THE_PACKAGE, reason: THE_REASON }, 'a-session')
  assert.ok('answer' in answered, `the test could not switch the member: ${'refused' in answered ? answered.refused : ''}`)
}

/** The question the mod puts to the launcher at a turn's end, as a real one does. */
const questionOf = (crew: ACrewMade): Record<string, unknown> => ({
  usage: { context: { percent: 5 }, cost: { usd: 0.1 } },
  turn_id: `t-${String(crew.theRow()?.['at'] ?? 0)}`,
  answer: '',
})

/** The order the mod is answered with: the switch made real, and the owner's settings file guarded for it. */
async function ordered(crew: ACrewMade): Promise<Record<string, unknown>> {
  crew.aTurnLater()
  const answered = await crew.tools.answer(THE_REFRESH_ASK, questionOf(crew), 'a-session')
  assert.ok('answer' in answered, `the flow refused the question: ${'refused' in answered ? answered.refused : ''}`)
  return JSON.parse(answered.answer) as Record<string, unknown>
}

/** The host's own save, as the host writes one: the whole file, with the model it was told to save. */
const theHostSaved = (crew: ACrewMade, model: string = THE_REVIEWER_MODEL): void =>
  writeFileSync(crew.settings_file, `${JSON.stringify({ ...(crew.owners_settings ?? {}), model }, null, 2)}\n`)

/**
 * The host's save over the file as it stands: the keys the owner has there now, and the model it was told to save. It is
 * how a host saves a second time in one session — the file it read carries whatever the owner wrote since — so a test
 * about a second switch over an unfinished one needs this save, not the one above that starts from the owner's first.
 */
const theHostSavedOverTheFile = (crew: ACrewMade, model: string): void =>
  writeFileSync(crew.settings_file, `${JSON.stringify({ ...(JSON.parse(readFileSync(crew.settings_file, 'utf8')) as Record<string, unknown>), model }, null, 2)}\n`)

/** The model this session runs on, reported by the mod once the host's command resolved: what the launcher answered. */
async function reported(crew: ACrewMade, model: string = THE_REVIEWER_MODEL): Promise<string> {
  crew.aTurnLater()
  const answered = await crew.tools.answer(THE_MODEL_REPORT_ASK, { model }, 'a-session')
  assert.ok('answer' in answered, `the launcher refused the model report: ${'refused' in answered ? answered.refused : ''}`)
  return answered.answer
}

/** The owner's file is byte for byte what the owner wrote: the whole claim of the package, in one assertion. */
const theOwnersBytesStand = (crew: ACrewMade): void =>
  assert.equal(readFileSync(crew.settings_file, 'utf8'), OWNERS_BYTES, 'the owner\'s settings file was not put back byte for byte')

/** The whole round trip: the tool, the order, the host's save, the report. */
async function aSwitchedMember(crew: ACrewMade): Promise<void> {
  await switched(crew.tools)
  await ordered(crew)
  theHostSaved(crew)
  await reported(crew)
}

/** The owner's own edit in the window: the model the host saved, and a key of theirs changed beside it. */
const THE_OWNERS_EDIT = `${JSON.stringify({ env: { MARTHA_TEST: '2' }, model: THE_REVIEWER_MODEL }, null, 2)}\n`

/**
 * The return home, and the host's own save of it: the member comes back to its own model, the order carries that model
 * to the host, and the host writes it into the owner's file the way it writes any save.
 */
async function returnedHome(crew: ACrewMade): Promise<Record<string, unknown>> {
  const answered = await crew.tools.answer(RETURN_TO_YOUR_OWN_MODEL, { reason: 'the review is done' }, 'a-session')
  assert.ok('answer' in answered, `the test could not return the member home: ${'refused' in answered ? answered.refused : ''}`)
  const order = await ordered(crew)
  assert.equal(order['carry'], CARRY_A_MODEL, `the return was not a model order, so no host saved anything: ${JSON.stringify(order)}`)
  assert.equal(order['model'], OWN_MODEL, 'the return did not ask the host for the member\'s own model')
  theHostSavedOverTheFile(crew, OWN_MODEL)
  await reported(crew, OWN_MODEL)
  return order
}

test('a switch puts the owner\'s own bytes back, and the record of what it did to them is cleared (mutant: the restore removed)', async () => {
  const crew = await aCrew()
  await aSwitchedMember(crew)
  theOwnersBytesStand(crew)
  assert.equal(theRecordOf(crew.crew)?.settings, undefined, 'the record of what the switch did to the owner\'s default outlived the restore')
  assert.equal((crew.theRow()?.['host'] as Record<string, unknown> | undefined)?.['model'], THE_REVIEWER_MODEL, 'the row does not say the model the session now runs on')
  assert.equal(crew.theRow()?.['needs'], '', 'the row says something needs the owner after a switch that was put back')
})

test('a save that lands after the answer is still put back: what the restore keys on is the file (mutant: restoring on the command\'s word)', async () => {
  const crew = await aCrew()
  await switched(crew.tools)
  await ordered(crew)
  // The host's answer comes before its write, 300 ms later — the case its own 3 s bound exists for.
  const theWrite = new Promise<void>((resolved) => setTimeout(resolved, 300)).then(() => theHostSaved(crew))
  const told = await reported(crew)
  await theWrite
  theOwnersBytesStand(crew)
  assert.equal(told, `Noted: this row says ${THE_REVIEWER_MODEL}.`, 'the launcher told the mod that the owner\'s file needed something when the restore had put it back')
})

test('a save that never shows keeps the record, and says so in the row and in the answer (mutant: the record cleared on a timeout)', async () => {
  const crew = await aCrew()
  await switched(crew.tools)
  await ordered(crew)
  const told = await reported(crew)
  const why = `${crew.settings_file} showed no save of the switched model within ${THE_SAVE_WAIT_MS} ms, so the owner's default may be the member's model: the next launch finishes this switch`
  assert.equal(told, `Noted: this row says ${THE_REVIEWER_MODEL}. ${why}`, 'the launcher did not tell the mod what became of the owner\'s file')
  assert.equal(crew.theRow()?.['needs'], why, 'the row does not say what needs the owner about the switch')
  const kept = theRecordOf(crew.crew)?.settings
  assert.notEqual(kept, undefined, 'a switch whose save never showed left no record for the next launch to finish')
  assert.equal(kept?.after, null, 'the record says a save was seen when the file never showed one')
  assert.equal(kept?.wrote, null, 'the record says which value the file gained when it gained none')
  assert.equal(kept?.why, why, 'the record does not say why the switch was left unfinished')
  theOwnersBytesStand(crew)
})

test('a return home over a switch whose restore was refused puts the owner\'s own model back, not the member\'s (mutant: an open record replaced by a fresh snapshot)', async () => {
  const crew = await aCrew()
  await switched(crew.tools)
  await ordered(crew)
  theHostSaved(crew)
  // The owner edits a key of their own after the host's save and before the report: the restore is refused, and the
  // member's model stands in the owner's file until something puts the owner's own back.
  writeFileSync(crew.settings_file, THE_OWNERS_EDIT)
  assert.match(await reported(crew), /something other than the model changed/, 'the restore was not refused, so this case never reached the unfinished record it is about')
  await returnedHome(crew)
  const now = JSON.parse(readFileSync(crew.settings_file, 'utf8')) as { model?: string; env?: Record<string, unknown> }
  assert.equal(now.model, OWN_MODEL, 'the owner\'s default was left on the member\'s model by the return home')
  assert.equal(now.env?.['MARTHA_TEST'], '2', 'the owner\'s own edit was written over')
  assert.equal(theRecordOf(crew.crew)?.settings, undefined, 'a record of the owner\'s default outlived the return that put it back')
})

test('a return home over a switch whose save landed after the wait puts the owner\'s own model back (mutant: an open record replaced by a fresh snapshot)', async () => {
  const crew = await aCrew()
  await switched(crew.tools)
  await ordered(crew)
  assert.match(await reported(crew), /showed no save/, 'the wait saw a save, so this case never reached the unfinished record it is about')
  // The host's save lands after the answer, where the wait cannot see it: the record is the only witness it happened.
  theHostSaved(crew)
  await returnedHome(crew)
  assert.equal(readFileSync(crew.settings_file, 'utf8'), OWNERS_BYTES, 'the owner\'s settings file did not end as the owner wrote it')
  assert.equal(theRecordOf(crew.crew)?.settings, undefined, 'a record of the owner\'s default outlived the return that put it back')
})

test('a file that changed in more than its model is never written over: nothing is put back, and both the row and the answer say why (mutant: the compare-and-swap removed)', async () => {
  const crew = await aCrew()
  await switched(crew.tools)
  await ordered(crew)
  // The owner edits their own settings while the switch is in flight: their model, and a key of their own.
  const theOwnersEdit = THE_OWNERS_EDIT
  writeFileSync(crew.settings_file, theOwnersEdit)
  const told = await reported(crew)
  const why = `something other than the model changed in ${crew.settings_file} during the switch, so nothing was written back and the owner's default may be the member's model`
  assert.equal(told, `Noted: this row says ${THE_REVIEWER_MODEL}. ${why}`, 'the launcher did not tell the mod why the owner\'s file was left as the owner wrote it')
  assert.equal(crew.theRow()?.['needs'], why, 'the row does not say what needs the owner about the switch')
  assert.equal(readFileSync(crew.settings_file, 'utf8'), theOwnersEdit, 'the owner\'s own edit was written over by the restore')
  assert.equal(theRecordOf(crew.crew)?.settings?.why, why, 'the record does not say why the owner\'s file was not put back')
})

test('an owner who never wrote a settings file has none after a switch: the host\'s file is removed again (mutant: a file kept where the owner had none)', async () => {
  const crew = await aCrew(null)
  await aSwitchedMember(crew)
  assert.throws(() => readFileSync(crew.settings_file, 'utf8'), /ENOENT/, 'the host\'s settings file was left behind for an owner who had none')
})

test('a switch is refused, and nothing recorded as switched, when the owner\'s settings file cannot be put back (mutant: the file\'s own kind unchecked)', async () => {
  const crew = await aCrew()
  rmSync(crew.settings_file, { force: true })
  mkdirSync(crew.settings_file)
  await switched(crew.tools)
  const order = await ordered(crew)
  assert.notEqual(order['carry'], CARRY_A_MODEL, 'a switch ran whose owner\'s settings file could not have been put back')
  assert.equal(theRecordOf(crew.crew)?.switched, false, 'the record still says the member was switched when the host was never ordered to')
  assert.match(String(crew.theRow()?.['needs']), /is not a regular file/, 'the row does not say what needs the owner about the refused switch')
})

test('a second switch waits for the one holding the owner\'s file, and is no order until it is given back (mutant: no lock)', async () => {
  const crew = await aCrew()
  const guard = await guardTheOwnersDefault(crew.owners, THE_REVIEWER_MODEL)
  assert.ok(!('refusal' in guard), `the test could not take the lock: ${'refusal' in guard ? guard.refusal : ''}`)
  try {
    await switched(crew.tools)
    const order = await ordered(crew)
    assert.notEqual(order['carry'], CARRY_A_MODEL, 'a second switch ran while the first still held the owner\'s settings file')
  } finally {
    guard.lock.release()
  }
})

test('a switch a crash left between the save and the restore is finished by the record\'s own hash (mutant: recovery never runs)', async () => {
  const crew = await aCrew()
  const { held, seen } = await aCrashedSwitch(crew)
  held.lock.release()
  const finished = await finishAnUnfinishedSwitch(crew.owners, seen.record)
  assert.equal(finished.why, '', `the recovery would not finish the switch: ${finished.why}`)
  assert.deepEqual(JSON.parse(readFileSync(crew.settings_file, 'utf8')) as unknown, OWNERS_SETTINGS, 'the recovery did not put the owner\'s model back')
  assert.equal(theRecordOf(crew.crew)?.settings, undefined, 'the record of a finished switch outlived it')
})

test('a recovery writes nothing when the owner changed the file after the crash: the owner\'s own edit stands, and the reason names the file (mutant: recovery that ignores the hash)', async () => {
  const crew = await aCrew()
  const { held, seen } = await aCrashedSwitch(crew)
  held.lock.release()
  const theOwnersEdit = `${JSON.stringify({ env: { MARTHA_TEST: '2' }, model: THE_REVIEWER_MODEL }, null, 2)}\n`
  writeFileSync(crew.settings_file, theOwnersEdit)
  const finished = await finishAnUnfinishedSwitch(crew.owners, seen.record)
  assert.equal(finished.why, `${crew.settings_file} changed after the switch, so nothing was put back and the owner's default is theirs to set`, 'the recovery did not say why it left the owner\'s file alone')
  assert.equal(readFileSync(crew.settings_file, 'utf8'), theOwnersEdit, 'the recovery wrote over an edit the owner made after the crash')
})

/** A switch taken and saved, with the process about to die: the guard is held, and the record says what the file gained. */
async function aCrashedSwitch(crew: ACrewMade): Promise<{ readonly held: AGuardedSwitch; readonly seen: Extract<TheSaveSeen, { moved: true }> }> {
  await switched(crew.tools)
  const guard = await guardTheOwnersDefault(crew.owners, THE_REVIEWER_MODEL)
  assert.ok(!('refusal' in guard), `the test could not guard the owner's settings file: ${'refusal' in guard ? guard.refusal : ''}`)
  theHostSaved(crew)
  const seen = await theSaveInTheFile(crew.owners, guard)
  assert.equal(seen.why, '', `the file did not show the save: ${seen.why}`)
  if (!seen.moved) assert.fail('the file showed the save and the record of it was not kept')
  return { held: guard, seen }
}

test('two switches in two processes are one at a time: the second waits, and the owner\'s file ends where it began (martha#359 R2, mutant: no lock)', async () => {
  const shared = join(homeOfAll, 'two-processes')
  const config_dir = join(shared, 'claude')
  mkdirSync(config_dir, { recursive: true })
  const settings_file = join(config_dir, USER_SETTINGS_FILE)
  writeFileSync(settings_file, OWNERS_BYTES)
  const lock_root = join(shared, 'state', STATE_ROOT_NAME)
  // Two crews of one owner, so what they share is the owner's file and nothing else: the models are told apart by
  // being each other's, which is what a switch across two crews would really look like.
  const first = aProcessToSwitch(shared, { tag: 'a', own_model: OWN_MODEL, review_model: THE_REVIEWER_MODEL, member: 'builder', config_dir, settings_file, lock_root, waits_for_go: true })
  await waitForAFile(join(shared, 'a', 'saved-a'), 'the first switch never saved its model')
  const second = aProcessToSwitch(shared, { tag: 'b', own_model: THE_REVIEWER_MODEL, review_model: OWN_MODEL, member: 'reviewer', config_dir, settings_file, lock_root, waits_for_go: false })
  // The second switch's order must not come back while the first holds the lock: that is the whole of R2.
  await new Promise((resolved) => setTimeout(resolved, 400))
  assert.equal(there(join(shared, 'b', 'ordered-b')), false, 'the second switch took its order while the first still held the owner\'s settings file, so nothing kept them apart')
  writeFileSync(join(shared, 'a', 'go-a'), '')
  await first
  await second
  assert.equal(there(join(shared, 'b', 'ordered-b')), true, 'the second switch never got its order after the first gave the lock back')
  assert.equal(readFileSync(settings_file, 'utf8'), OWNERS_BYTES, 'two switches on one owner\'s file left the owner\'s default somewhere else')
})

/** A part a process plays in the two-process test: which crew it is, and which way its switch moves. */
interface ItsPart {
  readonly tag: string
  readonly own_model: string
  readonly review_model: string
  readonly member: string
  readonly config_dir: string
  readonly settings_file: string
  readonly lock_root: string
  readonly waits_for_go: boolean
}

/** Starts one switch as its own process, and answers when it has ended: the driver is ../prove_the_core's. */
function aProcessToSwitch(shared: string, part: ItsPart): Promise<void> {
  const home = join(shared, part.tag)
  mkdirSync(home, { recursive: true })
  const config_file = join(home, 'its-part.json')
  writeFileSync(config_file, `${JSON.stringify({ home, package: THE_PACKAGE, ...part })}\n`)
  return new Promise((resolved, refused) => {
    const child = spawn(process.execPath, [SWITCH_DRIVER, config_file], { stdio: 'inherit' })
    child.on('error', refused)
    child.on('exit', (code) => (code === 0 ? resolved() : refused(new Error(`the switch in process ${part.tag} ended with ${String(code)}`))))
  })
}

/** The driver that runs one switch as its own process. */
const SWITCH_DRIVER = join(import.meta.dirname, '..', '..', 'prove_the_core', 'a_switch_in_another_process.ts')

/** Whether a file is there, without waiting. */
function there(file: string): boolean {
  try {
    readFileSync(file)
    return true
  } catch {
    return false
  }
}

/** Waits, bounded, until a file is there: the step another process reached, rather than a guess at a clock. */
async function waitForAFile(file: string, why: string): Promise<void> {
  for (let waited = 0; waited < A_FILE_WAITS_MS; waited += A_STEP_MS) {
    if (there(file)) return
    await new Promise((resolved) => setTimeout(resolved, A_STEP_MS))
  }
  throw new Error(`${why}: ${file} never appeared`)
}

/** How long a step of another process may take before the test calls it stuck. */
const A_FILE_WAITS_MS = 30_000

/** How often the test looks for another process's step. */
const A_STEP_MS = 20

// The checks no case above reaches, each pinned by the case only it can save (martha#359 r=2, Uranus's U1 to U8): a
// recovery from a record whose save never showed, at both timings; the two checks a restore makes before it writes; the
// config directory a record was kept for; a lock whose holder has died; the mode of the owner's own file, which can hold
// their environment; and the line a launch owes the owner when it cannot finish what a switch left open.

/** A third model, which this crew declares nowhere: the owner's file is theirs, and it may hold a model no crew names. */
const A_THIRD_MODEL = 'haiku'

/**
 * A record whose save the wait never saw, the way a switch leaves one: `after` is null, the wait timed out, and the
 * record holds what the next launch must match to finish it. The host's save is written after the wait, where it really
 * can land, so the file says the member's model while the record has no hash of it.
 */
async function aRecordTheWaitNeverSaw(crew: ACrewMade): Promise<TheOwnersModelRecord> {
  const guard = await guardTheOwnersDefault(crew.owners, THE_REVIEWER_MODEL)
  assert.ok(!('refusal' in guard), `the test could not guard the owner's settings file: ${'refusal' in guard ? guard.refusal : ''}`)
  guard.lock.release()
  const seen = theSaveThatNeverShowed(crew.owners, guard)
  assert.equal(seen.moved, false, 'the file showed a save the test never wrote')
  assert.ok(seen.record !== null, 'a switch whose save may still land kept no record for the next launch')
  theHostSaved(crew)
  return seen.record
}

test('a recovery from a record whose save never showed puts the owner\'s model back, matching everything but the model (mutant: the recovery from an unseen save always refused)', async () => {
  const crew = await aCrew()
  const record = await aRecordTheWaitNeverSaw(crew)
  assert.equal(record.after, null, 'the record the test built says a save was seen when the wait never saw one')
  const finished = await finishAnUnfinishedSwitch(crew.owners, record)
  assert.equal(finished.why, '', `the recovery would not finish a switch the file still matches: ${finished.why}`)
  assert.equal(finished.record, null, 'a finished switch left a record behind for the next launch')
  assert.deepEqual(JSON.parse(readFileSync(crew.settings_file, 'utf8')) as unknown, OWNERS_SETTINGS, 'the recovery did not put the owner\'s model back')
})

test('a recovery from a record whose save never showed writes nothing when the owner changed something else, and names the file (mutant: the recovery from an unseen save ignores what else moved)', async () => {
  const crew = await aCrew()
  const record = await aRecordTheWaitNeverSaw(crew)
  writeFileSync(crew.settings_file, THE_OWNERS_EDIT)
  const finished = await finishAnUnfinishedSwitch(crew.owners, record)
  const why = `something other than the model changed in ${crew.settings_file} during the switch, so nothing was written back and the owner's default may be the member's model`
  assert.equal(finished.why, why, 'the recovery did not say why it left the owner\'s file alone')
  assert.equal(readFileSync(crew.settings_file, 'utf8'), THE_OWNERS_EDIT, 'the recovery wrote over a change the owner made')
})

test('a restore writes nothing when the model was replaced again after the host\'s save, and says the model was changed again (mutant: the check that the file still holds what the switch wrote removed)', async () => {
  const crew = await aCrew()
  await switched(crew.tools)
  const guard = await guardTheOwnersDefault(crew.owners, THE_REVIEWER_MODEL)
  assert.ok(!('refusal' in guard), `the test could not guard the owner's settings file: ${'refusal' in guard ? guard.refusal : ''}`)
  theHostSaved(crew)
  const seen = await theSaveInTheFile(crew.owners, guard)
  if (!seen.moved) assert.fail('the file did not show the save the test wrote')
  // The model alone changes again before the restore: the file still holds nothing but the owner's own keys, so only the
  // value the switch saw can tell this from the host's save.
  const replaced = `${JSON.stringify({ env: { MARTHA_TEST: '1' }, model: A_THIRD_MODEL }, null, 2)}\n`
  writeFileSync(crew.settings_file, replaced)
  const after = putTheOwnersModelBack(crew.owners, guard, seen.record)
  guard.lock.release()
  assert.equal(after.why, `the model in ${crew.settings_file} was changed again before the switch could be put back, so nothing was written back and the owner's default may be the member's model`, 'the restore did not name the model that was changed again')
  assert.equal(readFileSync(crew.settings_file, 'utf8'), replaced, 'the restore wrote over a model something else had just set')
})

test('a record kept for another config directory is put back nowhere, and the reason names both (mutant: the config-directory check removed)', async () => {
  const crew = await aCrew()
  const record = await aRecordTheWaitNeverSaw(crew)
  const before = readFileSync(crew.settings_file, 'utf8')
  const elsewhere = { ...record, config_dir: join(homeOfAll, 'another-config') }
  const finished = await finishAnUnfinishedSwitch(crew.owners, elsewhere)
  assert.equal(
    finished.why,
    `a switch was left unfinished on ${elsewhere.config_dir}'s settings, and this launch reads ${crew.owners.config_dir}, so nothing was put back: ${crew.settings_file} is not the file that switch wrote`,
    'the recovery did not refuse a record kept for another config directory',
  )
  assert.equal(readFileSync(crew.settings_file, 'utf8'), before, 'a recovery wrote into a file it was not the record for')
})

test('a lock whose holder has died is broken by the next switch, so a crash does not refuse every switch after it (mutant: a lock nobody holds never broken)', async () => {
  const crew = await aCrew()
  const taken = await guardTheOwnersDefault(crew.owners, THE_REVIEWER_MODEL)
  assert.ok(!('refusal' in taken), `the test could not take the lock: ${'refusal' in taken ? taken.refusal : ''}`)
  const lock_file = taken.lock.file
  taken.lock.release()
  // The lock a killed switch leaves behind: a nonce, and the pid of a process that had already ended.
  const ended = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' })
  assert.equal(ended.status, 0, 'the test could not make a process and let it end')
  writeFileSync(lock_file, `a-switch-that-died\n${String(ended.pid)}\n${new Date(0).toISOString()}\n`)
  const again = await guardTheOwnersDefault(crew.owners, THE_REVIEWER_MODEL)
  assert.ok(!('refusal' in again), `the switch after a crash was refused because the dead switch's lock was left behind: ${'refusal' in again ? again.refusal : ''}`)
  if (!('refusal' in again)) again.lock.release()
})

test('the owner\'s file keeps its own mode through a restore and through a recovery, because it can hold their secrets (mutant: the mode not kept)', async () => {
  const crew = await aCrew()
  chmodSync(crew.settings_file, 0o600)
  await aSwitchedMember(crew)
  assert.equal(statSync(crew.settings_file).mode & 0o777, 0o600, 'the restore widened the mode of the owner\'s own settings file')
  const record = await aRecordTheWaitNeverSaw(crew)
  const finished = await finishAnUnfinishedSwitch(crew.owners, record)
  assert.equal(finished.why, '', `the recovery did not finish the switch: ${finished.why}`)
  assert.equal(statSync(crew.settings_file).mode & 0o777, 0o600, 'the recovery widened the mode of the owner\'s own settings file')
})

test('a record a launch cannot finish puts its line in the member\'s own row, not only in the terminal (mutant: the row left out)', async () => {
  const crew = await aCrew()
  await switched(crew.tools)
  // A report first, because a launch's line has a row to go into only for a member that has one: the launch is asked
  // about a member that was running and had left a record behind, and no guard is held, so nothing here is put back.
  await reported(crew)
  const marker = theRecordOf(crew.crew)
  assert.ok(marker !== null, 'the test could not read the record of the member\'s switch')
  const record = await aRecordTheWaitNeverSaw(crew)
  theOwnersDefaultKept({ stores: { crew: crewFilesDirectory(crew.crew) } }, MEMBER, marker, record)
  // The owner's own change since, so the launch cannot finish the record by either hash it holds.
  writeFileSync(crew.settings_file, THE_OWNERS_EDIT)
  const said = await finishTheOwnersDefaultAtLaunch({
    member: MEMBER,
    host: { stores: { crew: crewFilesDirectory(crew.crew) } },
    owners: crew.owners,
    beats: crew.beats,
  })
  assert.equal(said.length, 1, `the launch finished the record it should have left to the owner: ${JSON.stringify(said)}`)
  assert.equal(crew.theRow()?.['needs'], said[0], 'the row does not say what needs the owner about the record the launch could not finish')
})
