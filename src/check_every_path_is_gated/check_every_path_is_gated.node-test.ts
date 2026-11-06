import assert from 'node:assert/strict'
import { test } from 'node:test'

import { INBOUND_PATHS, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import {
  admitsLaunch,
  fingerprintOf,
  LAUNCH_FILES_OF_HOST,
  type LaunchGate,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import {
  recordIngestion,
  refuseExecutionAfterUngatedText,
  startFreshSession,
  type Policy,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { gapsInGateCoverage } from './check_every_path_is_gated.ts'

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
    ...Array.from({ length: 2 }, (_, index) => `C${index + 1}`),
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

// --- code the host starts by itself (issue #16) --------------------------------

const LAUNCHED = INBOUND_PATHS.filter((path) => path.klass === 'launched').map((path) => path.id)

const withLaunchGates = (gate: LaunchGate) =>
  gapsInGateCoverage(INBOUND_PATHS, gateRefuses, undefined, { 'owner-approved-launch-config': gate })

test('the registry has launched rows, and every one of them stands on the launch gate', () => {
  assert.notDeepEqual(LAUNCHED, [])
  for (const path of INBOUND_PATHS.filter((row) => row.klass === 'launched')) {
    assert.equal(path.control.kind, 'launch-gate', path.id)
  }
})

test('a planted launched path with no control makes the check fail, and it names that path', () => {
  const planted: InboundPath = {
    id: 'C99',
    what: 'a planted copy of a launched path, with control none',
    klass: 'launched',
    control: { kind: 'none' },
    attestation: 'none',
  }
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C99'],
  )
})

test('a launched path claiming the shell gate is a gap, even though the shell gate refuses its id', () => {
  const planted: InboundPath = {
    id: 'C98',
    what: 'a launched path claiming the shell gate',
    klass: 'launched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  }
  assert.equal(gateRefuses('C98'), true)
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C98'],
  )
  assert.match(gaps[0]?.why ?? '', /starts by itself/)
})

test('a launched path claiming a delivery gate is a gap too', () => {
  const planted: InboundPath = {
    id: 'C97',
    what: 'a launched path claiming a delivery gate',
    klass: 'launched',
    control: { kind: 'delivery-gate', gate: 'crew-room-acceptance' },
    attestation: 'none',
  }
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C97'],
  )
})

test('a launch gate on a path the host does not start is a gap', () => {
  const planted: InboundPath = {
    id: 'A96',
    what: 'a delivered path claiming the launch gate',
    klass: 'delivered',
    control: { kind: 'launch-gate', gate: 'owner-approved-launch-config', residual: 'a residual' },
    attestation: 'none',
  }
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, planted], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A96'],
  )
})

test('a launch gate nobody has built is not a control', () => {
  const invented = {
    id: 'C96',
    what: 'a launched path naming a gate that does not exist',
    klass: 'launched',
    control: { kind: 'launch-gate', gate: 'a-gate-someone-will-write-later', residual: 'a residual' },
    attestation: 'none',
  } as unknown as InboundPath
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, invented], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C96'],
  )
  assert.match(gaps[0]?.why ?? '', /nobody has built/)
})

test('a launched path must say in words what happens where Martha does not start the host', () => {
  const silent: InboundPath = {
    id: 'C95',
    what: 'a launched path with no residual',
    klass: 'launched',
    control: { kind: 'launch-gate', gate: 'owner-approved-launch-config', residual: '  ' },
    attestation: 'none',
  }
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, silent], gateRefuses)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['C95'],
  )
})

test('a launch gate that admits everyone is not a control', () => {
  const gaps = withLaunchGates(() => true)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits config the owner has not approved/)
})

test('a launch gate that refuses everyone is caught too', () => {
  const gaps = withLaunchGates(() => false)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /refuses config the owner approved/)
})

// The mistakes a launch gate could make while still answering most questions
// right. Each is the real gate with one rule taken out, so only that rule's
// probe can catch it.

const [SERVERS] = LAUNCH_FILES_OF_HOST['claude-code']

test('a gate that approves by file name, not content, is caught', () => {
  const by_name: LaunchGate = (request) =>
    admitsLaunch(request) ||
    (Object.hasOwn(LAUNCH_FILES_OF_HOST, request.host) &&
      request.entries.every((entry) => entry.kind === 'absent' || (entry.kind === 'file' && entry.path === SERVERS)) &&
      request.approved_fingerprints.length > 0)
  const gaps = withLaunchGates(by_name)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits an approved file whose content changed under the same name/)
})

test('a gate that only looks at the checkout itself, not the directories above, is caught', () => {
  const here_only: LaunchGate = (request) =>
    admitsLaunch({ ...request, entries: request.entries.filter((entry) => !entry.path.startsWith('../')) })
  const gaps = withLaunchGates(here_only)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits a config one directory up/)
})

test('a gate that trusts an approved symlink is caught', () => {
  const trusts_links: LaunchGate = (request) =>
    admitsLaunch(request) ||
    (Object.hasOwn(LAUNCH_FILES_OF_HOST, request.host) &&
      request.approved_fingerprints.includes(fingerprintOf(request.entries)))
  const gaps = withLaunchGates(trusts_links)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits a symlink/)
})

test('a gate that lets a host it has no file list for start is caught', () => {
  const any_host: LaunchGate = (request) =>
    admitsLaunch(request) || !Object.hasOwn(LAUNCH_FILES_OF_HOST, request.host)
  const gaps = withLaunchGates(any_host)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits a host it has no file list for/)
})

test('a gate that takes an empty read for an empty checkout is caught', () => {
  const trusts_empty: LaunchGate = (request) =>
    admitsLaunch(request) || (Object.hasOwn(LAUNCH_FILES_OF_HOST, request.host) && request.entries.length === 0)
  const gaps = withLaunchGates(trusts_empty)
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    LAUNCHED,
  )
  assert.match(gaps[0]?.why ?? '', /admits a request whose config was never read/)
})
