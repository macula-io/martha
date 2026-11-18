// Who may check a range (martha#605): verify_range is the Supervisor's work, so the declaration's assign_work decides,
// read as the crew's other Supervisor tools read it, and a refusal reads nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OWNER } from '../declare_crew/declare_crew.ts'
import type { HostContract } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { verifyTheRangeOver, whyTheAskerMayNotCheckARange } from './the_verify_range_tool.ts'

const BUILDER = 'Ceres'
const THE_SUPERVISOR = 'Uranus'

/** A crew of a builder and a supervisor, its table granting assign_work to `granted`. */
const aCrew = (granted: readonly string[]) => ({
  members: [{ name: BUILDER, role: 'builder' }, { name: THE_SUPERVISOR, role: SUPERVISOR }],
  mode: { may: { assign_work: granted } },
})

test('#605: a member whose role the table does not grant assign_work may not check a range, and is told who may', () => {
  assert.equal(
    whyTheAskerMayNotCheckARange({ member: BUILDER, declaration: aCrew([SUPERVISOR]) }),
    `${BUILDER} may not check a range: the declaration grants assign_work to ${SUPERVISOR}, and ${BUILDER}'s role is builder. Nothing was read.`,
  )
  assert.equal(whyTheAskerMayNotCheckARange({ member: THE_SUPERVISOR, declaration: aCrew([SUPERVISOR]) }), undefined)
  assert.match(whyTheAskerMayNotCheckARange({ member: BUILDER, declaration: aCrew([OWNER, SUPERVISOR]) }) ?? '', /may not check a range/)
})

test('#605: a table granting assign_work to the owner alone lets every member check, as the owner\'s own sessions', () => {
  for (const member of [BUILDER, THE_SUPERVISOR]) assert.equal(whyTheAskerMayNotCheckARange({ member, declaration: aCrew([OWNER]) }), undefined, member)
})

test('#605: the tool refuses such a member before it runs anything', async () => {
  const { host } = hostForTests()
  const nothing_runs: HostContract['processes'] = { run: async () => assert.fail('the refused check ran a process') } as unknown as HostContract['processes']
  const answer = await verifyTheRangeOver({ ...host, processes: nothing_runs }, { member: BUILDER, declaration: aCrew([SUPERVISOR]) }, { path: '/a/clone', base: 'a', tip: 'b' })
  assert.deepEqual(answer, { refused: `${BUILDER} may not check a range: the declaration grants assign_work to ${SUPERVISOR}, and ${BUILDER}'s role is builder. Nothing was read.` })
})
