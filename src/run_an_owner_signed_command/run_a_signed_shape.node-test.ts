import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { openState, ownWritesKeptIn } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { INSTALLED_LOCK, LOCK, LOCKFILE_VERSION, MANIFEST } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { gitBlobIdOf, OWN_WRITE_MODES } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { runASignedShape, RUNS_DIRECTORY, type ShapeToRun } from './run_a_signed_shape.ts'
import { skipWithoutTheSandbox } from './sandbox_under_test.ts'

const [REGULAR] = OWN_WRITE_MODES
const unavailable = skipWithoutTheSandbox()
const MARKER = 'stranger-marker-129'
const GIT_ENV = { PATH: process.env['PATH'] ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' }
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' }).trim()

// One dependency, `tool`, with two bin names, pinned by the base lock and installed to match it.
const TOOL = { version: '1.0.0', resolved: 'https://registry.example.invalid/tool-1.0.0.tgz', integrity: 'sha512-tool', bin: { tool: 'cli.sh', 'tool-too': 'cli.sh' } }
const lockOf = (packages: Record<string, unknown>) => JSON.stringify({ name: 'p', lockfileVersion: LOCKFILE_VERSION, packages })
const BASE_FILES = {
  '.gitignore': 'node_modules/\n',
  [MANIFEST]: JSON.stringify({ name: 'p', version: '1.0.0', scripts: { test: 'tool && tool-too && cat a.txt && ls -a' } }),
  [LOCK]: lockOf({ '': { name: 'p', version: '1.0.0' }, 'node_modules/tool': TOOL }),
  'a.txt': 'the owner wrote this\n',
}

/** A remote holding BASE_FILES on main, a clone with `tool` installed, and a state directory; removed after. */
function place(t: { after(fn: () => void): void }) {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'martha-129-shape-')))
  t.after(() => rmSync(top, { recursive: true, force: true }))
  const remote = join(top, 'remote')
  mkdirSync(remote)
  git(remote, 'init', '--quiet', '--initial-branch=main')
  for (const [path, text] of Object.entries(BASE_FILES)) writeFileSync(join(remote, path), text)
  git(remote, 'add', '-A')
  git(remote, 'commit', '--quiet', '-m', `base ${MARKER}`)
  const checkout = join(top, 'checkout')
  git(top, 'clone', '--quiet', remote, checkout)
  mkdirSync(join(checkout, 'node_modules/tool'), { recursive: true })
  writeFileSync(join(checkout, 'node_modules/tool/cli.sh'), '#!/bin/sh\necho "$(basename "$0")-ran"\n')
  writeFileSync(join(checkout, 'node_modules/tool/package.json'), JSON.stringify({ name: 'tool', version: TOOL.version }))
  writeFileSync(join(checkout, INSTALLED_LOCK), lockOf({ 'node_modules/tool': TOOL }))
  const state_root = join(top, 'state')
  mkdirSync(state_root, { mode: 0o700 })
  const state = openState(state_root, checkout)
  if ('refusal' in state) throw new Error(state.refusal)
  const run: ShapeToRun = {
    state,
    checkout,
    base: { remote_url: `file://${remote}`, branch: 'main' },
    shapes: [{ name: 'test', argv: ['npm', 'test'] }],
    name: 'test',
    inherited: { PATH: GIT_ENV.PATH, HOME: top },
  }
  return { top, checkout, state, run }
}

const said = (ended: Awaited<ReturnType<typeof runASignedShape>>) => (typeof ended === 'string' ? ended : ended.output.toString('utf8'))

test('a checkout equal to its signed base runs the shape on a copy: both bin names, the files, and no repository', { skip: unavailable }, async (t) => {
  const p = place(t)
  const ended = await runASignedShape(p.run)
  assert.ok(typeof ended !== 'string', String(ended))
  assert.equal(ended.status, 0, said(ended))
  const output = said(ended)
  assert.match(output, /tool-ran\ntool-too-ran\nthe owner wrote this\n/)
  assert.equal(/^\.git$/m.test(output), false, output)
  assert.equal(output.includes(MARKER), false, output)
})

test('a failing shape ends with its own status', { skip: unavailable }, async (t) => {
  const p = place(t)
  const ended = await runASignedShape({ ...p.run, shapes: [{ name: 'test', argv: ['/bin/sh', '-c', 'exit 1'] }] })
  assert.ok(typeof ended !== 'string', String(ended))
  assert.equal(ended.status, 1)
})

test('a name the owner did not sign runs nothing', { skip: unavailable }, async (t) => {
  const p = place(t)
  assert.match(String(await runASignedShape({ ...p.run, name: 'other' })), /signed no shape named other/)
})

test('a file neither base nor own write runs nothing, and is named; written through the registry, it runs', { skip: unavailable }, async (t) => {
  const p = place(t)
  writeFileSync(join(p.checkout, 'planted.txt'), MARKER)
  assert.match(String(await runASignedShape(p.run)), /nothing ran: planted\.txt/)
  const refused = ownWritesKeptIn(p.state).append({
    path: join(p.checkout, 'planted.txt'),
    blob: gitBlobIdOf(Buffer.from(MARKER), 'sha1'),
    mode: REGULAR,
    tool: 'Write',
    tool_use_id: 'toolu_01',
    session: 's',
    launch: 'l',
    recorded_at: new Date().toISOString(),
  })
  assert.equal(refused, undefined)
  const ended = await runASignedShape(p.run)
  assert.ok(typeof ended !== 'string', String(ended))
  assert.equal(ended.status, 0)
})

test('an own write of another checkout does not vouch for a file at the same path here', { skip: unavailable }, async (t) => {
  const p = place(t)
  writeFileSync(join(p.checkout, 'planted.txt'), MARKER)
  const elsewhere = { path: join(p.top, 'elsewhere', 'planted.txt'), blob: gitBlobIdOf(Buffer.from(MARKER), 'sha1'), mode: REGULAR, tool: 'Write', tool_use_id: 't', session: 's', launch: 'l', recorded_at: new Date().toISOString() } as const
  assert.equal(ownWritesKeptIn(p.state).append(elsewhere), undefined)
  assert.match(String(await runASignedShape(p.run)), /nothing ran: planted\.txt/)
})

test('a test script redefined in the checkout runs nothing, even written by the member', { skip: unavailable }, async (t) => {
  const p = place(t)
  const manifest = JSON.stringify({ name: 'p', version: '1.0.0', scripts: { test: `echo ${MARKER}` } })
  writeFileSync(join(p.checkout, MANIFEST), manifest)
  assert.equal(ownWritesKeptIn(p.state).append({ path: join(p.checkout, MANIFEST), blob: gitBlobIdOf(Buffer.from(manifest), 'sha1'), mode: REGULAR, tool: 'Edit', tool_use_id: 't', session: 's', launch: 'l', recorded_at: new Date().toISOString() }), undefined)
  const ended = await runASignedShape(p.run)
  assert.equal(typeof ended, 'string')
  assert.match(String(ended), new RegExp(MANIFEST.replace('.', '\\.')))
  assert.equal(String(ended).includes(MARKER), false)
})

test('a package directory the installed lock does not hold runs nothing, and is named', { skip: unavailable }, async (t) => {
  const p = place(t)
  mkdirSync(join(p.checkout, 'node_modules/@types/marker'), { recursive: true })
  writeFileSync(join(p.checkout, 'node_modules/@types/marker/index.d.ts'), MARKER)
  assert.match(String(await runASignedShape(p.run)), /@types\/marker/)
})

test('the run directory is gone once the run ends', { skip: unavailable }, async (t) => {
  const p = place(t)
  await runASignedShape(p.run)
  const runs = join(p.state.directory, RUNS_DIRECTORY)
  assert.deepEqual(execFileSync('ls', ['-A', runs], { encoding: 'utf8' }), '')
  assert.ok(readFileSync(join(p.checkout, 'a.txt')).length > 0)
})
