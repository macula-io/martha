// What a package's budget does to a member's calls (martha#513, slice 3; a notice since martha#601 row 112).
//
// The count is the package's, not the session's: it is kept in a stream of its own beside the package's ledger, read once
// a session, and never reset by a refresh, a restart or a new version of the contract. The clock is the package's too:
// it starts once, at the first version that is bounded and names minutes, and time spent waiting counts.
//
// What these tests hold: a call is counted when it runs; at the limit every call is told so in a notice, except the four
// that end the package cleanly, matched by the host's own names; the count survives a successor session; the budget binds from the
// call that names the package, however late in the session that is, and follows the member onto another package; an
// unbounded package is never noticed; and a counted call reads neither the package's act ledger nor the spend stream more
// than once a session.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { claudeCodeToolNames } from '../host_contract/tool_names_for_tests.ts'
import { readLedger, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { theContractIn, theContractOfABlock } from '../keep_the_package_contract/the_contract_in_a_brief.ts'
import { CONTRACT_KEPT, noteTheContract, type LedgerHost as TheLedgerHost } from '../log_ledger/log_ledger.ts'
import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { PARK_A_MEMBER } from '../park_and_wake_a_member/the_park_tools.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { theRowWithNothingSaid } from '../show_dashboard_beat/show_dashboard_beat.ts'

import { THE_CALLS_THAT_END_A_PACKAGE, theNoticeOfACallPastTheBudget } from './refuse_a_call_past_the_budget.ts'
import { SPEND_COUNTED, noteTheCallCounted as noteTheStreamRow, spendStreamOf, theSpendCounts } from './the_spend_stream.ts'
import { theUncountableBudgetNote } from './the_spend_in_force.ts'
import { theBudgetOver } from './the_budget_tools.ts'

// Synthetic names, never a real one: this repository is public.
const PACKAGE = 'synthetic-owner/repo#17'
const MEMBER = 'member-one'
const SESSION = 'a-session'

/** A contract's block, with the budget line a test names. */
const aBlock = (budget: string, extra: readonly string[] = []): readonly string[] => [
  'goal: a package is held to what it may spend',
  `acceptance: the budget stops the member | ci: CI`,
  'allowed: push',
  `budget: ${budget}`,
  'done: the tip is green',
  ...extra,
]

/** A brief around a block, as a Supervisor writes one. */
const aBrief = (block: readonly string[]): string => ['# Brief', '', '```package-contract', ...block, '```', ''].join('\n')

/** A host whose clock, rows and documents a test drives, and which counts its reads of every stream. */
function aHostForTheBudget(options: { readonly now?: number } = {}) {
  const given = hostForTests({ now: options.now ?? 0 })
  const streams_read: string[] = []
  const host = {
    clock: given.host.clock,
    stores: {
      rows: {
        append: (stream: string, row: Parameters<typeof given.host.stores.rows.append>[1], expected?: number) =>
          given.host.stores.rows.append(stream, row, expected),
        read: async (stream: string) => {
          streams_read.push(stream)
          return given.host.stores.rows.read(stream)
        },
      },
    },
  } as unknown as LedgerHost
  return { given, host, streamsRead: () => [...streams_read] }
}

/** Keeps `block` as `package_name`'s contract, through the ledger's own row, as the Supervisor's tool does. */
async function keepTheContract(host: LedgerHost, block: readonly string[], package_name: string = PACKAGE): Promise<void> {
  const read = theContractOfABlock(block)
  assert.ok('ok' in read, 'refused' in read ? read.refused : '')
  const versions = (await readLedger(host, package_name)).filter((row) => row.kind === CONTRACT_KEPT)
  await noteTheContract(host as TheLedgerHost, {
    package: package_name,
    member: 'Supervisor',
    version: versions.length + 1,
    digest: read.ok.digest,
    block,
  })
}

/** The beats row that says this member holds the package, as the crew's dashboard keeps it. */
const holdingThePackage = (holds: string) => ({ ...theRowWithNothingSaid(), member: MEMBER, session: SESSION, at: 0, holds })

/** A crew's places over the host, with `holds` as the package this member's own row names. */
function placesOver(host: LedgerHost, holds: string) {
  return {
    member: MEMBER,
    ledger: host,
    beats: { read: () => holdingThePackage(holds), keep: () => {} },
  } as unknown as Parameters<typeof theBudgetOver>[0]
}

/**
 * Places whose member row names the package the test moves: a member's first calls in a session read its brief and its
 * handover, and `report_where_the_work_stands` names the package some calls later (r=1 R1).
 */
function placesOverARowThatMoves(host: LedgerHost): { readonly places: Parameters<typeof theBudgetOver>[0]; readonly holding: (package_name: string) => void } {
  const row = { holds: '' }
  const places = {
    member: MEMBER,
    ledger: host,
    beats: { read: () => holdingThePackage(row.holds), keep: () => {} },
  } as unknown as Parameters<typeof theBudgetOver>[0]
  return { places, holding: (package_name) => void (row.holds = package_name) }
}

/** A call the budget judges: its tool, and nothing else it needs. */
const aCall = (tool: string) => ({ tool, input: {} })

const CLAUDE_CODE = claudeCodeToolNames

test('a call that runs is one more tool call spent, kept so a successor reads it', async () => {
  const { host } = aHostForTheBudget()
  await keepTheContract(host, aBlock('10 tool calls'))
  const budget = theBudgetOver(placesOver(host, PACKAGE))

  assert.equal(await budget.noteTheCallCounted(SESSION, 'some_working_tool'), undefined)
  await budget.noteTheCallCounted(SESSION, 'some_working_tool')

  const spend = await budget.theSpendInForce(SESSION)
  assert.ok(spend !== undefined)
  assert.deepEqual(spend.units, [{ unit: 'tool calls', spent: 2, limit: 10 }])
  // The durable copy is the stream's own, so a successor counts from there.
  assert.deepEqual(await theSpendCounts(host, PACKAGE), { 'tool calls': 2 })
})

test('#601 row 112: at the limit the next call is told, in one notice, what was spent and the four calls that end the package', async () => {
  const { host } = aHostForTheBudget()
  await keepTheContract(host, aBlock('2 tool calls'))
  const budget = theBudgetOver(placesOver(host, PACKAGE))
  await budget.noteTheCallCounted(SESSION, 'some_working_tool')
  await budget.noteTheCallCounted(SESSION, 'some_working_tool')
  const spend = await budget.theSpendInForce(SESSION)

  assert.equal(
    theNoticeOfACallPastTheBudget(aCall('some_working_tool'), spend, CLAUDE_CODE.ownNameOf),
    `Notice: package ${PACKAGE}'s budget (contract version 1) is spent — 2 of 2 tool calls. The call runs; stop and ` +
      `write your handover (${WRITE_MY_HANDOVER_TOOL}), say so to the crew (${SAY_TO_THE_CREW}), ` +
      `report where the work stands (${REPORT_WHERE_THE_WORK_STANDS}) or be parked (${PARK_A_MEMBER}).`,
  )

  // The four that end the package are told nothing, under the names Claude Code calls them by.
  for (const ending of [WRITE_MY_HANDOVER_TOOL, SAY_TO_THE_CREW, PARK_A_MEMBER, REPORT_WHERE_THE_WORK_STANDS]) {
    assert.equal(
      theNoticeOfACallPastTheBudget(aCall(`mcp__martha__${ending}`), spend, CLAUDE_CODE.ownNameOf),
      undefined,
      ending,
    )
  }
})

test('the ending calls are the same calls without a server name, and a look-alike is not one of them', async () => {
  const { host } = aHostForTheBudget()
  await keepTheContract(host, aBlock('1 tool calls'))
  const budget = theBudgetOver(placesOver(host, PACKAGE))
  await budget.noteTheCallCounted(SESSION, 'some_working_tool')
  const spend = await budget.theSpendInForce(SESSION)

  assert.equal(theNoticeOfACallPastTheBudget(aCall(WRITE_MY_HANDOVER_TOOL), spend, CLAUDE_CODE.ownNameOf), undefined)
  // A name that merely ends with one is another call: it is told like any other.
  assert.notEqual(theNoticeOfACallPastTheBudget(aCall('mcp__martha__not_write_my_handover'), spend, CLAUDE_CODE.ownNameOf), undefined)
})

test('a successor session reads the count from the stream and is told on its first over-budget call', async () => {
  const { host } = aHostForTheBudget()
  await keepTheContract(host, aBlock('3 tool calls'))
  const first = theBudgetOver(placesOver(host, PACKAGE))
  await first.noteTheCallCounted('a-session-before', 'some_working_tool')
  await first.noteTheCallCounted('a-session-before', 'some_working_tool')
  await first.noteTheCallCounted('a-session-before', 'some_working_tool')

  // A refresh: a new session of the same launch counts from the same stream, and nothing is reset.
  const second = theBudgetOver(placesOver(host, PACKAGE))
  const spend = await second.theSpendInForce('a-session-after')
  assert.ok(spend !== undefined)
  assert.deepEqual(spend.units, [{ unit: 'tool calls', spent: 3, limit: 3 }])
  assert.notEqual(theNoticeOfACallPastTheBudget(aCall('some_working_tool'), spend, CLAUDE_CODE.ownNameOf), undefined)
})

test('a session handed its package after its first call is held to it from the call that names it (r=1 R1)', async () => {
  const { host } = aHostForTheBudget()
  await keepTheContract(host, aBlock('2 tool calls'))
  const { places, holding } = placesOverARowThatMoves(host)
  const budget = theBudgetOver(places)

  // The brief and the handover are read before the member reports what it holds: nothing binds yet, and nothing counts.
  assert.equal(await budget.theSpendInForce(SESSION), undefined)
  assert.equal(await budget.noteTheCallCounted(SESSION, 'some_working_tool'), undefined)

  // The report names the package, and from the next call the budget holds: the first two calls are told nothing, the
  // three after them are told the budget is spent.
  holding(PACKAGE)
  const ran: boolean[] = []
  for (let call = 0; call < 5; call += 1) {
    const spend = await budget.theSpendInForce(SESSION)
    const told = theNoticeOfACallPastTheBudget(aCall('some_working_tool'), spend, CLAUDE_CODE.ownNameOf)
    ran.push(told === undefined)
    if (told === undefined) await budget.noteTheCallCounted(SESSION, 'some_working_tool')
  }
  assert.deepEqual(ran, [true, true, false, false, false], 'the calls after the package was named were not told of its budget')

  // And the two that ran were counted: a successor reads them, not zero.
  const successor = await theBudgetOver(placesOver(host, PACKAGE)).theSpendInForce('a-session-after')
  assert.deepEqual(successor?.units, [{ unit: 'tool calls', spent: 2, limit: 2 }], 'the calls that ran after the package was named were never counted')
})

test('a member handed another package in the same session is held to the new one, not the one it left (r=1 R1)', async () => {
  const other = 'synthetic-owner/repo#18'
  const { host } = aHostForTheBudget()
  await keepTheContract(host, aBlock('10 tool calls'))
  await keepTheContract(host, aBlock('1 tool calls'), other)
  const { places, holding } = placesOverARowThatMoves(host)
  const budget = theBudgetOver(places)

  holding(PACKAGE)
  assert.equal(await budget.noteTheCallCounted(SESSION, 'some_working_tool'), undefined)
  assert.deepEqual((await budget.theSpendInForce(SESSION))?.units, [{ unit: 'tool calls', spent: 1, limit: 10 }])

  // The member is handed another package: its own budget is the one in force, with its own count.
  holding(other)
  assert.deepEqual((await budget.theSpendInForce(SESSION))?.units, [{ unit: 'tool calls', spent: 0, limit: 1 }], 'the package the member left kept its budget in force')
  assert.equal(await budget.noteTheCallCounted(SESSION, 'some_working_tool'), undefined)
  const spend = await budget.theSpendInForce(SESSION)
  assert.notEqual(theNoticeOfACallPastTheBudget(aCall('some_working_tool'), spend, CLAUDE_CODE.ownNameOf), undefined, 'the new package had a call left and its spent budget was not noticed')
})

test('a second session in the same launch counts from the stream, not from the tally the first one kept', async () => {
  const { host } = aHostForTheBudget()
  await keepTheContract(host, aBlock('10 tool calls'))
  const budget = theBudgetOver(placesOver(host, PACKAGE))
  await budget.noteTheCallCounted('a-session-before', 'some_working_tool')
  await budget.noteTheCallCounted('a-session-before', 'some_working_tool')
  // Another writer counts one more, as a writer other than this budget would: the stream is the count, not memory.
  await noteTheStreamRow(host, { package: PACKAGE, member: MEMBER, unit: 'tool calls', count: 1 })

  assert.deepEqual(
    (await budget.theSpendInForce('a-session-after'))?.units,
    [{ unit: 'tool calls', spent: 3, limit: 10 }],
    'the new session was answered from the tally the session before it kept rather than from the stream',
  )
})

test('an unbounded package counts nothing and notices no call', async () => {
  const { host } = aHostForTheBudget()
  const unbounded = ['unbounded: the owner said this one runs as long as it needs to', 'owner_yes: 12']
  await keepTheContract(host, unbounded)
  const budget = theBudgetOver(placesOver(host, PACKAGE))

  assert.equal(await budget.theSpendInForce(SESSION), undefined)
  assert.equal(theNoticeOfACallPastTheBudget(aCall('some_working_tool'), await budget.theSpendInForce(SESSION), CLAUDE_CODE.ownNameOf), undefined)
  // Nothing is counted either: an unbounded package spends nothing it is held to.
  assert.equal(await budget.noteTheCallCounted(SESSION, 'some_working_tool'), undefined)
  assert.deepEqual(await theSpendCounts(host, PACKAGE), {})
})

test('a member holding no package spends nothing, and neither does a package with no contract', async () => {
  const { host } = aHostForTheBudget()
  assert.equal(await theBudgetOver(placesOver(host, '')).theSpendInForce(SESSION), undefined)

  await keepTheContract(host, aBlock('1 tool calls'))
  const no_contract = theBudgetOver(placesOver(host, 'synthetic-owner/repo#99'))
  assert.equal(await no_contract.theSpendInForce(SESSION), undefined)
  assert.equal(await no_contract.noteTheCallCounted(SESSION, 'some_working_tool'), undefined)
})

test('minutes spend a package with calls left, and they count while it waits', async () => {
  const { host, given } = aHostForTheBudget({ now: 1_000 })
  await keepTheContract(host, aBlock('30 minutes, 100 tool calls'))
  given.advanceClock(31 * MINUTE_MS)
  const spend = await theBudgetOver(placesOver(host, PACKAGE)).theSpendInForce(SESSION)

  assert.ok(spend !== undefined)
  assert.deepEqual(spend.units, [
    { unit: 'minutes', spent: 31, limit: 30 },
    { unit: 'tool calls', spent: 0, limit: 100 },
  ])
  assert.notEqual(theNoticeOfACallPastTheBudget(aCall('some_working_tool'), spend, CLAUDE_CODE.ownNameOf), undefined)
})

test('the clock starts at the first version that names minutes, so a package bounded late is not spent at once', async () => {
  const { host, given } = aHostForTheBudget({ now: 1_000 })
  // Version 1 is unbounded, and a week passes while the package waits.
  await keepTheContract(host, ['unbounded: not bounded yet', 'owner_yes: 9'])
  given.advanceClock(7 * 24 * 60 * MINUTE_MS)
  // Version 2 bounds it, from this moment: 30 minutes of a 30 minute budget cannot be gone at once.
  await keepTheContract(host, aBlock('30 minutes'))

  const spend = await theBudgetOver(placesOver(host, PACKAGE)).theSpendInForce(SESSION)
  assert.ok(spend !== undefined)
  assert.deepEqual(spend.units, [{ unit: 'minutes', spent: 0, limit: 30 }])
  assert.equal(theNoticeOfACallPastTheBudget(aCall('some_working_tool'), spend, CLAUDE_CODE.ownNameOf), undefined)
})

test('a session reads the spend stream and the contract once, and no call reads either again', async () => {
  const { host, streamsRead } = aHostForTheBudget()
  await keepTheContract(host, aBlock('100 tool calls'))
  const budget = theBudgetOver(placesOver(host, PACKAGE))
  const before = streamsRead().length

  // The first call of the session is the one that reads: the package's contract, then its spend.
  const first = await budget.theSpendInForce(SESSION)
  assert.equal(theNoticeOfACallPastTheBudget(aCall('some_working_tool'), first, CLAUDE_CODE.ownNameOf), undefined)
  await budget.noteTheCallCounted(SESSION, 'some_working_tool')
  const read_at_the_first_call = streamsRead().slice(before)
  assert.deepEqual(read_at_the_first_call.sort(), [`ledger/${PACKAGE}`, spendStreamOf(PACKAGE)].sort())

  // Every call after it is answered from what was read: no stream is read again.
  for (let call = 0; call < 25; call += 1) {
    const spend = await budget.theSpendInForce(SESSION)
    assert.equal(theNoticeOfACallPastTheBudget(aCall('some_working_tool'), spend, CLAUDE_CODE.ownNameOf), undefined)
    await budget.noteTheCallCounted(SESSION, 'some_working_tool')
  }
  assert.deepEqual(streamsRead().slice(before + read_at_the_first_call.length), [], 'no call after the first reads a stream')
})

test('#601 row 113: a call whose row cannot be kept is not counted, and says why for the journal', async () => {
  const { host, given } = aHostForTheBudget()
  await keepTheContract(host, aBlock('10 tool calls'))
  const budget = theBudgetOver(placesOver(host, PACKAGE))

  given.refuseNextAppend('the store is full')
  const why = await budget.noteTheCallCounted(SESSION, 'some_working_tool')
  assert.equal(why, `the store could not keep the row counting this call against ${PACKAGE}'s budget (the store refused the row: the store is full), so this call is not counted.`)
  assert.deepEqual(await theSpendCounts(host, PACKAGE), {})

  // And a call after it still counts: the failure was this row's, not the stream's.
  assert.equal(await budget.noteTheCallCounted(SESSION, 'some_working_tool'), undefined)
  assert.deepEqual(await theSpendCounts(host, PACKAGE), { 'tool calls': 1 })
})

test('the spend is kept in a stream of its own, so the package ledger holds no spend row', async () => {
  const { host } = aHostForTheBudget()
  await keepTheContract(host, aBlock('10 tool calls'))
  await theBudgetOver(placesOver(host, PACKAGE)).noteTheCallCounted(SESSION, 'some_working_tool')

  const ledger_rows = await readLedger(host, PACKAGE)
  assert.equal((ledger_rows.map((row) => row.kind) as readonly string[]).includes(SPEND_COUNTED), false)
  assert.notEqual(spendStreamOf(PACKAGE), `ledger/${PACKAGE}`)
})

test('a budget this host cannot count says so at the start line, rather than pretending it bites', () => {
  const read = theContractIn(aBrief(aBlock('5000 tokens')))
  assert.ok('ok' in read, 'refused' in read ? read.refused : '')
  assert.equal(read.ok.contract.kind, 'bounded')
  const said = theUncountableBudgetNote(read.ok.contract)
  assert.ok(said !== undefined)
  assert.match(said, /tokens/)
  assert.match(said, /no token count/)
})

test('every name on the ending table is one the tree defines, so a renamed tool cannot slip off it', () => {
  assert.deepEqual([...THE_CALLS_THAT_END_A_PACKAGE].sort(), [WRITE_MY_HANDOVER_TOOL, PARK_A_MEMBER, REPORT_WHERE_THE_WORK_STANDS, SAY_TO_THE_CREW].sort())
})
