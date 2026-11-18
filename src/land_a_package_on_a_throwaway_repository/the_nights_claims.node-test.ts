// The night's crew claims (martha#639 section 6): each row read from its member's own transcript, in the host's own
// record shapes (a string prompt for a handed turn, a tool_use block for a call), and each row's failure named. The
// expected lines are written out here, never built with the function under test.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { framed } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { HANDOFF_ARRIVED, HANDOFF_SAID, theMembersRecords, theNightsLine, VERDICT_ARRIVED, VERDICT_SAID, whichCrewClaimFails, type TheNight } from './the_nights_claims.ts'

const BASE = 'a'.repeat(40)
const TIP = 'b'.repeat(40)
const NIGHT: TheNight = { package: 'night-bot/martha-live-20261118-221500#1', range: `${BASE}..${TIP}`, builder: 'ada', reviewer: 'bo' }
const HANDOFF = `HANDOFF night-bot/martha-live-20261118-221500#1 ${BASE}..${TIP} r=1 ci=none:paths`
const VERDICT = `VERDICT night-bot/martha-live-20261118-221500#1 PASS ${BASE}..${TIP} r=1 ci=none:paths req=0`

/** A call the host records: an assistant record whose content holds a tool_use block, as Claude Code writes it. */
const aCall = (at: string, text: string, change: Record<string, unknown> = {}, name = 'mcp__martha__say_to_the_crew'): string =>
  JSON.stringify({
    parentUuid: 'p',
    isSidechain: false,
    message: { id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'tool_use', id: 't', name, input: { to: ['someone'], text } }] },
    type: 'assistant',
    uuid: 'u',
    timestamp: at,
    ...change,
  })

/** A turn the member's mod handed in: a user record whose content is the framed string. */
const aTurn = (at: string, content: unknown, change: Record<string, unknown> = {}): string =>
  JSON.stringify({ parentUuid: 'p', isSidechain: false, type: 'user', message: { role: 'user', content }, uuid: 'u', timestamp: at, ...change })

const T1 = '2026-11-18T21:20:00.000Z'
const T2 = '2026-11-18T21:21:00.000Z'
const T3 = '2026-11-18T21:25:00.000Z'
const T4 = '2026-11-18T21:26:00.000Z'

const builderOf = (...lines: string[]): string => lines.join('\n') + '\n'
const GOOD_BUILDER = builderOf(aCall(T1, `${HANDOFF}\nthe package is ready`), aTurn(T4, `[crew #2] bo: ${VERDICT}\nall good`))
const GOOD_REVIEWER = builderOf(aTurn(T2, `[crew #1] ada: ${HANDOFF}\nthe package is ready`), aCall(T3, `${VERDICT}\nall good`))

test("the night's lines are the crew's own shapes, with the night's values", () => {
  assert.equal(theNightsLine('HANDOFF', NIGHT), HANDOFF)
  assert.equal(theNightsLine('VERDICT', NIGHT), VERDICT)
  assert.throws(() => theNightsLine('LANDED', NIGHT), /not a line a member sends/)
})

test('all four rows hold when each transcript shows its own lines in order', () => {
  assert.equal(whichCrewClaimFails(NIGHT, GOOD_BUILDER, GOOD_REVIEWER), undefined)
})

test("a handed turn written as text blocks is read the same as a string", () => {
  const reviewer = builderOf(aTurn(T2, [{ type: 'text', text: `[crew #1] ada: ${HANDOFF}` }]), aCall(T3, VERDICT))
  assert.equal(whichCrewClaimFails(NIGHT, GOOD_BUILDER, reviewer), undefined)
})

test('a builder with no handoff call fails the first row by name', () => {
  const builder = builderOf(aTurn(T4, `[crew #2] bo: ${VERDICT}`))
  assert.match(whichCrewClaimFails(NIGHT, builder, GOOD_REVIEWER) ?? '', new RegExp(`^${HANDOFF_SAID}: `))
})

test("the builder's handoff found only in the reviewer's transcript does not stand in for the builder's", () => {
  const reviewer = builderOf(aCall(T1, HANDOFF), aTurn(T2, `[crew #1] ada: ${HANDOFF}`), aCall(T3, VERDICT))
  const builder = builderOf(aTurn(T4, `[crew #2] bo: ${VERDICT}`))
  assert.match(whichCrewClaimFails(NIGHT, builder, reviewer) ?? '', new RegExp(`^${HANDOFF_SAID}: `))
})

test('a handoff line that differs by one word is not the night\'s handoff', () => {
  const builder = builderOf(aCall(T1, HANDOFF.replace('r=1', 'r=2')), aTurn(T4, `[crew #2] bo: ${VERDICT}`))
  assert.match(whichCrewClaimFails(NIGHT, builder, GOOD_REVIEWER) ?? '', new RegExp(`^${HANDOFF_SAID}: `))
})

test("a subagent's call is not the member's own", () => {
  const builder = builderOf(aCall(T1, HANDOFF, { isSidechain: true }), aTurn(T4, `[crew #2] bo: ${VERDICT}`))
  assert.match(whichCrewClaimFails(NIGHT, builder, GOOD_REVIEWER) ?? '', new RegExp(`^${HANDOFF_SAID}: `))
})

test('a call to another tool that carries the line is not a say', () => {
  const builder = builderOf(aCall(T1, HANDOFF, {}, 'mcp__martha__report_progress'), aTurn(T4, `[crew #2] bo: ${VERDICT}`))
  assert.match(whichCrewClaimFails(NIGHT, builder, GOOD_REVIEWER) ?? '', new RegExp(`^${HANDOFF_SAID}: `))
})

test('a request blob that repeats the call records nothing', () => {
  const builder = builderOf(aCall(T1, HANDOFF, { type: 'api-request-blob' }), aTurn(T4, `[crew #2] bo: ${VERDICT}`))
  assert.match(whichCrewClaimFails(NIGHT, builder, GOOD_REVIEWER) ?? '', new RegExp(`^${HANDOFF_SAID}: `))
})

test('a handoff that never reached the reviewer fails the second row', () => {
  const reviewer = builderOf(aCall(T3, VERDICT))
  assert.match(whichCrewClaimFails(NIGHT, GOOD_BUILDER, reviewer) ?? '', new RegExp(`^${HANDOFF_ARRIVED}: `))
})

test('the handoff typed by someone other than the builder is not its arrival', () => {
  const reviewer = builderOf(aTurn(T2, `[crew #1] mallory: ${HANDOFF}`), aCall(T3, VERDICT))
  assert.match(whichCrewClaimFails(NIGHT, GOOD_BUILDER, reviewer) ?? '', new RegExp(`^${HANDOFF_ARRIVED}: `))
})

test('the handoff as a bare turn, without the crew frame, is not its arrival', () => {
  const reviewer = builderOf(aTurn(T2, HANDOFF), aCall(T3, VERDICT))
  assert.match(whichCrewClaimFails(NIGHT, GOOD_BUILDER, reviewer) ?? '', new RegExp(`^${HANDOFF_ARRIVED}: `))
})

test('the handoff after the sender\'s name, without the crew frame, is not its arrival', () => {
  const reviewer = builderOf(aTurn(T2, `ada: ${HANDOFF}`), aCall(T3, VERDICT))
  assert.match(whichCrewClaimFails(NIGHT, GOOD_BUILDER, reviewer) ?? '', new RegExp(`^${HANDOFF_ARRIVED}: `))
})

test('a turn the carrier itself framed is read as an arrival', () => {
  const reviewer = builderOf(aTurn(T2, framed(7, 'ada', `${HANDOFF}\nready`)), aCall(T3, VERDICT))
  assert.equal(whichCrewClaimFails(NIGHT, GOOD_BUILDER, reviewer), undefined)
})

test('a say block in a record that is not the assistant\'s is no call', () => {
  const asUser = aCall(T1, HANDOFF).replace('"role":"assistant"', '"role":"user"')
  const builder = builderOf(asUser, aTurn(T4, `[crew #2] bo: ${VERDICT}`))
  assert.match(whichCrewClaimFails(NIGHT, builder, GOOD_REVIEWER) ?? '', new RegExp(`^${HANDOFF_SAID}: `))
})

test("an arrival written before the builder's call is not that call's arrival", () => {
  const reviewer = builderOf(aTurn('2026-11-18T21:19:00.000Z', `[crew #1] ada: ${HANDOFF}`), aCall(T3, VERDICT))
  assert.match(whichCrewClaimFails(NIGHT, GOOD_BUILDER, reviewer) ?? '', new RegExp(`^${HANDOFF_ARRIVED}: `))
})

test('a reviewer with no verdict call fails the third row, and a FAIL is not the PASS', () => {
  const none = builderOf(aTurn(T2, `[crew #1] ada: ${HANDOFF}`))
  assert.match(whichCrewClaimFails(NIGHT, GOOD_BUILDER, none) ?? '', new RegExp(`^${VERDICT_SAID}: `))
  const failed = builderOf(aTurn(T2, `[crew #1] ada: ${HANDOFF}`), aCall(T3, VERDICT.replace(' PASS ', ' FAIL ')))
  assert.match(whichCrewClaimFails(NIGHT, GOOD_BUILDER, failed) ?? '', new RegExp(`^${VERDICT_SAID}: `))
})

test('a verdict that never reached the builder fails the fourth row', () => {
  const builder = builderOf(aCall(T1, HANDOFF))
  assert.match(whichCrewClaimFails(NIGHT, builder, GOOD_REVIEWER) ?? '', new RegExp(`^${VERDICT_ARRIVED}: `))
})

test('a transcript line that is not JSON is never read as a transcript holding nothing', () => {
  assert.throws(() => theMembersRecords(`${aCall(T1, HANDOFF)}\n{not json\n`), /line 2 of the transcript is not JSON/)
})
