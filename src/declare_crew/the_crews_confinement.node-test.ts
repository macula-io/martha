// The crew's confinement as house-adjacent declaration (martha#989, gap 21): the slice, its two values, a member's two,
// and the systemd-only bus. Every field is the declaration's, and every one is refused by its own name when Martha could
// not hand it to systemd.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from './a_hosts_model_vocabulary.ts'

import { CONFINEMENT, CONFINEMENT_THAT_INIT_WRITES, SYSTEMD_WEIGHT_MOST, theConfinementOf } from './the_crews_confinement.ts'
import { DECLARATION_DIRECTORY, DECLARATION_FILE, DeclarationRefused, declareCrew, soloDeclaration } from './declare_crew.ts'

const NO_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: [] }

/** The values a test declares: none of them crew-code's, so a default read in their place would show. */
const DECLARED = {
  slice: 'tests.slice',
  slice_cpu_quota: '1234%',
  slice_cpu_weight: 21,
  member_cpu_quota: '321%',
  member_cpu_weight: 77,
  systemd_only_bus: { unit: 'tests-bus', socket: 'tests-bus-socket' },
}

/** What reading a block came to: its value, or the refusal's field and words. */
const read = (block: unknown): { readonly value: ReturnType<typeof theConfinementOf> } | { readonly field: string; readonly why: string } => {
  try {
    return { value: theConfinementOf((field, why) => { throw new DeclarationRefused('the declaration', field, why) }, block) }
  } catch (failure) {
    if (failure instanceof DeclarationRefused) return { field: failure.field ?? '', why: failure.message }
    throw failure
  }
}

test('#989: a declaration naming no confinement reads none, and one naming all six reads each', () => {
  assert.deepEqual(read(undefined), { value: null })
  assert.deepEqual(read(DECLARED), { value: DECLARED })
})

test('#989: a block naming only some of its fields is refused naming the first it leaves out', () => {
  const { systemd_only_bus: _bus, ...without_bus } = DECLARED
  const gone = read(without_bus)
  assert.ok('field' in gone)
  assert.equal(gone.field, `${CONFINEMENT}.systemd_only_bus`)
})

test('#989: a socket that is a path, or a dot, is refused by its own name', () => {
  for (const socket of ['a/b', '..', '.', '']) {
    const refused = read({ ...DECLARED, systemd_only_bus: { ...DECLARED.systemd_only_bus, socket } })
    assert.ok('field' in refused, `a socket of ${JSON.stringify(socket)} was read as one`)
    assert.equal(refused.field, `${CONFINEMENT}.systemd_only_bus.socket`)
  }
})

test('#989: a slice that does not end in .slice, and one whose name systemd does not read, are refused by name', () => {
  for (const slice of ['tests', 'tests.service', 'tests slice', 'tests/slice.slice']) {
    const refused = read({ ...DECLARED, slice })
    assert.ok('field' in refused, `a slice of ${JSON.stringify(slice)} was read as one`)
    assert.equal(refused.field, `${CONFINEMENT}.slice`)
  }
})

test('#989: a bus unit named with other characters, or with its own .service, is refused by name', () => {
  for (const unit of ['tests bus', 'tests/bus', 'tests-bus.service', '.', '..']) {
    const refused = read({ ...DECLARED, systemd_only_bus: { ...DECLARED.systemd_only_bus, unit } })
    assert.ok('field' in refused, `a unit of ${JSON.stringify(unit)} was read as one`)
    assert.equal(refused.field, `${CONFINEMENT}.systemd_only_bus.unit`)
  }
})

test('#989: a weight past systemd\'s range on either side, or not a whole number, is refused by name', () => {
  for (const weight of [0, SYSTEMD_WEIGHT_MOST + 1, 1.5, '50']) {
    const refused = read({ ...DECLARED, member_cpu_weight: weight })
    assert.ok('field' in refused, `a weight of ${JSON.stringify(weight)} was read as one`)
    assert.equal(refused.field, `${CONFINEMENT}.member_cpu_weight`)
  }
})

test('#989: a quota without its percent, at zero, or not whole, is refused by name', () => {
  for (const quota of ['2400', '0%', '24.5%', '2400 %', '%']) {
    const refused = read({ ...DECLARED, slice_cpu_quota: quota })
    assert.ok('field' in refused, `a quota of ${JSON.stringify(quota)} was read as one`)
    assert.equal(refused.field, `${CONFINEMENT}.slice_cpu_quota`)
  }
})

test('#989: a field the block does not know is said in one line and read past', () => {
  const said: string[] = []
  const value = theConfinementOf((field, why) => { throw new DeclarationRefused('the declaration', field, why) }, { ...DECLARED, extra: 1 }, (field, why) => said.push(`${field} ${why}`))
  assert.deepEqual(value, DECLARED)
  assert.equal(said.length, 1)
  assert.match(said[0] ?? '', new RegExp(`^${CONFINEMENT}\\.extra is not a field here`))
})

test('#989: a declaration carries the block into the crew\'s settings, and refuses a bad one by its own name', async () => {
  const root = '/martha-989-confinement'
  const declaration_path = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const declared = async (block: unknown) => {
    const { host } = hostForTests({ documents: { [declaration_path]: JSON.stringify({ ...soloDeclaration('the-owner'), [CONFINEMENT]: block }) } })
    return declareCrew(host.stores.documents, root, NO_MODELS)
  }

  assert.deepEqual((await declared(DECLARED)).confinement, DECLARED, 'the block a declaration names is not what the crew is read as')
  await assert.rejects(declared({ ...DECLARED, slice: 'tests' }), (failure: unknown) => failure instanceof DeclarationRefused && failure.field === `${CONFINEMENT}.slice`)
})

test('#989: what martha init writes is crew-code\'s own ceiling, the bus unit host00 already runs, and no value of a test\'s', () => {
  assert.deepEqual(CONFINEMENT_THAT_INIT_WRITES, {
    slice: 'crew.slice',
    slice_cpu_quota: '2400%',
    slice_cpu_weight: 50,
    member_cpu_quota: '400%',
    member_cpu_weight: 50,
    systemd_only_bus: { unit: 'ci-systemd-bus', socket: 'ci-systemd-bus' },
  })
  // The declaration carries the block it is given, and none when given none: whether this host can hold one is
  // init's to read (../declare_a_solo_crew, Supervisor ruling on martha#989).
  const written = soloDeclaration('the-owner', null, undefined, CONFINEMENT_THAT_INIT_WRITES)
  assert.deepEqual(written[CONFINEMENT as keyof typeof written], CONFINEMENT_THAT_INIT_WRITES, 'a declaration given the confinement does not write it')
  assert.equal(CONFINEMENT in soloDeclaration('the-owner'), false, 'a declaration given no confinement writes one')
})
