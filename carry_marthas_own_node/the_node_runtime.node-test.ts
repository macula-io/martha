// The pinned Node and the command of a standalone Martha (martha#547, package S3).
//
// The pin is held to where its version comes from: at or above the engines floor Martha declares, and on the Node line
// every workflow of this repository runs. The sha256 reader is held to nodejs.org's own list shape, and the command is
// run through the links an install makes, with a stand-in node that names what it was asked to run.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { COMMAND_FOLDER, namesAtHead, RUNTIME_FOLDER, theCommand } from './assemble_a_standalone_martha.ts'
import { hashesFrom } from './record_the_node_runtime.ts'
import { archiveOf, PLATFORMS, platformOf, theNodeRuntime, type NodeRuntime } from './the_node_runtime.ts'

const CHECKOUT = join(import.meta.dirname, '..')
const read = (path: string): string => readFileSync(join(CHECKOUT, path), 'utf8')

const numbers = (version: string): number[] => version.split('.').map(Number)
function atLeast(version: string, floor: string): boolean {
  const [a, b] = [numbers(version), numbers(floor)]
  const differs = a.findIndex((part, at) => part !== b[at])
  return differs === -1 || (a[differs] ?? 0) > (b[differs] ?? 0)
}

function pinned(): NodeRuntime {
  const runtime = theNodeRuntime()
  assert.ok(!('refusal' in runtime), 'refusal' in runtime ? runtime.refusal : '')
  return runtime
}

test('the pinned Node is at or above the engines floor of Martha and of its installer', () => {
  for (const manifest of ['package.json', 'installer/package.json']) {
    const floor = (JSON.parse(read(manifest)) as { engines: { node: string } }).engines.node.replace(/^>=\s*/, '')
    assert.ok(atLeast(pinned().version, floor), `${manifest} asks for node ${floor}; the pin is ${pinned().version}`)
  }
})

test('the pinned Node is on the Node line every workflow runs', () => {
  const workflows = readdirSync(join(CHECKOUT, '.github', 'workflows')).map((file) => read(join('.github', 'workflows', file)))
  const lines = new Set(workflows.flatMap((text) => [...text.matchAll(/node-version:\s*'?(\d+)/g)].map((found) => found[1])))
  assert.deepEqual([...lines], [String(numbers(pinned().version)[0])])
})

test('a SHASUMS256.txt is read to the pin, and a platform missing from it is named', () => {
  const { version, archives } = pinned()
  const list = PLATFORMS.map((platform) => `${archives[platform].sha256}  ${archiveOf(version, platform).file}`)
  assert.deepEqual(hashesFrom([`${'0'.repeat(64)}  node-v${version}.tar.gz`, ...list].join('\n'), version), { archives })
  assert.deepEqual(hashesFrom(list.slice(1).join('\n'), version), { missing: [PLATFORMS[0]] })
})

test('a recording without a version or a hash is refused', () => {
  assert.deepEqual(theNodeRuntime(JSON.stringify({ ...pinned(), version: 'v24' })), { refusal: 'the recording names no X.Y.Z version' })
  const { version, archives } = pinned()
  assert.deepEqual(theNodeRuntime(JSON.stringify({ version, archives: { ...archives, [PLATFORMS[1]]: { sha256: 'f00' } } })), { refusal: `the recording holds no sha256 for ${PLATFORMS[1]}` })
})

test('only the four platforms are made', () => {
  for (const platform of PLATFORMS) assert.equal(platformOf(...(platform.split('-') as [string, string])), platform)
  assert.deepEqual(platformOf('win32', 'x64'), { refusal: 'a standalone Martha is not made for win32-x64' })
})

test("the names are the installer's and the version is the root package's", () => {
  const names = (JSON.parse(read('installer/package.json')) as { martha: { command: string; releaseFolder: string } }).martha
  assert.deepEqual(namesAtHead(read), { command: names.command, folder: names.releaseFolder, version: (JSON.parse(read('package.json')) as { version: string }).version })
})

test('the command runs Martha with the Node beside it, through an absolute and a relative link, and with CDPATH set', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-standalone-'))
  t.after(() => removeTheTree(dir))
  const release = join(dir, 'release')
  const folder = 'the-tree'
  for (const sub of [join(RUNTIME_FOLDER, 'bin'), join(folder, 'bin'), COMMAND_FOLDER, 'links']) mkdirSync(join(release, sub), { recursive: true })
  writeFileSync(join(release, RUNTIME_FOLDER, 'bin', 'node'), '#!/bin/sh\necho "$0|$*"\n')
  chmodSync(join(release, RUNTIME_FOLDER, 'bin', 'node'), 0o755)
  writeFileSync(join(release, COMMAND_FOLDER, 'cmd'), theCommand(folder))
  chmodSync(join(release, COMMAND_FOLDER, 'cmd'), 0o755)
  symlinkSync(join(release, COMMAND_FOLDER, 'cmd'), join(dir, 'absolute'))
  symlinkSync(join('..', COMMAND_FOLDER, 'cmd'), join(release, 'links', 'relative'))
  // A path relative to the working directory, with CDPATH naming that directory: cd finds the release through CDPATH
  // and prints it, so a command that did not empty CDPATH would hold that line twice and start no node.
  const throughCdpath = { cwd: dir, env: { ...process.env, CDPATH: dir } }
  const launches: readonly (readonly [string, { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv }])[] = [
    [join(release, COMMAND_FOLDER, 'cmd'), {}],
    [join(dir, 'absolute'), {}],
    [join(release, 'links', 'relative'), {}],
    [join('release', COMMAND_FOLDER, 'cmd'), throughCdpath],
    [join('release', 'links', 'relative'), throughCdpath],
  ]
  for (const [command, options] of launches) {
    const ran = spawnSync(command, ['--version', 'two words'], { encoding: 'utf8', ...options })
    const real = spawnSync('/bin/sh', ['-c', 'cd "$1" && pwd -P', 'sh', release], { encoding: 'utf8' }).stdout.trim()
    assert.equal(ran.stdout, `${real}/${RUNTIME_FOLDER}/bin/node|${real}/${folder}/bin/martha --version two words\n`, command)
  }
})
