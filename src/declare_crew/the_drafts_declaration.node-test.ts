// A declaration in the shape of Raf's draft (martha#931, issuecomment-7033712899): a mode by name, members on profiles,
// providers, harnesses, a workspace, a mesh, a terminal and an id. The values are made up: this repository is public.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import { CLAUDE, CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { GATE_ENFORCES } from '../read_the_gate_mode/read_the_gate_mode.ts'
import { OPEN_VOCABULARY } from './a_hosts_model_vocabulary.ts'
import { CLOCK_ZONE } from './the_crews_clock_zone.ts'
import {
  ACTS,
  BILLED_BY_API_KEY,
  BILLED_BY_SUBSCRIPTION,
  DECLARATION_DIRECTORY,
  DECLARATION_FILE,
  DeclarationRefused,
  ENGINE_ENDPOINT,
  GATE_ENFORCE_AS_DRAFTED,
  OWNER,
  THE_ENGINES_HOST,
  WORKTREES_BESIDE_CLONES,
  SOLO_MODE,
  declareCrew,
  soloDeclaration,
} from './declare_crew.ts'

const root = '/a-workspace'
const crew = join(root, DECLARATION_DIRECTORY)
const declaration_path = join(crew, DECLARATION_FILE)
const ANY_MODEL = { kind: OPEN_VOCABULARY, names: [] } as const

/** A crew in the draft's shape: two harnesses, two providers, two profiles, a parked member on each. */
const draft = {
  version: 1,
  id: 'a-crew',
  owner: 'Ann',
  mode: 'team',
  terminal: 'tmux',
  workspace: { root: 'clones-folder', root_allowed: ['.attic'], own_orgs: ['an-org', 'another-org'] },
  mesh: {
    realm: 'ab'.repeat(32),
    keys: '~/a-keys-folder',
    mail: { service: 'a-mail-service' },
    memory: { service: 'a-memory-service' },
    graph: { service: 'a-graph-service' },
    kanban: { service: 'a-kanban-service', on: false },
  },
  harnesses: { [CLAUDE]: { config: '~/a-config-folder' }, [THE_ENGINES_HOST]: {} },
  providers: {
    an_engine_provider: { endpoint: 'api.a-provider.test', key_file: '~/keys/a-key-file' },
    an_account: { account: 'ann@example.org', key_file: '~/keys/another-key-file', billing: BILLED_BY_SUBSCRIPTION },
  },
  profiles: {
    big: { model: 'model-big', harness: CLAUDE, provider: 'an_account', context_limit: 300000 },
    quick: { model: 'model-quick', harness: THE_ENGINES_HOST, provider: 'an_engine_provider', context_limit: 400000 },
  },
  members: [
    { name: 'Lead', role: 'supervisor', profile: 'big' },
    { name: 'Checker', role: 'reviewer', profile: 'big', parked: true },
    { name: 'Maker', role: 'builder', profile: 'quick' },
    { name: 'Sleeper', role: 'builder', profile: 'quick', parked: true },
  ],
  house_rules: { owner_items: true, [GATE_ENFORCE_AS_DRAFTED]: ['Lead'], workspace_layout: true, practice: true },
  clock_zone: 'UTC',
  thresholds: { offline_after_seconds: 31, progress_stale_minutes: 29, handover_percent: 71 },
  github: { budget_floor: 501 },
  transcripts: { launches_kept: 63, megabytes_kept: 15 },
  owner_notices: { show: ['agent_needs_input', 'agent_completed'] },
}

const declare = (declaration: unknown, also: Readonly<Record<string, string>> = {}) => {
  const { host } = hostForTests({ documents: { [declaration_path]: JSON.stringify(declaration), ...also } })
  return declareCrew(host.stores.documents, root, ANY_MODEL)
}

const refusedWith = async (declaration: unknown, field: string, why?: RegExp) => {
  await assert.rejects(declare(declaration), (error: unknown) => {
    assert.ok(error instanceof DeclarationRefused, `expected a DeclarationRefused, got ${String(error)}`)
    assert.equal(error.field, field)
    if (why !== undefined) assert.match(error.message, why)
    return true
  })
}

test('#931: a declaration in the draft\'s shape is read whole: each member on its profile\'s host and model, parked as declared', async () => {
  const settings = await declare(draft)
  assert.deepEqual(settings.members.map((member) => [member.name, member.role, member.host, member.model, member.parked]), [
    ['Lead', 'supervisor', CLAUDE_CODE, 'model-big', false],
    ['Checker', 'reviewer', CLAUDE_CODE, 'model-big', true],
    ['Maker', 'builder', THE_ENGINES_HOST, 'model-quick', false],
    ['Sleeper', 'builder', THE_ENGINES_HOST, 'model-quick', true],
  ])
})

test('#931: a mode Martha has no table for has the roles its members hold, and a table that names no act, so every act is the owner\'s', async () => {
  const { mode } = await declare({ ...draft, mode: 'a-crews-own-mode' })
  assert.equal(mode.name, 'a-crews-own-mode')
  assert.deepEqual(mode.roles, ['supervisor', 'reviewer', 'builder'])
  for (const act of ACTS) assert.deepEqual(mode.may[act], [OWNER], act)
  await refusedWith({ ...draft, mode: ' ' }, 'mode')
  await refusedWith({ ...draft, members: [{ name: 'Lead', role: OWNER, profile: 'big' }] }, 'members[0].role')
})

test('#931 (PR 939 ruling): a mode named team takes Martha\'s team table: the supervisor assigns, unparks, restarts and brings asks, reviewers hold reviews, the owner approves landings', async () => {
  const { mode } = await declare(draft)
  assert.deepEqual(mode, {
    name: 'team',
    roles: ['supervisor', 'builder', 'reviewer'],
    may: {
      assign_work: ['supervisor'],
      approve_landing: [OWNER],
      resume_parked_work: ['supervisor'],
      offer_owner_asks: ['supervisor'],
      restart_member: ['supervisor'],
      hold_reviews: ['reviewer'],
    },
  })
  await refusedWith({ ...draft, members: [{ name: 'Lead', role: 'lead', profile: 'big' }] }, 'members[0].role')
})

test('#931: the engine is reached through the provider its profiles name, a bare host on https, the key file kept as written', async () => {
  assert.deepEqual((await declare(draft)).engine_endpoint, { host: 'https://api.a-provider.test', base_path: null, key_from: null, key_file: '~/keys/a-key-file' })
  const onHttp = { ...draft, providers: { ...draft.providers, an_engine_provider: { endpoint: 'http://a-host.test:8080', key_from: 'A_KEY_VARIABLE' } } }
  assert.deepEqual((await declare(onHttp)).engine_endpoint, { host: 'http://a-host.test:8080', base_path: null, key_from: 'A_KEY_VARIABLE', key_file: null })
  const noEngineMember = { ...draft, members: draft.members.filter((member) => member.profile === 'big') }
  assert.equal((await declare(noEngineMember)).engine_endpoint, null, 'a crew with no engine member reaches no engine provider')
})

test('#931: an engine endpoint is declared in one place, and the engine reaches one provider', async () => {
  await refusedWith({ ...draft, [ENGINE_ENDPOINT]: { host: 'https://a-host.test' } }, ENGINE_ENDPOINT)
  const twoProviders = {
    ...draft,
    providers: { ...draft.providers, a_second: { endpoint: 'api.second.test' } },
    profiles: { ...draft.profiles, other: { model: 'model-other', harness: THE_ENGINES_HOST, provider: 'a_second' } },
    members: [...draft.members, { name: 'Other', role: 'builder', profile: 'other' }],
  }
  await refusedWith(twoProviders, 'profiles.other.provider', /this release reaches one provider/)
  await refusedWith({ ...draft, providers: { ...draft.providers, an_engine_provider: { endpoint: 'https://user:sk-a-key@synthetic.invalid' } } }, 'providers.an_engine_provider.endpoint')
})

test('#931: a member names its profile or its own model and host, never both, and only a profile the declaration names', async () => {
  await refusedWith({ ...draft, members: [{ name: 'Lead', role: 'supervisor', profile: 'big', model: 'model-big' }] }, 'members[0].model')
  await refusedWith({ ...draft, members: [{ name: 'Lead', role: 'supervisor', profile: 'big', host: CLAUDE_CODE }] }, 'members[0].host')
  await refusedWith({ ...draft, members: [{ name: 'Lead', role: 'supervisor', profile: 'none-such' }] }, 'members[0].profile')
  await refusedWith({ ...draft, members: [{ name: 'Lead', role: 'supervisor', profile: 'big', mesh_key: 7 }] }, 'members[0].mesh_key')
  const ownKey = await declare({ ...draft, members: [{ name: 'Lead', role: 'supervisor', profile: 'big', mesh_key: '~/a-key' }] })
  assert.equal(ownKey.members[0]!.name, 'Lead')
})

test('#931: a profile names a model, a harness and a provider the declaration names; a harness is one Martha knows', async () => {
  await refusedWith({ ...draft, profiles: { big: { ...draft.profiles.big, harness: 'none-such' } } }, 'profiles.big.harness')
  await refusedWith({ ...draft, profiles: { big: { ...draft.profiles.big, provider: 'none-such' } } }, 'profiles.big.provider')
  await refusedWith({ ...draft, profiles: { big: { ...draft.profiles.big, model: '' } } }, 'profiles.big.model')
  await refusedWith({ ...draft, profiles: { big: { ...draft.profiles.big, context_limit: 0 } } }, 'profiles.big.context_limit')
  await refusedWith({ ...draft, profiles: { big: { ...draft.profiles.big, colour: 'red' } } }, 'profiles.big.colour')
  await refusedWith({ ...draft, harnesses: { ...draft.harnesses, 'a-harness': {} } }, 'harnesses.a-harness')
  await refusedWith({ ...draft, harnesses: { [CLAUDE]: { config: 7 } } }, 'harnesses.claude.config')
  await refusedWith({ ...draft, profiles: [] }, 'profiles')
})

test('martha#916: a member is billed as its profile\'s provider declares, and by the launch\'s pick when the provider or the member names none', async () => {
  const billingOf = async (declaration: unknown) => Object.fromEntries((await declare(declaration)).members.map((member) => [member.name, member.billing]))
  const withAccount = (billing: unknown) => ({ ...draft, providers: { ...draft.providers, an_account: { ...draft.providers.an_account, billing } } })
  for (const billing of [BILLED_BY_SUBSCRIPTION, BILLED_BY_API_KEY]) {
    assert.deepEqual(await billingOf(withAccount(billing)), { Lead: billing, Checker: billing, Maker: null, Sleeper: null }, billing)
  }
  const { billing: _named, ...unbilled } = draft.providers.an_account
  assert.deepEqual(await billingOf({ ...draft, providers: { ...draft.providers, an_account: unbilled } }), { Lead: null, Checker: null, Maker: null, Sleeper: null })
  const onItsOwn = { ...draft, members: [{ name: 'Lead', role: 'supervisor', model: 'model-big', host: CLAUDE_CODE }] }
  assert.deepEqual(await billingOf(onItsOwn), { Lead: null }, 'a member that names no profile names no billing')
})

test('martha#916: a provider\'s billing is the subscription or the key, refused by field otherwise: how the host says a session was billed is not a choice', async () => {
  const withAccount = (billing: unknown) => ({ ...draft, providers: { ...draft.providers, an_account: { ...draft.providers.an_account, billing } } })
  for (const billing of ['metered', 'unknown', 'Subscription', 'key', '', null, true, [BILLED_BY_API_KEY]]) {
    await refusedWith(withAccount(billing), 'providers.an_account.billing', new RegExp(`is not one of ${BILLED_BY_SUBSCRIPTION}, ${BILLED_BY_API_KEY}$`))
  }
})

test('#931: a provider names where its key is, never the key: a variable\'s name or a path with no `..` and no space', async () => {
  const provider = (fields: Record<string, unknown>) => ({ ...draft, providers: { ...draft.providers, an_account: fields } })
  await refusedWith(provider({ key_file: '~/keys/../a-file' }), 'providers.an_account.key_file')
  await refusedWith(provider({ key_file: 'sk-a key pasted' }), 'providers.an_account.key_file', /the key itself never goes in the declaration/)
  await refusedWith(provider({ key_from: 'not a name' }), 'providers.an_account.key_from')
  await refusedWith(provider({ key_from: 'A_KEY', key_file: '/a/key-file' }), 'providers.an_account.key_file', /one place/)
  await refusedWith(provider({ billing: 'by the hour' }), 'providers.an_account.billing')
  await refusedWith(provider({ endpoint: 7 }), 'providers.an_account.endpoint')
  await refusedWith(provider({ token: 'x' }), 'providers.an_account.token')
})

test('#942: a key pasted into a provider\'s account is refused at that field, and the key is never in the refusal', async () => {
  const account = (value: string) => ({ ...draft, providers: { ...draft.providers, an_account: { ...draft.providers.an_account, account: value } } })
  const pasted = [
    ['a known key prefix, short', ['hf', 'a1b2c3'].join('_')],
    ['a long unbroken run, as a key with no known prefix is', ['sk', 'a1b2c3d4e5f6'.repeat(3)].join('-')],
    ['white space a pasted key brings', 'ann@example.org\n'],
    ['a UUID-length run that is not a UUID', 'a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6x'],
  ] as const
  for (const [shape, value] of pasted) {
    await assert.rejects(declare(account(value)), (error: unknown) => {
      assert.ok(error instanceof DeclarationRefused, `${shape}: expected a DeclarationRefused, got ${String(error)}`)
      assert.equal(error.field, 'providers.an_account.account', shape)
      assert.match(error.message, /the key itself never goes in the declaration/, shape)
      assert.ok(!error.message.includes(value.trim()), `${shape}: the refusal holds the key's text`)
      return true
    })
  }
  for (const value of ['ann.with.a.long.name.of.her.own@example.org', 'a-team-account', 'Ann', '3f2b8c1e-9a4d-4e7f-b6c2-5d8e1a0f7c93', '3F2B8C1E-9A4D-4E7F-B6C2-5D8E1A0F7C93']) {
    assert.ok((await declare(account(value))).members.length > 0, `an account written ${value} is read`)
  }
})

test('#931: gate_enforce, as the draft spells it, is read as gate_enforces, and never beside it', async () => {
  const drafted = (await declare(draft)).gate
  const { [GATE_ENFORCE_AS_DRAFTED]: _drafted, ...rules } = draft.house_rules
  assert.deepEqual(drafted, (await declare({ ...draft, house_rules: { ...rules, [GATE_ENFORCES]: ['Lead'] } })).gate)
  assert.notDeepEqual(drafted, (await declare({ ...draft, house_rules: rules })).gate, 'the drafted spelling is read, not dropped')
  await refusedWith({ ...draft, house_rules: { ...draft.house_rules, [GATE_ENFORCES]: 'all' } }, `house_rules.${GATE_ENFORCE_AS_DRAFTED}`)
})

test('#931: the workspace root places the clones under the project and the worktrees beside them, and is named in one place', async () => {
  const { house_rules } = await declare(draft)
  assert.equal(house_rules.clones, join(root, 'clones-folder'))
  assert.equal(house_rules.worktrees, join(root, WORKTREES_BESIDE_CLONES))
  await refusedWith({ ...draft, house_rules: { ...draft.house_rules, clones: '/elsewhere' } }, 'house_rules.clones')
  await refusedWith({ ...draft, workspace: { root: '../outside' } }, 'workspace.root')
  await refusedWith({ ...draft, workspace: { root: '/absolute' } }, 'workspace.root')
  await refusedWith({ ...draft, workspace: { ...draft.workspace, own_orgs: ['an org'] } }, 'workspace.own_orgs[0]')
  await refusedWith({ ...draft, workspace: { ...draft.workspace, root_allowed: ['a/b'] } }, 'workspace.root_allowed[0]')
  await refusedWith({ ...draft, workspace: { ...draft.workspace, roots: [] } }, 'workspace.roots')
})

test('#932: the crew\'s id and terminal are read as declared, and a declaration naming neither opens in kitty with no id', async () => {
  assert.deepEqual((await declare(draft)).opens, { id: 'a-crew', terminal: 'tmux' })
  assert.deepEqual((await declare({ ...draft, id: '  a-crew ', terminal: 'kitty' })).opens, { id: 'a-crew', terminal: 'kitty' })
  const { id: _id, terminal: _terminal, ...unnamed } = draft
  assert.deepEqual((await declare(unnamed)).opens, { id: null, terminal: 'kitty' })
})

test("#1016: the mesh's keys folder and each member's own mesh_key reach the settings as written, by the member's name key", async () => {
  assert.deepEqual((await declare(draft)).mesh_keys, { folder: '~/a-keys-folder', named: {} })
  const members = draft.members.map((member) => (member.name === 'Maker' ? { ...member, mesh_key: ' ~/elsewhere/maker.key ' } : member))
  assert.deepEqual((await declare({ ...draft, members })).mesh_keys, { folder: '~/a-keys-folder', named: { maker: '~/elsewhere/maker.key' } })
  const { mesh: _mesh, ...meshless } = draft
  assert.deepEqual((await declare(meshless)).mesh_keys, { folder: null, named: {} })
})

test("#1016: the mesh's realm and each service it names reach the settings, a service on unless it says false", async () => {
  const { mesh_realm, mesh_services } = await declare({ ...draft, mesh: { ...draft.mesh, graph: undefined, mail: { service: ' a-mail-service ', on: true } } })
  assert.equal(mesh_realm, draft.mesh.realm)
  assert.deepEqual(mesh_services, { mail: { service: 'a-mail-service', on: true }, memory: { service: 'a-memory-service', on: true }, kanban: { service: 'a-kanban-service', on: false } })
  const { mesh: _mesh, ...meshless } = draft
  assert.deepEqual(await declare(meshless).then(({ mesh_realm: realm, mesh_services: services }) => ({ realm, services })), { realm: null, services: {} })
})

test('#931: the mesh, the terminal and the id are checked field by field', async () => {
  await refusedWith({ ...draft, terminal: 'a-terminal' }, 'terminal')
  await refusedWith({ ...draft, id: '' }, 'id')
  await refusedWith({ ...draft, mesh: { ...draft.mesh, realm: 'abc' } }, 'mesh.realm')
  await refusedWith({ ...draft, mesh: { ...draft.mesh, chat: { service: 'x' } } }, 'mesh.chat')
  await refusedWith({ ...draft, mesh: { ...draft.mesh, kanban: { service: 'x', on: 'no' } } }, 'mesh.kanban.on')
  await refusedWith({ ...draft, mesh: { ...draft.mesh, mail: {} } }, 'mesh.mail.service')
  await refusedWith({ ...draft, mesh: { ...draft.mesh, keys: '' } }, 'mesh.keys')
})

test('#931: a declaration that names no conventions reads the crew\'s conventions.md when there is one, and none when there is not', async () => {
  const conventions = join(crew, 'conventions.md')
  assert.equal((await declare(draft, { [conventions]: '# ours' })).paths.conventions, conventions)
  assert.equal((await declare(draft)).paths.conventions, null)
  const named = join(crew, 'ours.md')
  assert.equal((await declare({ ...draft, conventions: 'ours.md' }, { [conventions]: '# ours', [named]: '# named' })).paths.conventions, named, 'a named file wins over the default')
})

test('#931: the blocks the later packages read are checked for their shape, so a misspelt field is refused by name', async () => {
  await refusedWith({ ...draft, [CLOCK_ZONE]: 7 }, CLOCK_ZONE)
  await refusedWith({ ...draft, github: { budget_floor: -1 } }, 'github.budget_floor')
  await refusedWith({ ...draft, github: { budget: 1 } }, 'github.budget')
  await refusedWith({ ...draft, transcripts: { launches_kept: 0 } }, 'transcripts.launches_kept')
  await refusedWith({ ...draft, transcripts: [] }, 'transcripts')
  await refusedWith({ ...draft, owner_notices: { show: [''] } }, 'owner_notices.show[0]')
  await refusedWith({ ...draft, owner_notices: { hide: [] } }, 'owner_notices.hide')
})

test('#931 (PR 939 ruling): a mode named solo takes the table `martha init` writes for solo, and its members hold its roles', async () => {
  const written = soloDeclaration('Ann').mode
  const solo = { ...draft, mode: SOLO_MODE, members: [{ name: 'Maker', role: 'builder', profile: 'big' }, { name: 'Checker', role: 'reviewer', profile: 'big' }], house_rules: {} }
  const { mode } = await declare(solo)
  assert.deepEqual(mode, { name: written.name, roles: [...written.roles], may: written.may })
  assert.notDeepEqual(mode.may, (await declare({ ...solo, mode: 'a-mode-martha-has-no-table-for' })).mode.may, 'the solo table is read, not the owner-only one')
  await refusedWith({ ...solo, members: [{ name: 'Lead', role: 'supervisor', profile: 'big' }] }, 'members[0].role')
})
