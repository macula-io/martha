// The reading of what a session spent, taken the whole way round through the crew's tools (martha#860).
//
// What this proves that the slice's own tests cannot: the reading is taken where the mod's question arrives, BEFORE the
// flow orders a model switch, so the turn the question closes is kept under the model that ran it (Venus's R1). A
// switch ordered at a reading moves only the turns after the host confirms it.
//
// The mutant each test kills is named in its title.

import { THE_BUDGET_ASK } from '../keep_what_a_session_spent/the_crews_budget.ts'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { ownersSettingsIn } from '../owners_settings_directory/owners_settings_directory.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, REVIEW_MODEL, MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { CREW_ROWS_PLACE, openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { askAMemberToRefresh, CARRY_A_MODEL, CARRY_A_TEXT, THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { SWITCH_YOUR_MODEL } from '../switch_a_members_model/the_switch_tools.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import type { RowStore } from '../host_contract/host_contract.ts'
import { SPEND_NOT_KEPT, THE_ENGINES_USAGE_HOST, USAGE_PLACE, usageStreamOf, type AUsageHost } from '../keep_what_a_session_spent/keep_what_a_session_spent.ts'
import { theSpendBetween } from '../keep_what_a_session_spent/the_spend_between.ts'
import { crewToolsOver, THE_MODEL_REPORT_ASK, type CrewTools } from './a_crews_tools.ts'

const HOST_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['sonnet', 'opus', 'fable'] }
const OWN_MODEL = 'sonnet'
const THE_REVIEWER_MODEL = 'fable'
const MEMBER = 'builder'
const THE_PACKAGE = 'macula-io/martha#860'
const SESSION = 'a-session'
const STARTED_AT = 1_794_998_340_000
const THE_CREW_FILES = 'the-crew-files'

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-usage-reading-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }

interface ACrew {
  readonly tools: CrewTools
  readonly rows: RowStore
  readonly aTurnLater: () => void
  readonly home: string
  readonly beats: ReturnType<typeof dashboardRowsIn>
}

/** A solo crew whose member runs on its own model and may switch to the crew's reviewer model. */
async function aCrewOfTools(more: { readonly usage_host?: AUsageHost } = {}): Promise<ACrew> {
  const home = join(homeOfAll, `crew-${String(Math.random()).slice(2)}`)
  const root = join(home, 'checkout')
  const clock = { at: STARTED_AT }
  mkdirSync(root, { recursive: true })
  mkdirSync(join(home, 'row'), { recursive: true })
  mkdirSync(join(home, CREW_ROWS_PLACE), { recursive: true })
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const declared = await declareSoloCrew({ runtime_dir: undefined, root, owner: 'an owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.ok(declared.declared, `the test could not declare a crew: ${declared.declared ? '' : declared.refusal}`)
  const declaration = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const held = JSON.parse(readFileSync(declaration, 'utf8')) as { members: { name: string; model?: string }[]; house_rules?: Record<string, unknown> }
  for (const member of held.members) if (member.name === MEMBER) member.model = OWN_MODEL
  held.house_rules = { ...(held.house_rules ?? {}), [REVIEW_MODEL]: THE_REVIEWER_MODEL }
  writeFileSync(declaration, `${JSON.stringify(held, null, 2)}\n`)
  const config_dir = join(home, 'the-hosts-config')
  mkdirSync(config_dir, { recursive: true })
  const rows = rowStreamsDirectory(join(home, CREW_ROWS_PLACE))
  const beats = dashboardRowsIn(join(home, 'row'))
  const tools = crewToolsOver({
    member: MEMBER,
    ledger: { clock: { now: () => clock.at }, stores: { rows } },
    beats,
    root,
    documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(join(home, THE_CREW_FILES)) },
    models: HOST_MODELS,
    launched_on: OWN_MODEL,
    ...more,
    owners_settings: { config_dir, file: join(config_dir, USER_SETTINGS_FILE), store: ownersSettingsIn(join(config_dir, USER_SETTINGS_FILE), state.state_root) },
  })
  return { tools, rows, home, beats, aTurnLater: () => (clock.at += MINUTE_MS) }
}

/** The mod's question at a turn's end, carrying what the session has cost so far. */
async function aTurnEnds(crew: ACrew, turn_id: string, usd: number, more: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  crew.aTurnLater()
  const usage = { startedAt: STARTED_AT, context: { percent: 5 }, cost: { usd }, rateLimits: [{ kind: 'five_hour', percentUsed: 1 }] }
  const answered = await crew.tools.answer(THE_REFRESH_ASK, { usage, turn_id, answer: '', ...more }, SESSION)
  assert.ok('answer' in answered, `the flow refused the question: ${'refused' in answered ? answered.refused : ''}`)
  return JSON.parse(answered.answer) as Record<string, unknown>
}

async function called(crew: ACrew, name: string, args: Record<string, unknown>): Promise<void> {
  // A call is a beat of its own, newer than the turn before it, as a real one is: a beat no newer is dropped.
  crew.aTurnLater()
  const answered = await crew.tools.answer(name, args, SESSION)
  assert.ok('answer' in answered, `${name} was refused: ${'refused' in answered ? answered.refused : ''}`)
}

test('#860 R1: the turn a switch is ordered at is kept under the model that ran it (mutant: the reading takes the ordered model)', async () => {
  const crew = await aCrewOfTools()
  await aTurnEnds(crew, '', 0)
  await called(crew, REPORT_WHERE_THE_WORK_STANDS, { task: 'the spend row', step: 1, of: 3, package: THE_PACKAGE })
  await aTurnEnds(crew, 't-1', 0.25)
  await called(crew, SWITCH_YOUR_MODEL, { model: THE_REVIEWER_MODEL, package: THE_PACKAGE, reason: 'the review is on the other model' })
  // The question that closes the turn the switch was made in is answered with the switch: that turn ran on the own model.
  assert.deepEqual(await aTurnEnds(crew, 't-2', 0.5), { carry: CARRY_A_MODEL, model: THE_REVIEWER_MODEL }, 'the switch was not ordered at this reading')
  await called(crew, THE_MODEL_REPORT_ASK, { model: THE_REVIEWER_MODEL })
  await aTurnEnds(crew, 't-3', 1.5)

  // The session began on the crew's stream and opened the package's at t-1, the reading that first saw the package.
  const readings = (await crew.rows.read(usageStreamOf(THE_PACKAGE))).map((stored) => [stored.row['model'], stored.row['usd'], stored.row['opens']])
  assert.deepEqual(readings, [[OWN_MODEL, 0.25, 1], [OWN_MODEL, 0.5, 0], [THE_REVIEWER_MODEL, 1.5, 0]], 'the readings are not the turns as the models that ran them')

  const spend = theSpendBetween({ from: 0, to: Number.MAX_SAFE_INTEGER, usage: new Map([[THE_PACKAGE, await crew.rows.read(usageStreamOf(THE_PACKAGE))]]), crew: await crew.rows.read(usageStreamOf(null)) })
  assert.ok(!('refused' in spend), 'the readings could not be read back')
  assert.deepEqual(spend.bySessionModel, [
    { model: OWN_MODEL, usd: { subscription: 0.5, metered: 0, unknown: 0 } },
    { model: THE_REVIEWER_MODEL, usd: { subscription: 1, metered: 0, unknown: 0 } },
  ], 'the turn the switch was ordered at was put on the model it was switched to')
})

test('#860 R4: a reading the store refused is said on the row, the order left alone, and taken off once one is kept (mutant: the refusal dropped)', async () => {
  const crew = await aCrewOfTools()
  await aTurnEnds(crew, '', 0)
  // A file where the crew's usage place belongs: the store refuses the place, so the writer cannot remember its reading.
  const usage_place = join(crew.home, THE_CREW_FILES, USAGE_PLACE)
  removeTheTree(usage_place)
  writeFileSync(usage_place, 'not a place\n')
  assert.deepEqual(await aTurnEnds(crew, 't-1', 0.25), { carry: 'none' }, 'a reading the store refused held the flow up')
  const said = crew.beats.read(MEMBER)?.refresh
  assert.equal(said?.phase, SPEND_NOT_KEPT, 'the refusal was not said on the row')
  assert.match(said?.reason ?? '', /^what the session spent was not kept: Martha keeps no crew files there/, 'the row does not say why')

  rmSync(usage_place, { force: true })
  // A beat taken while a turn runs keeps nothing, so it takes nothing off either.
  await aTurnEnds(crew, 't-2', 0.375, { turn_running: 1 })
  assert.equal(crew.beats.read(MEMBER)?.refresh?.phase, SPEND_NOT_KEPT, 'a beat that kept nothing took the refusal off the row')
  await aTurnEnds(crew, 't-2', 0.5)
  assert.equal(crew.beats.read(MEMBER)?.refresh ?? null, null, 'the row still says a reading was not kept after one was')
  const kept = (await crew.rows.read(usageStreamOf(null))).map((stored) => stored.row['usd'])
  assert.ok(kept.includes(0.5), 'the reading taken after the store answered again was not kept')
})

test('#860 R4: a refusal on the turn the flow writes its own phase is said beside that phase, never in its place (mutant: the flow\'s phase replaced)', async () => {
  const crew = await aCrewOfTools()
  await aTurnEnds(crew, '', 0)
  const usage_place = join(crew.home, THE_CREW_FILES, USAGE_PLACE)
  removeTheTree(usage_place)
  writeFileSync(usage_place, 'not a place\n')
  const asked = askAMemberToRefresh({ stores: { crew: keepTheCrewsFilesAsDirectories(join(crew.home, THE_CREW_FILES)) } }, MEMBER, 'the owner asked for it', STARTED_AT)
  assert.equal(asked, undefined, 'the test could not ask for a refresh')
  const order = await aTurnEnds(crew, 't-1', 0.25)
  assert.equal(order['carry'], CARRY_A_TEXT, 'the refresh the owner asked for did not start: the refusal held the flow up')
  const said = crew.beats.read(MEMBER)?.refresh
  assert.notEqual(said?.phase, SPEND_NOT_KEPT, 'the flow\'s own phase was replaced by the refusal')
  assert.match(said?.reason ?? '', /.; what the session spent was not kept: Martha keeps no crew files there/, 'the refusal was not said beside the flow\'s own reason')
  rmSync(usage_place, { force: true })
})

/** The refresh phase the member's row says, or null when it says none. */
const theRowPhaseOf = (crew: ACrew): { readonly phase: string; readonly reason: string } | null => crew.beats.read(MEMBER)?.refresh ?? null

/** The crew's usage place made a file, so the store refuses it; undone by the function returned. */
function theUsagePlaceRefused(crew: ACrew): () => void {
  const usage_place = join(crew.home, THE_CREW_FILES, USAGE_PLACE)
  removeTheTree(usage_place)
  writeFileSync(usage_place, 'not a place\n')
  return () => rmSync(usage_place, { force: true })
}

test('#860 R4: a refusal while the flow waits on the phase it wrote earlier is said beside it, once, and taken off leaving the flow\'s own words (mutants: the left phase replaced, the left phase wiped, said twice)', async () => {
  const crew = await aCrewOfTools()
  await aTurnEnds(crew, '', 0)
  const asked = askAMemberToRefresh({ stores: { crew: keepTheCrewsFilesAsDirectories(join(crew.home, THE_CREW_FILES)) } }, MEMBER, 'the owner asked for it', STARTED_AT)
  assert.equal(asked, undefined, 'the test could not ask for a refresh')
  await aTurnEnds(crew, 't-1', 0.25)
  const flows = theRowPhaseOf(crew) ?? assert.fail('the flow wrote no phase of its own to wait on')
  assert.notEqual(flows.phase, SPEND_NOT_KEPT, 'the flow wrote no phase of its own to wait on')
  const answerAgain = theUsagePlaceRefused(crew)
  await aTurnEnds(crew, 't-2', 0.375)
  await aTurnEnds(crew, 't-3', 0.5)
  const said = theRowPhaseOf(crew) ?? assert.fail('the row says no phase')
  assert.equal(said.phase, flows.phase, 'the refusal replaced the phase the flow is waiting on')
  assert.equal(said.reason.split('what the session spent was not kept').length, 2, `the refusal was not said exactly once beside the flow's reason: ${said.reason}`)
  assert.ok(said.reason.startsWith(`${flows.reason}; what the session spent was not kept: Martha keeps no crew files there`), said.reason)
  answerAgain()
  await aTurnEnds(crew, 't-4', 0.625)
  assert.deepEqual(theRowPhaseOf(crew), flows, 'once a reading was kept, the row does not say the flow\'s own phase as the flow wrote it')
})

test('#999 package 5: an engine launch\'s readings are kept under the engine\'s name, and a launch that names no host keeps Claude Code\'s (mutant: the host left hard-coded)', async () => {
  for (const [more, host] of [[{ usage_host: THE_ENGINES_USAGE_HOST }, THE_ENGINES_USAGE_HOST], [{}, CLAUDE_CODE]] as const) {
    const crew = await aCrewOfTools(more)
    await aTurnEnds(crew, '', 0)
    await aTurnEnds(crew, 't-1', 0.25)
    const hosts = (await crew.rows.read(usageStreamOf(null))).map((stored) => stored.row['host'])
    assert.ok(hosts.length > 0, 'no reading was kept')
    assert.deepEqual([...new Set(hosts)], [host])
  }
})

test('#990: a turn\'s weekly reading is the crew\'s budget: /crew-budget shows it, sets the reviewer gauge, and the pane draws the line (mutant: the reading not kept)', async () => {
  const crew = await aCrewOfTools()
  const resets_at = STARTED_AT + 3 * 24 * 60 * MINUTE_MS
  const weekly = { kind: 'seven_day', percentUsed: 37, resetsAt: new Date(resets_at).toISOString() }
  crew.aTurnLater()
  const asked = await crew.tools.answer(THE_REFRESH_ASK, { usage: { startedAt: STARTED_AT, context: { percent: 5 }, cost: { usd: 1 }, rateLimits: [weekly] }, turn_id: 'turn-990', answer: '' }, SESSION)
  assert.ok('answer' in asked, `the flow refused the question: ${'refused' in asked ? asked.refused : ''}`)
  const shown = await crew.tools.answer(THE_BUDGET_ASK, { typed: '' }, SESSION)
  assert.ok('answer' in shown && shown.answer.startsWith('Budget: weekly 37% · resets in 3d.'), `the budget was not shown from the turn's reading: ${JSON.stringify(shown)}`)
  const set = await crew.tools.answer(THE_BUDGET_ASK, { typed: `${THE_REVIEWER_MODEL} 56` }, SESSION)
  assert.ok('answer' in set && set.answer.includes(' · Fable 56% (set 1m ago).'), `the reviewer gauge was not set: ${JSON.stringify(set)}`)
  const pane = await crew.tools.answer('see_the_crew', {}, SESSION)
  assert.ok('answer' in pane)
  const lines = (JSON.parse(pane.answer) as { lines: string[] }).lines
  assert.ok(lines.some((line) => line.startsWith('Budget: weekly 37% · resets in 3d') && line.endsWith('Fable 56% (set 1m ago)')), `the pane draws no budget line: ${lines.join(' | ')}`)
})
