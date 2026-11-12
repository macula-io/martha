// `martha wake <member>`: a member that is not running is started from its newest handover (martha#255 part 2).
//
// A wake is the owner's act, and it refuses before it starts anything: a name the crew does not have, a park it cannot
// read, a handover it cannot read, and a member that never handed over each stop it with a line the owner reads. Only
// once all four are answered is the member started, and only once it is started is its park cleared — so a member that
// failed to start is still parked, and the owner can try again.
//
// The handover is written here by the host's own write (../write_my_handover) and stamped into the crew's own stamp
// store (../crew_files_directory), so what the wake reads is the file a launch would have left, at the path the host
// chose, with the stamp the host wrote.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'

import { CLAUDE_CODE_SESSION_EVENTS, startSession } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { crewFilesDirectory, handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import {
  mayParkOrUnparkAnother,
  parkAMember,
  parkedPlace,
  theParkMarker,
  theParkOf,
  type TheDeclaration,
} from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { theHandoverFile, writeMyHandover } from '../write_my_handover/write_my_handover.ts'
import { theResumePrompt, wakeAMember, type TheStart, type TheWakeAsking } from './wake_a_member.ts'

const home = mkdtempSync(join(tmpdir(), 'martha-wake-'))
after(() => removeTheTree(home))


const AT = new Date('2026-11-12T09:00:00Z')

/** The crew of the tests: a supervisor that may move another's park, and the builder it parks and wakes. */
const THE_CREW: TheDeclaration = {
  members: [
    { name: 'supervisor', role: 'supervisor' },
    { name: 'builder', role: 'builder' },
  ],
  mode: { may: { resume_parked_work: ['supervisor'] } },
}

/**
 * A crew's host over this disk, in a crew directory of its own so no test reads a handover or a park another wrote:
 * the contract's test host's stores, and the stamps the host keeps handover times in.
 */
let crewsSoFar = 0
const aWakeHost = () => {
  crewsSoFar += 1
  const itsOwn = join(home, 'state', 'crews', `a-key-${crewsSoFar}`)
  return { stores: hostForTests({ crew: crewFilesDirectory(itsOwn) }).host.stores, stamps: handoverStampsIn(itsOwn) }
}

/** A start that records what it was asked, and says what the test told it to. */
function aStartSaying(started: boolean, refusal?: string) {
  const asked: TheWakeAsking[] = []
  const start: TheStart = async (asking) => {
    asked.push(asking)
    return started ? { started: true } : { started: false, refusal: refusal ?? 'the host would not start it' }
  }
  return { start, asked }
}

/** A member that has handed over, through the host's own write and stamp; answers the file it was written to. */
function handedOver(host: ReturnType<typeof aWakeHost>, member = 'builder', content = 'What stands: the package, its branch, its tip.') {
  const session = startSession({ read: () => undefined, write: () => {} }, CLAUDE_CODE_SESSION_EVENTS, { event: 'startup', session_id: 'a-session' })
  const written = writeMyHandover(host, { member, content, at: AT, stamps: host.stamps, session })
  assert.equal(written, 'CREW-HANDOVER-WRITTEN', `the host did not write the handover the test needed: ${written}`)
  return theHandoverFile(member, AT)
}

/** Parks `member`, through the same slice a launch parks with. */
function parked(host: ReturnType<typeof aWakeHost>, member = 'builder') {
  const said = parkAMember(host, {
    actor: 'supervisor',
    member,
    reason: 'the supervisor is picking this up tomorrow',
    at: AT,
    declaration: THE_CREW,
  })
  assert.ok(!('refusal' in said), `the test could not park ${member}: ${'refusal' in said ? said.refusal : ''}`)
}

test('#255 part 2: a parked member with a handover is started on it, and its park is cleared', async () => {
  const host = aWakeHost()
  const handoverFile = handedOver(host)
  parked(host)
  const { start, asked } = aStartSaying(true)

  const woken = await wakeAMember(host, { member: 'builder', declaration: THE_CREW, at: AT }, start)

  assert.ok(!('refusal' in woken), `the wake refused a member that had handed over: ${'refusal' in woken ? woken.refusal : ''}`)
  assert.equal(asked.length, 1, 'the wake started the member a number of times other than once')
  assert.equal(asked[0]?.member, 'builder')
  assert.ok(asked[0]?.prompt.includes(handoverFile), 'the prompt the member was started with does not name its handover')
  const place = parkedPlace(host)
  assert.ok(!('refusal' in place), 'the host refused the park place')
  const park = theParkOf(place, 'builder')
  assert.equal(park.kind, 'not_parked', 'a woken member is still parked')
  assert.equal(park.kind === 'not_parked' ? park.last_marker?.reason : '', 'woken from its handover by the owner', 'the marker does not say the member was woken')
})

test('#255 part 2: the prompt names the handover\'s file and does not carry its text', () => {
  const text = 'What stands: the package, its branch, its tip.'
  const prompt = theResumePrompt({ file: '/somewhere/HANDOVER_2026-11-12_builder.md', content: text }, 'builder')
  assert.match(prompt, /\/somewhere\/HANDOVER_2026-11-12_builder\.md/, 'the prompt does not name the handover file')
  assert.ok(!prompt.includes(text), 'the prompt carries the handover\'s text, which would be a second handover nothing stamped')
})

test('#255 part 2: a member that never handed over is refused by name, and nothing is started', async () => {
  const host = aWakeHost()
  const { start, asked } = aStartSaying(true)
  const woken = await wakeAMember(host, { member: 'builder', declaration: THE_CREW, at: AT }, start)
  assert.ok('refusal' in woken, 'a member that never handed over was woken')
  assert.match(woken.refusal, /builder/, 'the refusal does not name the member')
  assert.match(woken.refusal, /handed nothing over/, 'the refusal does not say what was missing')
  assert.equal(asked.length, 0, 'the wake asked for a start it had already refused')
})

test('#255 part 2: a name the crew does not have is refused with the crew\'s names, before anything else', async () => {
  const host = aWakeHost()
  const { start, asked } = aStartSaying(true)
  const woken = await wakeAMember(host, { member: 'nobody', declaration: THE_CREW, at: AT }, start)
  assert.ok('refusal' in woken, 'a name the crew does not have was woken')
  assert.match(woken.refusal, /supervisor, builder/, 'the refusal does not name the crew\'s members')
  assert.equal(asked.length, 0, 'the wake asked for a start of a name it had already refused')
})

test('#255 part 2: a park the store will not answer for refuses the wake instead of reading as not parked', async () => {
  const host = aWakeHost()
  handedOver(host)
  const place = parkedPlace(host)
  assert.ok(!('refusal' in place), 'the host refused the park place')
  assert.equal(place.keep(theParkMarker('builder'), 'not a marker at all\n'), undefined, 'the store refused the file the test needed it to keep')
  const { start, asked } = aStartSaying(true)

  const woken = await wakeAMember(host, { member: 'builder', declaration: THE_CREW, at: AT }, start)

  assert.ok('refusal' in woken, 'a park the store would not answer for was read as a member nobody parked')
  assert.match(woken.refusal, /builder\.parked\.json/, 'the refusal does not name the marker it could not read')
  assert.equal(asked.length, 0, 'the wake started a member whose park it had just admitted it could not read')
})

test('#255 part 2: a start that refuses leaves the park as it was, so the owner can try again', async () => {
  const host = aWakeHost()
  handedOver(host)
  parked(host)
  const { start } = aStartSaying(false, 'the checkout needs approving')

  const woken = await wakeAMember(host, { member: 'builder', declaration: THE_CREW, at: AT }, start)

  assert.ok('refusal' in woken, 'a start the host refused was reported as a wake')
  assert.match(woken.refusal, /approving/, 'the refusal the start gave was not the one the owner reads')
  const place = parkedPlace(host)
  assert.ok(!('refusal' in place), 'the host refused the park place')
  assert.equal(theParkOf(place, 'builder').kind, 'parked', 'a member that failed to start was unparked anyway')
})

test('#255 part 2: the grant that moves another member\'s park is the table\'s, and the wake asks it of nobody', () => {
  assert.equal(mayParkOrUnparkAnother(THE_CREW, 'builder'), false, 'a member with no grant was allowed to move another member\'s park')
  assert.equal(mayParkOrUnparkAnother(THE_CREW, 'supervisor'), true, 'a member whose role is granted the act may not move another\'s park')
})
