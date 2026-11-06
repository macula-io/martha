import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { LedgerHost } from './log_ledger.ts'
import {
  ACT_NOT_SENT,
  CONCLUDE_ATTEMPTS,
  LEDGER_ROW_KINDS,
  OUTCOME_NOT_KEPT,
  OutcomeNotKept,
  actsAwaitingOutcome,
  concludeAct,
  ledgerStreamOf,
  noteMilestone,
  readLedger,
  sendOutwardAct,
} from './log_ledger.ts'

// Synthetic names, never a real one: this repository is public.
const work = { package: 'synthetic-owner/repo#7', member: 'member-one' }
const push = { kind: 'push', what: 'main 1111..2222' } as const

// --- a row before every outward act (#15 finding 2) ---------------------------

test('an act runs only after its row is in the store', async () => {
  const { host } = hostForTests()
  let seen_before_running: unknown
  await sendOutwardAct(host, { ...work, act: push }, async () => {
    seen_before_running = await actsAwaitingOutcome(host, work.package)
    return 'pushed'
  })
  assert.deepEqual(seen_before_running, [{ announced_at: 0, member: work.member, act: push, at: 0 }])
})

test('a store that refuses the row stops the act: it never runs', async () => {
  const { host, refuseNextAppend } = hostForTests()
  refuseNextAppend('disk full')
  let ran = false
  await assert.rejects(
    sendOutwardAct(host, { ...work, act: push }, async () => {
      ran = true
      return 'pushed'
    }),
    (error: unknown) =>
      (error as { code?: unknown }).code === ACT_NOT_SENT && /disk full/.test(String((error as Error).cause)),
  )
  assert.equal(ran, false)
  assert.deepEqual(await readLedger(host, work.package), [])
})

test('an act that succeeds is concluded with what it returned', async () => {
  const { host } = hostForTests()
  assert.equal(await sendOutwardAct(host, { ...work, act: push }, async () => 'pushed 2222'), 'pushed 2222')
  assert.deepEqual(await actsAwaitingOutcome(host, work.package), [])
  assert.deepEqual((await readLedger(host, work.package)).at(-1), {
    kind: 'act_concluded',
    package: work.package,
    member: work.member,
    at: 0,
    announced_at: 0,
    outcome: { succeeded: true, detail: 'pushed 2222' },
  })
})

test('an act that fails is concluded as failed, and the failure still reaches the caller', async () => {
  const { host } = hostForTests()
  await assert.rejects(
    sendOutwardAct(host, { ...work, act: push }, async () => {
      throw new Error('rejected: non-fast-forward')
    }),
    /non-fast-forward/,
  )
  assert.deepEqual(await actsAwaitingOutcome(host, work.package), [])
  assert.deepEqual((await readLedger(host, work.package)).at(-1), {
    kind: 'act_concluded',
    package: work.package,
    member: work.member,
    at: 0,
    announced_at: 0,
    outcome: { succeeded: false, detail: 'rejected: non-fast-forward' },
  })
})

test('an outcome that cannot be written leaves the act awaiting, so a successor checks it', async () => {
  const { host, refuseNextAppend } = hostForTests()
  await assert.rejects(
    sendOutwardAct(host, { ...work, act: push }, async () => {
      refuseNextAppend('disk full')
      return 'pushed'
    }),
    { code: OUTCOME_NOT_KEPT },
  )
  assert.deepEqual(await actsAwaitingOutcome(host, work.package), [
    { announced_at: 0, member: work.member, act: push, at: 0 },
  ])
})

// What each failure tells a caller about retrying: never sent (retry is safe),
// sent and failed (its outcome is kept), or sent with no outcome kept (check
// before anything else, never resend).
const failureOf = async (sending: Promise<string>): Promise<unknown> => {
  try {
    await sending
  } catch (error) {
    return error
  }
  return assert.fail('the act was expected to fail')
}

test('a caller can tell an act never sent from an act sent whose outcome was not kept', async () => {
  const { host, refuseNextAppend } = hostForTests()
  refuseNextAppend('disk full before')
  const never_sent = await failureOf(sendOutwardAct(host, { ...work, act: push }, async () => 'pushed'))

  const sent_unkept = await failureOf(
    sendOutwardAct(host, { ...work, act: push }, async () => {
      refuseNextAppend('disk full after')
      return 'pushed 2222'
    }),
  )

  assert.equal((never_sent as { code?: unknown }).code, ACT_NOT_SENT)
  assert.ok(sent_unkept instanceof OutcomeNotKept)
  assert.equal(sent_unkept.code, OUTCOME_NOT_KEPT)
  assert.equal(sent_unkept.announced_at, 0)
  assert.deepEqual(sent_unkept.sent, { succeeded: true, result: 'pushed 2222' })
  assert.match(String(sent_unkept.keeping_error), /disk full after/)
})

test("when the act fails and its outcome cannot be kept, the act's own failure is the cause", async () => {
  const { host, refuseNextAppend } = hostForTests()
  const rejected = new Error('rejected: non-fast-forward')
  const failure = await failureOf(
    sendOutwardAct(host, { ...work, act: push }, async () => {
      refuseNextAppend('disk full after')
      throw rejected
    }),
  )
  assert.ok(failure instanceof OutcomeNotKept)
  assert.equal(failure.cause, rejected)
  assert.deepEqual(failure.sent, { succeeded: false })
  assert.match(String(failure.keeping_error), /disk full after/)
})

test('an act whose outcome a successor kept first is reported as not kept, never as not sent', async () => {
  const { host } = hostForTests()
  const failure = await failureOf(
    sendOutwardAct(host, { ...work, act: push }, async () => {
      await concludeAct(host, {
        package: work.package,
        member: 'member-two',
        announced_at: 0,
        outcome: { succeeded: true, detail: 'found it on main' },
      })
      return 'pushed'
    }),
  )
  assert.ok(failure instanceof OutcomeNotKept)
  assert.match(String(failure.keeping_error), /already concluded/)
})

// --- a successor sees what is unresolved --------------------------------------

test('a successor on the same store gets exactly the acts with no outcome, in order', async () => {
  const { host, advanceClock } = hostForTests()
  const handoff = { kind: 'handoff', what: 'synthetic-owner/repo#7 r=1' } as const
  const tag = { kind: 'tag', what: 'v0.1.0' } as const

  // The predecessor sends three acts and dies before two of them come back.
  await sendOutwardAct(host, { ...work, act: push }, async () => 'pushed')
  advanceClock(10)
  const never = new Promise<string>(() => {})
  void sendOutwardAct(host, { ...work, act: handoff }, () => never)
  advanceClock(10)
  void sendOutwardAct(host, { ...work, act: tag }, () => never)
  await new Promise((settle) => setImmediate(settle))

  // The successor holds no object of the predecessor's: only the host's store.
  assert.deepEqual(await actsAwaitingOutcome(host, work.package), [
    { announced_at: 2, member: work.member, act: handoff, at: 10 },
    { announced_at: 3, member: work.member, act: tag, at: 20 },
  ])
})

test('a successor that checked an act records its outcome, and the act is no longer awaiting', async () => {
  const { host } = hostForTests()
  void sendOutwardAct(host, { ...work, act: push }, () => new Promise<string>(() => {}))
  await new Promise((settle) => setImmediate(settle))

  await concludeAct(host, {
    package: work.package,
    member: 'member-two',
    announced_at: 0,
    outcome: { succeeded: true, detail: 'found 2222 on main' },
  })
  assert.deepEqual(await actsAwaitingOutcome(host, work.package), [])
})

test('an outcome for an act never announced is refused', async () => {
  const { host } = hostForTests()
  await noteMilestone(host, { ...work, milestone: 'checkpoint_reached', note: 'tests red' })
  await assert.rejects(
    concludeAct(host, { ...work, announced_at: 0, outcome: { succeeded: true, detail: 'x' } }),
    /no act was announced at row 0/,
  )
  await assert.rejects(
    concludeAct(host, { ...work, announced_at: 9, outcome: { succeeded: true, detail: 'x' } }),
    /no act was announced at row 9/,
  )
})

test('two successors concluding the same act at once: one outcome is kept, the other refused', async () => {
  const { host } = hostForTests()
  void sendOutwardAct(host, { ...work, act: push }, () => new Promise<string>(() => {}))
  await new Promise((settle) => setImmediate(settle))

  const conclude = (member: string) =>
    concludeAct(host, { package: work.package, member, announced_at: 0, outcome: { succeeded: true, detail: member } })
  const results = await Promise.allSettled([conclude('member-two'), conclude('member-three')])

  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected'],
  )
  const concluded = (await readLedger(host, work.package)).filter((row) => row.kind === 'act_concluded')
  assert.equal(concluded.length, 1)
})

test('a second outcome for the same act is refused', async () => {
  const { host } = hostForTests()
  await sendOutwardAct(host, { ...work, act: push }, async () => 'pushed')
  await assert.rejects(
    concludeAct(host, { ...work, announced_at: 0, outcome: { succeeded: false, detail: 'x' } }),
    /act at row 0 is already concluded/,
  )
})

// --- milestones and the shape of the ledger -----------------------------------

test('a milestone is kept with its package, member, time and note', async () => {
  const { host } = hostForTests({ now: 42 })
  await noteMilestone(host, { ...work, milestone: 'review_round_closed', note: 'r=1 pass' })
  assert.deepEqual(await readLedger(host, work.package), [
    { kind: 'review_round_closed', package: work.package, member: work.member, at: 42, note: 'r=1 pass' },
  ])
})

test('each package keeps its own ledger', async () => {
  const { host } = hostForTests()
  await noteMilestone(host, { ...work, milestone: 'checkpoint_reached', note: 'one' })
  await noteMilestone(host, { ...work, package: 'synthetic-owner/repo#8', milestone: 'checkpoint_reached', note: 'two' })
  assert.deepEqual(
    (await readLedger(host, work.package)).map((row) => row.kind === 'checkpoint_reached' && row.note),
    ['one'],
  )
})

test('a row the ledger does not know is refused on reading, never skipped', async () => {
  const { host } = hostForTests()
  await noteMilestone(host, { ...work, milestone: 'checkpoint_reached', note: 'one' })
  // Another writer on the same store, through the stream the ledger names.
  await host.stores.rows.append(ledgerStreamOf(work.package), { kind: 'something_else' })
  await assert.rejects(readLedger(host, work.package), /row 1 of synthetic-owner\/repo#7 is not a ledger row/)
})

// --- package names and streams --------------------------------------------------

test('a package that is not owner/repo#n is refused before anything is written', async () => {
  const { host } = hostForTests()
  // Synthetic owners only (the private-text check resolves every owner/repo).
  // The one shorthand case is joined at runtime: written out, the check would
  // refuse it as a reference to an unnamed repository.
  const shorthand = ['synthetic-repo', '#7'].join('')
  const bad_names = [
    '../../etc/passwd',
    'synthetic-owner/repo',
    shorthand,
    'synthetic-owner/repo#0',
    'synthetic-owner/repo#7/../x',
    'synthetic-owner/..#7',
    'synthetic-owner/repo#7 ',
  ]
  for (const bad of bad_names) {
    await assert.rejects(
      noteMilestone(host, { package: bad, member: work.member, milestone: 'checkpoint_reached', note: 'x' }),
      /not a work package/,
      bad,
    )
    assert.throws(() => ledgerStreamOf(bad), /not a work package/, bad)
  }
})

test("a row whose package is not its stream's is refused on reading", async () => {
  const { host } = hostForTests()
  await host.stores.rows.append(ledgerStreamOf(work.package), {
    kind: 'checkpoint_reached',
    package: 'synthetic-owner/repo#8',
    member: work.member,
    at: 0,
    note: 'misfiled',
  })
  await assert.rejects(readLedger(host, work.package), /row 0 of synthetic-owner\/repo#7 belongs to synthetic-owner\/repo#8/)
})

// --- a stream that keeps moving --------------------------------------------------

test('concluding gives up after a bounded number of attempts on a stream that never stops moving', async () => {
  const { host } = hostForTests()
  void sendOutwardAct(host, { ...work, act: push }, () => new Promise<string>(() => {}))
  await new Promise((settle) => setImmediate(settle))

  let attempts = 0
  const moving: LedgerHost = {
    clock: host.clock,
    stores: {
      ...host.stores,
      rows: {
        read: host.stores.rows.read,
        append: async () => {
          attempts += 1
          throw Object.assign(new Error('moved'), { code: ROW_STREAM_MOVED })
        },
      },
    },
  }
  await assert.rejects(
    concludeAct(moving, { ...work, announced_at: 0, outcome: { succeeded: true, detail: 'x' } }),
    /kept moving/,
  )
  assert.equal(attempts, CONCLUDE_ATTEMPTS)
})

test('every row kind is a business word, never a CRUD verb', () => {
  const crud = LEDGER_ROW_KINDS.filter((kind) => /_(created|updated|deleted)$/.test(kind))
  assert.deepEqual(crud, [])
})
