// The owner's two overrides, `/crew-progress` and `/crew-park` (martha#1000, gap 8 of #957): progress reporting turned
// off from a session's own tab stops taking the member's reports and clears what was taken, and the park command moves
// the park of the session it was typed in, on the owner's own word.
//
// Both are the launcher's answers to an ask the mod posts, so they are driven here the way the mod drives them: through
// the tools' own `answer`, with the ask's name and its arguments. The park's marker is read back from the crew's store,
// which is the same file the wake and the launcher read.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import { openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { theParkMarker, theParkOf, parkedPlace } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { REPORT_PROGRESS_TOOL } from '../report_where_the_work_stands/report_progress_tool.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { THE_OWNERS_PARK_ASK, THE_PROGRESS_SWITCH_ASK, PROGRESS_REPORTING_IS_OFF, crewToolsOver, type CrewTools } from './a_crews_tools.ts'

/** The models this test's host runs (martha#315), as the park test's declaration is read against them. */
const HOST_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['opus', 'fable'] }

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-overrides-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }
const MEMBER = 'a member'

/** One crew the test made, and the clock its rows are written on. */
interface ACrew {
  readonly tools: CrewTools
  readonly beats: ReturnType<typeof dashboardRowsIn>
  /** Moves the crew's clock on, so a row written next is newer than the row held (the beat rule drops an older one). */
  tick: () => void
}

let crewsSoFar = 0
async function aCrewOfTools(): Promise<ACrew> {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crewFiles = join(home, 'crew-files')
  mkdirSync(root, { recursive: true })
  // The row's own directory is the store's to write whole files into; a crew that never made one keeps no row.
  mkdirSync(join(home, 'row'), { recursive: true })
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const declared = await declareSoloCrew({ root, owner: 'an owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.ok(declared.declared, `the test could not declare a crew: ${declared.declared ? '' : declared.refusal}`)
  let at = 1_000
  const beats = dashboardRowsIn(join(home, 'row'))
  const tools = crewToolsOver({
    member: MEMBER,
    ledger: { clock: { now: () => at }, stores: { rows: rowStreamsDirectory(join(home, 'row-streams')) } },
    beats,
    root,
    documents,
    stores: { crew: keepTheCrewsFilesAsDirectories(crewFiles) },
  })
  return { tools, beats, tick: () => void (at += 1_000) }
}

/** The member's own report, as its session posts it. */
const aReport = (task: string) => ({ task, step: 2, of: 5, phase: 'working' })

test('#1000: /crew-progress off takes no more reports and clears the one already taken, and on takes them again', async () => {
  const crew = await aCrewOfTools()
  const reported = await crew.tools.answer(REPORT_PROGRESS_TOOL.name, aReport('the work in hand'), 's-1')
  assert.ok('answer' in reported, `the report was refused: ${JSON.stringify(reported)}`)
  crew.tick()
  const taken = crew.beats.read(MEMBER)
  assert.equal(taken?.task, 'the work in hand', 'the report did not reach the row')

  crew.tick()
  const off = await crew.tools.answer(THE_PROGRESS_SWITCH_ASK, { wanted: 'off' }, 's-1')
  assert.ok('answer' in off && off.answer.includes('off'), `the switch answered ${JSON.stringify(off)}`)
  const cleared = crew.beats.read(MEMBER)
  assert.equal(cleared?.task, '', 'the report already taken stood after progress reporting was turned off')
  assert.equal(cleared?.progress.step, 0, 'the figure already taken stood after progress reporting was turned off')

  crew.tick()
  const refused = await crew.tools.answer(REPORT_PROGRESS_TOOL.name, aReport('a second try'), 's-1')
  assert.deepEqual(refused, { answer: PROGRESS_REPORTING_IS_OFF }, 'a report was taken while progress reporting was off')
  assert.equal(crew.beats.read(MEMBER)?.task, '', 'a report taken while off reached the row')

  crew.tick()
  await crew.tools.answer(THE_PROGRESS_SWITCH_ASK, { wanted: 'on' }, 's-1')
  crew.tick()
  await crew.tools.answer(REPORT_PROGRESS_TOOL.name, aReport('back at it'), 's-1')
  assert.equal(crew.beats.read(MEMBER)?.task, 'back at it', 'a report was not taken again after progress reporting was turned back on')
})

test('#1000: a switch that names neither on nor off is refused and moves nothing', async () => {
  const crew = await aCrewOfTools()
  const refused = await crew.tools.answer(THE_PROGRESS_SWITCH_ASK, { wanted: 'sideways' }, 's-1')
  assert.ok('refused' in refused, `a switch that named neither on nor off answered ${JSON.stringify(refused)}`)
})

test('#1000: /crew-park moves this session\'s own park, and /crew-park off takes it back', async () => {
  const crew = await aCrewOfTools()
  const parked = await crew.tools.answer(THE_OWNERS_PARK_ASK, { parked: true }, 's-1')
  assert.ok('answer' in parked && parked.answer.includes('parked'), `the park answered ${JSON.stringify(parked)}`)
  const place = parkedPlace({ stores: { crew: keepTheCrewsFilesAsDirectories(join(homeOfAll, `crew-${crewsSoFar}`, 'crew-files')) } })
  assert.ok(!('refusal' in place), 'the crew store refused its park place')
  assert.equal(theParkMarker(MEMBER), `${MEMBER}.parked.json`)
  const marker = theParkOf(place, MEMBER)
  assert.equal(marker.kind, 'parked', `the park did not reach the store: ${JSON.stringify(marker)}`)

  const unparked = await crew.tools.answer(THE_OWNERS_PARK_ASK, { parked: false }, 's-1')
  assert.ok('answer' in unparked && unparked.answer.includes('unparked'), `the unpark answered ${JSON.stringify(unparked)}`)
  assert.equal(theParkOf(place, MEMBER).kind, 'not_parked', 'the unpark did not reach the store')
})
