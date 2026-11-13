import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import type { DocumentStore } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import {
  ACTS,
  DECLARATION_DIRECTORY,
  PERSON_MINUTES,
  REVIEW_MINUTES,
  STALLED_MINUTES,
  DECLARATION_FILE,
  DECLARATION_VERSION,
  DeclarationRefused,
  HOUSE_RULE_SWITCHES,
  NUDGES,
  OWNER,
  RESTART_MEMBER,
  STRICT_GATE,
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
  channel_read_seconds: 30,
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
  channel_read_seconds: 30,
}

/**
 * The models this test's host runs (martha#315): what a declaration's `review_model` is read against. The fixture
 * names its own three, so a refusal below is about the declaration and never about a model list typed here.
 */
const HOST_MODELS = ['model-a', 'model-b', 'model-r']

const declare = (declaration: unknown) => {
  const { store, documentsRead } = storeOf({ [declaration_path]: JSON.stringify(declaration) })
  return { settings: declareCrew(store, root, HOST_MODELS), documentsRead }
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

test('the dashboard is a switch like the others: off unless the declaration names it (martha#254)', async () => {
  const unnamed = await declare(solo).settings
  assert.equal(unnamed.house_rules.dashboard, false, 'a crew that names no dashboard opens no pane')

  const named = await declare({ ...solo, house_rules: { dashboard: true } }).settings
  assert.equal(named.house_rules.dashboard, true, 'a crew that switches it on reads it on')
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
  await assert.rejects(declareCrew(store, root, HOST_MODELS), (error: unknown) => {
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
  await assert.rejects(declareCrew(store, root, HOST_MODELS), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused)
    assert.equal(error.file, declaration_path)
    assert.match(error.message, /EACCES/)
    return true
  })
})

test('a declaration that is not JSON is refused by its file', async () => {
  const { store } = storeOf({ [declaration_path]: '{ "version": ' })
  await assert.rejects(declareCrew(store, root, HOST_MODELS), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused)
    assert.equal(error.file, declaration_path)
    assert.equal(error.field, null)
    return true
  })
})

test('a root that is not an absolute path is refused before anything is read', async () => {
  const { store, documentsRead } = storeOf({})
  await assert.rejects(declareCrew(store, 'relative/root', HOST_MODELS), DeclarationRefused)
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
    // A model the host does not run is refused here, by name, rather than read as a rule that can never match (#315).
    [{ ...team, house_rules: { review_model: 'model-the-host-cannot-spell' } }, 'house_rules.review_model'],
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

// --- the strict shell gate is a house rule (martha#259) -----------------------

test('the strict gate is a house rule, off unless the declaration names it, and refused when it is not true or false', async () => {
  assert.equal((await declare(solo).settings).house_rules[STRICT_GATE], false)
  assert.equal((await declare({ ...solo, house_rules: { [STRICT_GATE]: true } }).settings).house_rules[STRICT_GATE], true)
  await refusedWith({ ...solo, house_rules: { [STRICT_GATE]: 'yes' } }, `house_rules.${STRICT_GATE}`)
})

test('every declared switch is read from the one list, so a new rule is neither misspelt nor forgotten', async () => {
  // Two switches also name what they read with (martha#256's places, martha#320's windows): switching either on alone is
  // refused, as the tests below say, so each is named here with them.
  const places = { clones: '/crew-place/clones', worktrees: '/crew-place/worktrees' }
  const windows = { [STALLED_MINUTES]: 60, [REVIEW_MINUTES]: 45, [PERSON_MINUTES]: 30 }
  const withIt = (name: string) => (name === 'workspace_layout' ? places : name === NUDGES ? windows : {})
  for (const name of HOUSE_RULE_SWITCHES) {
    const named = await declare({ ...solo, house_rules: { ...withIt(name), [name]: true } }).settings
    assert.equal(named.house_rules[name], true, name)
  }
  assert.ok(HOUSE_RULE_SWITCHES.includes(STRICT_GATE), 'the strict gate is one of the declared switches')
})

// --- where a crew keeps its clones and its worktrees (martha#256) -------------

test('a crew whose workspace layout is on must name where its clones and worktrees live, each field by name', async () => {
  const layout = { workspace_layout: true, clones: '/crew-place/clones', worktrees: '/crew-place/worktrees' }
  const declared = await declare({ ...solo, house_rules: layout }).settings
  assert.equal(declared.house_rules.clones, '/crew-place/clones')
  assert.equal(declared.house_rules.worktrees, '/crew-place/worktrees')
  await refusedWith({ ...solo, house_rules: { workspace_layout: true, worktrees: '/crew-place/worktrees' } }, 'house_rules.clones')
  await refusedWith({ ...solo, house_rules: { workspace_layout: true, clones: '/crew-place/clones' } }, 'house_rules.worktrees')
})

test('a place that is not an absolute path is refused by name, and a crew with the layout off needs none', async () => {
  await refusedWith({ ...solo, house_rules: { clones: 'clones' } }, 'house_rules.clones')
  await refusedWith({ ...solo, house_rules: { worktrees: '' } }, 'house_rules.worktrees')
  const off = await declare(solo).settings
  assert.equal(off.house_rules.clones, null)
  assert.equal(off.house_rules.worktrees, null)
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

// --- 6. how often a session reads the crew channel (martha#253) ---------------

test('#253: a crew that does not say how often its sessions read the channel is refused, by field name', async () => {
  await refusedWith(without('channel_read_seconds', solo), 'channel_read_seconds')
  await refusedWith({ ...solo, channel_read_seconds: 0 }, 'channel_read_seconds')
  await refusedWith({ ...solo, channel_read_seconds: 1.5 }, 'channel_read_seconds')
  await refusedWith({ ...solo, channel_read_seconds: '30' }, 'channel_read_seconds')
})

test('#253: the interval a crew declares is the one its settings carry', async () => {
  assert.equal((await declare({ ...solo, channel_read_seconds: 7 }).settings).channel_read_seconds, 7)
})

// --- a crew declared before restart_member (martha#312 r=1 R1) ----------------------------------------------------

/** The declaration v0.1.0's `martha init` wrote, as its own soloDeclaration emitted it: three acts, none of them restart. */
const DECLARED_BY_V0_1_0: unknown = JSON.parse(readFileSync(new URL('./the_crew_v0_1_0_declared.json', import.meta.url), 'utf8'))

/**
 * v0.1.0's table with the one field main has required of it since #253, so this test measures only what #312 adds: the
 * file as v0.1.0 wrote it is refused for `channel_read_seconds` alone, a break of its own (martha#374).
 */
const V0_1_0_WITH_WHAT_253_REQUIRES = { ...(DECLARED_BY_V0_1_0 as object), channel_read_seconds: 1 }

test('#312: a crew v0.1.0 declared is refused for nothing #312 added, and restart_member, which it never named, is the owner\'s alone', async () => {
  await assert.rejects(declare(DECLARED_BY_V0_1_0).settings, (error: unknown) => error instanceof DeclarationRefused && error.field === 'channel_read_seconds')
  const settings = await declare(V0_1_0_WITH_WHAT_253_REQUIRES).settings
  assert.deepEqual(settings.mode.may[RESTART_MEMBER], [OWNER])
})

test('#312: a table that names restart_member and names nobody is still refused', async () => {
  const named = V0_1_0_WITH_WHAT_253_REQUIRES as unknown as { mode: { may: Record<string, unknown> } }
  const empty = { ...named, mode: { ...named.mode, may: { ...named.mode.may, [RESTART_MEMBER]: [] } } }
  await assert.rejects(declare(empty).settings, (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused)
    assert.equal(error.field, `mode.may.${RESTART_MEMBER}`)
    return true
  })
})

// --- 7. the windows a crew that reads nudges names (martha#320) ---------------

const nudging = { ...solo, house_rules: { nudges: true, [STALLED_MINUTES]: 60, [REVIEW_MINUTES]: 45, [PERSON_MINUTES]: 30 } }

test('#320: a crew that reads nudges and names no window is refused, naming the field that is missing', async () => {
  for (const missing of [STALLED_MINUTES, REVIEW_MINUTES, PERSON_MINUTES]) {
    await refusedWith({ ...nudging, house_rules: without(missing, nudging.house_rules) }, `house_rules.${missing}`)
  }
})

test('#320: a window that is not a whole number of minutes, zero or more, is refused by its own field', async () => {
  await refusedWith({ ...nudging, house_rules: { ...nudging.house_rules, stalled_minutes: -1 } }, 'house_rules.stalled_minutes')
  await refusedWith({ ...nudging, house_rules: { ...nudging.house_rules, review_minutes: 1.5 } }, 'house_rules.review_minutes')
  await refusedWith({ ...nudging, house_rules: { ...nudging.house_rules, person_minutes: '30' } }, 'house_rules.person_minutes')
})

test('#320: zero is a window a crew may mean, and a crew that names no nudges carries none', async () => {
  const off = await declare({ ...nudging, house_rules: { ...nudging.house_rules, stalled_minutes: 0 } }).settings
  assert.equal(off.house_rules.stalled_minutes, 0, 'zero turns that kind of nudge off, and is not refused')

  const quiet = await declare(solo).settings
  assert.equal(quiet.house_rules.nudges, false, 'a crew that names no nudges reads none')
  assert.equal(quiet.house_rules.stalled_minutes, null, 'and carries no window it never named')
  assert.equal(quiet.house_rules.review_minutes, null)
  assert.equal(quiet.house_rules.person_minutes, null)
})

test('#320: the windows a crew declares are the ones its settings carry', async () => {
  const settings = await declare(nudging).settings
  assert.equal(settings.house_rules.nudges, true)
  assert.deepEqual(
    [settings.house_rules.stalled_minutes, settings.house_rules.review_minutes, settings.house_rules.person_minutes],
    [60, 45, 30],
  )
})
