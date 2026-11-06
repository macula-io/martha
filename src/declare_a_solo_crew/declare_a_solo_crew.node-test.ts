// `martha init`: a solo crew of two, declared in the shape declareCrew reads, never over an existing one (martha#98).
//
// Real directories under a temporary home. Everything a test makes is removed after it.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { ACTS, DECLARATION_DIRECTORY, DECLARATION_FILE, declareCrew, OWNER } from '../declare_crew/declare_crew.ts'
import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import { nodeIdsFor, openState, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { declareSoloCrew, SOLO_MEMBERS } from './declare_a_solo_crew.ts'

const documents = { read: (path: string) => readFile(path, 'utf8') }

function placeFor(t: TestContext): { root: string; state: MarthaState } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-init-')))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = join(home, 'project')
  mkdirSync(root)
  const state = openState(join(home, 'state'), root)
  assert.ok('directory' in state)
  return { root, state }
}

test('init declares a solo crew of a builder and a reviewer that declareCrew reads, the owner may do every act', async (t) => {
  const { root, state } = placeFor(t)
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', state, documents })
  assert.ok(declared.declared, declared.declared ? '' : declared.refusal)

  const settings = await declareCrew(documents, root)
  assert.equal(settings.owner, 'Ada Owner')
  assert.deepEqual(settings.members.map((member) => member.name), SOLO_MEMBERS.map((member) => member.name))
  for (const act of ACTS) assert.deepEqual(settings.mode.may[act], [OWNER], act)
})

test('init gives each member a node id, outside the checkout, that the owner never types', async (t) => {
  const { root, state } = placeFor(t)
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', state, documents })
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
  const declared = await declareSoloCrew({ root, owner: 'Ada Owner', state, documents })
  assert.equal(declared.declared, false)
  assert.ok(!declared.declared && declared.refusal.includes(file), declared.declared ? '' : declared.refusal)
  assert.equal(readFileSync(file, 'utf8'), '{"the owner": "wrote this"}')
})

test('init with no owner name refuses, saying how to set one, and writes nothing', async (t) => {
  const { root, state } = placeFor(t)
  const declared = await declareSoloCrew({ root, owner: null, state, documents })
  assert.equal(declared.declared, false)
  assert.match(declared.declared ? '' : declared.refusal, /git config user\.name/)
  assert.equal(existsSync(join(root, DECLARATION_DIRECTORY)), false)
})

test('init refuses a declaration directory that is a link, naming it, and writes nothing where it points', async (t) => {
  const { root, state } = placeFor(t)
  const elsewhere = join(root, '..', 'elsewhere')
  mkdirSync(elsewhere)
  symlinkSync(elsewhere, join(root, DECLARATION_DIRECTORY))
  const outcome = await declareSoloCrew({ root, owner: 'Ada Owner', state, documents })
  assert.equal(outcome.declared, false)
  const refusal = outcome.declared ? '' : outcome.refusal
  assert.ok(refusal.includes(join(root, DECLARATION_DIRECTORY)), refusal)
  assert.deepEqual(readdirSync(elsewhere), [])
})

test('init refuses a declaration path that is a file, naming it, rather than throwing', async (t) => {
  const { root, state } = placeFor(t)
  writeFileSync(join(root, DECLARATION_DIRECTORY), 'not a directory\n')
  const outcome = await declareSoloCrew({ root, owner: 'Ada Owner', state, documents })
  assert.equal(outcome.declared, false)
  assert.ok(!outcome.declared && outcome.refusal.includes(join(root, DECLARATION_DIRECTORY)), outcome.declared ? '' : outcome.refusal)
})
