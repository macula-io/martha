// Parking and waking, as martha#255 part 1 states them.
//
// The park is a marker that outlives the session, and who may park another member is answered from the declaration the
// launcher started its member from rather than from who_may_act (r=3). Waking reads the newest handover by the time the
// host stamped it, never by the file's own name.
//
// Both are driven through the contract's test host, over the crew store the host really composes on a disk
// (../crew_files_directory), so the marker read back is the file a launch would have left.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import {
  CLAUDE_CODE_SESSION_EVENTS,
  stampHandover,
  startSession,
  type HandoverStamp,
  type HandoverStampStore,
} from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { handoversPlace, theHandoverFile, writeMyHandover } from '../write_my_handover/write_my_handover.ts'
import {
  mayParkAnother,
  parkAMember,
  parkedPlace,
  theNewestHandover,
  theParkOf,
  type TheDeclaration,
} from './park_and_wake_a_member.ts'

/** A home of the tests: the crew's own directory, as the launcher resolves one, under the state root. */
const home = mkdtempSync(join(tmpdir(), 'martha-park-'))
after(() => rmSync(home, { recursive: true, force: true }))
const crew = join(home, 'state', 'crews', 'a-key')

const AT = new Date('2026-11-11T15:00:00Z')

/** The contract's test host, over the crew's own store on this disk. */
const aHost = (): HostForTests => hostForTests({ crew: crewFilesDirectory(crew) })

const stampStore = (): HandoverStampStore & { readonly all: Map<string, HandoverStamp> } => {
  const all = new Map<string, HandoverStamp>()
  return { all, read: (file) => all.get(file), write: (file, stamp) => void all.set(file, stamp) }
}

/** A crew whose table grants the act to the roles named. */
const aTeamGranting = (granted: readonly string[]): TheDeclaration => ({
  members: [
    { name: 'supervisor', role: 'supervisor' },
    { name: 'builder', role: 'builder' },
  ],
  mode: { may: { resume_parked_work: granted } },
})

/** A solo crew: no roles but its member's, and the act granted to the owner alone. */
const aSoloCrew: TheDeclaration = {
  members: [{ name: 'builder', role: 'builder' }],
  mode: { may: { resume_parked_work: ['owner'] } },
}

const parkingOf = (declaration: TheDeclaration, actor: string, member = 'builder') => ({
  actor,
  member,
  reason: 'the supervisor is picking this up tomorrow',
  at: AT,
  declaration,
})

/** The place a crew's park markers live, once the host's store has made it. */
function theParkedPlace(host: HostForTests) {
  const place = parkedPlace(host.host)
  assert.ok(!('refusal' in place), 'the host refused the park place')
  return place
}

test('#255: a member whose role is not granted the act parks nobody, and is told which act it would need', () => {
  const host = aHost()
  const said = parkAMember(host.host, parkingOf(aTeamGranting(['supervisor']), 'builder', 'reviewer'))
  assert.ok('refusal' in said, 'a member with no grant parked another member')
  assert.match(said.refusal, /resume_parked_work/, 'the refusal does not name the act that would have allowed it')
  assert.equal(theParkOf(theParkedPlace(host), 'reviewer'), undefined, 'a refused park left a marker behind')
})

test('#255: a member whose role is granted the act parks another member', () => {
  const host = aHost()
  const said = parkAMember(host.host, parkingOf(aTeamGranting(['supervisor']), 'supervisor'))
  assert.ok(!('refusal' in said), 'a member whose role is granted the act was refused')
  assert.deepEqual(theParkOf(theParkedPlace(host), 'builder'), { reason: 'the supervisor is picking this up tomorrow', since: AT.toISOString() })
})

test('#255: a member parks itself whatever its role', () => {
  const host = aHost()
  const said = parkAMember(host.host, parkingOf(aTeamGranting(['supervisor']), 'builder', 'reviewer'))
  assert.ok('refusal' in said, 'the case did not start from a member that may not park another')
  const itself = parkAMember(host.host, parkingOf(aTeamGranting(['supervisor']), 'builder', 'builder'))
  assert.ok(!('refusal' in itself), 'a member was refused the park of itself, which the declaration has nothing to say about')
})

test('#255: a solo crew parks its member, because the owner is granted the act and has no node id to be checked against', () => {
  const host = aHost()
  assert.equal(mayParkAnother(aSoloCrew, 'owner'), true, 'a solo crew cannot park at all: its owner is granted the act and nothing else is')
  assert.equal(mayParkAnother(aSoloCrew, 'builder'), false, 'a solo crew\'s member parked by its role, which is not granted the act')
  const said = parkAMember(host.host, parkingOf(aSoloCrew, 'owner'))
  assert.ok(!('refusal' in said), 'the owner of a solo crew was refused the park of its only member')
})

test('#255: waking takes the newest handover by the time the host stamped it, not by the file\'s own name', () => {
  const host = aHost()
  const stamps = stampStore()
  const store = { read: () => undefined, write: () => {} }
  const session = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-session' })
  const place = handoversPlace(host.host)
  assert.ok(!('refusal' in place), 'the host refused the handovers place')
  writeMyHandover(host.host, { member: 'builder', content: 'the later day, stamped first', at: new Date('2026-11-11T09:00:00Z'), stamps, session })
  writeMyHandover(host.host, { member: 'builder', content: 'the earlier day, stamped last', at: new Date('2026-11-09T09:00:00Z'), stamps, session })
  // The earlier day's file is stamped again, later than the other: the name says 11-09 and the host says it is newest.
  const earlier = join(place.path, theHandoverFile('builder', new Date('2026-11-09T09:00:00Z')))
  stampHandover(stamps, { member: 'builder', session }, { file: earlier, content: 'the earlier day, stamped last' }, () => Date.parse('2026-11-11T23:00:00Z'))

  const newest = theNewestHandover(place, stamps, 'builder')
  assert.equal(newest?.file, earlier, 'the wake took the file whose name sorts last rather than the one the host stamped last')
  assert.equal(newest?.content, 'the earlier day, stamped last')
})

test('#255: a handover with no stamp is nobody\'s handover, so a wake is not offered it', () => {
  const host = aHost()
  const stamps = stampStore()
  const place = handoversPlace(host.host)
  assert.ok(!('refusal' in place), 'the host refused the handovers place')
  assert.equal(theNewestHandover(place, stamps, 'nobody-has-handed-over'), undefined, 'a handover no host stamped was offered to a wake')
})
