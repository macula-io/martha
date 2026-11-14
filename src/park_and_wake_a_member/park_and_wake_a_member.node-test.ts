// Parking and waking, as martha#255 states them: part 1's marker, and part 2's three answers and its unpark.
//
// The park is a marker that outlives the session, and who may park another member is answered from the declaration the
// launcher started its member from rather than from who_may_act (r=3). Waking reads the newest handover by the time the
// host stamped it, never by the file's own name.
//
// Part 2 gives both reads a caller, so neither may answer `undefined` for two different facts: the store says nothing
// is there, or the store will not say what is. A park is never deleted — the store keeps whole files and replaces
// them — so an unpark is the same marker with `parked: false`, carrying who unparked it, why and when.
//
// Both are driven through the contract's test host, over the crew store the host really composes on a disk
// (../crew_files_directory), so the marker read back is the file a launch would have left.

import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CLAUDE_CODE_SESSION_EVENTS, stampHandover, startSession } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { crewFilesDirectory } from '../crew_files_directory/crew_files_directory.ts'
import { OWNER } from '../declare_crew/declare_crew.ts'
import type { HandoverStamp, HandoverStampStore } from '../host_contract/host_contract.ts'
import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { handoversPlace, theHandoverFile, writeMyHandover } from '../write_my_handover/write_my_handover.ts'
import {
  isAStorm,
  mayParkOrUnparkAnother,
  parkAMember,
  parkedPlace,
  theNewestHandover,
  theParkMarker,
  STORM_WINDOW_MS,
  theParkOf,
  unparkAMember,
  type TheDeclaration,
} from './park_and_wake_a_member.ts'

/** A home of the tests: the crew's own directory, as the launcher resolves one, under the state root. */
const home = mkdtempSync(join(tmpdir(), 'martha-park-'))
after(() => removeTheTree(home))
const crew = join(home, 'state', 'crews', 'a-key')

const AT = new Date('2026-11-11T15:00:00Z')
const LATER = new Date('2026-11-12T09:00:00Z')

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
  mode: { may: { resume_parked_work: [OWNER] } },
}

const parkingOf = (declaration: TheDeclaration, actor: string, member = 'builder', at = AT) => ({
  actor,
  member,
  reason: 'the supervisor is picking this up tomorrow',
  at,
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
  assert.deepEqual(theParkOf(theParkedPlace(host), 'reviewer'), { kind: 'not_parked', last_marker: null }, 'a refused park left a marker behind')
})

test('#255: a member whose role is granted the act parks another member', () => {
  const host = aHost()
  const said = parkAMember(host.host, parkingOf(aTeamGranting(['supervisor']), 'supervisor'))
  assert.ok(!('refusal' in said), 'a member whose role is granted the act was refused')
  assert.deepEqual(theParkOf(theParkedPlace(host), 'builder'), {
    kind: 'parked',
    marker: { parked: true, reason: 'the supervisor is picking this up tomorrow', since: AT.toISOString() },
  })
})

test('#255: a member parks itself whatever its role', () => {
  const host = aHost()
  const said = parkAMember(host.host, parkingOf(aTeamGranting(['supervisor']), 'builder', 'reviewer'))
  assert.ok('refusal' in said, 'the case did not start from a member that may not park another')
  const itself = parkAMember(host.host, parkingOf(aTeamGranting(['supervisor']), 'builder', 'builder'))
  assert.ok(!('refusal' in itself), 'a member was refused the park of itself, which the declaration has nothing to say about')
})

// The owner is a seat like any other in the table: the grant is asked of the owner too, so a crew that does not grant
// the act to it has an owner that parks nobody. The rule is the OWNER arm of the r=3 design; this case holds it.
test('#255: an owner the table does not grant the act parks nobody', () => {
  const host = aHost()
  const ownerHasNoGrant = aTeamGranting(['supervisor'])
  assert.equal(
    mayParkOrUnparkAnother(ownerHasNoGrant, OWNER),
    false,
    'the owner was allowed to park another member by being the owner, which the declaration does not say',
  )
  const said = parkAMember(host.host, parkingOf(ownerHasNoGrant, OWNER, 'reviewer'))
  assert.ok('refusal' in said, 'the owner parked another member with no grant in the table')
  assert.match(said.refusal, /resume_parked_work/, 'the refusal does not name the act that would have allowed it')
  assert.deepEqual(theParkOf(theParkedPlace(host), 'reviewer'), { kind: 'not_parked', last_marker: null }, 'a refused park by the owner left a marker behind')
})

test('#255: a solo crew parks its member, because the owner is granted the act and has no node id to be checked against', () => {
  const host = aHost()
  assert.equal(mayParkOrUnparkAnother(aSoloCrew, OWNER), true, 'a solo crew cannot park at all: its owner is granted the act and nothing else is')
  assert.equal(mayParkOrUnparkAnother(aSoloCrew, 'builder'), false, 'a solo crew\'s member parked by its role, which is not granted the act')
  const said = parkAMember(host.host, parkingOf(aSoloCrew, OWNER))
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
  assert.equal(newest.kind, 'a_handover', 'a builder with two stamped handovers was offered none')
  assert.equal(newest.kind === 'a_handover' ? newest.handover.file : '', earlier, 'the wake took the file whose name sorts last rather than the one the host stamped last')
  assert.equal(newest.kind === 'a_handover' ? newest.handover.content : '', 'the earlier day, stamped last')
})

test('#255: a handover with no stamp is nobody\'s handover, so a wake is not offered it', () => {
  const host = aHost()
  const stamps = stampStore()
  const place = handoversPlace(host.host)
  assert.ok(!('refusal' in place), 'the host refused the handovers place')
  assert.deepEqual(
    theNewestHandover(place, stamps, 'nobody-has-handed-over'),
    { kind: 'no_handover' },
    'a handover no host stamped was offered to a wake',
  )
})

// Every member's handovers share one place, so the stamp's own member is what tells them apart: a wake of one member
// must never resume a colleague's newer file (martha#255 r=2).
test('#255: a wake is offered its own member\'s newest handover, never a colleague\'s newer one', () => {
  const host = aHost()
  const stamps = stampStore()
  const store = { read: () => undefined, write: () => {} }
  const session = startSession(store, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-session' })
  const place = handoversPlace(host.host)
  assert.ok(!('refusal' in place), 'the host refused the handovers place')
  const buildersDay = new Date('2026-11-09T09:00:00Z')
  const aColleaguesDay = new Date('2026-11-11T09:00:00Z')
  writeMyHandover(host.host, { member: 'builder', content: 'the builder\'s own', at: buildersDay, stamps, session })
  writeMyHandover(host.host, { member: 'reviewer', content: 'a colleague\'s, stamped later', at: aColleaguesDay, stamps, session })

  const newest = theNewestHandover(place, stamps, 'builder')
  assert.equal(newest.kind === 'a_handover' ? newest.handover.content : newest.kind, 'the builder\'s own', 'a wake of the builder was offered a colleague\'s newer handover, because the stamps were not asked whose they are')
  assert.equal(newest.kind === 'a_handover' ? newest.handover.file : '', join(place.path, theHandoverFile('builder', buildersDay)), 'the wake was offered a file the builder never wrote')
})

// Part 2's decision 1: a file the store will not vouch for is not "no park" and not "no handover" — it is a question
// the store would not answer, and the caller says so aloud instead of carrying on as if nobody were parked.
test('#255: a marker the store will not vouch for is a question the store would not answer, not "not parked"', () => {
  const place = theParkedPlace(aHost())
  assert.equal(place.keep(theParkMarker('builder'), '{"parked":true,"reason":"a reason","since":"2026-11-11T15:00:00.000Z"}\n'), undefined, 'the store refused the marker the test needed it to keep')
  const marker = join(place.path, theParkMarker('builder'))
  // Readable by others: the store refuses it, so the park is one the store will not answer for.
  chmodSync(marker, 0o644)
  const park = theParkOf(place, 'builder')
  assert.equal(park.kind, 'unreadable', 'a marker the store refuses was read as a member nobody parked')
  assert.match(park.kind === 'unreadable' ? park.refusal : '', /builder\.parked\.json/, 'the refusal does not name the marker it could not read')
  chmodSync(marker, 0o600)
})

// A stamp the store refuses is the same question as a place it cannot list: the store will not say when that handover
// was written, so it cannot say which is newest. Skipping it would silently land the wake on an older handover, or on
// none (martha#255 part 2 r=1 R2).
test('#255 part 2: a stamp the store refuses is a question it would not answer, never a handover it skips', () => {
  const host = aHost()
  const place = handoversPlace(host.host)
  assert.ok(!('refusal' in place), 'the host refused the handovers place')
  const name = theHandoverFile('builder', AT)
  assert.equal(place.keep(name, 'What stands: the package, its branch, its tip.'), undefined, 'the store refused the handover the test needed it to keep')
  const unanswerable: HandoverStampStore = {
    read: (file) => (file.endsWith(name) ? { refusal: `${file} has a stamp that will not be read, so Martha cannot say when it was written.` } : undefined),
    write: () => undefined,
  }

  const newest = theNewestHandover(place, unanswerable, 'builder')

  assert.equal(newest.kind, 'unreadable', 'a stamp the store refused was skipped, and the handover read as one nobody has')
  assert.match(newest.kind === 'unreadable' ? newest.refusal : '', /cannot say when it was written/, 'the refusal is not the store\'s own reason')
})

test('#255: a handovers place that cannot be listed is a question the store would not answer, not "no handover"', () => {
  const host = aHost()
  const place = handoversPlace(host.host)
  assert.ok(!('refusal' in place), 'the host refused the handovers place')
  removeTheTree(place.path)
  const newest = theNewestHandover(place, stampStore(), 'builder')
  assert.equal(newest.kind, 'unreadable', 'a place the store cannot list was read as a member that never handed over')
  assert.match(newest.kind === 'unreadable' ? newest.refusal : '', /handovers/, 'the refusal does not name the place it could not list')
})

// A file of valid JSON that is not a marker is one of the ways a marker cannot be read (martha#255 r=2). It is never a
// park, and it is never "not parked" either: nobody can say.
test('#255: a file that does not hold a marker is never read as a park, whatever JSON it holds', () => {
  const place = theParkedPlace(aHost())
  const notMarkers = [
    'not json at all\n',
    '{"why":"a reason nobody named"}\n',
    '{"reason":"a reason, and no since"}\n',
    '{"since":"2026-11-11T15:00:00.000Z"}\n',
    '{"parked":"yes","reason":"a reason","since":"2026-11-11T15:00:00.000Z"}\n',
    'null\n',
    '"a member\'s name, not a marker"\n',
    '[]\n',
  ]
  for (const text of notMarkers) {
    assert.equal(place.keep(theParkMarker('builder'), text), undefined, `the store refused a file the test needed it to keep: ${text.trim()}`)
    const park = theParkOf(place, 'builder')
    assert.equal(park.kind, 'unreadable', `${text.trim()} was read as a park, so a member nobody parked would wake parked`)
  }
})

// Part 2's decision 2: the store keeps whole files and replaces them, and it has no remove. So an unpark is a marker
// that says so, and the record of who unparked the member and why is kept rather than deleted.
test('#255: an unpark is written beside the park, and the member is not parked any more', () => {
  const host = aHost()
  const declared = aTeamGranting(['supervisor'])
  assert.ok(!('refusal' in parkAMember(host.host, parkingOf(declared, 'supervisor'))), 'the test could not park the member it means to unpark')
  const said = unparkAMember(host.host, parkingOf(declared, 'supervisor', 'builder', LATER))
  assert.ok(!('refusal' in said), 'the supervisor could not unpark the member it may park')
  assert.deepEqual(theParkOf(theParkedPlace(host), 'builder'), {
    kind: 'not_parked',
    last_marker: { parked: false, reason: 'the supervisor is picking this up tomorrow', since: LATER.toISOString() },
  })
})

test('#255: a member whose role is not granted the act unparks nobody, and a member unparks itself whatever its role', () => {
  const host = aHost()
  const declared = aTeamGranting(['supervisor'])
  assert.ok(!('refusal' in parkAMember(host.host, parkingOf(declared, 'supervisor', 'reviewer'))), 'the test could not park the member it means to unpark')
  const said = unparkAMember(host.host, parkingOf(declared, 'builder', 'reviewer', LATER))
  assert.ok('refusal' in said, 'a member with no grant unparked another member')
  assert.match(said.refusal, /resume_parked_work/, 'the refusal does not name the act that would have allowed it')
  assert.equal(theParkOf(theParkedPlace(host), 'reviewer').kind, 'parked', 'a refused unpark unparked the member anyway')
  const itself = unparkAMember(host.host, parkingOf(declared, 'reviewer', 'reviewer', LATER))
  assert.ok(!('refusal' in itself), 'a member was refused the unpark of itself, which the declaration has nothing to say about')
})

test('#255: two refreshes inside the window are a storm, and one outside it is not', () => {
  const now = 10 * STORM_WINDOW_MS
  assert.equal(isAStorm([now - STORM_WINDOW_MS / 2], now), true)
  assert.equal(isAStorm([now - STORM_WINDOW_MS - 1], now), false)
  assert.equal(isAStorm([], now), false)
})
