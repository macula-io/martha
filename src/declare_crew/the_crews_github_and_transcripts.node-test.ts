// The crew's `github` and `transcripts` blocks (martha#931 B): each is read through the declaration, a field left out
// reads the value the code held before #931, and a value the block cannot mean is refused by name. The slices that
// read each value are tested beside their own code with a declared value that differs from the default.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from './a_hosts_model_vocabulary.ts'
import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, DECLARATION_VERSION, DeclarationRefused, OWNER, SOLO_MODE, declareCrew } from './declare_crew.ts'
import { GITHUB, GITHUB_WHEN_UNNAMED } from './the_crews_github.ts'
import { MEGABYTE, TRANSCRIPTS, TRANSCRIPTS_WHEN_UNNAMED, bytesKeptOf } from './the_crews_transcripts.ts'

const root = '/martha-931-b'
const declaration_path = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
const NO_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: [] }

/** A solo crew, with whatever extra top-level fields the test names. */
const aCrewWith = (extra: Readonly<Record<string, unknown>> = {}): Record<string, unknown> => ({
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [{ name: 'Builder', role: 'builder' }],
  mode: { name: SOLO_MODE, roles: ['builder'], may: Object.fromEntries(ACTS.map((act) => [act, [OWNER]])) },
  ...extra,
})

const declared = async (declaration: Record<string, unknown>) => {
  const { host } = hostForTests({ documents: { [declaration_path]: JSON.stringify(declaration) } })
  return declareCrew(host.stores.documents, root, NO_MODELS)
}

const refusedAt = async (extra: Readonly<Record<string, unknown>>, field: string): Promise<void> => {
  await assert.rejects(declared(aCrewWith(extra)), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused, `expected a DeclarationRefused, got ${String(error)}`)
    assert.equal(error.field, field)
    return true
  })
}

test('#931 B: the defaults are the values the code held before #931, written out here, not read from the code', () => {
  // Before #931: THE_FLOOR = 500 (spend_the_github_budget), TRANSCRIPTS_LAUNCHES_KEPT = 64 and both byte bounds
  // 16 * 1024 * 1024 (choose_the_transcripts_to_keep).
  assert.equal(GITHUB_WHEN_UNNAMED.budget_floor, 500)
  assert.equal(TRANSCRIPTS_WHEN_UNNAMED.launches_kept, 64)
  assert.equal(bytesKeptOf(TRANSCRIPTS_WHEN_UNNAMED), 16 * 1024 * 1024)
})

test('#931 B: a declaration without the blocks reads every default, so an earlier file still declares', async () => {
  const settings = await declared(aCrewWith())
  assert.deepEqual(settings.github, GITHUB_WHEN_UNNAMED)
  assert.deepEqual(settings.transcripts, TRANSCRIPTS_WHEN_UNNAMED)
  const empty = await declared(aCrewWith({ [GITHUB]: {}, [TRANSCRIPTS]: {} }))
  assert.deepEqual([empty.github, empty.transcripts], [GITHUB_WHEN_UNNAMED, TRANSCRIPTS_WHEN_UNNAMED])
})

test('#931 B: each declared field is read, a field left out reads its own default, and a floor of 0 is a floor', async () => {
  const settings = await declared(aCrewWith({ [GITHUB]: { budget_floor: 120 }, [TRANSCRIPTS]: { launches_kept: 3, megabytes_kept: 2 } }))
  assert.deepEqual(settings.github, { budget_floor: 120 })
  assert.deepEqual(settings.transcripts, { launches_kept: 3, megabytes_kept: 2 })
  assert.equal(bytesKeptOf(settings.transcripts), 2 * MEGABYTE)
  assert.deepEqual((await declared(aCrewWith({ [TRANSCRIPTS]: { launches_kept: 3 } }))).transcripts, { ...TRANSCRIPTS_WHEN_UNNAMED, launches_kept: 3 })
  assert.deepEqual((await declared(aCrewWith({ [TRANSCRIPTS]: { megabytes_kept: 2 } }))).transcripts, { ...TRANSCRIPTS_WHEN_UNNAMED, megabytes_kept: 2 })
  assert.deepEqual((await declared(aCrewWith({ [GITHUB]: { budget_floor: 0 } }))).github, { budget_floor: 0 })
})

test('#931 B: a value the block cannot mean is refused by name, never read as the default', async () => {
  for (const block of [GITHUB, TRANSCRIPTS]) {
    await refusedAt({ [block]: [] }, block)
    await refusedAt({ [block]: 'some' }, block)
    await refusedAt({ [block]: { kept: 1 } }, `${block}.kept`)
  }
  for (const bad of [-1, 1.5, '500', null]) await refusedAt({ [GITHUB]: { budget_floor: bad } }, `${GITHUB}.budget_floor`)
  for (const key of ['launches_kept', 'megabytes_kept']) {
    for (const bad of [0, -1, 1.5, '16', null]) await refusedAt({ [TRANSCRIPTS]: { [key]: bad } }, `${TRANSCRIPTS}.${key}`)
  }
})
