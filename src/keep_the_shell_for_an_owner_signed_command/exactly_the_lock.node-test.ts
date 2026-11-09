import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEPENDENCIES, LOCKFILE_VERSION, dependenciesTheRunMaySee, type DependenciesToJudge } from './exactly_the_lock.ts'

const pkg = (version: string, more: Record<string, unknown> = {}) => ({ version, integrity: `sha512-${version}`, ...more })

const BASE_PACKAGES = {
  '': { name: 'project', version: '1.0.0' },
  'node_modules/typescript': pkg('5.9.3', { bin: { tsc: 'bin/tsc', tsserver: 'bin/tsserver' } }),
  'node_modules/@s/one': pkg('1.0.0', { bin: 'cli.js' }),
  'node_modules/a': pkg('2.0.0'),
  'node_modules/a/node_modules/b': pkg('0.1.0'),
  'node_modules/@esbuild/darwin-arm64': pkg('0.1.0', { optional: true }),
}
const installedOf = (packages: Record<string, unknown>) => ({ lockfileVersion: LOCKFILE_VERSION, packages })
const { '': _root, 'node_modules/@esbuild/darwin-arm64': _other_os, ...INSTALLED } = BASE_PACKAGES

/** The checkout's node_modules as a directory listing. */
const DISK: Record<string, readonly string[]> = {
  node_modules: ['.bin', '.cache', '.package-lock.json', 'typescript', '@s', 'a'],
  'node_modules/@s': ['one'],
  'node_modules/a/node_modules': ['b'],
}

const judge = (overrides: Partial<DependenciesToJudge> = {}, disk: Record<string, readonly string[]> = DISK) =>
  dependenciesTheRunMaySee({
    base_blobs: { lock: 'L', manifest: 'M' },
    live_blobs: { lock: 'L', manifest: 'M' },
    base_lock: { lockfileVersion: LOCKFILE_VERSION, packages: BASE_PACKAGES },
    installed_lock: installedOf(INSTALLED),
    namesIn: (directory) => disk[directory],
    ...overrides,
  })

test('an install equal to the base lock passes, copying exactly its packages', () => {
  const seen = judge()
  assert.deepEqual(seen.refusals, [])
  assert.deepEqual([...seen.packages].sort(), Object.keys(INSTALLED).sort())
})

test('every name in a bin map gets its own link, read from the base lock, pointing inside its package', () => {
  const links = judge().bin_links
  assert.deepEqual(
    links.map((l) => [l.link, l.points_at]),
    [
      [`${DEPENDENCIES}/.bin/tsc`, '../typescript/bin/tsc'],
      [`${DEPENDENCIES}/.bin/tsserver`, '../typescript/bin/tsserver'],
      [`${DEPENDENCIES}/.bin/one`, '../@s/one/cli.js'],
    ],
  )
})

test('the bin links come from the base lock, not from the installed entry', () => {
  const installed = { ...INSTALLED, 'node_modules/a': pkg('2.0.0', { bin: { planted: 'x.js' } }) }
  assert.equal(judge({ installed_lock: installedOf(installed) }).bin_links.some((l) => l.link.endsWith('/planted')), false)
})

test('a bin path outside its package refuses', () => {
  const base = { ...BASE_PACKAGES, 'node_modules/a': pkg('2.0.0', { bin: { x: '../typescript/bin/tsc' } }) }
  assert.match(judge({ base_lock: { lockfileVersion: LOCKFILE_VERSION, packages: base } }).refusals.join(), /pointing outside the package/)
})

test('a lock or manifest the member changed is not the base, so it refuses', () => {
  assert.match(judge({ live_blobs: { lock: 'X', manifest: 'M' } }).refusals.join(), /live package-lock.json is not the base's/)
  assert.match(judge({ live_blobs: { lock: 'L', manifest: 'X' } }).refusals.join(), /live package.json is not the base's/)
  assert.match(judge({ base_blobs: { lock: undefined, manifest: 'M' } }).refusals.join(), /base has no package-lock.json/)
})

test('a missing installed lock, or one in another shape, refuses by design', () => {
  assert.match(judge({ installed_lock: undefined }).refusals.join(), /\.package-lock\.json is missing/)
  assert.match(judge({ installed_lock: { lockfileVersion: 2, packages: INSTALLED } }).refusals.join(), /\.package-lock\.json is missing/)
  assert.match(judge({ base_lock: { lockfileVersion: 1, dependencies: {} } }).refusals.join(), /base package-lock.json is not lockfileVersion 3/)
})

test('one integrity changed, or an entry with no integrity, refuses by package', () => {
  const changed = { ...INSTALLED, 'node_modules/a': { version: '2.0.0', integrity: 'sha512-other' } }
  assert.match(judge({ installed_lock: installedOf(changed) }).refusals.join(), /node_modules\/a is installed at another version or integrity/)
  const bare = { ...INSTALLED, 'node_modules/a': { version: '2.0.0' } }
  assert.match(judge({ installed_lock: installedOf(bare) }).refusals.join(), /node_modules\/a is installed with no version or integrity/)
})

test('a pinned package missing from the install refuses, unless it is optional', () => {
  const { 'node_modules/a/node_modules/b': _b, ...without } = INSTALLED
  const disk = { ...DISK, 'node_modules/a/node_modules': [] }
  assert.match(judge({ installed_lock: installedOf(without) }, disk).refusals.join(), /node_modules\/a\/node_modules\/b is pinned by the base package-lock.json and not installed/)
  assert.deepEqual(judge().refusals, [])
})

test('an extra package on disk, every listed one agreeing, refuses by name', () => {
  const disk = { ...DISK, node_modules: [...DISK.node_modules!, '@types'], 'node_modules/@types': ['marker'] }
  assert.deepEqual(judge({}, disk).refusals, ['node_modules/@types/marker is installed and is not in node_modules/.package-lock.json'])
  const stray_child = { ...DISK, 'node_modules/@s': ['one', 'two'] }
  assert.deepEqual(judge({}, stray_child).refusals, ['node_modules/@s/two is installed and is not in node_modules/.package-lock.json'])
  const nested = { ...DISK, 'node_modules/a/node_modules': ['b', 'c'] }
  assert.deepEqual(judge({}, nested).refusals, ['node_modules/a/node_modules/c is installed and is not in node_modules/.package-lock.json'])
})

test('a package installed that the base lock does not pin refuses', () => {
  const installed = { ...INSTALLED, 'node_modules/extra': pkg('1.0.0') }
  const disk = { ...DISK, node_modules: [...DISK.node_modules!, 'extra'] }
  assert.match(judge({ installed_lock: installedOf(installed) }, disk).refusals.join(), /node_modules\/extra is installed and the base package-lock.json does not pin it/)
})

test('a link or a bundled package refuses in the first release', () => {
  const installed = { ...INSTALLED, 'node_modules/a': pkg('2.0.0', { link: true }) }
  assert.match(judge({ installed_lock: installedOf(installed) }).refusals.join(), /link or a bundled package/)
})

test('an installed key outside node_modules is not a package', () => {
  const installed = { ...INSTALLED, 'node_modules/../x': pkg('1.0.0') }
  assert.match(judge({ installed_lock: installedOf(installed) }).refusals.join(), /not a package under node_modules/)
})
