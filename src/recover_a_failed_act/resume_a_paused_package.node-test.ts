import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { RESUME_EVENT, keepTheMilestone } from '../keep_the_ledger/keep_the_ledger.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { PACKAGE_RESUMED, readLedger, thePauseOn, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { theNudgeLine, theNudgesGoTo } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { PackagePaused, RecoveryDecided, sendAnActAndRecover, type AnInspection } from './recover_a_failed_act.ts'
import { thePausedNudges } from './resume_a_paused_package.ts'

// Synthetic names, never a real one: this repository is public.
const work = { package: 'synthetic-owner/repo#7', member: 'member-one' }
const elsewhere = { package: 'synthetic-owner/repo#8', member: 'member-one' }
const push = { kind: 'push', what: 'origin member-one/7-the-branch' } as const
const tag = { kind: 'tag', what: 'v1.2.3' } as const

/** A crew whose table grants assign_work to the supervisor role alone: the one the nudges go to. */
const RECEIVER = 'Supervisor'
const crew = {
  owner: 'the-owner',
  members: [
    { name: RECEIVER, role: SUPERVISOR },
    { name: 'member-one', role: 'builder' },
  ],
  mode: { may: { assign_work: [SUPERVISOR] } },
}
const mayResume = async (): Promise<readonly string[]> => theNudgesGoTo(crew)

const nowhere = async (): Promise<AnInspection> => ({ state: 'it_did_not_happen', read: 'origin', found: 'nothing there' })

/** A failure kept as it was thrown: what a caller would have caught. */
const caught = async (sending: () => Promise<string>): Promise<unknown> => {
  try {
    await sending()
  } catch (failure) {
    return failure
  }
  return assert.fail('the send was expected to fail')
}

/** A package paused by a failure nothing can name: the send throws something with no code, name or message. */
async function aPausedPackage(host: LedgerHost): Promise<void> {
  const failure = await caught(() =>
    sendAnActAndRecover(host, { ...work, act: push }, async () => {
      throw {}
    }, nowhere),
  )
  assert.ok(failure instanceof RecoveryDecided && failure.decision === 'paused', 'the package was expected to pause')
}

test('a paused package refuses its next act before anything is announced, whatever the act', async () => {
  const { host } = hostForTests()
  await aPausedPackage(host)
  const before = (await readLedger(host, work.package)).length
  let sends = 0
  const failure = await caught(() =>
    sendAnActAndRecover(host, { ...work, act: tag }, async () => {
      sends += 1
      return 'tagged'
    }, nowhere),
  )
  assert.ok(failure instanceof PackagePaused, `a paused package refuses the act: ${String(failure)}`)
  assert.equal(sends, 0, 'the act did not run')
  assert.equal((await readLedger(host, work.package)).length, before, 'nothing was announced')
  assert.match(failure.told, /synthetic-owner\/repo#7: the tag \(v1\.2\.3\) was not sent, because the package is paused since the push/)
  assert.match(failure.told, /log_a_milestone, event resume/)
})

test('a pause holds its own package and no other', async () => {
  const { host } = hostForTests()
  await aPausedPackage(host)
  assert.equal(await sendAnActAndRecover(host, { ...elsewhere, act: tag }, async () => 'tagged', nowhere), 'tagged')
})

test("a member's own resume is refused and writes nothing; the Supervisor's resume writes package_resumed and lifts the hold", async () => {
  const { host } = hostForTests()
  await aPausedPackage(host)
  const before = (await readLedger(host, work.package)).length

  const own = await keepTheMilestone(host, { ...work, event: RESUME_EVENT, note: 'the branch is gone, I checked' }, mayResume)
  assert.match(own.told, /^Not recorded: member-one may not resume a paused package; only Supervisor/)
  assert.equal((await readLedger(host, work.package)).length, before, "the member's resume wrote nothing")
  assert.notEqual(thePauseOn(await readLedger(host, work.package)), undefined, 'the package is still paused')

  const resumed = await keepTheMilestone(host, { package: work.package, member: RECEIVER, event: RESUME_EVENT, note: 'origin read: the branch is still there' }, mayResume)
  assert.match(resumed.told, /^Kept: synthetic-owner\/repo#7 is resumed/)
  const rows = await readLedger(host, work.package)
  assert.equal(rows.at(-1)?.kind, PACKAGE_RESUMED)
  assert.equal(rows.at(-1)?.member, RECEIVER, 'the resume is written as the member who asked')
  assert.equal(thePauseOn(rows), undefined)
  assert.equal(await sendAnActAndRecover(host, { ...work, act: tag }, async () => 'tagged', nowhere), 'tagged')
})

test('a caller that names nobody who may resume lets nobody, and a package that is not paused is not resumed', async () => {
  const { host } = hostForTests()
  await aPausedPackage(host)
  const told = await keepTheMilestone(host, { package: work.package, member: RECEIVER, event: RESUME_EVENT, note: 'resume it' })
  assert.match(told.told, /^Not recorded: Supervisor may not resume a paused package; only nobody/)
  const unpaused = await keepTheMilestone(host, { package: elsewhere.package, member: RECEIVER, event: RESUME_EVENT, note: 'resume it' }, mayResume)
  assert.equal(unpaused.told, 'Not recorded: synthetic-owner/repo#8 is not paused.')
  assert.equal((await readLedger(host, elsewhere.package)).length, 0)
})

test('a resume does not give the package its attempt back: the same act failing again pauses it again', async () => {
  const { host, refuseNextAppend } = hostForTests()
  // The one attempt is spent: the first row is refused, so the act is retried, and the retry fails and pauses.
  refuseNextAppend('disk full on the first')
  let sends = 0
  const failing = async (): Promise<string> => {
    sends += 1
    throw new Error('rejected: non-fast-forward')
  }
  const first = await caught(() => sendAnActAndRecover(host, { ...work, act: push }, failing, nowhere))
  assert.ok(first instanceof RecoveryDecided && first.decision === 'paused')
  assert.equal(sends, 1, 'the retry is the one send that ran')
  await keepTheMilestone(host, { package: work.package, member: RECEIVER, event: RESUME_EVENT, note: 'try it once more' }, mayResume)
  // After the resume the act is refused its row again, which on an unspent attempt would buy a retry: here it pauses.
  refuseNextAppend('disk full again')
  const again = await caught(() => sendAnActAndRecover(host, { ...work, act: push }, failing, nowhere))
  assert.ok(again instanceof RecoveryDecided)
  assert.equal(again.decision, 'paused')
  assert.match(again.told, /already spent the one attempt a package is given/)
  assert.equal(sends, 1, 'nothing ran after the resume')
})

test('a paused package reaches the Supervisor as a `paused` nudge, until it is resumed', async () => {
  const { host } = hostForTests()
  await aPausedPackage(host)
  const nudges = await thePausedNudges(host, [work.package, elsewhere.package, '', 'not a package'])
  assert.equal(nudges.length, 1)
  const [nudge] = nudges
  assert.ok(nudge !== undefined)
  assert.deepEqual({ kind: nudge.kind, member: nudge.member, package: nudge.package }, { kind: 'paused', member: 'member-one', package: work.package })
  assert.match(theNudgeLine(nudge, crew) ?? '', /^- paused: member-one on synthetic-owner\/repo#7, since \d\d:\d\d UTC$/)
  await keepTheMilestone(host, { package: work.package, member: RECEIVER, event: RESUME_EVENT, note: 'read and settled' }, mayResume)
  assert.deepEqual(await thePausedNudges(host, [work.package]), [])
})

// A pause the store would not keep holds nothing and nudges nobody, so the member is never told it does (martha#512 r=2).

/** A look that arms the store to refuse the next row, the recovery's own decision, and then answers what it found. */
const aLookThatRefusesTheDecision = (refuseNextAppend: (reason: string) => void, found: AnInspection) => async (): Promise<AnInspection> => {
  refuseNextAppend('the disk is full')
  return found
}

test('a pause whose row the store refused tells the member nothing holds the package, and the next act runs', async () => {
  const { host, refuseNextAppend } = hostForTests()
  const cannotTell: AnInspection = { state: 'cannot_tell', read: 'origin', found: 'no answer' }
  const failure = await caught(() =>
    sendAnActAndRecover(host, { ...work, act: push }, async () => {
      throw {}
    }, aLookThatRefusesTheDecision(refuseNextAppend, cannotTell)),
  )
  assert.ok(failure instanceof RecoveryDecided && failure.decision === 'paused', `the package was expected to stop: ${String(failure)}`)
  assert.match(failure.told, /The decision was not recorded \(the store refused the row: the disk is full\)/)
  assert.match(failure.told, /The pause could not be recorded, so nothing holds the package and the Supervisor is not nudged: do not go on with this package, and tell the Supervisor yourself\.$/)
  assert.doesNotMatch(failure.told, /The package is paused/)
  assert.equal(thePauseOn(await readLedger(host, work.package)), undefined)
  assert.deepEqual(await thePausedNudges(host, [work.package]), [])
  assert.equal(await sendAnActAndRecover(host, { ...work, act: tag }, async () => 'tagged', nowhere), 'tagged', 'nothing holds the package')
})

test('a retry whose row the store refused stops the package without claiming a hold, and the next act runs', async () => {
  const { host, refuseNextAppend } = hostForTests()
  let sends = 0
  // The act's own row is refused, so nothing was sent and a retry is decided; then the store refuses that decision too.
  refuseNextAppend('disk full on the act')
  const failure = await caught(() =>
    sendAnActAndRecover(host, { ...work, act: push }, async () => {
      sends += 1
      throw new Error('rejected: non-fast-forward')
    }, aLookThatRefusesTheDecision(refuseNextAppend, { state: 'it_did_not_happen', read: 'origin', found: 'nothing there' })),
  )
  assert.ok(failure instanceof RecoveryDecided && failure.decision === 'paused', `the package was expected to stop: ${String(failure)}`)
  assert.equal(sends, 0, 'neither the act nor its retry was sent')
  assert.match(failure.told, /the decision could not be kept on the package, so sending the act again would spend an attempt/, 'the stop path was the one taken')
  assert.match(failure.told, /The decision was not recorded \(the store refused the row: the disk is full\)/)
  assert.match(failure.told, /The pause could not be recorded, so nothing holds the package and the Supervisor is not nudged/)
  assert.doesNotMatch(failure.told, /The package is paused/)
  assert.equal(thePauseOn(await readLedger(host, work.package)), undefined)
  assert.equal(await sendAnActAndRecover(host, { ...work, act: tag }, async () => 'tagged', nowhere), 'tagged', 'nothing holds the package')
})

test('who may resume is compared without regard to case (martha#512 r=2, M9)', async () => {
  const { host } = hostForTests()
  await aPausedPackage(host)
  const resumed = await keepTheMilestone(host, { package: work.package, member: RECEIVER.toUpperCase(), event: RESUME_EVENT, note: 'read and settled' }, mayResume)
  assert.match(resumed.told, /^Kept: synthetic-owner\/repo#7 is resumed/)
})
