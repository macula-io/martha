// `martha init`: a solo crew of two, declared in the shape declareCrew reads, never over an existing one (martha#98).
//
// Real directories under a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ACTS, CLONES, DECLARATION_DIRECTORY, DECLARATION_FILE, declareCrew, HOLD_REVIEWS, HOST, LAYOUT_TO_ADD, OWNER, THE_ENGINES_HOST, WORKTREES, WORKTREES_BESIDE_CLONES, type WorkspaceLayout } from '../declare_crew/declare_crew.ts'
import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import type { ProcessOutcome, ProcessRequest } from '../host_contract/host_contract.ts'
import { hostForTests } from '../host_contract/host_for_tests.ts'
import { nodeIdsFor, openState, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { openAWorktree } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { declareSoloCrew } from './declare_a_solo_crew.ts'
import { SOLO_MEMBERS } from '../declare_crew/declare_crew.ts'
import { CLOSED_VOCABULARY, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'

/** The models this test's host runs (martha#315): the vocabulary a declaration's review_model is read against. */
const HOST_MODELS: ModelVocabulary = { kind: CLOSED_VOCABULARY, names: ['opus', 'fable'] }

const documents = { read: (path: string) => readFile(path, 'utf8') }

function placeFor(t: TestContext): { root: string; state: MarthaState } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-init-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'project')
  mkdirSync(root)
  const state = openState(join(home, 'state'), root)
  assert.ok('directory' in state)
  return { root, state }
}

test('init declares a solo crew of a builder and a reviewer that declareCrew reads, the owner may do every act', async (t) => {
  const { root, state } = placeFor(t)
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.ok(declared.declared, declared.declared ? '' : declared.refusal)

  const settings = await declareCrew(documents, root, HOST_MODELS)
  assert.equal(settings.owner, 'Ada Owner')
  assert.deepEqual(settings.members.map((member) => member.name), SOLO_MEMBERS.map((member) => member.name))
  // Every act is the owner's alone, except `hold_reviews`: the solo crew's reviewer role holds it too, so the reviewer's
  // own session is the review (martha#541 package 6b).
  const reviewer = SOLO_MEMBERS[1]!
  for (const act of ACTS) assert.deepEqual(settings.mode.may[act], act === HOLD_REVIEWS ? [OWNER, reviewer.role] : [OWNER], act)
})

test('#541: init writes the crew-level host the install names, no member host, and the file reads back with it', async (t) => {
  const { root, state } = placeFor(t)
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', origin: null, state, documents, models: HOST_MODELS, host: THE_ENGINES_HOST })
  assert.ok(declared.declared, declared.declared ? '' : declared.refusal)
  // The file itself, not only what the reader makes of it: the key is written where an owner reads it.
  const written = JSON.parse(readFileSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')) as Record<string, unknown>
  assert.equal(written[HOST], THE_ENGINES_HOST)
  const settings = await declareCrew(documents, root, HOST_MODELS)
  assert.equal(settings.host, THE_ENGINES_HOST)
  // Init writes no per-member host: a mixed crew adds one to the member it wants elsewhere.
  for (const member of settings.members) assert.equal(member.host, null, member.name)
})

test('init gives each member a node id, outside the checkout, that the owner never types', async (t) => {
  const { root, state } = placeFor(t)
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.ok(declared.declared)
  const ids = nodeIdsFor(state, SOLO_MEMBERS.map((member) => member.name))
  assert.ok('ids' in ids)
  for (const member of SOLO_MEMBERS) assert.match(ids.ids[member.name] ?? '', NODE_ID, member.name)
  const declaration = readFileSync(join(root, DECLARATION_DIRECTORY, DECLARATION_FILE), 'utf8')
  for (const id of Object.values(ids.ids)) assert.ok(!declaration.includes(id), 'no node id is in the checkout')
})

test('init refuses to overwrite a declaration, naming it, and leaves it as it was', async (t) => {
  const { root, state } = placeFor(t)
  const file = join(root, DECLARATION_DIRECTORY, DECLARATION_FILE)
  mkdirSync(join(root, DECLARATION_DIRECTORY))
  writeFileSync(file, '{"the owner": "wrote this"}')
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.equal(declared.declared, false)
  assert.ok(!declared.declared && declared.refusal.includes(file), declared.declared ? '' : declared.refusal)
  assert.equal(readFileSync(file, 'utf8'), '{"the owner": "wrote this"}')
})

test('init with no owner name refuses, saying how to set one, and writes nothing', async (t) => {
  const { root, state } = placeFor(t)
  const declared = await declareSoloCrew({ root, owner: null, origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.equal(declared.declared, false)
  assert.match(declared.declared ? '' : declared.refusal, /git config user\.name/)
  assert.equal(existsSync(join(root, DECLARATION_DIRECTORY)), false)
})

test('init refuses a declaration directory that is a link, naming it, and writes nothing where it points', async (t) => {
  const { root, state } = placeFor(t)
  const elsewhere = join(root, '..', 'elsewhere')
  mkdirSync(elsewhere)
  symlinkSync(elsewhere, join(root, DECLARATION_DIRECTORY))
  const outcome = await declareSoloCrew({ root, owner: 'Ada Owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.equal(outcome.declared, false)
  const refusal = outcome.declared ? '' : outcome.refusal
  assert.ok(refusal.includes(join(root, DECLARATION_DIRECTORY)), refusal)
  assert.deepEqual(readdirSync(elsewhere), [])
})

test('init refuses a declaration path that is a file, naming it, rather than throwing', async (t) => {
  const { root, state } = placeFor(t)
  writeFileSync(join(root, DECLARATION_DIRECTORY), 'not a directory\n')
  const outcome = await declareSoloCrew({ root, owner: 'Ada Owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.equal(outcome.declared, false)
  assert.ok(!outcome.declared && outcome.refusal.includes(join(root, DECLARATION_DIRECTORY)), outcome.declared ? '' : outcome.refusal)
})

/** The repository the case's origin names, and the slug of the worktree it opens: the fixture's own two values. */
const REPO_OF_THE_CASE = 'acme/widget'
const SLUG_OF_THE_CASE = 'greet'

/**
 * A checkout at `<clones>/acme/widget`, cloned from a bare origin at `<home>/remote/acme/widget.git`: the shape init's
 * layout is read from, where the checkout's own path ends in the repository its origin names (martha#611).
 */
function aCheckoutUnderItsOrigin(t: TestContext): { home: string; clone: string; origin: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-init-')))
  t.after(() => removeTheTree(home))
  const remote = join(home, 'remote', 'acme')
  mkdirSync(remote, { recursive: true })
  const origin = join(remote, 'widget.git')
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  const seed = join(home, 'seed')
  mkdirSync(seed)
  execFileSync('git', ['init', '--quiet', '--initial-branch=main'], { cwd: seed })
  writeFileSync(join(seed, 'README.md'), '# widget\n')
  execFileSync('git', ['add', '-A'], { cwd: seed })
  execFileSync('git', ['-c', 'user.name=Ann', '-c', 'user.email=ann@example.invalid', 'commit', '--quiet', '-m', 'the first commit'], { cwd: seed })
  execFileSync('git', ['remote', 'add', 'origin', origin], { cwd: seed })
  execFileSync('git', ['push', '--quiet', '-u', 'origin', 'main'], { cwd: seed })
  mkdirSync(join(home, CLONES, 'acme'), { recursive: true })
  const clone = join(home, CLONES, 'acme', 'widget')
  execFileSync('git', ['clone', '--quiet', origin, clone])
  return { home, clone, origin }
}

/** A real git, so the worktree this case opens is one git really made. */
const runReal = async (request: ProcessRequest): Promise<ProcessOutcome> => {
  const outcome = spawnSync(request.command, [...request.args], { cwd: request.cwd, encoding: 'utf8' })
  return { exit_code: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr }
}

test('init declares the workspace layout its checkout proves, and a member opens a worktree in it with no hand edit', async (t) => {
  const { home, clone, origin } = aCheckoutUnderItsOrigin(t)
  const state = openState(join(home, 'state'), clone)
  assert.ok('directory' in state)
  const declared = await declareSoloCrew({ root: clone, owner: 'Ada Owner', origin, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.ok(declared.declared, declared.declared ? '' : declared.refusal)

  const layout: WorkspaceLayout = { [CLONES]: join(home, CLONES), [WORKTREES]: join(home, WORKTREES_BESIDE_CLONES) }
  const settings = await declareCrew(documents, clone, HOST_MODELS)
  assert.equal(settings.house_rules.workspace_layout, true)
  assert.equal(settings.house_rules.clones, layout.clones)
  assert.equal(settings.house_rules.worktrees, layout.worktrees)
  assert.equal(declared.workspace, `Workspace layout declared: clones ${layout.clones}, worktrees ${layout.worktrees}.`)

  const builder = SOLO_MEMBERS[0].name
  const test_host = hostForTests({ run: runReal })
  const opened = await openAWorktree(
    {
      host: { processes: test_host.host.processes, clock: test_host.host.clock, stores: { rows: test_host.host.stores.rows } },
      settings,
      member: builder,
    },
    { repo: REPO_OF_THE_CASE, slug: SLUG_OF_THE_CASE },
  )
  const at = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: clone, encoding: 'utf8' }).trim()
  const worktree = join(layout.worktrees, `widget-${SLUG_OF_THE_CASE}`)
  assert.ok('told' in opened, 'told' in opened ? '' : opened.refused)
  assert.equal(opened.told, `opened ${worktree} on ${builder}/${SLUG_OF_THE_CASE}, from origin/main at ${at}`)
  assert.ok(existsSync(worktree))
})

test('init declares no layout for a checkout its origin does not place under <clones>/<org>/<name>, and says what to add', async (t) => {
  const { root, state } = placeFor(t)
  const origin = join(root, '..', 'remote', 'acme', 'widget.git')
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', origin, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.ok(declared.declared, declared.declared ? '' : declared.refusal)
  const settings = await declareCrew(documents, root, HOST_MODELS)
  assert.equal(settings.house_rules.workspace_layout, false)
  assert.equal(settings.house_rules.clones, null)
  assert.equal(settings.house_rules.worktrees, null)
  assert.equal(declared.workspace, `No workspace layout: ${root} does not sit at <clones>/${REPO_OF_THE_CASE}. ${LAYOUT_TO_ADD}`)
})

test('init declares no layout for a checkout with no origin, and says what to add', async (t) => {
  const { root, state } = placeFor(t)
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', origin: null, state, documents, models: HOST_MODELS, host: CLAUDE_CODE })
  assert.ok(declared.declared, declared.declared ? '' : declared.refusal)
  assert.equal((await declareCrew(documents, root, HOST_MODELS)).house_rules.workspace_layout, false)
  assert.equal(declared.workspace, `No workspace layout: ${root} names no origin remote. ${LAYOUT_TO_ADD}`)
})
