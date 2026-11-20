// `martha up` (martha#511): a team declared at a workspace that is no git checkout, read back by the reader, and a
// second command adding only its own missing members.
//
// Real directories under a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ACTS, APPROVE_LANDING, CLONES, DECLARATION_DIRECTORY, DECLARATION_FILE, declareCrewOnHosts, HOLD_REVIEWS, HOST, OWNER, THE_ENGINES_HOST, theHostOfMember, WORKSPACE_LAYOUT, WORKTREES, WORKTREES_BESIDE_CLONES } from '../declare_crew/declare_crew.ts'
import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import { CLAUDE_CODE_MODELS } from '../claude_code_host/claude_code_host.ts'
import { hostRuns } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { MEMBERS_FILE, openState, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { THE_VOCABULARIES_OF_HOST } from '../start_the_member_on_its_host/start_the_member_on_its_host.ts'
import {
  A_WORKSPACES_CLONES,
  BUILDER_ROLE,
  CLAUDE_CODE_TEAM,
  CLAUDE_CODE_TEAM_MODEL,
  CLAUDE_CODE_WORKERS,
  declareTheTeam,
  SUPERVISOR_ROLE,
  TEAM_MODE,
  type TeamMember,
  type TeamRequest,
} from './declare_a_team_at_a_workspace.ts'

const documents = { read: (path: string) => readFile(path, 'utf8') }

/** The engine's members as the other command would add them: names and a model of this test's own. */
const ENGINE_MEMBERS: readonly TeamMember[] = ['engine-a', 'engine-b'].map((name) => ({ name, role: BUILDER_ROLE, model: 'an-engine-model', host: THE_ENGINES_HOST }))

/** A workspace under a temporary home, no git checkout, with a clones folder when `clones` says so. */
function workspaceFor(t: TestContext, clones: boolean): { root: string; state: MarthaState } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-511-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'work')
  mkdirSync(root)
  if (clones) mkdirSync(join(root, A_WORKSPACES_CLONES))
  const state = openState(join(home, 'state'), root)
  assert.ok('directory' in state)
  return { root, state }
}

const requestFor = (root: string, state: MarthaState, seed: readonly TeamMember[], owner: string | null = 'Ada Owner'): TeamRequest => ({ root, owner, state, documents, vocabularies: THE_VOCABULARIES_OF_HOST, host: CLAUDE_CODE, seed })

test('#511: up --claude declares a team at a folder that is no checkout: a Supervisor and three workers, each on Claude Code running Opus', async (t) => {
  const { root, state } = workspaceFor(t, false)
  const declared = await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM))
  assert.ok(declared.declared, declared.declared ? '' : declared.refusal)
  assert.equal(declared.wrote, true)

  const settings = await declareCrewOnHosts(documents, root, THE_VOCABULARIES_OF_HOST)
  assert.equal(settings.owner, 'Ada Owner')
  assert.equal(settings.mode.name, TEAM_MODE)
  assert.deepEqual(settings.members.map((member) => member.name), [SUPERVISOR_ROLE, 'opus-1', 'opus-2', 'opus-3'])
  assert.equal(settings.members.filter((member) => member.role === SUPERVISOR_ROLE).length, 1)
  assert.equal(settings.members.filter((member) => member.role === BUILDER_ROLE).length, CLAUDE_CODE_WORKERS)
  for (const member of settings.members) {
    assert.equal(theHostOfMember(settings, member), CLAUDE_CODE, member.name)
    assert.equal(member.model, CLAUDE_CODE_TEAM_MODEL, member.name)
  }
  // The model is one Claude Code's own vocabulary spells, so the host is asked for a model it runs.
  assert.ok(hostRuns(CLAUDE_CODE_MODELS, CLAUDE_CODE_TEAM_MODEL))
})

test('#511: the team table: the Supervisor beside the owner on every act but a landing, which is the owner\'s alone; builders hold reviews', async (t) => {
  const { root, state } = workspaceFor(t, false)
  assert.ok((await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM))).declared)
  const settings = await declareCrewOnHosts(documents, root, THE_VOCABULARIES_OF_HOST)
  for (const act of ACTS) {
    const expected = act === APPROVE_LANDING ? [OWNER] : act === HOLD_REVIEWS ? [OWNER, BUILDER_ROLE] : [OWNER, SUPERVISOR_ROLE]
    assert.deepEqual(settings.mode.may[act], expected, act)
  }
})

test('#511: a workspace with a clones folder declares its layout, the worktrees beside it; one without declares none', async (t) => {
  const withClones = workspaceFor(t, true)
  assert.ok((await declareTheTeam(requestFor(withClones.root, withClones.state, CLAUDE_CODE_TEAM))).declared)
  const written = JSON.parse(readFileSync(join(withClones.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as { house_rules: Record<string, unknown> }
  assert.deepEqual(written.house_rules, { [WORKSPACE_LAYOUT]: true, [CLONES]: join(withClones.root, A_WORKSPACES_CLONES), [WORKTREES]: join(withClones.root, WORKTREES_BESIDE_CLONES) })

  const without = workspaceFor(t, false)
  assert.ok((await declareTheTeam(requestFor(without.root, without.state, CLAUDE_CODE_TEAM))).declared)
  const bare = JSON.parse(readFileSync(join(without.root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as Record<string, unknown>
  assert.equal(Object.hasOwn(bare, 'house_rules'), false)
})

test('#511: a second up --claude adds nothing and leaves the file byte for byte', async (t) => {
  const { root, state } = workspaceFor(t, true)
  assert.ok((await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM))).declared)
  const file = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const before = readFileSync(file, 'utf8')
  const again = await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM))
  assert.ok(again.declared, again.declared ? '' : again.refusal)
  assert.equal(again.wrote, false)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('#511: the declaration is the config: a later run with another seed adds nothing, and the file is left byte for byte', async (t) => {
  const { root, state } = workspaceFor(t, false)
  assert.ok((await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM))).declared)
  const file = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const before = readFileSync(file, 'utf8')
  const later = await declareTheTeam({ ...requestFor(root, state, ENGINE_MEMBERS), host: THE_ENGINES_HOST })
  assert.ok(later.declared, later.declared ? '' : later.refusal)
  assert.equal(later.wrote, false)
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.deepEqual(later.settings.members.map((member) => member.name), CLAUDE_CODE_TEAM.map((member) => member.name))
})

test('#511: a member the owner removed and a model the owner changed stay as the owner left them', async (t) => {
  const { root, state } = workspaceFor(t, false)
  assert.ok((await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM))).declared)
  const file = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  const declared = JSON.parse(readFileSync(file, 'utf8')) as { members: { name: string; model: string }[] }
  const edited = `${JSON.stringify({ ...declared, members: declared.members.slice(0, -1).map((member) => ({ ...member, model: 'sonnet' })) }, null, 2)}\n`
  writeFileSync(file, edited)
  const again = await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM))
  assert.ok(again.declared, again.declared ? '' : again.refusal)
  assert.equal(readFileSync(file, 'utf8'), edited)
  assert.deepEqual(again.settings.members.map((member) => [member.name, member.model]), [[SUPERVISOR_ROLE, 'sonnet'], ['opus-1', 'sonnet'], ['opus-2', 'sonnet']])
})

test('#511: a first run seeded with both hosts\' members declares each on its own host', async (t) => {
  const { root, state } = workspaceFor(t, false)
  const declared = await declareTheTeam(requestFor(root, state, [...CLAUDE_CODE_TEAM, ...ENGINE_MEMBERS]))
  assert.ok(declared.declared, declared.declared ? '' : declared.refusal)
  const settings = await declareCrewOnHosts(documents, root, THE_VOCABULARIES_OF_HOST)
  assert.deepEqual(settings.members.filter((member) => theHostOfMember(settings, member) === THE_ENGINES_HOST).map((member) => member.name), ENGINE_MEMBERS.map((member) => member.name))
  assert.deepEqual(settings.members.filter((member) => theHostOfMember(settings, member) === CLAUDE_CODE).map((member) => member.name), CLAUDE_CODE_TEAM.map((member) => member.name))
  const written = JSON.parse(readFileSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as { members: Record<string, unknown>[] }
  for (const member of written.members) assert.ok(typeof member[HOST] === 'string', String(member['name']))
})

test('#511: every member the first run seeds has a node id kept in Martha\'s state, none of them in the workspace', async (t) => {
  const { root, state } = workspaceFor(t, false)
  assert.ok((await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM))).declared)
  // Read from the file itself: nodeIdsFor would make an id that is missing, and so prove nothing about this run.
  const kept = JSON.parse(readFileSync(join(state.directory, MEMBERS_FILE), 'utf8')) as Record<string, string>
  const declaration = readFileSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')
  for (const member of CLAUDE_CODE_TEAM) {
    const id = kept[member.name]
    assert.ok(id !== undefined && NODE_ID.test(id) && !declaration.includes(id), member.name)
  }
})

test('#511: with no owner name in git, nothing is written and the refusal says how to set one', async (t) => {
  const { root, state } = workspaceFor(t, false)
  const declared = await declareTheTeam(requestFor(root, state, CLAUDE_CODE_TEAM, null))
  assert.equal(declared.declared, false)
  assert.ok(!declared.declared && declared.refusal.includes('git config user.name'))
  assert.throws(() => readFileSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)))
})
