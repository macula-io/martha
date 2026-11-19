// The read of what was spent between two instants (martha#860, design §5): one recorded set of streams, and every figure
// of TheSpend pinned by name against it. Each figure has a mutant that changes it: the baseline, the window's lower
// reading, the silent and unknown-baseline filters, wentBack, the model taken from the reading, the billing split, the
// crew stream's share, and the start of wallMs.
//
// The set, minute by minute from T, read for the window [T+10, T+100):
// - mars holds THE_PACKAGE from T (metered). Its readings before the window (1.00, 1.50) are the reference; inside it
//   2.00 closes a sonnet turn, 2.75 an opus turn (a switch ordered at the 2.00 reading), 2.50 goes back, 3.00 is opus.
// - venus holds THE_PACKAGE on a subscription from T+15, and hands over to ANOTHER_PACKAGE at T+35: the same reading
//   closes one hold and opens the other.
// - mars's /clear at T+60 opens a new hold of the same session id; its reading at T+110 lies past the window.
// - juno (martha-engine) is silent in one session and has a null baseline then a cost in another.
// - mercurius starts in the crew's stream at T+12 and names THE_PACKAGE at T+32.
// Every dollar is a sum of quarters and eighths, so each figure compares exactly.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MINUTE_MS } from '../declare_crew/declare_crew.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import type { StoredRow } from '../host_contract/host_contract.ts'
import { USAGE_READ, type AUsageRead } from './keep_what_a_session_spent.ts'
import { theSpendBetween, type TheSpend } from './the_spend_between.ts'

const THE_PACKAGE = 'macula-io/martha#860'
const ANOTHER_PACKAGE = 'macula-io/martha#308'
const T = 1_794_998_340_000
const at = (minutes: number): number => T + minutes * MINUTE_MS
const FROM = at(10)
const TO = at(100)

type AReading = Omit<AUsageRead, 'kind' | 'opens' | 'at_start' | 'unknown_price' | 'at'> & { readonly minute: number; readonly opens?: 0 | 1; readonly at_start?: 0 | 1 }

const MARS = { member: 'mars', host: CLAUDE_CODE, session: 'mars-session', started_at: at(-30), billing: 'metered', package: THE_PACKAGE } as const
const MARS_CLEARED = { ...MARS, started_at: at(60) } as const
const VENUS = { member: 'venus', host: CLAUDE_CODE, session: 'venus-session', started_at: at(-5), billing: 'subscription', model: 'sonnet' } as const
const JUNO_SILENT = { member: 'juno', host: 'martha-engine', session: 'juno-silent', started_at: null, billing: 'unknown', model: 'deepseek', package: THE_PACKAGE, usd: null } as const
const JUNO_UNKNOWN = { ...JUNO_SILENT, session: 'juno-unknown' } as const
const MERCURIUS = { member: 'mercurius', host: CLAUDE_CODE, session: 'mercurius-session', started_at: at(11), billing: 'metered', model: 'haiku' } as const

/** The package's stream, oldest first, as the writer keeps it. */
const THE_PACKAGES_READINGS: readonly AReading[] = [
  { ...MARS, model: 'sonnet', usd: 1, minute: 0, opens: 1 },
  { ...MARS, model: 'sonnet', usd: 1.5, minute: 5 },
  { ...VENUS, package: THE_PACKAGE, usd: 3, minute: 15, opens: 1 },
  { ...MARS, model: 'sonnet', usd: 2, minute: 20 },
  { ...JUNO_SILENT, minute: 20, opens: 1 },
  { ...VENUS, package: THE_PACKAGE, usd: 3.25, minute: 25 },
  { ...MARS, model: 'opus', usd: 2.75, minute: 30 },
  { ...JUNO_SILENT, minute: 30 },
  { ...MERCURIUS, package: THE_PACKAGE, usd: 0.625, minute: 32, opens: 1 },
  { ...VENUS, package: THE_PACKAGE, usd: 3.75, minute: 35 },
  { ...MARS, model: 'opus', usd: 2.5, minute: 40 },
  { ...JUNO_UNKNOWN, minute: 40, opens: 1 },
  { ...MERCURIUS, package: THE_PACKAGE, usd: 0.875, minute: 42 },
  { ...MARS, model: 'opus', usd: 3, minute: 50 },
  { ...JUNO_UNKNOWN, usd: 0.75, minute: 50 },
  { ...MARS_CLEARED, model: 'sonnet', usd: 0, minute: 60, opens: 1, at_start: 1 },
  { ...MARS_CLEARED, model: 'sonnet', usd: 0.5, minute: 70 },
  { ...MARS_CLEARED, model: 'sonnet', usd: 1, minute: 110 },
]

const THE_OTHER_PACKAGES_READINGS: readonly AReading[] = [
  { ...VENUS, package: ANOTHER_PACKAGE, usd: 3.75, minute: 35, opens: 1 },
  { ...VENUS, package: ANOTHER_PACKAGE, usd: 4, minute: 45 },
]

const THE_CREWS_READINGS: readonly AReading[] = [
  { ...MERCURIUS, package: null, usd: 0.125, minute: 12, opens: 1, at_start: 1 },
  { ...MERCURIUS, package: null, usd: 0.375, minute: 22 },
  { ...MERCURIUS, package: null, usd: 0.625, minute: 32 },
]

const stored = (readings: readonly AReading[]): readonly StoredRow[] =>
  readings.map(({ minute, opens = 0, at_start = 0, ...reading }, position) => ({
    position,
    row: { kind: USAGE_READ, ...reading, opens, at_start, unknown_price: 0, at: at(minute) },
  }))

function theRecordedSpend(): TheSpend {
  const spend = theSpendBetween({
    from: FROM,
    to: TO,
    usage: new Map([[THE_PACKAGE, stored(THE_PACKAGES_READINGS)], [ANOTHER_PACKAGE, stored(THE_OTHER_PACKAGES_READINGS)]]),
    crew: stored(THE_CREWS_READINGS),
  })
  assert.ok(!('refused' in spend), 'the recorded set was refused')
  return spend
}

const dollars = (subscription: number, metered: number, unknown = 0) => ({ subscription, metered, unknown })
const named = (sessions: readonly { readonly member: string; readonly session: string }[]): readonly string[] => sessions.map((one) => `${one.member}/${one.session}`)

test('#860 §5: each session\'s spend in the window (mutants: the baseline, the window\'s lower reading, the billing split, wallMs\'s start, the model)', () => {
  const sessions = theRecordedSpend().sessions.map((one) => [one.package, one.member, one.session, one.model, one.usd, one.wentBack, one.wallMs / MINUTE_MS])
  assert.deepEqual(sessions, [
    [THE_PACKAGE, 'mars', 'mars-session', 'opus', dollars(0, 1.5), true, 40],
    [THE_PACKAGE, 'venus', 'venus-session', 'sonnet', dollars(0.75, 0), false, 20],
    [THE_PACKAGE, 'juno', 'juno-silent', 'deepseek', null, false, 10],
    [THE_PACKAGE, 'mercurius', 'mercurius-session', 'haiku', dollars(0, 0.25), false, 10],
    [THE_PACKAGE, 'juno', 'juno-unknown', 'deepseek', null, false, 10],
    [THE_PACKAGE, 'mars', 'mars-session', 'sonnet', dollars(0, 0.5), false, 10],
    [ANOTHER_PACKAGE, 'venus', 'venus-session', 'sonnet', dollars(0.25, 0), false, 10],
    [null, 'mercurius', 'mercurius-session', 'haiku', dollars(0, 0.5), false, 20],
  ])
})

test('#860 §5: by package, with its silent sessions named (mutants: the baseline, the billing split, the silent filter)', () => {
  assert.deepEqual(theRecordedSpend().byPackage, [
    { package: THE_PACKAGE, usd: dollars(0.75, 2.25), sessions: 6, silent: ['juno-silent', 'juno-unknown'] },
    { package: ANOTHER_PACKAGE, usd: dollars(0.25, 0), sessions: 1, silent: [] },
  ])
})

test('#860 R4: what was spent outside any package is the crew stream\'s, up to the reading that named a package (mutant: the crew stream\'s share)', () => {
  assert.deepEqual(theRecordedSpend().outsideAnyPackage, dollars(0, 0.5))
})

test('#860 §4: by member, the two members on one package kept apart (mutants: the billing split, the crew stream\'s share)', () => {
  assert.deepEqual(theRecordedSpend().byMember, [
    { member: 'mars', usd: dollars(0, 2) },
    { member: 'venus', usd: dollars(1, 0) },
    { member: 'juno', usd: dollars(0, 0) },
    { member: 'mercurius', usd: dollars(0, 0.75) },
  ])
})

test('#860 R1 R2: by the model the session ran on, a turn going to the model of the reading that closes it (mutant: the model taken from the order)', () => {
  assert.deepEqual(theRecordedSpend().bySessionModel, [
    { model: 'sonnet', usd: dollars(1, 1) },
    { model: 'opus', usd: dollars(0, 1) },
    { model: 'haiku', usd: dollars(0, 0.75) },
  ])
})

test('#860 R5: a silent session and a null-baseline session are named apart, never counted as 0 (mutants: the silent filter, the unknown-baseline filter)', () => {
  const spend = theRecordedSpend()
  assert.deepEqual(named(spend.silent), ['juno/juno-silent'])
  assert.deepEqual(named(spend.unknownBaseline), ['juno/juno-unknown'])
})

test('#860: a reading lower than one before it is named as going back, and its highest reading counts (mutant: wentBack)', () => {
  assert.deepEqual(named(theRecordedSpend().wentBack), ['mars/mars-session'])
})

test('#860: a row that is no reading of its stream refuses the whole read by name (mutant: a foreign row skipped)', () => {
  const spend = theSpendBetween({ from: FROM, to: TO, usage: new Map([[ANOTHER_PACKAGE, stored(THE_PACKAGES_READINGS)]]), crew: [] })
  assert.deepEqual(spend, { refused: 'row 0 of usage/macula-io/martha#308 is not a reading of what a session spent there' })
})
