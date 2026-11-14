import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ROW_STREAM_MOVED, readingOnly } from './host_contract.ts'
import { coreSources } from '../../prove_the_core/core_sources.ts'
import { SCANNED_EXTENSIONS, isScannedSource } from './core_source.ts'
import { moduleReferencesOf } from '../../prove_the_core/parse_a_source.ts'
import { hostForTests } from './host_for_tests.ts'
import { claudeCodeToolNames, openCodeToolNames } from './tool_names_for_tests.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'

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

// The crew's own store is #254 R1's, reached here rather than by a path a slice names
// (martha#255): a slice keeps a handover or a park marker through it and never imports
// the glue that writes one, which prove_the_core/only_the_launcher_writes_launch_records
// holds it to. The title gained "the crew's own (#255)" for it: the base's copy named the
// five stores and said nothing else was there, which is no longer true of this contract.
// The commit that carries this comment names the title it replaced, in the trailer the
// dropped-title check keeps in one file, which is how a title changed on purpose is recorded.
test('stores are rows, documents, the launcher\'s records (#42), files and scratch (#26), the crew\'s own (#255), nothing else', () => {
  assert.deepEqual(Object.keys(hostForTests().host.stores).sort(), ['crew', 'documents', 'files', 'launches', 'rows', 'scratch'])
})

// The launcher's records name which member a pid is, so a slice that could write
// one could have its own deliveries attributed to another member (#42). The type
// gives slices `all` only; these prove the object they hold has nothing more.
test('the launcher\'s records a slice is handed have no writing member, however it is reached', () => {
  const { host, launcherRecords } = hostForTests({ launches: [{ key: 'Pluto', row: { member_name: 'Pluto' } }] })
  const held: object = host.stores.launches

  assert.deepEqual(Reflect.ownKeys(held), ['all'])
  assert.equal(Reflect.get(held, 'keep'), undefined)
  assert.equal(Reflect.get(held, 'drop'), undefined)
  assert.equal(Object.values(held).length, 1)
  assert.ok(Object.isFrozen(held))
  assert.throws(() => Object.assign(held, { keep: launcherRecords.keep }))
  assert.equal(Object.getPrototypeOf(held), Object.prototype)

  // It reads the very records the launcher writes.
  launcherRecords.keep('Neptunus', { member_name: 'Neptunus' })
  assert.deepEqual(host.stores.launches.all().map(({ key }) => key).sort(), ['Neptunus', 'Pluto'])
})

test('readingOnly keeps only the reading member of whatever store it is given', () => {
  const store = { all: () => [], keep: () => undefined, drop: () => undefined }
  assert.deepEqual(Reflect.ownKeys(readingOnly(store)), ['all'])
})

// --- the core reaches a coding tool only through the contract -----------------

const sourcesUnder = coreSources

// Which imports the core may make is judged in prove_the_core/imports_beyond_the_core.ts,
// from the syntax tree; what is pinned here is the walk and the contract's own imports.

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
  assert.deepEqual(moduleReferencesOf(contract.text, contract.path), [])
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
  assert.deepEqual(await host.processes.run({ command: 'git', args: ['status'], cwd: '/a-run-tree' }), {
    exit_code: 0,
    stdout: 'git status',
    stderr: '',
  })
})

test('a host with no runner refuses to run a process rather than inventing an outcome', async () => {
  await assert.rejects(hostForTests().host.processes.run({ command: 'git', args: [], cwd: '/a-run-tree' }), /no process runner/)
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

test('with no files, scratch or runner given, the test host refuses every read, directory and run (#26)', () => {
  const { host } = hostForTests()
  assert.throws(() => host.stores.files.kindOf('/a-run-tree'), /no file tree/)
  assert.throws(() => host.stores.files.bytesOf('/a-run-tree'), /no file tree/)
  assert.throws(() => host.stores.files.childrenOf('/a-run-tree'), /no file tree/)
  assert.throws(() => host.stores.files.realPathOf('/a-run-tree'), /no file tree/)
  assert.throws(() => host.stores.scratch.make(null, 'x-'), /no scratch place/)
  assert.throws(() => host.processes.runNow({ command: 'git', args: [], cwd: '/a-run-tree' }), /no process runner/)
})

test('the files, scratch and runner a test gives are the ones the host uses (#26)', () => {
  const outcome = { exit_code: 0, stdout: 'ran', stderr: '' }
  const { host } = hostForTests({
    files: { kindOf: () => ({ kind: 'absent' }), bytesOf: () => new Uint8Array(), childrenOf: () => ['a'], realPathOf: () => '/real' },
    scratch: { make: (root, prefix) => ({ path: `${root ?? '/tmp'}/${prefix}1`, write: (name) => name, remove: () => undefined }) },
    runNow: () => outcome,
  })
  assert.deepEqual(host.stores.files.kindOf('/a-run-tree'), { kind: 'absent' })
  assert.deepEqual(host.stores.files.childrenOf('/a-run-tree'), ['a'])
  assert.equal(host.stores.files.realPathOf('/a-run-tree'), '/real')
  assert.equal(host.stores.scratch.make(null, 'x-').path, '/tmp/x-1')
  assert.equal(host.processes.runNow({ command: 'git', args: [], cwd: '/a-run-tree' }), outcome)
})

// --- a called tool's own name is the host's to give (martha#2, item 5 (b)) ---

test('tools are registering and naming a called tool, nothing else', () => {
  assert.deepEqual(Object.keys(hostForTests().host.tools).sort(), ['ownNameOf', 'register'])
})

test("the test host names a called tool by the host's split it is given", () => {
  const { host } = hostForTests({ toolNames: openCodeToolNames(['macula']) })
  assert.equal(host.tools.ownNameOf('macula_mesh_read_inbox'), 'mesh_read_inbox')
  assert.equal(hostForTests({ toolNames: claudeCodeToolNames }).host.tools.ownNameOf('mcp__x__mesh_say'), 'mesh_say')
  // A server name may hold __ (the host only replaces characters outside [A-Za-z0-9_-]): the last __ splits.
  assert.equal(claudeCodeToolNames.ownNameOf('mcp__macula__x__mesh_read_inbox'), 'mesh_read_inbox')
})

test("a test host given no split uses Claude Code's, so a core test cannot fail open by forgetting it", () => {
  assert.equal(hostForTests().host.tools.ownNameOf('mcp__macula__mesh_read_inbox'), 'mesh_read_inbox')
})

test("OpenCode's split strips the longest server name that matches, in any order", () => {
  for (const servers of [['macula', 'macula_mcp'], ['macula_mcp', 'macula']]) {
    const names = openCodeToolNames(servers)
    assert.equal(names.ownNameOf('macula_mcp_mesh_read_inbox'), 'mesh_read_inbox', servers.join())
    assert.equal(names.ownNameOf('macula_mesh_read_inbox'), 'mesh_read_inbox', servers.join())
  }
})

test('each split keeps a built-in tool its own name, and splits only its own form', () => {
  const openCode = openCodeToolNames(['macula', 'macula-mcp'])
  for (const names of [claudeCodeToolNames, openCode]) assert.equal(names.ownNameOf(CLAUDE_CODE_SHELL_TOOL), CLAUDE_CODE_SHELL_TOOL)
  assert.equal(claudeCodeToolNames.ownNameOf('mcp__plugin_macula-mcp_macula__mesh_read_inbox'), 'mesh_read_inbox')
  assert.equal(openCode.ownNameOf('macula-mcp_mesh_read_inbox'), 'mesh_read_inbox')
  assert.equal(openCode.ownNameOf('unknown_mesh_read_inbox'), 'unknown_mesh_read_inbox')
})
