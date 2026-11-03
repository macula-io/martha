import assert from 'node:assert/strict'
import { test } from 'node:test'

import { INBOUND_PATHS, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import { refuseExecutionAfterUngatedText, type Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { gapsInGateCoverage } from './check_every_path_is_gated.ts'

const policy: Policy = { may_send_executable_text: [] }
const stranger = '00d52e2fbb71b85ab07acafcdaf3cef8df4b304e297a86ff7c2055f6cb6598c0'

// The gate this check drives. If the gate stops refusing, the check goes red.
const gateRefuses = (path: string) =>
  refuseExecutionAfterUngatedText({
    tool: 'Bash',
    ingests: [{ path, from_node_id: stranger }],
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
  }
  const gaps = gapsInGateCoverage([...INBOUND_PATHS, lying], (path) => path !== 'A98')
  assert.deepEqual(
    gaps.map((gap) => gap.path),
    ['A98'],
  )
})
