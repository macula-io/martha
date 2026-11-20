// The crew's `owner_notices` and `clock_zone` (martha#931 C): a value left out reads what the code held before #931,
// a declared one is read as declared, and a value the field cannot mean is refused by name. The slices that read each
// value are tested beside their own code with a declared value that differs from the default.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLOCK_ZONE, CLOCK_ZONE_WHEN_UNNAMED, clockZoneOf, theClockOf } from './the_crews_clock_zone.ts'
import { OWNER_NOTICES, OWNER_NOTICES_WHEN_UNNAMED, ownerNoticesOf } from './the_crews_owner_notices.ts'

/** A refusal that throws what it was told, so a test reads the field it names. */
class Refused extends Error {
  readonly field: string
  constructor(field: string, why: string) {
    super(`${field}: ${why}`)
    this.field = field
  }
}
const refuse = (field: string, why: string): never => {
  throw new Refused(field, why)
}

const refusedAt = (read: () => unknown, field: string): void => {
  assert.throws(read, (error: unknown) => {
    assert.ok(error instanceof Refused, `expected a refusal, got ${String(error)}`)
    assert.equal(error.field, field)
    return true
  })
}

test('#931 C: the defaults are what the code held before #931, written out here, not read from the code', () => {
  // Before #931: the SHOWN_AS_A_DIALOG rows of WHAT_EACH_NOTIFICATION_SAYS, and the UTC both clock spellings printed.
  assert.deepEqual([...OWNER_NOTICES_WHEN_UNNAMED.show].sort(), [
    'agent_completed', 'agent_needs_input', 'auth_storage_failure', 'computer_use_enter', 'computer_use_exit', 'elicitation_url_dialog', 'model_refusal_fallback',
    'plugin_notification', 'push_notification', 'quota_auto_resume_disabled', 'quota_auto_resume_fired', 'quota_auto_resume_stale', 'worker_permission_prompt',
  ])
  assert.equal(CLOCK_ZONE_WHEN_UNNAMED, 'UTC')
})

test('#931 C: a declaration that names neither reads the defaults, and an empty block reads its default list', () => {
  assert.deepEqual(ownerNoticesOf(undefined, refuse), OWNER_NOTICES_WHEN_UNNAMED)
  assert.deepEqual(ownerNoticesOf({}, refuse), OWNER_NOTICES_WHEN_UNNAMED)
  assert.equal(clockZoneOf(undefined, refuse), CLOCK_ZONE_WHEN_UNNAMED)
})

test('#931 C: a declared list and a declared zone are read as declared; an empty list is told of nothing', () => {
  // permission_prompt is not for the owner by the table, and an owner who lists it is told of it.
  assert.deepEqual(ownerNoticesOf({ show: ['agent_completed', 'permission_prompt', 'agent_completed'] }, refuse), { show: ['agent_completed', 'permission_prompt'] })
  assert.deepEqual(ownerNoticesOf({ show: [] }, refuse), { show: [] })
  assert.equal(clockZoneOf('Europe/Brussels', refuse), 'Europe/Brussels')
})

test('#931 C: a value the field cannot mean is refused by name, never read as the default', () => {
  for (const bad of [[], 'some', null]) refusedAt(() => ownerNoticesOf(bad, refuse), OWNER_NOTICES)
  refusedAt(() => ownerNoticesOf({ hide: [] }, refuse), `${OWNER_NOTICES}.hide`)
  refusedAt(() => ownerNoticesOf({ show: 'agent_completed' }, refuse), `${OWNER_NOTICES}.show`)
  refusedAt(() => ownerNoticesOf({ show: ['agent_completed', 'agent_complete'] }, refuse), `${OWNER_NOTICES}.show[1]`)
  refusedAt(() => ownerNoticesOf({ show: [7] }, refuse), `${OWNER_NOTICES}.show[0]`)
  for (const bad of ['', 'Mars/Olympus_Mons', 7, null]) refusedAt(() => clockZoneOf(bad, refuse), CLOCK_ZONE)
})

test('#931 C: one clock spelling, the minute in the declared zone with the zone named', () => {
  const at = Date.UTC(2026, 0, 15, 14, 5, 59)
  // The spelling clockOf printed before #931, for the default.
  assert.equal(theClockOf(at, CLOCK_ZONE_WHEN_UNNAMED), '14:05 UTC')
  assert.equal(theClockOf(at, 'Europe/Brussels'), '15:05 Europe/Brussels')
  assert.equal(theClockOf(Date.UTC(2026, 0, 15, 0, 5), 'UTC'), '00:05 UTC', 'midnight reads as 00, never 24')
})
