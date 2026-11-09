import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { openState, STATE_FILE_MODE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { ED25519 } from '../trust_only_signed_lists/ssh_signature.ts'
import { fixtureKey, signLikeAHardwareKey } from '../trust_only_signed_lists/sign_like_a_hardware_key.ts'
import { COMMAND_SHAPES_KIND, TRUST_LIST_NAMESPACE } from '../trust_only_signed_lists/trust_only_signed_lists.ts'
import { EPOCHS_FILE, epochsKeptIn, keepCommandShapes, openKeptCommandShapes, pinnedOwnerKeys, pinOwnerKey, projectOf } from './keep_what_the_owner_signed.ts'

// A synthetic remote, never a real one: this repository is public.
const now = new Date('2026-11-06T12:00:00Z')
const owner = fixtureKey()
const body = { base: { remote_url: 'https://example.invalid/owner/project.git', branch: 'main' }, shapes: [{ name: 'test', argv: ['npm', 'test'] }] }

/** A project's state directory, fresh; removed after. */
function stateOf(t: { after(fn: () => void): void }, name = 'checkout') {
  const top = mkdtempSync(join(tmpdir(), 'martha-129-signed-'))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  const checkout = join(top, name)
  mkdirSync(checkout)
  const state_root = join(top, 'state')
  mkdirSync(state_root, { mode: 0o700, recursive: true })
  const state = openState(state_root, checkout)
  if ('refusal' in state) throw new Error(state.refusal)
  return { top, state }
}

const signed = (crew: string, epoch = 1) => {
  const document = Buffer.from(JSON.stringify({ crew, kind: COMMAND_SHAPES_KIND, epoch, issued_at: '2026-11-01T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', body }))
  return { document, signature: signLikeAHardwareKey(owner, document, { namespace: TRUST_LIST_NAMESPACE }) }
}

test('a list signed for this project by a pinned hardware key is kept, and opens from the state on every read', (t) => {
  const { state } = stateOf(t)
  assert.equal(pinOwnerKey(state, owner.line), undefined)
  const { document, signature } = signed(projectOf(state))
  assert.equal(keepCommandShapes(state, document, signature, now).trusted, true)
  const opened = openKeptCommandShapes(state, now)
  assert.equal(opened.trusted, true)
  assert.deepEqual(opened.shapes, body.shapes)
  assert.deepEqual(opened.base, body.base)
})

test('only a hardware key is pinned, once', (t) => {
  const { state } = stateOf(t)
  assert.match(String(pinOwnerKey(state, fixtureKey(ED25519).line)?.refusal), /only a hardware key/)
  assert.match(String(pinOwnerKey(state, 'not a key')?.refusal), /not an OpenSSH public key/)
  assert.equal(pinOwnerKey(state, owner.line), undefined)
  assert.match(String(pinOwnerKey(state, owner.line)?.refusal), /pinned already/)
  assert.deepEqual(pinnedOwnerKeys(state), { keys: [owner.line] })
})

test('with no key pinned, or no list kept, no shape opens', (t) => {
  const { state } = stateOf(t)
  const { document, signature } = signed(projectOf(state))
  assert.match(String((keepCommandShapes(state, document, signature, now) as { why?: string }).why), /no key is pinned/)
  pinOwnerKey(state, owner.line)
  assert.match(String((openKeptCommandShapes(state, now) as { why?: string }).why), /no document/)
})

test('a list signed for another checkout opens empty here, and is not kept', (t) => {
  const { state } = stateOf(t)
  pinOwnerKey(state, owner.line)
  const { document, signature } = signed('0'.repeat(64))
  assert.match(String((keepCommandShapes(state, document, signature, now) as { why?: string }).why), /another crew/)
  assert.match(String((openKeptCommandShapes(state, now) as { why?: string }).why), /no document/)
})

test('an older epoch is refused across processes: the newest opened is kept in the state', (t) => {
  const { state } = stateOf(t)
  pinOwnerKey(state, owner.line)
  const newer = signed(projectOf(state), 2)
  assert.equal(keepCommandShapes(state, newer.document, newer.signature, now).trusted, true)
  const older = signed(projectOf(state), 1)
  // A fresh store over the same state stands for a restarted launcher.
  assert.deepEqual(epochsKeptIn(state).newest(projectOf(state), COMMAND_SHAPES_KIND)?.epoch, 2)
  assert.match(String((keepCommandShapes(state, older.document, older.signature, now) as { why?: string }).why), /older|epoch/)
  assert.equal(openKeptCommandShapes(state, now).trusted, true)
})

test('an epochs file that is not one opens nothing, never reads as nothing opened yet', (t) => {
  const { state } = stateOf(t)
  pinOwnerKey(state, owner.line)
  const { document, signature } = signed(projectOf(state))
  keepCommandShapes(state, document, signature, now)
  writeFileSync(join(state.directory, EPOCHS_FILE), '{"x":', { mode: STATE_FILE_MODE })
  const opened = openKeptCommandShapes(state, now)
  assert.equal(opened.trusted, false)
  assert.match(String((opened as { why?: string }).why), /epochs Martha keeps/)
})
