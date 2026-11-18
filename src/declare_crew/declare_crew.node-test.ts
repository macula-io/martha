import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import type { DocumentStore } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import {
  ACTS,
  BACKLOG,
  CHANNEL_READ_SECONDS_WHEN_UNNAMED,
  CLONES,
  CREW_CODE_DECLARATION_DIRECTORY,
  CREW_CODE_DECLARATION_FILE,
  HANDOVER_CEILING_MINUTES_LEAST,
  HANDOVER_CEILING_MINUTES_MOST,
  HANDOVER_CEILING_MINUTES_WHEN_UNNAMED,
  HOST,
  DECLARATION_DIRECTORY,
  PERSON_MINUTES,
  REVIEW_MINUTES,
  REVIEW_MODEL,
  STALLED_MINUTES,
  DECLARATION_FILE,
  DECLARATION_VERSION,
  DeclarationRefused,
  HOUSE_RULE_SWITCHES,
  NUDGES,
  OWNER,
  RESTART_MEMBER,
  THE_ENGINES_HOST,
  theHostOfMember,
  STRICT_GATE,
  VOLATILE_PATHS,
  WORKTREES,
  WORKSPACE_LAYOUT,
  WORKTREES_BESIDE_CLONES,
  LAYOUT_TO_ADD,
  HOLD_REVIEWS,
  THE_HOST_A_MEMBER_RAN_ON,
  declareCrew,
  declareCrewOnHosts,
  holdsReviews,
  reviewerMembersOf,
  soloDeclaration,
  workspaceLayoutOf,
  type CrewSettings,
  type WorkspaceLayout,
} from './declare_crew.ts'
import { SOLO_MODE } from '../declare_crew/declare_crew.ts'
import { repoOfTheOrigin } from '../read_the_origin_a_clone_has/read_the_origin_a_clone_has.ts'
import { CLOSED_VOCABULARY, OPEN_VOCABULARY, type ModelVocabulary } from './a_hosts_model_vocabulary.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'

// A made-up project root: this repository is public, so no real path appears here.
const root = '/martha-project'
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
  mode: { name: SOLO_MODE, roles: ['builder'], may: allActsTo([OWNER]) },
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
const HOST_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['model-a', 'model-b', 'model-r'] }

const declare = (declaration: unknown) => {
  const { store, documentsRead } = storeOf({ [declaration_path]: JSON.stringify(declaration) })
  return { settings: declareCrew(store, root, HOST_MODELS), documentsRead }
}

/** A host that takes any model name its provider serves, as Goose does (martha#541, package 6). */
const OPEN_HOST: ModelVocabulary = { kind: OPEN_VOCABULARY, names: [] }

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
  assert.deepEqual(settings.members, [{ name: 'Builder', role: 'builder', model: null, host: null }])
  assert.equal(settings.mode.name, SOLO_MODE)
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

test('the roots a reboot deletes are the declaration\'s, and the launch\'s own when it names none (martha#314)', async () => {
  const unnamed = await declare(solo).settings
  assert.deepEqual(unnamed.volatile_paths, [], 'a crew that names no root declared one, so the machine roots apply')

  const named = await declare({ ...solo, [VOLATILE_PATHS]: ['/var/scratch', '/run/user/1000/'] }).settings
  assert.deepEqual(named.volatile_paths, ['/var/scratch', '/run/user/1000'], 'a trailing slash was kept as part of a root')
})

test('a root that is not absolute, an empty list and a root named twice are refused by field (martha#314)', async () => {
  await refusedWith({ ...solo, [VOLATILE_PATHS]: 'scratch' }, VOLATILE_PATHS)
  await refusedWith({ ...solo, [VOLATILE_PATHS]: [] }, VOLATILE_PATHS)
  await refusedWith({ ...solo, [VOLATILE_PATHS]: ['scratch'] }, `${VOLATILE_PATHS}[0]`)
  await refusedWith({ ...solo, [VOLATILE_PATHS]: ['/var/scratch', '/var/scratch/'] }, `${VOLATILE_PATHS}[1]`)
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

test('#468: a checkout still holding crew-code\'s declaration is refused by name, not as a plain absence', async () => {
  const crewCodeDeclaration = join(root, CREW_CODE_DECLARATION_DIRECTORY, CREW_CODE_DECLARATION_FILE)
  const { store } = storeOf({ [crewCodeDeclaration]: JSON.stringify(solo) })
  await assert.rejects(declareCrew(store, root, HOST_MODELS), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused)
    assert.equal(error.file, declaration_path)
    assert.equal(error.field, null)
    // The message names the file found and the file Martha reads, so a person can move one to the other.
    assert.ok(error.message.includes(crewCodeDeclaration), error.message)
    assert.ok(error.message.includes(declaration_path), error.message)
    return true
  })
})

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

test('every act a table does not name is the owner\'s alone, so a crew file written before the act existed still declares (martha#313, martha#312; mutant: the rule narrowed to one act)', async () => {
  // v0.1.0's `martha init` wrote tables with no offer_owner_asks in them, and a file written before a later act
  // (restart_member, #312) names none of that one either. It is one rule for every act, not a case per act: absent
  // reads as the owner alone. Pinning every act here is what stops the rule being narrowed back to a single one.
  for (const act of ACTS) {
    const settings = await declare({ ...solo, mode: { ...solo.mode, may: without(act, solo.mode.may) } }).settings
    assert.deepEqual(settings.mode.may, allActsTo([OWNER]), `${act} absent is the owner's alone, and every other act is read as named`)
  }

  // The rule is for an act that is absent. An act that is there and names nobody is still refused, as before.
  for (const act of ACTS) {
    await refusedWith({ ...solo, mode: { ...solo.mode, may: { ...solo.mode.may, [act]: [] } } }, `mode.may.${act}`)
  }
})

// --- folded in from review r=3 ----------------------------------------------

test('a field that is not an object is refused with its shape, naming every key it takes', async () => {
  const shapes: [unknown, string, readonly string[]][] = [
    [{ ...team, members: ['Lead'] }, 'members[0]', ['name', 'role', 'model?', 'host?']],
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
  const places = { clones: `/crew-place/${CLONES}`, worktrees: `/crew-place/${WORKTREES}` }
  const windows = { [STALLED_MINUTES]: 60, [REVIEW_MINUTES]: 45, [PERSON_MINUTES]: 30 }
  const withIt = (name: string) => (name === WORKSPACE_LAYOUT ? places : name === NUDGES ? windows : {})
  for (const name of HOUSE_RULE_SWITCHES) {
    const named = await declare({ ...solo, house_rules: { ...withIt(name), [name]: true } }).settings
    assert.equal(named.house_rules[name], true, name)
  }
  assert.ok(HOUSE_RULE_SWITCHES.includes(STRICT_GATE), 'the strict gate is one of the declared switches')
})

// --- where a crew keeps its clones and its worktrees (martha#256) -------------

test('a crew whose workspace layout is on must name where its clones and worktrees live, each field by name', async () => {
  const layout = { workspace_layout: true, clones: `/crew-place/${CLONES}`, worktrees: `/crew-place/${WORKTREES}` }
  const declared = await declare({ ...solo, house_rules: layout }).settings
  assert.equal(declared.house_rules.clones, `/crew-place/${CLONES}`)
  assert.equal(declared.house_rules.worktrees, `/crew-place/${WORKTREES}`)
  await refusedWith({ ...solo, house_rules: { workspace_layout: true, worktrees: `/crew-place/${WORKTREES}` } }, 'house_rules.clones')
  await refusedWith({ ...solo, house_rules: { workspace_layout: true, clones: `/crew-place/${CLONES}` } }, 'house_rules.worktrees')
})

test('a place that is not an absolute path is refused by name, and a crew with the layout off needs none', async () => {
  await refusedWith({ ...solo, house_rules: { clones: 'some-clones' } }, 'house_rules.clones')
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
  assert.deepEqual(settings.members, [{ name: 'Lead', role: 'builder', model: null, host: null }])
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

test('#253: a crew that does not say how often its sessions read the channel reads as init writes it, and a value it cannot use is refused by field name', async () => {
  assert.equal((await declare(without('channel_read_seconds', solo)).settings).channel_read_seconds, CHANNEL_READ_SECONDS_WHEN_UNNAMED)
  await refusedWith({ ...solo, channel_read_seconds: 0 }, 'channel_read_seconds')
  await refusedWith({ ...solo, channel_read_seconds: 1.5 }, 'channel_read_seconds')
  await refusedWith({ ...solo, channel_read_seconds: '30' }, 'channel_read_seconds')
})

// --- 6b. how long a handover waits behind a running turn (martha#311) ------------

test('#311: a crew that names no handover ceiling reads the default, and 0 or past the most is refused by field name (mutant: accept 0)', async () => {
  assert.equal((await declare(without('handover_ceiling_minutes', solo)).settings).handover_ceiling_minutes, HANDOVER_CEILING_MINUTES_WHEN_UNNAMED)
  await refusedWith({ ...solo, handover_ceiling_minutes: HANDOVER_CEILING_MINUTES_LEAST - 1 }, 'handover_ceiling_minutes')
  await refusedWith({ ...solo, handover_ceiling_minutes: HANDOVER_CEILING_MINUTES_MOST + 1 }, 'handover_ceiling_minutes')
  await refusedWith({ ...solo, handover_ceiling_minutes: 2.5 }, 'handover_ceiling_minutes')
  assert.equal((await declare({ ...solo, handover_ceiling_minutes: HANDOVER_CEILING_MINUTES_MOST }).settings).handover_ceiling_minutes, HANDOVER_CEILING_MINUTES_MOST)
  assert.equal((await declare({ ...solo, handover_ceiling_minutes: HANDOVER_CEILING_MINUTES_LEAST }).settings).handover_ceiling_minutes, HANDOVER_CEILING_MINUTES_LEAST)
})

// --- 7. a declaration an earlier release's init wrote (martha#374) ------------

/** The declaration v0.1.0's `martha init` wrote, as its own soloDeclaration emitted it: three acts, none of them restart. */
const DECLARED_BY_V0_1_0_TEXT = readFileSync(new URL('./the_crew_v0_1_0_declared.json', import.meta.url), 'utf8')

/** The slice's own directory: the releases' declarations are kept beside it, one file per released `martha init`. */
const declaredByReleases = new URL('.', import.meta.url)

/** Every released init's declaration this tree keeps, by the file that keeps it, which names the release. */
const declarationsOfReleases = (): readonly { readonly release: string; readonly text: string }[] =>
  readdirSync(fileURLToPath(declaredByReleases))
    .filter((name) => name.endsWith('_declared.json'))
    .sort()
    .map((release) => ({ release, text: readFileSync(fileURLToPath(new URL(release, declaredByReleases)), 'utf8') }))

test("#374: every declaration a release's init wrote is still declared, and a refusal names the release's file", async () => {
  const releases = declarationsOfReleases()
  assert.ok(releases.length > 0, 'this tree keeps no released declaration, so this check would pass by looking at nothing')
  for (const { release, text } of releases) {
    const { store } = storeOf({ [declaration_path]: text })
    await declareCrew(store, root, HOST_MODELS).catch((error: unknown) => {
      const why = error instanceof Error ? error.message : String(error)
      assert.fail(`${release} is refused (${why}): an owner who declared a crew with that release can no longer start, wake, list, stop or restart its members`)
    })
  }
})

test('#374: the declaration v0.1.0 wrote declares, and its channel_read_seconds reads as the value init writes', async () => {
  const { store } = storeOf({ [declaration_path]: DECLARED_BY_V0_1_0_TEXT })
  const settings = await declareCrew(store, root, HOST_MODELS)
  assert.equal(settings.channel_read_seconds, CHANNEL_READ_SECONDS_WHEN_UNNAMED)
})

// --- the host each member runs on (martha#541 package 5) --------------------------------------------------------

test('#541: a member runs on the host it names, else the crew\'s, and the crew\'s is where a member names none (mutant: the member\'s host read as the crew\'s)', async () => {
  // This crew names both hosts, so it is read with both hosts' models (martha#541 package 6b): its `review_model` is
  // held against every member's host, and the crew's own host is the engine, where a member names none.
  const settings = await declareOnHosts(
    { ...team, host: THE_ENGINES_HOST, members: [{ name: 'Lead', role: 'supervisor', host: CLAUDE_CODE }, { name: 'Builder1', role: 'builder' }] },
    new Map([[CLAUDE_CODE, HOST_MODELS], [THE_ENGINES_HOST, HOST_MODELS]]),
  )
  assert.equal(settings.members[0]!.host, CLAUDE_CODE)
  assert.equal(theHostOfMember(settings, settings.members[0]!), CLAUDE_CODE, 'the member\'s own host did not win over the crew\'s')
  assert.equal(settings.members[1]!.host, null)
  assert.equal(theHostOfMember(settings, settings.members[1]!), THE_ENGINES_HOST, 'a member naming none did not take the crew\'s host')
})

test('#541: a declaration that names no host at all reads as the host every release before this one ran (mutant: refuse it)', async () => {
  const settings = await declare(solo).settings
  assert.equal(settings.host, CLAUDE_CODE)
  assert.equal(settings.members[0]!.host, null)
  assert.equal(theHostOfMember(settings, settings.members[0]!), CLAUDE_CODE)
  // A file an earlier release's init wrote is the same case, and still declares.
  const { store } = storeOf({ [declaration_path]: DECLARED_BY_V0_1_0_TEXT })
  const old = await declareCrew(store, root, HOST_MODELS)
  assert.equal(old.host, CLAUDE_CODE)
  for (const member of old.members) assert.equal(theHostOfMember(old, member), CLAUDE_CODE)
})

test('#541: a host Martha does not know is refused by its field, naming the hosts it knows, at the top level and on a member', async () => {
  for (const [declaration, field] of [
    [{ ...solo, host: 'a-host-nothing-runs' }, HOST],
    [{ ...team, members: [{ name: 'Lead', role: 'supervisor', host: 'a-host-nothing-runs' }] }, 'members[0].host'],
  ] as const) {
    await assert.rejects(declare(declaration).settings, (error: unknown) => {
      assert.ok(error instanceof DeclarationRefused)
      assert.equal(error.field, field)
      assert.ok(error.message.includes(THE_ENGINES_HOST), error.message)
      assert.ok(error.message.includes(CLAUDE_CODE), error.message)
      return true
    })
  }
})


// --- the reviewer model read across the crew's hosts (martha#541 package 6b) -----------------------------------
//
// A crew whose members name two hosts is read with one vocabulary per host, and `review_model` must be one every
// member's host runs, because any member can spawn a subagent. Each test names the mutant that must fail it:
//   1 one host's list read for both      a model the other host cannot spell is accepted
//   2 only the reviewer's host checked   a member that is no reviewer spawns under a host the rule never reads
//   3 an unrecorded host read as open    a host this release records no models for accepts any name

/** The engine's vocabulary as a closed list: a host that names its models, held to exactly these. */
const ENGINE_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['engine-model'] }

/** The two hosts, each able to spell `model-r`: read as the crew's reviewer model is held against both. */
const BOTH_SPELL_IT = new Map<string, ModelVocabulary>([
  [CLAUDE_CODE, HOST_MODELS],
  [THE_ENGINES_HOST, { kind: CLOSED_VOCABULARY, names: ['model-r'] }],
])

/** Claude Code can spell `model-r` and the engine cannot: the case one host's list read for both would accept. */
const CLAUDE_SPELLS_IT_ONLY = new Map<string, ModelVocabulary>([[CLAUDE_CODE, HOST_MODELS], [THE_ENGINES_HOST, ENGINE_MODELS]])

/** Claude Code as this fixture's host, and the engine taking any name its provider serves. */
const CLAUDE_AND_AN_OPEN_ENGINE = new Map<string, ModelVocabulary>([[CLAUDE_CODE, HOST_MODELS], [THE_ENGINES_HOST, OPEN_HOST]])

/** The declaration a two-host crew writes: a builder and a reviewer, each on a host the test names. */
const acrossTwoHosts = (review_model: string | undefined, hosts: { readonly builder: string; readonly reviewer: string }) => ({
  ...team,
  members: [
    { name: 'Builder1', role: 'builder', host: hosts.builder },
    { name: 'Reviewer1', role: 'reviewer', host: hosts.reviewer, model: review_model ?? null },
  ],
  mode: { ...team.mode, may: { ...allActsTo([OWNER]), [HOLD_REVIEWS]: ['reviewer'] } },
  house_rules: { ...without(REVIEW_MODEL, team.house_rules), ...(review_model === undefined ? {} : { [REVIEW_MODEL]: review_model }) },
})

const declareOnHosts = (declaration: unknown, vocabularies: ReadonlyMap<string, ModelVocabulary>) =>
  declareCrewOnHosts(storeOf({ [declaration_path]: JSON.stringify(declaration) }).store, root, vocabularies)

test('#541 6b: a crew whose members name two hosts reads, and the roles that hold hold_reviews are its reviewers', async () => {
  const settings = await declareOnHosts(acrossTwoHosts('model-r', { builder: CLAUDE_CODE, reviewer: THE_ENGINES_HOST }), CLAUDE_AND_AN_OPEN_ENGINE)
  assert.equal(settings.house_rules.review_model, 'model-r')
  assert.deepEqual(settings.members.map((member) => theHostOfMember(settings, member)), [CLAUDE_CODE, THE_ENGINES_HOST])
  assert.deepEqual(reviewerMembersOf(settings).map((member) => member.name), ['Reviewer1'])
  assert.equal(holdsReviews(settings, settings.members[0]!), false, 'a member whose role holds no reviews was read as a reviewer member')
})

test('#541 6b: a crew whose two closed hosts both list the reviewer model reads it', async () => {
  const settings = await declareOnHosts(acrossTwoHosts('model-r', { builder: CLAUDE_CODE, reviewer: THE_ENGINES_HOST }), BOTH_SPELL_IT)
  assert.equal(settings.house_rules.review_model, 'model-r')
})

test('#541 6b: the reviewer model one of the crew\'s hosts cannot spell is refused, naming that host (mutant: one host\'s list for both)', async () => {
  await assert.rejects(
    declareOnHosts(acrossTwoHosts('model-r', { builder: CLAUDE_CODE, reviewer: THE_ENGINES_HOST }), CLAUDE_SPELLS_IT_ONLY),
    (error: unknown) => {
      assert.ok(error instanceof DeclarationRefused, `expected a DeclarationRefused, got ${String(error)}`)
      assert.equal(error.field, 'house_rules.review_model')
      assert.ok(error.message.includes(THE_ENGINES_HOST), error.message)
      assert.ok(error.message.includes('engine-model'), error.message)
      return true
    },
  )
})

test('#541 6b: every member\'s host is held to the reviewer model, not only the reviewer member\'s (mutant: only the reviewer\'s host checked)', async () => {
  // The reviewer sits on the host that can spell the model; the builder's host cannot. A rule that reads only the
  // reviewer's host accepts this crew, and every review the builder spawns on the engine would then be held to a name
  // the engine never runs.
  await assert.rejects(
    declareOnHosts(acrossTwoHosts('model-r', { builder: THE_ENGINES_HOST, reviewer: CLAUDE_CODE }), CLAUDE_SPELLS_IT_ONLY),
    (error: unknown) => {
      assert.ok(error instanceof DeclarationRefused, `expected a DeclarationRefused, got ${String(error)}`)
      assert.equal(error.field, 'house_rules.review_model')
      assert.ok(error.message.includes(THE_ENGINES_HOST), error.message)
      return true
    },
  )
})

test('#541 6b: a member\'s host this release records no models for is refused by name (mutant: an unrecorded host read as open)', async () => {
  await assert.rejects(
    declareOnHosts(acrossTwoHosts('model-r', { builder: CLAUDE_CODE, reviewer: THE_ENGINES_HOST }), new Map([[CLAUDE_CODE, HOST_MODELS]])),
    (error: unknown) => {
      assert.ok(error instanceof DeclarationRefused, `expected a DeclarationRefused, got ${String(error)}`)
      assert.equal(error.field, 'house_rules.review_model')
      assert.ok(error.message.includes('records no models'), error.message)
      assert.ok(error.message.includes(THE_ENGINES_HOST), error.message)
      return true
    },
  )
})

test('#541 6b: a crew that names no reviewer model reads on a host this release records none for', async () => {
  const settings = await declareOnHosts(acrossTwoHosts(undefined, { builder: CLAUDE_CODE, reviewer: THE_ENGINES_HOST }), new Map([[CLAUDE_CODE, HOST_MODELS]]))
  assert.equal(settings.house_rules.review_model, null)
  assert.deepEqual(settings.members.map((member) => theHostOfMember(settings, member)), [CLAUDE_CODE, THE_ENGINES_HOST])
})

test('#541 6b: declareCrew is the one-host wrapper, and refuses a two-host crew by the host it records no models for', async () => {
  const viaWrapper = await declare(team).settings
  const viaHosts = await declareOnHosts(team, new Map([[CLAUDE_CODE, HOST_MODELS]]))
  assert.deepEqual(viaWrapper.house_rules, viaHosts.house_rules)
  assert.deepEqual(viaWrapper.members, viaHosts.members)
  assert.deepEqual(viaWrapper.mode.may, viaHosts.mode.may)
  await assert.rejects(declare(acrossTwoHosts('model-r', { builder: CLAUDE_CODE, reviewer: THE_ENGINES_HOST })).settings, (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused)
    assert.equal(error.field, 'house_rules.review_model')
    assert.ok(error.message.includes(THE_ENGINES_HOST), error.message)
    return true
  })
})

test('#541 6b: hold_reviews names the reviewer members by the act, and a role merely called reviewer holds nothing', async () => {
  const fromInit = await declare(soloDeclaration('Ann')).settings
  assert.deepEqual(reviewerMembersOf(fromInit).map((member) => member.name), ['reviewer'], 'init\'s solo crew holds no reviewer member')
  assert.equal(holdsReviews(fromInit, fromInit.members.find((member) => member.name === 'builder')!), false)
  assert.equal(THE_HOST_A_MEMBER_RAN_ON, CLAUDE_CODE)

  // A file an earlier release's init wrote names the act nowhere: it is the owner's alone, even though its member is
  // in a role called reviewer, so no member is held to a rule its declaration never named.
  const old = await declareCrew(storeOf({ [declaration_path]: DECLARED_BY_V0_1_0_TEXT }).store, root, HOST_MODELS)
  assert.deepEqual(old.mode.may[HOLD_REVIEWS], [OWNER], 'an act a declaration does not name was not read as the owner\'s alone')
  assert.deepEqual(reviewerMembersOf(old), [], 'a member in the role "reviewer" was made a reviewer member without the act')
})

test('#253: the interval a crew declares is the one its settings carry', async () => {
  assert.equal((await declare({ ...solo, channel_read_seconds: 7 }).settings).channel_read_seconds, 7)
})

// --- a crew declared before restart_member (martha#312 r=1 R1) ----------------------------------------------------

const DECLARED_BY_V0_1_0: unknown = JSON.parse(DECLARED_BY_V0_1_0_TEXT)

test('#312: a crew v0.1.0 declared is refused for nothing #312 added, and restart_member, which it never named, is the owner\'s alone', async () => {
  const settings = await declare(DECLARED_BY_V0_1_0).settings
  assert.deepEqual(settings.mode.may[RESTART_MEMBER], [OWNER])
})

test('#312: a table that names restart_member and names nobody is still refused', async () => {
  const named = DECLARED_BY_V0_1_0 as unknown as { mode: { may: Record<string, unknown> } }
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

test('#319 B test 6: a backlog that names no idle_minutes is refused, naming the field, and is never given a default', async () => {
  await refusedWith({ ...solo, [BACKLOG]: { places: ['macula-io'] } }, `${BACKLOG}.idle_minutes`)
  const { settings } = declare({ ...solo, [BACKLOG]: { places: ['macula-io'] } })
  await assert.rejects(settings, /idle_minutes is missing: a backlog names how long a member may sit idle beside unheld work, 0 for no nudge/)
})

test('#319 B: a backlog names at least one organisation or owner/repo, and a whole number of idle minutes', async () => {
  await refusedWith({ ...solo, [BACKLOG]: { places: [], idle_minutes: 30 } }, `${BACKLOG}.places`)
  await refusedWith({ ...solo, [BACKLOG]: { places: ['macula-io/martha/extra'], idle_minutes: 30 } }, `${BACKLOG}.places`)
  await refusedWith({ ...solo, [BACKLOG]: { places: ['macula-io'], idle_minutes: -1 } }, `${BACKLOG}.idle_minutes`)
  await refusedWith({ ...solo, [BACKLOG]: { places: ['macula-io'], idle_minutes: 1.5 } }, `${BACKLOG}.idle_minutes`)
  await refusedWith({ ...solo, [BACKLOG]: { places: ['macula-io'], idle_minutes: 30, every: 5 } }, `${BACKLOG}.every`)
  await refusedWith({ ...solo, [BACKLOG]: ['macula-io'] }, BACKLOG)
})

test('#319 B: a declaration without a backlog has none, and one with it reads its places and window, 0 included', async () => {
  assert.equal((await declare(solo).settings).backlog, null)
  assert.deepEqual((await declare({ ...solo, [BACKLOG]: { places: ['macula-io', 'macula-io/macula'], idle_minutes: 0 } }).settings).backlog, { places: ['macula-io', 'macula-io/macula'], idle_minutes: 0 })
})

/** A checkout of a made-up repository under a made-up home: this repository is public, so no real path appears here. */
const A_HOME = '/a-home'
const A_CLONES = join(A_HOME, CLONES)
const A_WORKTREES = join(A_HOME, WORKTREES_BESIDE_CLONES)
const A_ORIGIN = join(A_HOME, 'remote', 'acme', 'widget.git')
const A_CHECKOUT = join(A_CLONES, 'acme', 'widget')
const ITS_LAYOUT: WorkspaceLayout = { [CLONES]: A_CLONES, [WORKTREES]: A_WORKTREES }

test('#611: a checkout at <clones>/org/name keeps its clones in <clones> and its worktrees beside them', () => {
  assert.deepEqual(workspaceLayoutOf(A_CHECKOUT, 'acme/widget', A_ORIGIN), {
    layout: ITS_LAYOUT,
    said: `Workspace layout declared: clones ${A_CLONES}, worktrees ${A_WORKTREES}.`,
  })
  assert.deepEqual(workspaceLayoutOf(join(A_HOME, 'deeper', 'place', 'acme', 'widget'), 'acme/widget', A_ORIGIN).layout, {
    [CLONES]: join(A_HOME, 'deeper', 'place'),
    [WORKTREES]: join(A_HOME, 'deeper', WORKTREES_BESIDE_CLONES),
  })
})

test('#611: a checkout the origin does not place under <clones>/org/name proves no layout, and says which', () => {
  const project = join(A_HOME, 'project')
  const elsewhere = join(A_CLONES, 'other', 'widget')
  assert.deepEqual(workspaceLayoutOf(project, 'acme/widget', A_ORIGIN), {
    layout: null,
    said: `No workspace layout: ${project} does not sit at <clones>/acme/widget. ${LAYOUT_TO_ADD}`,
  })
  assert.equal(workspaceLayoutOf(elsewhere, 'acme/widget', A_ORIGIN).layout, null)
})

test('#611: a checkout whose origin is missing, or names no repository, proves no layout, and says which', () => {
  assert.deepEqual(workspaceLayoutOf(A_CHECKOUT, undefined, null), {
    layout: null,
    said: `No workspace layout: ${A_CHECKOUT} names no origin remote. ${LAYOUT_TO_ADD}`,
  })
  assert.deepEqual(workspaceLayoutOf(A_CHECKOUT, undefined, 'not a url'), {
    layout: null,
    said: `No workspace layout: the origin of ${A_CHECKOUT} names no repository as org/name. ${LAYOUT_TO_ADD}`,
  })
})

test('#611 r=2: the line names no origin URL, so a token in its userinfo is never printed', () => {
  // init prints this line, and an origin can carry a credential: `https://x-access-token:<token>@github.com/` names no
  // repository, so it lands on the branch above — the one a leak would be printed from.
  const aTokenInTheOrigin = 'https://x-access-token:ghs_plantedtoken@example.invalid/'
  const proved = workspaceLayoutOf(A_CHECKOUT, repoOfTheOrigin(aTokenInTheOrigin), aTokenInTheOrigin)
  assert.equal(proved.layout, null, 'an origin naming no repository proves no layout')
  assert.equal(proved.said, `No workspace layout: the origin of ${A_CHECKOUT} names no repository as org/name. ${LAYOUT_TO_ADD}`)
  assert.ok(!proved.said.includes('ghs_plantedtoken'), `the token in the origin reached the line init prints: ${proved.said}`)
})

test('a host that takes any model name reads any review model, and one that names its models refuses the rest', async () => {
  const declaration = { ...team, house_rules: { ...team.house_rules, review_model: 'model-the-host-cannot-spell' } }
  const { store } = storeOf({ [declaration_path]: JSON.stringify(declaration) })
  const settings = await declareCrew(store, root, OPEN_HOST)
  assert.equal(settings.house_rules.review_model, declaration.house_rules.review_model)
  await refusedWith(declaration, 'house_rules.review_model')
})
