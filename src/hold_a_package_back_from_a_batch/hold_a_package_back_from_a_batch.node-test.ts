// A held package stops a batch (martha#364): which open holds a batch's packages meet, and what the refusal names.
// The landing's own tests (../land_passed_work_as_one_batch) pin that the check runs before anything else.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { StandingItem } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { theHoldsOnTheseRows, whyTheHoldsRefuse } from './hold_a_package_back_from_a_batch.ts'

const aHold = (id: string, work_package?: string): StandingItem => ({
  kind: 'held',
  id,
  fields: { item: `item ${id}`, reason: `reason ${id}`, until: `until ${id}`, ...(work_package === undefined ? {} : { package: work_package }) },
  recorded_by: 'Supervisor',
  since: 0,
})
const aWait = (id: string): StandingItem => ({ kind: 'awaiting', id, fields: { owes: 'Uranus', what: 'a verdict', package: 'macula-io/martha#1' }, recorded_by: 'Supervisor', since: 0 })

test('#364: only a hold that names a package in the batch holds it; a hold with no package, on another package, or a wait does not', () => {
  const items = [aHold('none'), aHold('other', 'macula-io/martha#2'), aWait('wait'), aHold('this', 'macula-io/martha#1')]
  assert.deepEqual(theHoldsOnTheseRows(items, ['macula-io/martha#1']).map((held) => held.hold.id), ['this'])
  assert.deepEqual(theHoldsOnTheseRows(items, ['macula-io/martha#3']), [])
})

test('#364: owner/repo is compared without case, the number exactly (mutant: compare with case)', () => {
  assert.deepEqual(theHoldsOnTheseRows([aHold('upper', 'MACULA-IO/Martha#1')], ['macula-io/martha#1']).map((held) => held.package), ['macula-io/martha#1'])
  assert.deepEqual(theHoldsOnTheseRows([aHold('longer', 'macula-io/martha#10')], ['macula-io/martha#1']), [])
})

test('#364: every held package in a batch is named, not only the first (mutant: stop at the first hold)', () => {
  const held = theHoldsOnTheseRows([aHold('one', 'macula-io/martha#1'), aHold('two', 'macula-io/martha#2')], ['macula-io/martha#1', 'macula-io/martha#2', 'macula-io/martha#3'])
  const why = whyTheHoldsRefuse(held, 'nothing was landed')
  for (const named of ['one', 'two', 'macula-io/martha#1', 'macula-io/martha#2', 'item one', 'reason two', 'until two', 'Supervisor']) {
    assert.ok(why.includes(named), `the refusal does not name ${named}: ${why}`)
  }
  assert.ok(!why.includes('macula-io/martha#3'), 'the refusal names a package no hold holds')
})
