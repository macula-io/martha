// The park and wake tools a member calls (martha#255 part 2, martha#343): `park_a_member` sets the marker and
// `wake_a_member` clears it, and each says what landed.
//
// The tools decide nothing of their own. A member's park or wake of itself is always allowed; another member's is the
// declaration's table, and the refusal names the act that would have allowed it (r=3). The marker is the same file the
// wake and the launcher read (../park_and_wake_a_member), written through the crew's own store, so what a tool answers
// is what an owner reading the crew's state would find. One tool, one act: no call carries a flag saying which act was
// meant, so no call can be read as the other one (martha#343).

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { declareSoloCrew } from '../declare_a_solo_crew/declare_a_solo_crew.ts'
import { openState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { parkedPlace, theParkMarker, theParkOf } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { THE_TOOLS_ASK, PARK_A_MEMBER, WAKE_A_MEMBER, crewToolsOver, type CrewTools } from './a_crews_tools.ts'

/** The models this test's host runs (martha#315): the vocabulary a declaration's review_model is read against. */
const HOST_MODELS = ['opus', 'fable']

const homeOfAll = mkdtempSync(join(tmpdir(), 'martha-park-tool-'))
after(() => removeTheTree(homeOfAll))

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** One crew the test made: the tools its member calls, and where its own store is, so nothing is shared between tests. */
interface ACrew {
  readonly tools: CrewTools
  readonly crew: string
}

/** A solo crew declared in a checkout of its own, and the tools one of its members calls. */
let crewsSoFar = 0
async function aCrewOfTools(member: string): Promise<ACrew> {
  crewsSoFar += 1
  const home = join(homeOfAll, `crew-${crewsSoFar}`)
  const root = join(home, 'checkout')
  const crew = join(home, 'crew')
  mkdirSync(root, { recursive: true })
  const state = openState(join(home, 'state'), root)
  assert.ok(!('refusal' in state), `the test could not open Martha's state: ${'refusal' in state ? state.refusal : ''}`)
  const declared = await declareSoloCrew({ root, owner: 'an owner', state, documents, models: HOST_MODELS })
  assert.ok(declared.declared, `the test could not declare a crew: ${declared.declared ? '' : declared.refusal}`)
  const tools = crewToolsOver({
    member,
    ledger: { clock: { now: () => 1_000 }, stores: { rows: rowStreamsDirectory(join(home, 'rows')) } },
    beats: dashboardRowsIn(join(home, 'row')),
    root,
    documents,
    stores: { crew: crewFilesDirectory(crew) },
  })
  return { tools, crew }
}

/** What the crew's store holds for `member`, as the wake and the launcher read it. */
function theParkInTheStore(crew: string, member: string) {
  const place = parkedPlace({ stores: { crew: crewFilesDirectory(crew) } })
  assert.ok(!('refusal' in place), `the crew's store refused its park place: ${'refusal' in place ? place.refusal : ''}`)
  return theParkOf(place, member)
}

test('#255 part 2: a member parks itself with the tool, and the marker says why', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const answered = await tools.answer(PARK_A_MEMBER, { reason: 'waiting for the owner to decide' }, 'a-session')
  assert.ok('answer' in answered, `the park tool refused a member's park of itself: ${'refused' in answered ? answered.refused : ''}`)
  assert.deepEqual(theParkInTheStore(crew, 'builder'), {
    kind: 'parked',
    marker: { parked: true, reason: 'waiting for the owner to decide', since: new Date(1_000).toISOString() },
  })
})

test('#255 part 2: a member wakes itself with the wake tool, and the marker is written rather than removed', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  assert.ok('answer' in (await tools.answer(PARK_A_MEMBER, { reason: 'a reason' }, 'a-session')), 'the test could not park the member first')
  const answered = await tools.answer(WAKE_A_MEMBER, { reason: 'the owner is back' }, 'a-session')
  assert.ok('answer' in answered, `the wake tool refused a member's wake of itself: ${'refused' in answered ? answered.refused : ''}`)
  const park = theParkInTheStore(crew, 'builder')
  assert.equal(park.kind, 'not_parked', `${WAKE_A_MEMBER} left the member parked, so the wake moved the park the wrong way`)
  assert.equal(park.kind === 'not_parked' ? park.last_marker?.reason : '', 'the owner is back', 'the wake lost the reason it was given')
})

test('#255 part 2: a member parks nobody it may not, and is told which act it would need', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const answered = await tools.answer(PARK_A_MEMBER, { reason: 'a reason', member: 'reviewer' }, 'a-session')
  assert.ok('refused' in answered, 'a solo crew\'s member parked a colleague, which its table does not grant')
  assert.match(answered.refused, /resume_parked_work/, 'the refusal does not name the act that would have allowed it')
  assert.deepEqual(theParkInTheStore(crew, 'reviewer'), { kind: 'not_parked', last_marker: null }, 'a refused park left a marker behind')
})

test('#255 part 2: a member wakes nobody it may not, and is told which act it would need', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const answered = await tools.answer(WAKE_A_MEMBER, { reason: 'a reason', member: 'reviewer' }, 'a-session')
  assert.ok('refused' in answered, 'a solo crew\'s member woke a colleague, which its table does not grant')
  assert.match(answered.refused, /resume_parked_work/, 'the refusal does not name the act that would have allowed it')
  assert.deepEqual(theParkInTheStore(crew, 'reviewer'), { kind: 'not_parked', last_marker: null }, 'a refused wake left a marker behind')
})

test('#255 part 2: a park naming somebody the crew does not have is refused with the crew\'s names', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const answered = await tools.answer(PARK_A_MEMBER, { reason: 'a reason', member: 'nobody' }, 'a-session')
  assert.ok('refused' in answered, 'a park naming a member the crew does not have was kept')
  assert.match(answered.refused, /builder, reviewer/, 'the refusal does not name the crew\'s members')
  assert.deepEqual(theParkInTheStore(crew, 'nobody'), { kind: 'not_parked', last_marker: null }, 'a refused park left a marker behind')
})

test('#255 part 2: a wake naming somebody the crew does not have is refused with the crew\'s names', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const answered = await tools.answer(WAKE_A_MEMBER, { reason: 'a reason', member: 'nobody' }, 'a-session')
  assert.ok('refused' in answered, 'a wake naming a member the crew does not have was kept')
  assert.match(answered.refused, /builder, reviewer/, 'the refusal does not name the crew\'s members')
  assert.deepEqual(theParkInTheStore(crew, 'nobody'), { kind: 'not_parked', last_marker: null }, 'a refused wake left a marker behind')
})

// Until martha#343 one tool took a `parked` boolean and refused anything it could not read as one, because a word that
// looked like `true` once went down the unpark path and answered "not parked" about a member nobody had brought out of a
// park (martha#255 part 2 r=1 R3). The act is the tool's now, so there is no flag to read: neither schema carries one,
// and an argument that looks like the old flag cannot turn a park into a wake.
test('#343: neither tool takes a flag saying which act it is, so no argument can read as the other one', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const ask = await tools.answer(THE_TOOLS_ASK, {}, 'a-session')
  assert.ok('answer' in ask, 'the launcher answered the tools ask with no tools')
  const registered = JSON.parse(ask.answer) as readonly { name: string; inputSchema: { properties?: Record<string, unknown>; required?: readonly string[] } }[]
  for (const name of [PARK_A_MEMBER, WAKE_A_MEMBER]) {
    const tool = registered.find((one) => one.name === name)
    assert.ok(tool !== undefined, `${name} is not among the tools the launcher registers`)
    assert.equal(Object.hasOwn(tool.inputSchema.properties ?? {}, 'parked'), false, `${name} still takes a parked flag, so a call can say which act it means`)
    assert.deepEqual(tool.inputSchema.required, ['reason'], `${name} does not ask for a reason and nothing else`)
  }

  const answered = await tools.answer(PARK_A_MEMBER, { reason: 'waiting for the owner', parked: false }, 'a-session')
  assert.ok('answer' in answered, `a park carrying the old flag was refused: ${'refused' in answered ? answered.refused : ''}`)
  assert.equal(theParkInTheStore(crew, 'builder').kind, 'parked', 'an argument that looks like the old flag turned a park into a wake')
})

test('#255 part 2: a park or a wake with no reason is refused, rather than kept as a line the owner cannot read', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  for (const tool of [PARK_A_MEMBER, WAKE_A_MEMBER]) {
    const answered = await tools.answer(tool, { reason: '  ' }, 'a-session')
    assert.ok('refused' in answered, `${tool} kept a call saying nothing, which the owner cannot read`)
    assert.match(answered.refused, /says why in one line/, `${tool} does not say what a call must carry`)
  }
  assert.deepEqual(theParkInTheStore(crew, 'builder'), { kind: 'not_parked', last_marker: null }, 'a refused park left a marker behind')
})

test('#255 part 2: both park tools are among the crew\'s tools, and the marker file is the one the wake reads', async () => {
  const { tools } = await aCrewOfTools('builder')
  const ask = await tools.answer(THE_TOOLS_ASK, {}, 'a-session')
  assert.ok('answer' in ask, 'the launcher answered the tools ask with no tools')
  const names = (JSON.parse(ask.answer) as readonly { name: string }[]).map((tool) => tool.name)
  for (const tool of [PARK_A_MEMBER, WAKE_A_MEMBER]) assert.ok(names.includes(tool), `${tool} is not among the tools the launcher registers`)
  assert.equal(theParkMarker('builder'), 'builder.parked.json', 'the marker is named something other than the member')
})
