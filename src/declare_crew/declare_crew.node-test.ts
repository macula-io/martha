import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import type { DocumentStore } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import {
  ACTS,
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DECLARATION_VERSION,
  DeclarationRefused,
  HOUSE_RULE_SWITCHES,
  OWNER,
  declareCrew,
  type CrewSettings,
} from './declare_crew.ts'

// A made-up project root: this repository is public, so no real path appears here.
const root = '/crew-project'
const crew_directory = join(root, DECLARATION_DIRECTORY)
const declaration_path = join(crew_directory, DECLARATION_FILE)

// The core's in-memory host, holding the given documents; it records every
// document read, so a test can say how often the declaration was read.
const storeOf = (documents: Readonly<Record<string, string>>) => {
  const { host, documentsRead } = hostForTests({ documents })
  return { store: host.stores.documents, documentsRead }
}

const allActsTo = (who: readonly string[]) => Object.fromEntries(ACTS.map(act => [act, who]))

// One person does everything: the mode table names only the owner.
const solo = {
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [{ name: 'Builder', role: 'builder' }],
  mode: { name: 'solo', roles: ['builder'], may: allActsTo([OWNER]) },
}

// A table with roles: a supervisor assigns and resumes, the owner approves a landing.
const team = {
  version: DECLARATION_VERSION,
  owner: 'Ann',
  members: [
    { name: 'Lead', role: 'supervisor', model: 'model-a' },
    { name: 'Builder1', role: 'builder', model: 'model-b' },
    { name: 'Reviewer1', role: 'reviewer' },
  ],
  mode: {
    name: 'team',
    roles: ['supervisor', 'builder', 'reviewer'],
    may: { ...allActsTo(['supervisor']), approve_landing: [OWNER] },
  },
  house_rules: { owner_items: true, practice: true, review_model: 'model-r' },
  conventions: 'conventions.md',
}

const declare = (declaration: unknown) => {
  const { store, documentsRead } = storeOf({ [declaration_path]: JSON.stringify(declaration) })
  return { settings: declareCrew(store, root), documentsRead }
}

const refusedWith = async (declaration: unknown, field: string | null) => {
  const { settings } = declare(declaration)
  await assert.rejects(settings, (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused, `expected a DeclarationRefused, got ${String(error)}`)
    assert.equal(error.file, declaration_path)
    assert.equal(error.field, field)
    return true
  })
}

const without = (key: string, from: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(from).filter(([k]) => k !== key))

// --- 1. one function for every mode ------------------------------------------

test('a solo declaration gives typed settings', async () => {
  const settings = await declare(solo).settings
  assert.equal(settings.owner, 'Ann')
  assert.deepEqual(settings.members, [{ name: 'Builder', role: 'builder', model: null }])
  assert.equal(settings.mode.name, 'solo')
  for (const act of ACTS) assert.deepEqual(settings.mode.may[act], [OWNER], act)
  assert.deepEqual(settings.paths, {
    root,
    crew: crew_directory,
    declaration: declaration_path,
    conventions: null,
  })
  for (const name of HOUSE_RULE_SWITCHES) assert.equal(settings.house_rules[name], false, name)
  assert.equal(settings.house_rules.review_model, null)
})

test('a team declaration gives typed settings through the same function', async () => {
  const settings = await declare(team).settings
  assert.deepEqual(
    settings.members.map(member => [member.name, member.role, member.model]),
    [
      ['Lead', 'supervisor', 'model-a'],
      ['Builder1', 'builder', 'model-b'],
      ['Reviewer1', 'reviewer', null],
    ],
  )
  assert.deepEqual(settings.mode.may.approve_landing, [OWNER])
  assert.deepEqual(settings.mode.may.assign_work, ['supervisor'])
  assert.equal(settings.house_rules.owner_items, true)
  assert.equal(settings.house_rules.practice, true)
  assert.equal(settings.house_rules.workspace_layout, false)
  assert.equal(settings.house_rules.review_model, 'model-r')
  assert.equal(settings.paths.conventions, join(crew_directory, 'conventions.md'))
})

test('the mode is data: a mode of any name reads exactly as the same table named team', async () => {
  const renamed = { ...team, mode: { ...team.mode, name: 'pairing' } }
  const as_team = await declare(team).settings
  const as_pairing = await declare(renamed).settings
  assert.deepEqual({ ...as_pairing, mode: { ...as_pairing.mode, name: as_team.mode.name } }, as_team)
})

// --- 2. read once -------------------------------------------------------------

test('the declaration is read exactly once, and using the settings reads nothing more', async () => {
  const { settings, documentsRead } = declare(team)
  const read: CrewSettings = await settings
  // Every later slice takes these settings as its argument; walking all of them
  // stands in for every slice using them, and must not reach the store again.
  JSON.stringify(read)
  assert.deepEqual(documentsRead(), [declaration_path])
})

// --- 3. no silent default -----------------------------------------------------

test('a missing declaration is refused by its file, never replaced by a default', async () => {
  const { store } = storeOf({})
  await assert.rejects(declareCrew(store, root), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused)
    assert.equal(error.file, declaration_path)
    assert.equal(error.field, null)
    assert.match(error.message, /missing/)
    return true
  })
})

test('an unreadable declaration is refused, and the store\'s own code is kept', async () => {
  const store: DocumentStore = {
    read: async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
    },
  }
  await assert.rejects(declareCrew(store, root), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused)
    assert.equal(error.file, declaration_path)
    assert.match(error.message, /EACCES/)
    return true
  })
})

test('a declaration that is not JSON is refused by its file', async () => {
  const { store } = storeOf({ [declaration_path]: '{ "version": ' })
  await assert.rejects(declareCrew(store, root), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused)
    assert.equal(error.file, declaration_path)
    assert.equal(error.field, null)
    return true
  })
})

test('a root that is not an absolute path is refused before anything is read', async () => {
  const { store, documentsRead } = storeOf({})
  await assert.rejects(declareCrew(store, 'relative/root'), DeclarationRefused)
  assert.deepEqual(documentsRead(), [])
})

test('every malformed field is refused by its name', async () => {
  const cases: [unknown, string | null][] = [
    [[], null],
    [{ ...team, version: DECLARATION_VERSION + 1 }, 'version'],
    [without('version', team), 'version'],
    [{ ...team, owner: '' }, 'owner'],
    [without('owner', team), 'owner'],
    [{ ...team, members: 'Lead' }, 'members'],
    [{ ...team, members: [{ name: 'has space', role: 'builder' }] }, 'members[0].name'],
    [{ ...team, members: [team.members[0], team.members[0]] }, 'members[1].name'],
    [{ ...team, members: [{ name: 'Lead', role: 'builder', model: '' }] }, 'members[0].model'],
    [{ ...team, members: [{ name: 'Lead', role: 'builder', colour: 'red' }] }, 'members[0].colour'],
    [without('mode', team), 'mode'],
    [{ ...team, mode: { ...team.mode, name: '' } }, 'mode.name'],
    [{ ...team, mode: { ...team.mode, roles: [] } }, 'mode.roles'],
    [{ ...team, mode: { ...team.mode, roles: ['builder', 'builder'] } }, 'mode.roles[1]'],
    [{ ...team, mode: { ...team.mode, roles: [OWNER] } }, 'mode.roles[0]'],
    [{ ...team, mode: { ...team.mode, may: without('assign_work', team.mode.may) } }, 'mode.may.assign_work'],
    [{ ...team, mode: { ...team.mode, may: { ...team.mode.may, assign_work: [] } } }, 'mode.may.assign_work'],
    [{ ...team, mode: { ...team.mode, may: { ...team.mode.may, assign_work: ['nobody'] } } }, 'mode.may.assign_work[0]'],
    [{ ...team, conventions: '/etc/conventions.md' }, 'conventions'],
    [{ ...team, conventions: '../outside.md' }, 'conventions'],
    [{ ...team, house_rules: { practice: 'yes' } }, 'house_rules.practice'],
    [{ ...team, house_rules: { review_model: '' } }, 'house_rules.review_model'],
    [{ ...team, house_rules: [] }, 'house_rules'],
    [{ ...team, extra: 1 }, 'extra'],
  ]
  for (const [declaration, field] of cases) await refusedWith(declaration, field)
})

// --- folded in from review r=3 ----------------------------------------------

test('a field that is not an object is refused with its shape, naming every key it takes', async () => {
  const shapes: [unknown, string, readonly string[]][] = [
    [{ ...team, members: ['Lead'] }, 'members[0]', ['name', 'role', 'model?']],
    [{ ...team, mode: 'team' }, 'mode', Object.keys(team.mode)],
    [{ ...team, mode: { ...team.mode, may: [] } }, 'mode.may', Object.keys(team.mode.may)],
  ]
  for (const [declaration, field, keys] of shapes) {
    await assert.rejects(declare(declaration).settings, (error: unknown) => {
      assert.ok(error instanceof DeclarationRefused)
      assert.equal(error.field, field)
      assert.ok(error.message.endsWith(`is not { ${keys.join(', ')} }`), error.message)
      return true
    })
  }
})

// --- 4. unknown switches and roles --------------------------------------------

test('a misspelt house rule is refused by name, so it cannot leave a rule off unseen', async () => {
  await refusedWith({ ...team, house_rules: { owner_item: true } }, 'house_rules.owner_item')
})

test('an act the mode table does not know is refused by name', async () => {
  await refusedWith({ ...team, mode: { ...team.mode, may: { ...team.mode.may, merge_anything: [OWNER] } } }, 'mode.may.merge_anything')
})

test('a member whose role is not in the mode table is refused by name', async () => {
  await refusedWith({ ...team, members: [...team.members, { name: 'Ghost', role: 'auditor' }] }, 'members[3].role')
})

// --- folded in from review r=1 ----------------------------------------------

test('two members whose names differ only in case are one name twice', async () => {
  await refusedWith({ ...team, members: [team.members[0], { name: 'lead', role: 'builder' }] }, 'members[1].name')
})

test('a model of null is the host\'s own model, the same as leaving the key out', async () => {
  const settings = await declare({ ...team, members: [{ name: 'Lead', role: 'builder', model: null }] }).settings
  assert.deepEqual(settings.members, [{ name: 'Lead', role: 'builder', model: null }])
})

test('the owner\'s name is trimmed', async () => {
  assert.equal((await declare({ ...team, owner: '  Ann ' }).settings).owner, 'Ann')
})

// --- 5. frozen ----------------------------------------------------------------

test('the settings are frozen all the way down: no slice changes them for its neighbours', async () => {
  const settings = await declare(team).settings
  const frozen = (value: unknown, at: string): void => {
    if (value === null || typeof value !== 'object') return
    assert.ok(Object.isFrozen(value), `${at} is not frozen`)
    for (const [key, inner] of Object.entries(value)) frozen(inner, `${at}.${key}`)
  }
  frozen(settings, 'settings')
  assert.throws(() => {
    ;(settings.members as unknown as { name: string }[]).push({ name: 'Intruder' })
  }, TypeError)
})
