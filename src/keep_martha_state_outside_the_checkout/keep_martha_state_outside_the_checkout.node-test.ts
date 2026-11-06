// Martha's own state for a project lives outside the checkout, closed to everyone but the owner (martha#98).
//
// Real directories under a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import {
  appendApproval,
  APPROVALS_FILE,
  MEMBERS_FILE,
  nodeIdsFor,
  openState,
  readApprovals,
  STATE_DIRECTORY_MODE,
  STATE_FILE_MODE,
  type Approval,
  type MarthaState,
} from './keep_martha_state_outside_the_checkout.ts'

const PERMISSIONS = 0o777

function homeFor(t: TestContext): { home: string; project: string; stateRoot: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-state-')))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const project = join(home, 'project')
  mkdirSync(project)
  return { home, project, stateRoot: join(home, 'state', 'martha') }
}

function opened(stateRoot: string, project: string): MarthaState {
  const state = openState(stateRoot, project)
  assert.ok('directory' in state, 'refusal' in state ? state.refusal : '')
  return state
}

test('the state directory is made outside the project, closed to everyone but the owner', (t) => {
  const { project, stateRoot } = homeFor(t)
  const state = opened(stateRoot, project)
  assert.ok(!state.directory.startsWith(project), 'the state is not inside the checkout')
  assert.equal(lstatSync(stateRoot).mode & PERMISSIONS, STATE_DIRECTORY_MODE)
  assert.equal(lstatSync(state.directory).mode & PERMISSIONS, STATE_DIRECTORY_MODE)
  assert.equal(opened(stateRoot, project).directory, state.directory, 'the same project has the same state')
})

test('two projects never share a state directory', (t) => {
  const { home, project, stateRoot } = homeFor(t)
  const other = join(home, 'other')
  mkdirSync(other)
  assert.notEqual(opened(stateRoot, project).directory, opened(stateRoot, other).directory)
})

test('a state directory others may write is refused by name', (t) => {
  const { project, stateRoot } = homeFor(t)
  const state = opened(stateRoot, project)
  chmodSync(state.directory, 0o777)
  const again = openState(stateRoot, project)
  assert.ok('refusal' in again)
  assert.ok(again.refusal.includes(state.directory), again.refusal)
})

test('a state directory that is a link is refused by name', (t) => {
  const { home, project, stateRoot } = homeFor(t)
  const state = opened(stateRoot, project)
  rmSync(state.directory, { recursive: true })
  const elsewhere = join(home, 'elsewhere')
  mkdirSync(elsewhere, { mode: STATE_DIRECTORY_MODE })
  symlinkSync(elsewhere, state.directory)
  const again = openState(stateRoot, project)
  assert.ok('refusal' in again)
  assert.ok(again.refusal.includes(state.directory), again.refusal)
})

test('each member gets a node id of its own, kept closed, and keeps it', (t) => {
  const { project, stateRoot } = homeFor(t)
  const state = opened(stateRoot, project)
  const first = nodeIdsFor(state, ['builder', 'reviewer'])
  assert.ok('ids' in first, 'refusal' in first ? first.refusal : '')
  for (const id of Object.values(first.ids)) assert.match(id, NODE_ID)
  assert.equal(first.ids['builder'], first.ids['builder']?.toLowerCase())
  assert.notEqual(first.ids['builder'], first.ids['reviewer'])
  assert.equal(lstatSync(join(state.directory, MEMBERS_FILE)).mode & PERMISSIONS, STATE_FILE_MODE)

  const again = nodeIdsFor(state, ['builder', 'reviewer', 'third'])
  assert.ok('ids' in again)
  assert.equal(again.ids['builder'], first.ids['builder'])
  assert.equal(again.ids['reviewer'], first.ids['reviewer'])
  assert.match(again.ids['third'] ?? '', NODE_ID)
})

test('a members file others may read is refused by name, and nothing is written over it', (t) => {
  const { project, stateRoot } = homeFor(t)
  const state = opened(stateRoot, project)
  assert.ok('ids' in nodeIdsFor(state, ['builder']))
  const file = join(state.directory, MEMBERS_FILE)
  chmodSync(file, 0o644)
  const before = readFileSync(file, 'utf8')
  const again = nodeIdsFor(state, ['builder', 'reviewer'])
  assert.ok('refusal' in again)
  assert.ok(again.refusal.includes(file), again.refusal)
  assert.equal(readFileSync(file, 'utf8'), before)
})

const anApproval = (fingerprint: string): Approval => ({
  fingerprint,
  approved_at: '2026-11-06T23:59:00.000Z',
  entries: [{ path: '.mcp.json', kind: 'file', sha256: 'a'.repeat(64) }],
  tree: 'b'.repeat(40),
})

test('approvals are kept one per line, closed, and read back in order', (t) => {
  const { project, stateRoot } = homeFor(t)
  const state = opened(stateRoot, project)
  assert.deepEqual(readApprovals(state), { approvals: [] })
  appendApproval(state, anApproval('1'.repeat(64)))
  appendApproval(state, anApproval('2'.repeat(64)))
  const read = readApprovals(state)
  assert.ok('approvals' in read)
  assert.deepEqual(read.approvals.map((approval) => approval.fingerprint), ['1'.repeat(64), '2'.repeat(64)])
  assert.equal(lstatSync(join(state.directory, APPROVALS_FILE)).mode & PERMISSIONS, STATE_FILE_MODE)
})

test('an approvals file that is not one approval per line is refused by name, never read in part', (t) => {
  const { project, stateRoot } = homeFor(t)
  const state = opened(stateRoot, project)
  appendApproval(state, anApproval('1'.repeat(64)))
  const file = join(state.directory, APPROVALS_FILE)
  writeFileSync(file, `${readFileSync(file, 'utf8')}not json\n`)
  const read = readApprovals(state)
  assert.ok('refusal' in read)
  assert.ok(read.refusal.includes(file), read.refusal)
})
