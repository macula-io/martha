// `martha install` runs the installer the release pins, and refuses in words when it cannot (martha#84, T12 to T17).
//
// Every refusal names what failed, and is proved to happen before anything is fetched: the npm a test puts in front
// of the act writes a mark when it runs, and a refusal must leave no mark. The installer itself is a stand-in the
// fake registry serves, so a test can see the words it was given, the exit status it chose, and what it found in its
// own installed tree.

import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { fakeNpmRegistry, sha512Of, type FakePackage, type FakeRegistry } from '../run_the_nodes_own_npm_alone/fake_npm_registry.ts'
import { INSTALLER_ENTRY, installThePinnedInstaller, PIN_FILE, TEMP_DIR_PREFIX, type InstallOutcome, type InstallRequest, type Pin } from './install_the_pinned_installer.ts'

const NAME = '@martha-installer-pin/fixture'
const VERSION = '1.0.0'
const OTHER = '@martha-installer-pin/other'

/** The package the fake registry serves as the pinned installer: it reports its words, its tree and its exit. */
const installerPackage = (): FakePackage => ({
  name: NAME,
  version: VERSION,
  bin: { 'martha-install': INSTALLER_ENTRY },
  files: {
    [INSTALLER_ENTRY]: [
      "import { existsSync, writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "const out = process.env['MARTHA_TEST_OUT']",
      "const bundle = existsSync(join(import.meta.dirname, '..', 'node_modules', 'inner', 'package.json'))",
      "if (out) writeFileSync(out, JSON.stringify({ args: process.argv.slice(2), bundle }))",
      "process.stdout.write('the installer spoke on stdout\\n')",
      "process.stderr.write('the installer spoke on stderr\\n')",
      "process.exit(Number(process.env['MARTHA_TEST_EXIT'] ?? 0))",
      '',
    ].join('\n'),
    'node_modules/inner/package.json': JSON.stringify({ name: 'inner', version: VERSION }),
    'node_modules/inner/index.js': 'export const inner = 1\n',
  },
  bundledDependencies: ['inner'],
})

const scratch = (t: TestContext, what: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `martha-pinned-${what}-`))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * What another run of this suite leaves in the shared temporary directory while this one goes: a directory named
 * as this run names its own, made by a neighbour and not by the run that reads these words.
 */
function aNeighbourRunsHere(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), `${TEMP_DIR_PREFIX}neighbour-`))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * How this run's own work directory is named, which no neighbour's is: the installer's prefix, this tree's name,
 * a dash. `tree` comes from scratch(), a mkdtempSync, so its basename belongs to this case alone.
 */
const thisRunsWorkDirectory = (tree: string): string => `${TEMP_DIR_PREFIX}${basename(tree)}-`

/** The entries in a directory that are named with `prefix`, which for this run's own name must be none. */
const entriesNamed = (inDirectory: string, prefix: string): string[] =>
  readdirSync(inDirectory).filter((entry) => entry.startsWith(prefix))

/**
 * The run's own temporary directory (martha#270): named for this case's tree, there while the run goes, and gone
 * once the run has answered. The name is the half that needs no hook -- a neighbour's directory has its own tree's
 * name, so it can neither be mistaken for this run's nor decide what this case reads.
 */
function watchingTheRunsOwnTempDir(tree: string): { readonly onWorkDir: (work: string) => void; readonly gone: (claim: string) => void } {
  const name = thisRunsWorkDirectory(tree)
  let announced = false
  return {
    onWorkDir: (dir) => {
      announced = true
      assert.ok(existsSync(dir), "the run's own temporary directory is there while the run goes")
      assert.ok(dir.startsWith(tmpdir()), `the run's own directory is outside the temporary directory: ${dir}`)
      assert.ok(basename(dir).startsWith(name), `the run's own directory is not named for its tree: ${dir}`)
    },
    gone: (claim) => {
      assert.ok(announced, 'the run said where its temporary directory was')
      assert.deepEqual(entriesNamed(tmpdir(), name), [], claim)
    }
  }
}

/** The running release's tree: the manifest naming the installer, and the pin it carries. */
function treeOf(t: TestContext, pin: Partial<Pin> | string, installerPackageName: string = NAME): string {
  const tree = scratch(t, 'tree')
  writeFileSync(join(tree, 'package.json'), JSON.stringify({ name: 'martha', version: '1.0.0', martha: { installerPackage: installerPackageName } }))
  const text = typeof pin === 'string' ? pin : JSON.stringify({ name: NAME, version: VERSION, integrity: 'sha512-planted', ...pin })
  writeFileSync(join(tree, PIN_FILE), text)
  return tree
}

/** The pin a registry's own bytes make. */
const pinFor = (registry: FakeRegistry): Pin => ({ name: NAME, version: VERSION, integrity: sha512Of(registry.tarballOf(NAME)) })

/** The npm a test puts in front: it writes a mark when it is run, so a refusal proves nothing was fetched. */
function standInNpm(t: TestContext): { readonly npm: string; readonly ran: () => boolean } {
  const dir = scratch(t, 'npm')
  const mark = join(dir, 'ran')
  const npm = join(dir, 'npm.js')
  writeFileSync(npm, `require('node:fs').writeFileSync(${JSON.stringify(mark)}, 'x')\n`)
  return { npm, ran: () => existsSync(mark) }
}

/** The request, with everything a test wants to see or keep out of reach. */
const requestFor = (tree: string, extra: Partial<InstallRequest> = {}): InstallRequest => ({
  args: [],
  tree,
  env: { ...process.env },
  stdio: 'inherit',
  ...extra,
})

const refusalOf = (outcome: InstallOutcome): string => {
  assert.ok('refusal' in outcome, `expected a refusal, got status ${'status' in outcome ? outcome.status : '?'}`)
  return outcome.refusal
}

/** What the stand-in installer reported about itself, from the file it wrote. */
const reported = (out: string): { readonly args: string[]; readonly bundle: boolean } => JSON.parse(readFileSync(out, 'utf8')) as { args: string[]; bundle: boolean }

test('a release with no pin is refused by name, before anything is fetched', (t) => {
  const tree = scratch(t, 'no-pin')
  writeFileSync(join(tree, 'package.json'), JSON.stringify({ martha: { installerPackage: NAME } }))
  const npm = standInNpm(t)
  const refusal = refusalOf(installThePinnedInstaller(requestFor(tree, { npm: npm.npm })))
  assert.ok(refusal.includes(PIN_FILE), refusal)
  assert.ok(refusal.includes('README'), 'the refusal names the way up')
  assert.equal(npm.ran(), false, 'nothing was fetched')
})

test('a pin that is not JSON, misses a field, or names another package is refused, naming what failed', (t) => {
  const npm = standInNpm(t)
  const cases: readonly [string, RegExp][] = [
    ['not json', /not JSON/],
    [JSON.stringify({ name: NAME, version: VERSION }), /no integrity/],
    [JSON.stringify({ name: NAME, integrity: 'sha512-x' }), /no version/],
    [JSON.stringify({ name: OTHER, version: VERSION, integrity: 'sha512-x' }), new RegExp(`pins ${OTHER}, and Martha's installer is ${NAME}`)]
  ]
  for (const [pin, pattern] of cases) {
    assert.match(refusalOf(installThePinnedInstaller(requestFor(treeOf(t, pin), { npm: npm.npm }))), pattern)
  }
  assert.equal(npm.ran(), false, 'nothing was fetched')
})

test('a release whose own manifest names no installer package is refused by name', (t) => {
  const tree = scratch(t, 'no-name')
  writeFileSync(join(tree, 'package.json'), JSON.stringify({ name: 'martha' }))
  writeFileSync(join(tree, PIN_FILE), JSON.stringify({ name: NAME, version: VERSION, integrity: 'sha512-x' }))
  assert.match(refusalOf(installThePinnedInstaller(requestFor(tree))), /names no installer package/)
})

test('bytes npm serves that are not the ones the pin names are refused by name, and the installer never runs', async (t) => {
  const good = await fakeNpmRegistry([installerPackage()])
  const other = await fakeNpmRegistry([{ ...installerPackage(), files: { ...installerPackage().files, 'planted.txt': 'x\n' } }])
  t.after(() => Promise.all([good.stop(), other.stop()]))
  const out = join(scratch(t, 'out'), 'reported.json')
  const tree = treeOf(t, pinFor(good))
  const refusal = refusalOf(installThePinnedInstaller(requestFor(tree, { registry: other.registry, env: { ...process.env, MARTHA_TEST_OUT: out } })))
  assert.match(refusal, new RegExp(`bytes for ${NAME}@${VERSION} that are not the ones this release pins`))
  assert.equal(existsSync(out), false, 'the installer never ran')
})

test('a version npm does not serve is refused by name, naming the package and version', async (t) => {
  const empty = await fakeNpmRegistry([])
  t.after(empty.stop)
  const tree = treeOf(t, { name: NAME, version: VERSION, integrity: 'sha512-planted' })
  const refusal = refusalOf(installThePinnedInstaller(requestFor(tree, { registry: empty.registry })))
  assert.match(refusal, new RegExp(`does not serve ${NAME}@${VERSION}`))
})

test('a node with no npm beside it is refused by name, naming the path', (t) => {
  const missing = join(scratch(t, 'no-npm'), 'npm-cli.js')
  const refusal = refusalOf(installThePinnedInstaller(requestFor(treeOf(t, { name: NAME, version: VERSION, integrity: 'sha512-x' }), { npm: missing })))
  assert.ok(refusal.includes(missing), refusal)
})

test('the installer runs with the words unchanged, its own streams and its own exit status', async (t) => {
  const registry = await fakeNpmRegistry([installerPackage()])
  t.after(registry.stop)
  const dir = scratch(t, 'out')
  const out = join(dir, 'reported.json')
  const streams = join(dir, 'streams')
  const fd = openSync(streams, 'w')
  const args = ['1.2.3', '--downgrade', '--digest', 'sha256:abc']
  const outcome = installThePinnedInstaller(requestFor(treeOf(t, pinFor(registry)), {
    args,
    registry: registry.registry,
    stdio: ['ignore', fd, fd],
    env: { ...process.env, MARTHA_TEST_OUT: out, MARTHA_TEST_EXIT: '7' },
  }))
  closeSync(fd)
  assert.deepEqual('status' in outcome ? outcome.status : -1, 7, 'the command ends as the installer did')
  assert.deepEqual(reported(out).args, args, 'the words reach the installer unchanged')
  const spoken = readFileSync(streams, 'utf8')
  assert.match(spoken, /the installer spoke on stdout/)
  assert.match(spoken, /the installer spoke on stderr/, 'both streams are the ones the command was given')
})

test('the installer the pin names installs with its bundled dependency, and the temporary directory is gone', async (t) => {
  const registry = await fakeNpmRegistry([installerPackage()])
  t.after(registry.stop)
  const out = join(scratch(t, 'out'), 'reported.json')
  const tree = treeOf(t, pinFor(registry))
  const ownTempDir = watchingTheRunsOwnTempDir(tree)
  const outcome = installThePinnedInstaller(requestFor(tree, { registry: registry.registry, env: { ...process.env, MARTHA_TEST_OUT: out }, onWorkDir: ownTempDir.onWorkDir }))
  aNeighbourRunsHere(t)
  assert.deepEqual('status' in outcome ? outcome.status : -1, 0)
  assert.equal(reported(out).bundle, true, 'the bundled node_modules arrived inside the tarball')
  ownTempDir.gone('the temporary directory is removed after a run')
})

test('the temporary directory is removed after a refusal too', async (t) => {
  const empty = await fakeNpmRegistry([])
  t.after(empty.stop)
  const tree = treeOf(t, { name: NAME, version: VERSION, integrity: 'sha512-x' })
  const ownTempDir = watchingTheRunsOwnTempDir(tree)
  refusalOf(installThePinnedInstaller(requestFor(tree, { registry: empty.registry, onWorkDir: ownTempDir.onWorkDir })))
  aNeighbourRunsHere(t)
  ownTempDir.gone('the temporary directory is removed after a refusal')
})
