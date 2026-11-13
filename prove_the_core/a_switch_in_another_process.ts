// One member's model switch, run as its own process (martha#359 R2).
//
// This exists so a lock can be proved to be a lock: two switches in one process share a memory, and an in-memory flag
// would pass a test of two switches that never contend for anything. Two of these run at once from
// ../src/a_crews_tools/a_switch_leaves_the_owners_default_alone.node-test.ts, each member its own process, each with
// its own crew and its own model record, and both over the one owner's settings file the lock is named for.
//
// It takes one argument, a JSON file, and does what a member's launcher does: the switch tool, the turn's question and
// the order that guards the owner's file, the host's own save written the way the host writes one, and the report that
// puts it back. What it leaves behind is signal files, so the test can wait on the one step it needs rather than on a
// clock: `ordered` when its order came back — the moment it took the lock — and `saved` when its save is in the file.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { crewFilesDirectory } from '../src/crew_files_directory/crew_files_directory.ts'
import { ownersSettingsIn } from '../src/owners_settings_directory/owners_settings_directory.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, REVIEW_MODEL } from '../src/declare_crew/declare_crew.ts'
import { declareSoloCrew } from '../src/declare_a_solo_crew/declare_a_solo_crew.ts'
import { CREW_ROWS_PLACE, openState } from '../src/keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { dashboardRowsIn } from '../src/dashboard_rows_directory/dashboard_rows_directory.ts'
import { rowStreamsDirectory } from '../src/row_streams_directory/row_streams_directory.ts'
import { THE_REFRESH_ASK } from '../src/refresh_a_member/the_refresh_flow.ts'
import { SWITCH_YOUR_MODEL, THE_MODEL_REPORT_ASK, crewToolsOver } from '../src/a_crews_tools/a_crews_tools.ts'

/** What the test tells this process to be: one crew, one member, one model, and where the owner's file is. */
interface ItsPart {
  readonly home: string
  readonly tag: string
  readonly member: string
  readonly own_model: string
  readonly review_model: string
  readonly package: string
  readonly config_dir: string
  readonly settings_file: string
  readonly lock_root: string
  /** Whether it writes its save and then waits for the test's go, the way the first switch holds the file open. */
  readonly waits_for_go: boolean
}

const [config_file] = process.argv.slice(2)
if (config_file === undefined) throw new Error('the switch in another process needs the file that says which switch it is')

const its = JSON.parse(readFileSync(config_file, 'utf8')) as ItsPart
const documents = { read: (path: string) => readFile(path, 'utf8') }

/** Writes the signal the test waits on: one file per step, named for this process's tag. */
const signal = (step: string): void => writeFileSync(join(its.home, `${step}-${its.tag}`), '')

/** The host's own save, as the host writes one: the whole file, with the model it was told to save. */
const theHostSaved = (model: string): void => writeFileSync(its.settings_file, `${JSON.stringify({ env: { MARTHA_TEST: '1' }, model }, null, 2)}\n`)

/** Waits until the test says go, by the file it writes: the first switch holds the lock until then. */
async function waitForTheGo(): Promise<void> {
  for (let waited = 0; waited < 30_000; waited += 20) {
    try {
      readFileSync(join(its.home, `go-${its.tag}`))
      return
    } catch {
      await new Promise((resolved) => setTimeout(resolved, 20))
    }
  }
  throw new Error(`${its.tag} was never told to go, so its switch never finished`)
}

/** The crew this process switches, declared the way a test declares one: its own member, its own models. */
async function theCrewTools(): Promise<ReturnType<typeof crewToolsOver>> {
  const root = join(its.home, 'checkout')
  const crew = join(its.home, 'crew-files')
  for (const made of [root, join(its.home, 'row'), join(its.home, CREW_ROWS_PLACE), its.config_dir]) mkdirSync(made, { recursive: true })
  const state = openState(join(its.home, 'state'), root)
  if ('refusal' in state) throw new Error(state.refusal)
  const declared = await declareSoloCrew({ root, owner: 'an owner', state, documents, models: [its.own_model, its.review_model] })
  if (!declared.declared) throw new Error(declared.refusal)
  declareTheModels(root, its)
  return crewToolsOver({
    member: its.member,
    ledger: { clock: { now: () => Date.now() }, stores: { rows: rowStreamsDirectory(join(its.home, CREW_ROWS_PLACE)) } },
    beats: dashboardRowsIn(join(its.home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(crew) },
    models: [its.own_model, its.review_model],
    launched_on: its.own_model,
    owners_settings: { config_dir: its.config_dir, file: its.settings_file, store: ownersSettingsIn(its.settings_file, its.config_dir, its.lock_root) },
  })
}

/** Gives the crew's declaration this process's models: the member's own, and the one every review runs on. */
function declareTheModels(root: string, part: ItsPart): void {
  const declaration = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const held = JSON.parse(readFileSync(declaration, 'utf8')) as { members: { name: string; model?: string }[]; house_rules?: Record<string, unknown> }
  for (const member of held.members) if (member.name === part.member) member.model = part.own_model
  held.house_rules = { ...(held.house_rules ?? {}), [REVIEW_MODEL]: part.review_model }
  writeFileSync(declaration, `${JSON.stringify(held, null, 2)}\n`)
}

const tools = await theCrewTools()
const switched = await tools.answer(SWITCH_YOUR_MODEL, { model: its.review_model, package: its.package, reason: 'the other process is switching too' }, 'a-session')
if (!('answer' in switched)) throw new Error(switched.refused)
// The order is where the owner's settings file is guarded: this is the step that waits for the other process's lock.
const order = await tools.answer(THE_REFRESH_ASK, { usage: { context: { percent: 5 }, cost: { usd: 0.1 } }, turn_id: `t-${its.tag}`, answer: '' }, 'a-session')
if (!('answer' in order)) throw new Error(order.refused)
signal('ordered')
theHostSaved(its.review_model)
if (its.waits_for_go) {
  signal('saved')
  await waitForTheGo()
}
const reported = await tools.answer(THE_MODEL_REPORT_ASK, { model: its.review_model }, 'a-session')
if (!('answer' in reported)) throw new Error(reported.refused)
signal('reported')
