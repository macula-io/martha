// The park tool a member calls (martha#255 part 2): `crew_park` keeps the marker and says what landed.
//
// The tool decides nothing of its own. A member's park of itself is always allowed; another member's park is the
// declaration's table, and the refusal names the act that would have allowed it (r=3). The marker is the same file the
// wake and the launcher read (../park_and_wake_a_member), written through the crew's own store, so what the tool answers
// is what an owner reading the crew's state would find.

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
import { dashboardRowsIn } from '../launch_a_claude_code_member/dashboard_rows_in_state.ts'
import { parkedPlace, theParkMarker, theParkOf } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { crewToolsOver, type CrewTools } from './a_crews_tools.ts'

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
  const declared = await declareSoloCrew({ root, owner: 'an owner', state, documents })
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
  const answered = await tools.answer('crew_park', { parked: true, reason: 'waiting for the owner to decide' }, 'a-session')
  assert.ok('answer' in answered, `the park tool refused a member's park of itself: ${'refused' in answered ? answered.refused : ''}`)
  assert.deepEqual(theParkInTheStore(crew, 'builder'), {
    kind: 'parked',
    marker: { parked: true, reason: 'waiting for the owner to decide', since: new Date(1_000).toISOString() },
  })
})

test('#255 part 2: the tool unparks a member, and the marker is written rather than removed', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  assert.ok('answer' in (await tools.answer('crew_park', { parked: true, reason: 'a reason' }, 'a-session')), 'the test could not park the member first')
  const answered = await tools.answer('crew_park', { parked: false, reason: 'the owner is back' }, 'a-session')
  assert.ok('answer' in answered, `the park tool refused a member's unpark of itself: ${'refused' in answered ? answered.refused : ''}`)
  const park = theParkInTheStore(crew, 'builder')
  assert.equal(park.kind, 'not_parked', 'the member is still parked after unparking itself')
  assert.equal(park.kind === 'not_parked' ? park.last_marker?.reason : '', 'the owner is back', 'the unpark lost the reason it was given')
})

test('#255 part 2: a member parks nobody it may not, and is told which act it would need', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const answered = await tools.answer('crew_park', { parked: true, reason: 'a reason', member: 'reviewer' }, 'a-session')
  assert.ok('refused' in answered, 'a solo crew\'s member parked a colleague, which its table does not grant')
  assert.match(answered.refused, /resume_parked_work/, 'the refusal does not name the act that would have allowed it')
  assert.deepEqual(theParkInTheStore(crew, 'reviewer'), { kind: 'not_parked', last_marker: null }, 'a refused park left a marker behind')
})

test('#255 part 2: a park naming somebody the crew does not have is refused with the crew\'s names', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const answered = await tools.answer('crew_park', { parked: true, reason: 'a reason', member: 'nobody' }, 'a-session')
  assert.ok('refused' in answered, 'a park naming a member the crew does not have was kept')
  assert.match(answered.refused, /builder, reviewer/, 'the refusal does not name the crew\'s members')
  assert.deepEqual(theParkInTheStore(crew, 'nobody'), { kind: 'not_parked', last_marker: null }, 'a refused park left a marker behind')
})

// A park and an unpark are two acts, and the word that asks for one is a boolean or it is nothing. A `parked` that is
// missing, or a word that looks like one, once went down the unpark path and answered "not parked" about a member
// nobody had brought out of a park (martha#255 part 2 r=1 R3).
test('#255 part 2: a park or an unpark the tool cannot read as true or false is refused, and moves no marker', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  assert.ok('answer' in (await tools.answer('crew_park', { parked: true, reason: 'waiting for the owner' }, 'a-session')), 'the test could not park the member first')
  for (const parked of [undefined, 'true', 'false', 1, 0, null]) {
    const answered = await tools.answer('crew_park', { parked, reason: 'the owner is back' }, 'a-session')
    assert.ok('refused' in answered, `${JSON.stringify(parked)} was read as a park or an unpark`)
    assert.match(answered.refused, /say true to park, false to come out of a park/, 'the refusal does not say what to send instead')
    assert.equal(theParkInTheStore(crew, 'builder').kind, 'parked', `${JSON.stringify(parked)} moved the marker it could not be read for`)
  }
})

test('#255 part 2: a park with no reason is refused, rather than kept as a line the owner cannot read', async () => {
  const { tools, crew } = await aCrewOfTools('builder')
  const answered = await tools.answer('crew_park', { parked: true, reason: '  ' }, 'a-session')
  assert.ok('refused' in answered, 'a park saying nothing was kept')
  assert.deepEqual(theParkInTheStore(crew, 'builder'), { kind: 'not_parked', last_marker: null }, 'a refused park left a marker behind')
})

test('#255 part 2: the park tool is one of the crew\'s tools, and its marker file is the one the wake reads', async () => {
  const { tools } = await aCrewOfTools('builder')
  const ask = await tools.answer('the_crews_tools', {}, 'a-session')
  assert.ok('answer' in ask, 'the launcher answered the tools ask with no tools')
  assert.ok(JSON.parse(ask.answer).some((tool: { name: string }) => tool.name === 'crew_park'), 'crew_park is not among the tools the launcher registers')
  assert.equal(theParkMarker('builder'), 'builder.parked.json', 'the marker is named something other than the member')
})
