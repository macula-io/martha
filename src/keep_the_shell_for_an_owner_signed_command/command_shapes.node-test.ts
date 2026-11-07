import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fixtureKey, signLikeAHardwareKey } from '../trust_only_signed_lists/sign_like_a_hardware_key.ts'
import { COMMAND_SHAPES_KIND, TRUST_LIST_NAMESPACE, type EpochStore, type OpenedEpoch } from '../trust_only_signed_lists/trust_only_signed_lists.ts'
import { SHAPE_NAME, openCommandShapes, type CommandShapesToOpen } from './command_shapes.ts'

// Synthetic crew and remote, never real ones: this repository is public.
const crew = 'a-crew'
const now = new Date('2026-11-06T12:00:00Z')
const owner = fixtureKey()
const base = { remote_url: 'https://example.invalid/owner/project.git', branch: 'main' }
const test_shape = { name: 'test', argv: ['npm', 'test'] }

const epochStore = (): EpochStore => {
  const seen = new Map<string, OpenedEpoch>()
  return { newest: (c, k) => seen.get(`${c}/${k}`), keep: (c, k, opened) => void seen.set(`${c}/${k}`, opened) }
}

const documentOf = (body: unknown, overrides: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({ crew, kind: COMMAND_SHAPES_KIND, epoch: 1, issued_at: '2026-11-01T00:00:00Z', expires_at: '2026-12-01T00:00:00Z', body, ...overrides }),
  )

const open = (body: unknown, overrides: Partial<CommandShapesToOpen> = {}) => {
  const document = documentOf(body)
  return openCommandShapes({
    document,
    signature: signLikeAHardwareKey(owner, document, { namespace: TRUST_LIST_NAMESPACE }),
    pinned_keys: [owner.line],
    crew,
    now,
    epochs: epochStore(),
    ...overrides,
  })
}

const opensEmpty = (opened: ReturnType<typeof open>, why: RegExp) => {
  assert.equal(opened.trusted, false)
  assert.deepEqual(opened.shapes, [])
  assert.equal(opened.base, undefined)
  if (!opened.trusted) assert.match(opened.why, why)
}

test('a signed list of command shapes opens to its base and its shapes', () => {
  const opened = open({ base, shapes: [test_shape, { name: 'lint', argv: ['npm', 'run', 'lint'] }] })
  assert.equal(opened.trusted, true)
  assert.deepEqual(opened.base, base)
  assert.deepEqual(opened.shapes, [test_shape, { name: 'lint', argv: ['npm', 'run', 'lint'] }])
})

test('an unsigned, unpinned or missing list knows no shape', () => {
  const document = documentOf({ base, shapes: [test_shape] })
  opensEmpty(open({ base, shapes: [test_shape] }, { signature: undefined }), /not signed/)
  opensEmpty(open({ base, shapes: [test_shape] }, { document: undefined }), /no document/)
  const stranger = fixtureKey()
  const by_stranger = signLikeAHardwareKey(stranger, document, { namespace: TRUST_LIST_NAMESPACE })
  opensEmpty(open({ base, shapes: [test_shape] }, { document, signature: by_stranger }), /not pinned/)
})

test('a node-id list signed by the owner is not a list of command shapes', () => {
  const document = documentOf({ base, shapes: [test_shape] }, { kind: 'policy' })
  const signature = signLikeAHardwareKey(owner, document, { namespace: TRUST_LIST_NAMESPACE })
  opensEmpty(open({ base, shapes: [test_shape] }, { document, signature }), /policy/)
})

test('two shapes of one name open as no shape at all', () => {
  opensEmpty(open({ base, shapes: [test_shape, { name: 'test', argv: ['npm', 'run', 'other'] }] }), /two shapes named test/)
})

test('a body with another field, or without the base, knows no shape', () => {
  opensEmpty(open({ base, shapes: [test_shape], env: {} }), /base and shapes and nothing else/)
  opensEmpty(open({ shapes: [test_shape] }), /base and shapes and nothing else/)
})

test('a base must name a remote url git fetches without running a command, and a plain branch', () => {
  const refused: readonly Record<string, unknown>[] = [
    { ...base, remote_url: 'ext::sh -c touch% /tmp/x' },
    { ...base, remote_url: 'https://example.invalid/x.git --upload-pack=x' },
    { ...base, remote_url: '' },
    { ...base, branch: '-main' },
    { ...base, branch: 'a..b' },
    { ...base, branch: 'refs/heads/main' },
    { ...base, branch: 'main', extra: 1 },
    { remote_url: base.remote_url },
  ]
  for (const bad of refused) opensEmpty(open({ base: bad, shapes: [test_shape] }), /base/)
})

test('a shape name is a short plain word, and its argv a list of plain strings', () => {
  const refused: readonly unknown[] = [
    { name: 'Test', argv: ['npm', 'test'] },
    { name: 'test run', argv: ['npm', 'test'] },
    { name: 'x'.repeat(33), argv: ['npm', 'test'] },
    { name: 'test', argv: [] },
    { name: 'test', argv: ['', 'test'] },
    { name: 'test', argv: ['npm', 1] },
    { name: 'test', argv: ['npm', 'te\u0000st'] },
    { name: 'test', argv: 'npm test' },
    { name: 'test', argv: ['npm', 'test'], cwd: '/' },
  ]
  for (const bad of refused) opensEmpty(open({ base, shapes: [bad] }), /shape/)
  assert.match('test', SHAPE_NAME)
  assert.match('a'.repeat(32), SHAPE_NAME)
})
