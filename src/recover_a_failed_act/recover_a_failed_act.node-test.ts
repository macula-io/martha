import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProcessOutcome } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { actsAwaitingOutcome, isRecoveryRow, readLedger, type LedgerHost, type LedgerRow, type RecoveryRow } from '../log_ledger/log_ledger.ts'
import {
  ATTEMPTS_A_PACKAGE_IS_GIVEN,
  FAILURE_CLASSES,
  RecoveryDecided,
  aFailureNamed,
  classifyAFailure,
  decideARecovery,
  inspectTheActualState,
  sendAnActAndRecover,
  type AnInspection,
} from './recover_a_failed_act.ts'

// Synthetic names, never a real one: this repository is public.
const work = { package: 'synthetic-owner/repo#7', member: 'member-one' }
const push = { kind: 'push', what: 'origin vesta/7-the-branch' } as const
const otherPush = { kind: 'push', what: 'origin vesta/7-another-branch' } as const

const exited = (exit_code: number | null, stderr: string): ProcessOutcome => ({ exit_code, stdout: '', stderr })

/** What a look at the act's real state answers, in one call. */
const found = (state: AnInspection['state'], read: string, said: string): (() => Promise<AnInspection>) => async () => ({ state, read, found: said })

/** A failure kept as it was thrown: what a caller would have caught. */
const caught = async (sending: () => Promise<string>): Promise<unknown> => {
  try {
    await sending()
  } catch (failure) {
    return failure
  }
  return assert.fail('the send was expected to fail')
}

/** The one recovery a package's ledger holds; a test saying so fails here rather than on a missing property. */
const theRecoveryIn = (rows: readonly LedgerRow[]): RecoveryRow => rows.find(isRecoveryRow) ?? assert.fail('no recovery row was kept')

// --- the classes ---------------------------------------------------------------

test('every failure the tree can read is given one of its names, and one it cannot read is `unknown`', () => {
  assert.deepEqual(classifyAFailure({ kind: 'a_check_read', read: { kind: 'red', ended: [] } }).class, 'check_red')
  assert.deepEqual(classifyAFailure({ kind: 'a_check_read', read: { kind: 'out_of_budget', refusal: 'the crew spent it' } }).class, 'budget_exhausted')
  assert.deepEqual(classifyAFailure({ kind: 'a_check_read', read: { kind: 'over_its_reads', refusal: 'four reads spent' } }).class, 'budget_exhausted')
  assert.deepEqual(classifyAFailure({ kind: 'a_check_read', read: { kind: 'cannot_tell', refusal: 'no answer' } }).class, 'unknown')
  assert.deepEqual(classifyAFailure({ kind: 'a_command_ended', ended: exited(1, 'fatal: not a git repository') }).class, 'command_failed')
  assert.deepEqual(classifyAFailure({ kind: 'a_command_ended', ended: exited(0, '') }).class, 'unknown')
  assert.deepEqual(classifyAFailure({ kind: 'a_command_timed_out', ended: exited(null, '') }).class, 'command_timed_out')
  assert.deepEqual(classifyAFailure({ kind: 'an_error', error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }).class, 'command_timed_out')
  assert.deepEqual(classifyAFailure({ kind: 'an_error', error: Object.assign(new Error('denied'), { code: 'EACCES' }) }).class, 'permission_refused')
  assert.deepEqual(classifyAFailure({ kind: 'an_error', error: Object.assign(new Error(''), { name: 'TimeoutError' }) }).class, 'command_timed_out')
  assert.deepEqual(classifyAFailure({ kind: 'an_error', error: new Error('rejected: non-fast-forward') }).class, 'command_failed')
  assert.deepEqual(classifyAFailure({ kind: 'an_error', error: {} }).class, 'unknown')
})

test('the evidence a class carries names what it was read from, so a budget names which one ran out', () => {
  const github = classifyAFailure({ kind: 'a_check_read', read: { kind: 'out_of_budget', refusal: 'the crew\'s GitHub allowance is spent' } })
  const wait = classifyAFailure({ kind: 'a_check_read', read: { kind: 'over_its_reads', refusal: 'this wait spent its four reads' } })
  assert.match(github.evidence, /GitHub allowance/)
  assert.match(wait.evidence, /four reads/)
  assert.equal(github.class, wait.class)
})

test('a failure a slice names itself is held to the list, and a name the tree has not is refused', () => {
  assert.deepEqual(aFailureNamed('merge_conflict', 'the batch head clashes on src/a.ts'), {
    class: 'merge_conflict',
    evidence: 'the batch head clashes on src/a.ts',
  })
  const unknown_name = aFailureNamed('went_wrong', 'it broke')
  assert.ok('refused' in unknown_name)
  assert.match(unknown_name.refused, /is not a failure class this tree names/)
  const no_evidence = aFailureNamed('host_died', '   ')
  assert.ok('refused' in no_evidence)
  assert.match(no_evidence.refused, /needs the evidence/)
})

test('every class the list holds can be named, so no name in it is a placeholder', () => {
  const named = FAILURE_CLASSES.map((failure_class) => aFailureNamed(failure_class, 'the evidence'))
  assert.equal(named.filter((failure) => 'refused' in failure).length, 0)
})

// --- the rule ------------------------------------------------------------------

test('an unknown failure is never retried: it pauses the package', () => {
  const decided = decideARecovery({
    failure: { class: 'unknown', evidence: 'nothing to read it by' },
    inspection: { state: 'it_did_not_happen', read: 'origin', found: 'the branch is still there' },
    attempt: 'never_sent',
    attempts_spent: 0,
  })
  assert.equal(decided.decision, 'paused')
  assert.match(decided.why, /cannot name/)
})

test('an act that had already happened is concluded from what was found, whatever was spent', () => {
  const decided = decideARecovery({
    failure: { class: 'command_timed_out', evidence: 'the deadline ended git' },
    inspection: { state: 'it_happened', read: 'origin', found: 'the branch is gone' },
    attempt: 'may_have_run',
    attempts_spent: ATTEMPTS_A_PACKAGE_IS_GIVEN,
  })
  assert.equal(decided.decision, 'concluded_from_the_inspection')
})

test('the one attempt belongs to the package: a spent one is not paid again', () => {
  const decided = decideARecovery({
    failure: { class: 'command_failed', evidence: 'exit 128' },
    inspection: { state: 'it_did_not_happen', read: 'origin', found: 'the branch is still there' },
    attempt: 'never_sent',
    attempts_spent: ATTEMPTS_A_PACKAGE_IS_GIVEN,
  })
  assert.equal(decided.decision, 'paused')
  assert.match(decided.why, /one attempt/)
})

test('an act that was sent and refused goes back to the member, not out a second time', () => {
  const decided = decideARecovery({
    failure: { class: 'command_failed', evidence: 'rejected: non-fast-forward' },
    inspection: { state: 'it_did_not_happen', read: 'origin', found: 'the branch is still there' },
    attempt: 'sent_and_failed',
    attempts_spent: 0,
  })
  assert.equal(decided.decision, 'replanned')
})

test('only an act that did not happen, with its attempt unspent, is sent once more', () => {
  const decided = decideARecovery({
    failure: { class: 'command_failed', evidence: 'its row was not kept (disk full)' },
    inspection: { state: 'it_did_not_happen', read: 'origin', found: 'the branch is still there' },
    attempt: 'never_sent',
    attempts_spent: 0,
  })
  assert.equal(decided.decision, 'retried_once')
})

// --- the send path --------------------------------------------------------------

/** The order in which a send and a look ran, so a test can say the inspection came first. */
interface TheOrder {
  readonly steps: string[]
  readonly host: LedgerHost
  readonly refuseNextAppend: (reason: string) => void
}

const aPlaceToSend = (): TheOrder => {
  const place = hostForTests()
  const steps: string[] = []
  return { steps, host: place.host, refuseNextAppend: place.refuseNextAppend }
}

test('a send whose outcome was not kept is sent once more, and only after the state was read', async () => {
  const place = aPlaceToSend()
  let sends = 0
  const result = await sendAnActAndRecover(
    place.host,
    { ...work, act: push },
    async () => {
      sends += 1
      place.steps.push(`send ${String(sends)}`)
      if (sends === 1) {
        place.refuseNextAppend('disk full after the push')
        return 'removed the branch on origin'
      }
      return 'removed the branch on origin'
    },
    async () => {
      place.steps.push('look')
      return { state: 'it_did_not_happen', read: 'origin\'s refs for the branch', found: 'the branch is still there' }
    },
  )
  assert.equal(result, 'removed the branch on origin')
  assert.deepEqual(place.steps, ['send 1', 'look', 'send 2'])
  assert.equal(sends, 2)
  assert.deepEqual(await actsAwaitingOutcome(place.host, work.package), [])
  // The attempt that was left awaiting is concluded from the inspection before the retry runs, so no row is chased.
  assert.deepEqual(
    (await readLedger(place.host, work.package)).map((row) => (row.kind === 'act_concluded' ? row.outcome.succeeded : row.kind)),
    ['act_announced', 'recovery_decided', false, 'act_announced', true],
  )
})

test('a send whose row was not kept is sent once more, and the retry is the only send that ran', async () => {
  const place = aPlaceToSend()
  place.refuseNextAppend('disk full')
  let sends = 0
  const result = await sendAnActAndRecover(
    place.host,
    { ...work, act: push },
    async () => {
      sends += 1
      place.steps.push(`send ${String(sends)}`)
      return 'removed the branch on origin'
    },
    async () => {
      place.steps.push('look')
      return { state: 'it_did_not_happen', read: 'origin\'s refs for the branch', found: 'the branch is still there' }
    },
  )
  assert.equal(result, 'removed the branch on origin')
  assert.deepEqual(place.steps, ['look', 'send 1'])
  assert.equal(sends, 1)
  assert.deepEqual(await actsAwaitingOutcome(place.host, work.package), [])
})

test('an act that was sent with no outcome kept is never sent twice: what was found is what is recorded', async () => {
  const place = aPlaceToSend()
  let sends = 0
  const result = await sendAnActAndRecover(
    place.host,
    { ...work, act: push },
    async () => {
      sends += 1
      if (sends === 1) {
        place.refuseNextAppend('disk full after the push')
        return 'removed the branch on origin'
      }
      return 'sent it again'
    },
    found('it_happened', 'origin\'s refs for the branch', 'the branch is gone from origin'),
  )
  assert.equal(result, 'the branch is gone from origin')
  assert.equal(sends, 1)
  assert.deepEqual(await actsAwaitingOutcome(place.host, work.package), [])
  const rows = await readLedger(place.host, work.package)
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['act_announced', 'recovery_decided', 'act_concluded'],
  )
  const recovery = theRecoveryIn(rows)
  assert.deepEqual(recovery, {
    kind: 'recovery_decided',
    package: work.package,
    member: work.member,
    at: 0,
    act: push,
    failure: {
      class: 'command_failed',
      evidence: 'the push at row 0 was sent, and its outcome was not kept (the store refused the row: disk full after the push)',
    },
    inspection: { read: 'origin\'s refs for the branch', found: 'the branch is gone from origin' },
    decision: 'concluded_from_the_inspection',
  })
})

test('a state that cannot be read pauses the package, and nothing is sent again', async () => {
  const place = aPlaceToSend()
  let sends = 0
  const failure = await caught(() =>
    sendAnActAndRecover(
      place.host,
      { ...work, act: push },
      async () => {
        sends += 1
        throw new Error('the remote hung up')
      },
      async () => {
        throw new Error('ls-remote could not reach origin')
      },
    ),
  )
  assert.ok(failure instanceof RecoveryDecided)
  assert.equal(failure.decision, 'paused')
  assert.equal(sends, 1)
  assert.match(failure.told, /could not be read: ls-remote could not reach origin/)
  assert.match(failure.told, /The package is paused/)
})

test('a failure with nothing to read it by pauses the package rather than retrying', async () => {
  const place = aPlaceToSend()
  let sends = 0
  const failure = await caught(() =>
    sendAnActAndRecover(
      place.host,
      { ...work, act: push },
      async () => {
        sends += 1
        throw Object.assign(new Error(''), { cause: 'unreadable' })
      },
      found('it_did_not_happen', 'origin', 'the branch is still there'),
    ),
  )
  assert.ok(failure instanceof RecoveryDecided)
  assert.equal(failure.failure.class, 'unknown')
  assert.equal(failure.decision, 'paused')
  assert.equal(sends, 1)
})

test('a second failure on the same act pauses the package, and the retry is the last send', async () => {
  const place = aPlaceToSend()
  place.refuseNextAppend('disk full on the first')
  let sends = 0
  const failure = await caught(() =>
    sendAnActAndRecover(
      place.host,
      { ...work, act: push },
      async () => {
        sends += 1
        throw new Error('rejected: non-fast-forward')
      },
      found('it_did_not_happen', 'origin', 'the branch is still there'),
    ),
  )
  assert.ok(failure instanceof RecoveryDecided)
  assert.equal(failure.decision, 'paused')
  // The first attempt never reached its send: its row was refused. So the one send that ran is the retry's, and the one
  // announcement in the ledger is the retry's too.
  assert.equal(sends, 1)
  const rows = await readLedger(place.host, work.package)
  assert.equal(rows.filter((row) => row.kind === 'act_announced').length, 1)
  assert.deepEqual(
    rows.filter((row) => row.kind === 'recovery_decided').map((row) => (row.kind === 'recovery_decided' ? row.decision : '')),
    ['retried_once', 'paused'],
  )
})

test('an attempt a predecessor spent is read from the ledger, so a successor buys no second one', async () => {
  const place = aPlaceToSend()
  place.refuseNextAppend('disk full on the first')
  const predecessor = await sendAnActAndRecover(
    place.host,
    { ...work, act: push },
    async () => 'sent it once more',
    found('it_did_not_happen', 'origin', 'the branch is still there'),
  )
  assert.equal(predecessor, 'sent it once more')
  // A successor, holding nothing of the predecessor's but the host's store.
  let sends = 0
  const failure = await caught(() =>
    sendAnActAndRecover(
      place.host,
      { ...work, act: push },
      async () => {
        sends += 1
        throw new Error('exit 128: the remote refused')
      },
      found('it_did_not_happen', 'origin', 'the branch is still there'),
    ),
  )
  assert.ok(failure instanceof RecoveryDecided)
  assert.equal(failure.decision, 'paused')
  assert.equal(sends, 1)
  assert.match(failure.told, /already spent the one attempt/)
})

test("another act's spent attempt does not count against this one", async () => {
  const place = aPlaceToSend()
  place.refuseNextAppend('disk full on the first branch')
  await sendAnActAndRecover(place.host, { ...work, act: push }, async () => 'removed the first branch', found('it_did_not_happen', 'origin', 'the branch is still there'))
  place.refuseNextAppend('disk full on the other branch')
  const result = await sendAnActAndRecover(
    place.host,
    { ...work, act: otherPush },
    async () => 'removed the other branch',
    found('it_did_not_happen', 'origin', 'the other branch is still there'),
  )
  assert.equal(result, 'removed the other branch')
})

test('an act that was sent and refused is not sent again, and what the world holds is told', async () => {
  const place = aPlaceToSend()
  let sends = 0
  const failure = await caught(() =>
    sendAnActAndRecover(
      place.host,
      { ...work, act: push },
      async () => {
        sends += 1
        throw new Error('rejected: non-fast-forward')
      },
      found('it_did_not_happen', 'origin', 'the branch is still there at 3333'),
    ),
  )
  assert.ok(failure instanceof RecoveryDecided)
  assert.equal(failure.decision, 'replanned')
  assert.equal(sends, 1)
  assert.match(failure.told, /is the member's decision/)
  assert.match(failure.told, /the branch is still there at 3333/)
})

test('a look that fails is the state `cannot_tell`, never a throw out of the inspection', async () => {
  const inspection = await inspectTheActualState(async () => {
    throw new Error('no answer from origin')
  })
  assert.equal(inspection.state, 'cannot_tell')
  assert.match(inspection.found, /no answer from origin/)
})
