// The crew's thresholds (martha#931 A): the declaration's `thresholds` block is read field by field, a field it leaves
// out reads the value the code held before #931, and a value that is not a threshold is refused by name. The slices that
// read each threshold are tested beside their own code with a declared value that differs from the default.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { BEAT_INTERVAL_MS } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from './a_hosts_model_vocabulary.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, DeclarationRefused, OWNER, SOLO_MODE, declareCrew } from './declare_crew.ts'
import {
  BEATS_MISSED_BEFORE_OFFLINE,
  HANDOVER_PERCENT_LEAST,
  HANDOVER_PERCENT_MOST,
  SECOND_MS,
  THRESHOLDS,
  THRESHOLDS_KEYS,
  THRESHOLDS_WHEN_UNNAMED,
  offlineAfterMsOf,
  progressStaleMsOf,
  type CrewThresholds,
} from './the_crews_thresholds.ts'

const root = '/martha-931'
const declaration_path = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
const NO_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: [] }

/** A solo crew, with whatever thresholds block the test names (or none). */
const aCrewWith = (thresholds?: unknown): Record<string, unknown> => ({
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [{ name: 'Builder', role: 'builder' }],
  mode: { name: SOLO_MODE, roles: ['builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER]])) },
  ...(thresholds === undefined ? {} : { [THRESHOLDS]: thresholds }),
})

const declared = async (declaration: Record<string, unknown>) => {
  const { host } = hostForTests({ documents: { [declaration_path]: JSON.stringify(declaration) } })
  return declareCrew(host.stores.documents, root, NO_MODELS)
}

const refusedAt = async (thresholds: unknown, field: string): Promise<void> => {
  await assert.rejects(declared(aCrewWith(thresholds)), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused, `expected a DeclarationRefused, got ${String(error)}`)
    assert.equal(error.field, field)
    return true
  })
}

/** Values a test declares: each differs from its default, so a reader that ignored the declaration is seen. */
const DECLARED: CrewThresholds = { offline_after_seconds: 90, handover_percent: 55, progress_stale_minutes: 7 }

test('#931 A: the defaults are the values the code held before #931, written out here, not read from the code', () => {
  // Before #931: OFFLINE_AFTER_MS = BEAT_INTERVAL_MS * 6 (show_dashboard_beat), HANDOVER_LIMIT_PERCENT = 70
  // (refresh_a_member), PROGRESS_STALE_AFTER_MS = 30 minutes (see_who_is_free).
  assert.equal(offlineAfterMsOf(THRESHOLDS_WHEN_UNNAMED), BEAT_INTERVAL_MS * BEATS_MISSED_BEFORE_OFFLINE)
  assert.equal(THRESHOLDS_WHEN_UNNAMED.offline_after_seconds * SECOND_MS, 30_000)
  assert.equal(THRESHOLDS_WHEN_UNNAMED.handover_percent, 70)
  assert.equal(progressStaleMsOf(THRESHOLDS_WHEN_UNNAMED), 30 * 60_000)
  for (const key of THRESHOLDS_KEYS) assert.notEqual(DECLARED[key], THRESHOLDS_WHEN_UNNAMED[key], `the test's declared ${key} must differ from its default`)
})

test('#931 A: a declaration without a thresholds block reads every default, so an earlier file still declares', async () => {
  assert.deepEqual((await declared(aCrewWith())).thresholds, THRESHOLDS_WHEN_UNNAMED)
  assert.deepEqual((await declared(aCrewWith({}))).thresholds, THRESHOLDS_WHEN_UNNAMED)
})

test('#931 A: each declared threshold is read, and a field left out reads its own default', async () => {
  assert.deepEqual((await declared(aCrewWith(DECLARED))).thresholds, DECLARED)
  for (const key of THRESHOLDS_KEYS) {
    const read = (await declared(aCrewWith({ [key]: DECLARED[key] }))).thresholds
    assert.deepEqual(read, { ...THRESHOLDS_WHEN_UNNAMED, [key]: DECLARED[key] }, `${key} alone`)
  }
})

test('#931 A: a value that is not a threshold is refused by name, never read as the default', async () => {
  await refusedAt([], THRESHOLDS)
  await refusedAt('fast', THRESHOLDS)
  await refusedAt({ offline_after_secs: 30 }, `${THRESHOLDS}.offline_after_secs`)
  for (const key of ['offline_after_seconds', 'progress_stale_minutes'] as const) {
    for (const bad of [0, -1, 1.5, '30', null]) await refusedAt({ [key]: bad }, `${THRESHOLDS}.${key}`)
  }
  for (const bad of [HANDOVER_PERCENT_LEAST - 1, HANDOVER_PERCENT_MOST + 1, 55.5, '70', null]) await refusedAt({ handover_percent: bad }, `${THRESHOLDS}.handover_percent`)
  assert.equal((await declared(aCrewWith({ handover_percent: HANDOVER_PERCENT_LEAST }))).thresholds.handover_percent, HANDOVER_PERCENT_LEAST)
  assert.equal((await declared(aCrewWith({ handover_percent: HANDOVER_PERCENT_MOST }))).thresholds.handover_percent, HANDOVER_PERCENT_MOST)
})
