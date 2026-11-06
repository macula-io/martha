import assert from 'node:assert/strict'
import { test } from 'node:test'

import { INBOUND_PATHS, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import {
  recordIngestion,
  refuseExecutionAfterUngatedText,
  startFreshSession,
  type Policy,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { CLAUDE_CODE_EMITTED_SESSION_EVENTS } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { gapsInGateCoverage, gapsInSessionEvents } from './check_every_path_is_gated.ts'

const policy: Policy = { may_send_executable_text: [] }

// Synthetic, never a real node id: this repository is public.
const stranger = 'b'.repeat(64)

// The gate this check drives. If the gate stops refusing, the check goes red.
const gateRefuses = (path: string) =>
  refuseExecutionAfterUngatedText({
    tool: 'Bash',
    session: recordIngestion(startFreshSession(), [{ path, from_node_id: stranger }]),
    policy,
  }).allow === false

test('every inbound path the table names is in the registry, exactly once', () => {
  const expected = [
    ...Array.from({ length: 13 }, (_, index) => `A${index + 1}`),
    ...Array.from({ length: 8 }, (_, index) => `B${index + 1}`),
  ]
  const seen = INBOUND_PATHS.map((path) => path.id).sort()
  assert.deepEqual(seen, [...expected].sort())
})

test('the registry as shipped has no path without a control', () => {
  assert.deepEqual(gapsInGateCoverage(INBOUND_PATHS, gateRefuses), [])
})

test('a planted path with no control makes the check fail, and it names that path', () => {
  const planted: InboundPath = {
    id: 'A99',
    what: 'a planted path nobody gated',
    klass: 'delivered',
    control: { kind: 'none' },
    attestation: 'none',
  }
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A99'],
  )
})

test('a planted path whose control was left out altogether makes the check fail', () => {
  const planted = {
    id: 'B99',
    what: 'a planted path with the control field forgotten',
    klass: 'fetched',
  } as unknown as InboundPath
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['B99'],
  )
})

test('a path that claims the shell gate must really be refused by it', () => {
  const lying: InboundPath = {
    id: 'A98',
    what: 'a path claiming cover it does not have',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  }
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, lying], (path) => path !== 'A98')
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A98'],
  )
})

test('a delivery gate nobody has built is not a control', () => {
  const invented = {
    id: 'A97',
    what: 'a path naming a gate that does not exist',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'a-gate-someone-will-write-later' },
  } as unknown as InboundPath
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, invented], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A97'],
  )
})

test('a path excused from the model must say why in words', () => {
  const excused: InboundPath = {
    id: 'B98',
    what: 'a path excused without a reason',
    klass: 'fetched',
    control: { kind: 'no-text-reaches-the-model', why: '   ' },
    attestation: 'none',
  }
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, excused], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['B98'],
  )
})

test('a delivery gate that admits everyone is not a control either', () => {
  const gaps = gapsInGateCoverage(INBOUND_PATHS, gateRefuses, {
    'crew-room-acceptance': () => true,
    'shared-room-acceptance': () => true,
  })
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A1', 'A2', 'A3'],
  )
  assert.match(gaps[0]?.why ?? '', /admits a message nobody attested/)
})

test('a delivery gate that refuses everyone is caught too', () => {
  const gaps = gapsInGateCoverage(INBOUND_PATHS, gateRefuses, {
    'crew-room-acceptance': () => false,
    'shared-room-acceptance': () => false,
  })
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A1', 'A2', 'A3'],
  )
  assert.match(gaps[0]?.why ?? '', /refuses a rostered member/)
})

test('a gate that answers only the roster question is caught: one question right is not a control', () => {
  const roster_only = ({ message, rosters }: { message: { from_node_id: string | null }; rosters: { crew: { member_node_ids: readonly string[] } } }) =>
    message.from_node_id !== null && rosters.crew.member_node_ids.includes(message.from_node_id)

  const gaps = gapsInGateCoverage(INBOUND_PATHS, gateRefuses, {
    'crew-room-acceptance': roster_only as never,
    'shared-room-acceptance': roster_only as never,
  })

  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A1', 'A2', 'A3'],
  )
  assert.match(gaps[0]?.why ?? '', /admits a message nobody attested/)
})

// --- every session event the host emits is declared ---------------------------

test('every session event the Claude Code host emits is declared', () => {
  assert.deepEqual(gapsInSessionEvents(), [])
})

test('a planted session event the declaration does not list turns the check red, by name', () => {
  const gaps = gapsInSessionEvents(undefined, [...CLAUDE_CODE_EMITTED_SESSION_EVENTS, 'resume_fork'])
  assert.equal(gaps.length, 1)
  assert.match(gaps[0]?.path ?? '', /resume_fork/)
})

test('a declared session event the host stops emitting turns the check red, by name', () => {
  const emitted = CLAUDE_CODE_EMITTED_SESSION_EVENTS.filter((event) => event !== 'crew_refresh')
  const gaps = gapsInSessionEvents(undefined, emitted)
  assert.equal(gaps.length, 1)
  assert.match(gaps[0]?.path ?? '', /crew_refresh/)
})
