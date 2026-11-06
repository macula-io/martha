import assert from 'node:assert/strict'
import { dirname, join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ROW_STREAM_MOVED } from './host_contract.ts'
import { coreSources } from '../../prove_the_core/core_sources.ts'
import { COMPUTED_SPECIFIER, SCANNED_EXTENSIONS, importsBeyondTheCore, isScannedSource } from './imports_beyond_the_core.ts'
import { hostForTests } from './host_for_tests.ts'

const SRC = dirname(dirname(fileURLToPath(import.meta.url)))

// --- the contract stays what #1 decided ---------------------------------------

// The five parts are the decision on issue #1 ("Host-neutral core, one host
// contract"), pinned here on purpose: a sixth part is a design change, so it
// fails here by name and goes back to that issue instead of drifting in.
const DECIDED_PARTS = ['clock', 'delivery', 'processes', 'stores', 'tools']

test('the host contract has exactly the five parts decided on #1', () => {
  const parts = Object.keys(hostForTests().host).sort()
  const extra = parts.filter((part) => !DECIDED_PARTS.includes(part))
  const missing = DECIDED_PARTS.filter((part) => !parts.includes(part))
  assert.deepEqual({ extra, missing }, { extra: [], missing: [] })
})

test('stores are rows and documents, nothing else', () => {
  assert.deepEqual(Object.keys(hostForTests().host.stores).sort(), ['documents', 'rows'])
})

// --- the core reaches a coding tool only through the contract -----------------

const sourcesUnder = coreSources

// This file plants imports in strings below, so it is the one file the scan
// leaves out, found by its own path rather than by a name written here.
const THIS_FILE = relative(SRC, fileURLToPath(import.meta.url))

test('no file in the core imports anything but its own slices and Node', () => {
  const core = sourcesUnder(SRC).filter((source) => source.path !== THIS_FILE)
  assert.ok(core.length > 1, 'the scan read the core')
  assert.deepEqual(importsBeyondTheCore(core), [])
})

test('a planted import of a coding tool is named, with its file', () => {
  const planted = [
    { path: 'a/static.ts', text: "import { tool } from '@opencode-ai/plugin'" },
    { path: 'a/type_only.ts', text: "import type { Hooks } from '@anthropic-ai/claude-code'" },
    { path: 'a/bare.ts', text: "import 'some-host-runtime'" },
    { path: 'a/dynamic.ts', text: "const sdk = await import('@opencode-ai/sdk')" },
    { path: 'a/required.ts', text: "const sdk = require('some-host-sdk')" },
    { path: 'a/reexport.ts', text: "export * from 'host-api'" },
    { path: 'a/template.ts', text: 'const sdk = await import(`@opencode-ai/sdk`)' },
    { path: 'a/computed.ts', text: 'const sdk = await import(name)' },
    { path: 'a/fine.ts', text: "import { join } from 'node:path'\nimport { x } from '../b/b.ts'" },
  ]
  assert.deepEqual(importsBeyondTheCore(planted), [
    { path: 'a/static.ts', specifier: '@opencode-ai/plugin' },
    { path: 'a/type_only.ts', specifier: '@anthropic-ai/claude-code' },
    { path: 'a/bare.ts', specifier: 'some-host-runtime' },
    { path: 'a/dynamic.ts', specifier: '@opencode-ai/sdk' },
    { path: 'a/required.ts', specifier: 'some-host-sdk' },
    { path: 'a/reexport.ts', specifier: 'host-api' },
    { path: 'a/template.ts', specifier: '@opencode-ai/sdk' },
    { path: 'a/computed.ts', specifier: `${COMPUTED_SPECIFIER}name)` },
  ])
})

test('the scan reads every kind of script file, not only .ts', () => {
  const names = sourcesUnder(SRC).map((source) => source.path)
  assert.ok(names.every((name) => SCANNED_EXTENSIONS.some((extension) => name.endsWith(extension))))
  for (const extension of ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']) {
    assert.ok(isScannedSource(`a/b${extension}`), extension)
  }
  assert.equal(isScannedSource('a/b.md'), false)
})

test('the contract itself imports nothing: every slice depends on it, never the reverse', () => {
  const contract = sourcesUnder(SRC).find((source) => source.path === join('host_contract', 'host_contract.ts'))
  assert.ok(contract, 'the contract was read')
  assert.doesNotMatch(contract.text, /^\s*import\b/m)
})

// --- rows are append only -----------------------------------------------------

test('rows can only be appended and read: there is no way to rewrite or remove one', () => {
  const rows = hostForTests().host.stores.rows
  assert.deepEqual(Object.keys(rows).sort(), ['append', 'read'])
})

test('each append lands at the next position of its stream, and reads come back in order', async () => {
  const rows = hostForTests().host.stores.rows
  assert.equal(await rows.append('one', { n: 1 }), 0)
  assert.equal(await rows.append('two', { n: 1 }), 0)
  assert.equal(await rows.append('one', { n: 2 }), 1)
  assert.deepEqual(await rows.read('one'), [
    { position: 0, row: { n: 1 } },
    { position: 1, row: { n: 2 } },
  ])
  assert.deepEqual(await rows.read('never_written'), [])
})

test('a row read back cannot be changed in the store through the copy', async () => {
  const rows = hostForTests().host.stores.rows
  const row = { n: 1 }
  await rows.append('one', row)
  row.n = 2
  const [first] = await rows.read('one')
  assert.deepEqual(first?.row, { n: 1 })
})

test('an append that expects the stream at a length lands only at that length', async () => {
  const rows = hostForTests().host.stores.rows
  assert.equal(await rows.append('one', { n: 1 }, 0), 0)
  await assert.rejects(rows.append('one', { n: 2 }, 0), { code: ROW_STREAM_MOVED })
  assert.equal(await rows.append('one', { n: 2 }, 1), 1)
  assert.equal((await rows.read('one')).length, 2)
})

test('a store told to refuse the next append refuses it, then works again', async () => {
  const { host, refuseNextAppend } = hostForTests()
  refuseNextAppend('disk full')
  await assert.rejects(host.stores.rows.append('one', { n: 1 }), /disk full/)
  assert.equal(await host.stores.rows.append('one', { n: 1 }), 0)
})

// --- documents ------------------------------------------------------------------

test('a document is read as text, and a missing one rejects with ENOENT', async () => {
  const { host } = hostForTests({ documents: { '/crew/declaration.json': '{"mode":"solo"}' } })
  assert.equal(await host.stores.documents.read('/crew/declaration.json'), '{"mode":"solo"}')
  await assert.rejects(host.stores.documents.read('/crew/absent.json'), { code: 'ENOENT' })
})

test('a test can see every document read, in order, missing ones included', async () => {
  const { host, documentsRead } = hostForTests({ documents: { '/crew/a': 'a' } })
  await host.stores.documents.read('/crew/a')
  await host.stores.documents.read('/crew/b').catch(() => undefined)
  await host.stores.documents.read('/crew/a')
  assert.deepEqual(documentsRead(), ['/crew/a', '/crew/b', '/crew/a'])
})

// --- the other parts --------------------------------------------------------------

test('the clock tells the time it is set to', () => {
  const { host, advanceClock } = hostForTests({ now: 1_000 })
  assert.equal(host.clock.now(), 1_000)
  advanceClock(500)
  assert.equal(host.clock.now(), 1_500)
})

test('a process runs through the runner the test gives, and its outcome comes back whole', async () => {
  const { host } = hostForTests({
    run: async ({ command, args }) => ({ exit_code: 0, stdout: `${command} ${args.join(' ')}`, stderr: '' }),
  })
  assert.deepEqual(await host.processes.run({ command: 'git', args: ['status'], cwd: '/work' }), {
    exit_code: 0,
    stdout: 'git status',
    stderr: '',
  })
})

test('a host with no runner refuses to run a process rather than inventing an outcome', async () => {
  await assert.rejects(hostForTests().host.processes.run({ command: 'git', args: [], cwd: '/work' }), /no process runner/)
})

test('a turn handed to the model is delivered, and an arriving turn reaches every listener', async () => {
  const { host, turnsHandedToModel, arrive } = hostForTests()
  await host.delivery.handToModel('carry on')
  assert.deepEqual(turnsHandedToModel(), ['carry on'])

  const heard: string[] = []
  host.delivery.onTurn((turn) => heard.push(`first:${turn.text}`))
  host.delivery.onTurn((turn) => heard.push(`second:${turn.text}`))
  arrive({ text: 'hello', arrival: { source: 'crew_room' } })
  assert.deepEqual(heard, ['first:hello', 'second:hello'])
})

test('a tool is registered once; a second tool by the same name is refused', async () => {
  const { host, registeredTool } = hostForTests()
  host.tools.register({ name: 'note_milestone', description: 'keeps a milestone', answer: async () => 'kept' })
  assert.throws(
    () => host.tools.register({ name: 'note_milestone', description: 'again', answer: async () => 'again' }),
    /already registered: note_milestone/,
  )
  assert.equal(await registeredTool('note_milestone')?.answer({}), 'kept')
})
