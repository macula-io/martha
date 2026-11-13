// Who is free, and who fits instead (martha#319 package A, the design's tests 1 to 5).
//
// The Supervisor picks the next member from this answer, so these tests pin what would hand a package to a member that
// cannot take it: a park read from the wrong place, a limit off by one, a stale report hidden by a fresh heartbeat, a
// refusal that suggests the member it refused, and a declared member that never started read as idle.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ThePark } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { seeTheCrew } from '../see_the_crew/see_the_crew.ts'
import { IDLE, OFFLINE, OFFLINE_AFTER_MS, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import {
  CLAIM_LIMIT_PERCENT,
  NOBODY_FITS,
  NOT_RUNNING,
  PARK_UNREADABLE_FLAG,
  PROGRESS_STALE_AFTER_MS,
  mayTakeAPackage,
  seeWhoIsFree,
  theAnswerToMayTake,
  type WhatTheCrewSays,
} from './see_who_is_free.ts'

const NOW = 1_762_900_000_000
const SUPERVISOR = 'Supervisor'
const CREW = { members: [{ name: SUPERVISOR }, { name: 'Vesta' }, { name: 'Uranus' }, { name: 'Terra' }, { name: 'Ceres' }] }

/** A member that is free: running, idle, nothing held, its context low. */
function freeBeat(member: string, changes: Partial<DashboardRow> = {}): DashboardRow {
  return {
    member,
    session: `session-${member}`,
    at: NOW - 1_000,
    state: IDLE,
    holds: '',
    task: '',
    progress: { step: 0, of: 1 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: 'anthropic', contextPercent: 20, costUsd: 1 },
    ...changes,
  }
}

const NOT_PARKED: ThePark = { kind: 'not_parked', last_marker: null }
const PARKED: ThePark = { kind: 'parked', marker: { parked: true, reason: 'the owner said wind down', since: new Date(NOW).toISOString() } }

/** The crew as the slice is handed it, from beats and parks the test names. */
function theCrewWith(beats: Readonly<Record<string, DashboardRow>>, parks: Readonly<Record<string, ThePark>> = {}): WhatTheCrewSays {
  return {
    rows: seeTheCrew(CREW, beats, NOW).rows,
    declared_models: {},
    parkOf: (member) => parks[member] ?? NOT_PARKED,
    now: NOW,
  }
}

const everyoneFree = (): Record<string, DashboardRow> => Object.fromEntries(CREW.members.map(({ name }) => [name, freeBeat(name)]))

test('test 1: a parked member is refused by its marker, though its row reads idle, and the refusal names who fits', () => {
  const crew = theCrewWith(everyoneFree(), { Vesta: PARKED })
  const answer = mayTakeAPackage(crew, 'Vesta', SUPERVISOR)

  assert.ok(!('refused' in answer) && !answer.may, 'a parked member may not take a package, whatever its row says')
  assert.match(answer.why, new RegExp(`Vesta is parked: ${PARKED.kind === 'parked' ? PARKED.marker.reason : ''}`), 'the refusal says it is parked, and why')
  assert.deepEqual(answer.instead, ['Uranus', 'Terra', 'Ceres'], 'and names the members that fit, never the asker')
  assert.deepEqual(seeWhoIsFree(crew).find((row) => row.member === 'Vesta')?.flags, [PARKED.kind], 'the row is flagged parked, in the park\'s own word')
})

test('test 1: a park marker Martha cannot read is a no, not a guess that the member is free', () => {
  const crew = theCrewWith(everyoneFree(), { Vesta: { kind: 'unreadable', refusal: 'the store would not hand it over' } })
  const answer = mayTakeAPackage(crew, 'Vesta', SUPERVISOR)

  assert.ok(!('refused' in answer) && !answer.may, 'a member whose park cannot be read is not offered')
  assert.match(answer.why, /cannot tell whether Vesta is parked: the store would not hand it over/)
  assert.deepEqual(seeWhoIsFree(crew).find((row) => row.member === 'Vesta')?.flags, [PARK_UNREADABLE_FLAG])
})

test('test 2: a member exactly at the claim limit is refused, and one point under it fits', () => {
  const at = theCrewWith({ ...everyoneFree(), Vesta: freeBeat('Vesta', { host: { model: 'opus', provider: 'anthropic', contextPercent: CLAIM_LIMIT_PERCENT, costUsd: 1 } }) })
  const answer = mayTakeAPackage(at, 'Vesta', SUPERVISOR)
  assert.ok(!('refused' in answer) && !answer.may, 'at the limit, the member would hand over before it starts')
  assert.match(answer.why, new RegExp(`at ${String(CLAIM_LIMIT_PERCENT)}% of its context`))
  assert.deepEqual(seeWhoIsFree(at).find((row) => row.member === 'Vesta')?.flags, [`context ${String(CLAIM_LIMIT_PERCENT)}%`])

  const under = theCrewWith({ ...everyoneFree(), Vesta: freeBeat('Vesta', { host: { model: 'opus', provider: 'anthropic', contextPercent: CLAIM_LIMIT_PERCENT - 1, costUsd: 1 } }) })
  assert.deepEqual(mayTakeAPackage(under, 'Vesta', SUPERVISOR), { may: true, member: 'Vesta' }, 'one point under the limit, the member fits')
  assert.deepEqual(seeWhoIsFree(under).find((row) => row.member === 'Vesta')?.flags, [], 'and its row raises no flag')
})

test('test 3: a fresh beat does not hide a report older than the stale age, and a finished package is never stale', () => {
  const midway = { state: 'working', holds: 'macula-io/martha#319', task: 'who is free', progress: { step: 2, of: 5 } } as const
  const stale = theCrewWith({
    ...everyoneFree(),
    Vesta: freeBeat('Vesta', { ...midway, at: NOW - 1_000, reported_at: NOW - PROGRESS_STALE_AFTER_MS - 60_000 }),
    Uranus: freeBeat('Uranus', { ...midway, progress: { step: 5, of: 5 }, at: NOW - 1_000, reported_at: NOW - PROGRESS_STALE_AFTER_MS - 60_000 }),
    Terra: freeBeat('Terra', { ...midway, at: NOW - 1_000, reported_at: NOW - PROGRESS_STALE_AFTER_MS }),
  })
  const rows = seeWhoIsFree(stale)
  const vesta = rows.find((row) => row.member === 'Vesta')

  assert.deepEqual(vesta?.flags, [`progress ${String(Math.floor((PROGRESS_STALE_AFTER_MS + 60_000) / 60_000))}m old`], 'its row is flagged by the report, not the beat')
  assert.equal(vesta?.reported_ago, PROGRESS_STALE_AFTER_MS + 60_000, 'and says how old its last report is')
  assert.equal(vesta?.beat_ago, 1_000, 'beside how old its beat is')
  assert.deepEqual(rows.find((row) => row.member === 'Uranus')?.flags, [], 'a member whose last report was step == of is not flagged')
  assert.deepEqual(rows.find((row) => row.member === 'Terra')?.flags, [], 'exactly at the stale age, a report is not yet stale')
  assert.deepEqual(mayTakeAPackage(stale, 'Uranus', SUPERVISOR), { may: true, member: 'Uranus' }, 'a member that finished its package is free')
  const busy = mayTakeAPackage(stale, 'Vesta', SUPERVISOR)
  assert.ok(!('refused' in busy) && !busy.may, 'a member in the middle of a package is busy, stale or not')
  assert.match(busy.why, /in the middle of macula-io\/martha#319 \(working, 2\/5\)/)
})

test('test 4: when nobody fits, the answer says so and names no one, not even the member it refused', () => {
  const crew = theCrewWith(everyoneFree(), { Vesta: PARKED, Uranus: PARKED, Terra: PARKED, Ceres: PARKED })
  const answer = mayTakeAPackage(crew, 'Vesta', SUPERVISOR)

  assert.ok(!('refused' in answer) && !answer.may)
  assert.deepEqual(answer.instead, [], 'nobody fits, so nobody is named')
  assert.equal(theAnswerToMayTake(answer), `no: ${answer.why}. ${NOBODY_FITS}.`, 'and the answer says so in words')
})

test('test 4: the members that fit instead come on the same provider first, in the declaration order otherwise', () => {
  const crew = theCrewWith({
    ...everyoneFree(),
    Vesta: freeBeat('Vesta', { state: 'needs-you', needs: 'a yes on the tag' }),
    Uranus: freeBeat('Uranus', { host: { model: 'deepseek', provider: 'deepseek', contextPercent: 10, costUsd: 0 } }),
  })
  const answer = mayTakeAPackage(crew, 'Vesta', SUPERVISOR)

  assert.ok(!('refused' in answer) && !answer.may)
  assert.match(answer.why, /Vesta needs the owner: a yes on the tag/)
  assert.deepEqual(answer.instead, ['Terra', 'Ceres', 'Uranus'], 'the same provider first, then the rest')
})

test('test 5: a member declared but never started reads not running, and is refused as such', () => {
  const beats = everyoneFree()
  delete beats['Ceres']
  const crew = theCrewWith(beats)
  const rows = seeWhoIsFree(crew)

  assert.deepEqual(rows.map((row) => row.member), CREW.members.map(({ name }) => name), 'every declared member has a row, the absent one too')
  assert.equal(rows.find((row) => row.member === 'Ceres')?.state, NOT_RUNNING, 'a member that never beat is not running, not idle')
  const answer = mayTakeAPackage(crew, 'Ceres', SUPERVISOR)
  assert.ok(!('refused' in answer) && !answer.may)
  assert.match(answer.why, new RegExp(`Ceres is ${NOT_RUNNING}`))
})

test('a member asked about that is not on the crew is refused by name, and nobody is guessed', () => {
  const answer = mayTakeAPackage(theCrewWith(everyoneFree()), 'Pluto', SUPERVISOR)
  assert.ok('refused' in answer)
  assert.match(answer.refused, /Pluto is not on this crew/)
})

test('an offline member whose last report finished its package is refused as offline, and flagged so (Uranus r=1)', () => {
  // Its last report was step == of, so the busy rule would let it through: only the offline rule stands between a
  // member whose session died just after a package and a yes.
  const crew = theCrewWith({ ...everyoneFree(), Vesta: freeBeat('Vesta', { state: 'waiting', holds: 'macula-io/martha#319', progress: { step: 5, of: 5 }, at: NOW - OFFLINE_AFTER_MS - 60_000 }) })
  const answer = mayTakeAPackage(crew, 'Vesta', SUPERVISOR)

  assert.ok(!('refused' in answer) && !answer.may, 'an offline member was offered a package because its last report was finished')
  assert.match(answer.why, /^Vesta is offline: its row has been quiet for \d+m$/)
  assert.deepEqual(seeWhoIsFree(crew).find((row) => row.member === 'Vesta')?.flags, [OFFLINE], 'its row is not flagged offline')
})

test('a member that needs the owner is flagged needs-you on its row (Uranus r=1)', () => {
  const crew = theCrewWith({ ...everyoneFree(), Vesta: freeBeat('Vesta', { state: 'needs-you', needs: 'a yes on the tag' }) })
  assert.deepEqual(seeWhoIsFree(crew).find((row) => row.member === 'Vesta')?.flags, ['needs-you'], 'a row needing the owner raises no needs-you flag')
})
