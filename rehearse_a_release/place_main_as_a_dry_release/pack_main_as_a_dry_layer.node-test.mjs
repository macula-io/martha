// The dry packer's own refusal (martha#639, ruling (b)): main whose installer/ has moved past the tag its version was
// published at is "not packable", said on its own line with its own exit, and nothing is packed. The pin is never
// skipped. A tree that equals its tag, or has no tag here, passes this check and goes on to the release's own steps.
//
// Each case runs the real script from a throwaway repository that holds it beside the real installer manifest and
// names, so the script's own clone of "this repository" is that repository. The cases stop before the release packer
// runs: the throwaway installer has no lock file, so `npm ci` refuses at once and the run exits 2 without the network.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { installerRef, NAMES } from '../../installer/keep_the_names_in_one_place/names.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SCRIPT = join(HERE, 'pack_main_as_a_dry_layer.sh')
const NAMES_MODULE = join(REPO, 'installer', 'keep_the_names_in_one_place', 'names.mjs')
/** The files the script reads from the tree it packs, copied as they are. */
const CARRIED = [SCRIPT, NAMES_MODULE, join(REPO, 'installer', 'package.json'), join(REPO, 'package.json')]
const NOT_PACKABLE = 'dry: not packable: installer ahead of its tag'
const NOT_PACKABLE_EXIT = 3
const COULD_NOT_RUN_EXIT = 2

/** git in `dir`, failing the test on a non-zero exit. @param {string} dir @param {...string} args */
const git = (dir, ...args) => {
  const run = spawnSync('git', ['-c', 'user.name=dry', '-c', 'user.email=dry@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout.trim()
}

/**
 * A repository of the test's own holding the carried files and one installer file, committed, removed when the test
 * ends. With `tagged`, the installer version's own tag points at that first commit.
 * @param {import('node:test').TestContext} t @param {{ tagged: boolean }} options
 */
function aRepository (t, { tagged }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-dry-pack-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'repo')
  mkdirSync(dir)
  git(dir, 'init', '--quiet')
  for (const file of CARRIED) {
    const to = join(dir, relative(REPO, file))
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(file, to)
  }
  writeFileSync(join(dir, 'installer', 'a_module.mjs'), 'export const said = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', 'the published installer')
  if (tagged) git(dir, 'update-ref', installerRef(NAMES.installerVersion), 'HEAD')
  return { root, dir }
}

/** A commit changing `path` in `dir`, and its sha. @param {string} dir @param {string} path */
function aChange (dir, path) {
  writeFileSync(join(dir, path), `export const said = ${Date.now()}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', `change ${path}`)
  return git(dir, 'rev-parse', 'HEAD')
}

/**
 * The script, run from `dir`'s copy, packing `sha` to a layer under `root`. With `pathFirst`, that folder comes first
 * on the script's PATH.
 * @param {string} root @param {string} dir @param {string} sha @param {string} [pathFirst]
 */
function pack (root, dir, sha, pathFirst) {
  const out = join(root, 'layer.tar.gz')
  const env = pathFirst === undefined ? process.env : { ...process.env, PATH: `${pathFirst}${delimiter}${process.env.PATH}` }
  const run = spawnSync('bash', [join(dir, relative(REPO, SCRIPT)), sha, out], { encoding: 'utf8', env })
  return { status: run.status, said: `${run.stdout}${run.stderr}`, packed: existsSync(out) }
}

test('main whose installer/ is ahead of its tag is not packable: its own line, its own exit, nothing packed', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, join('installer', 'a_module.mjs'))
  const { status, said, packed } = pack(root, dir, sha)
  assert.equal(status, NOT_PACKABLE_EXIT, said)
  assert.match(said, new RegExp(`^${NOT_PACKABLE}: installer/ at ${sha} is not what ${installerRef(NAMES.installerVersion)} published \\(1 file\\(s\\)\\); nothing was packed$`, 'm'))
  assert.equal(packed, false)
})

test('main whose installer/ is its tag\'s passes the check and goes on to the release\'s own steps', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, 'outside_the_installer.mjs')
  const { status, said } = pack(root, dir, sha)
  assert.doesNotMatch(said, new RegExp(NOT_PACKABLE))
  assert.match(said, /^dry: the installer's own dependencies could not be installed$/m)
  assert.equal(status, COULD_NOT_RUN_EXIT, said)
})

test('a comparison git cannot make, after the tag was found, exits as could-not-run in the packer\'s words', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, join('installer', 'a_module.mjs'))
  // A git that refuses only `diff`, first on the script's PATH: every other git call is the real one.
  const shim = join(root, 'shim')
  mkdirSync(shim)
  const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  writeFileSync(join(shim, 'git'), `#!/bin/bash\nfor a in "$@"; do [ "$a" = diff ] && { echo 'the shim refuses diff' >&2; exit 128; }; done\nexec ${realGit} "$@"\n`, { mode: 0o755 })
  const { status, said, packed } = pack(root, dir, sha, shim)
  assert.match(said, new RegExp(`^dry: git could not compare installer/ at ${sha} with ${installerRef(NAMES.installerVersion)}$`, 'm'))
  assert.doesNotMatch(said, new RegExp(NOT_PACKABLE))
  assert.equal(status, COULD_NOT_RUN_EXIT, said)
  assert.equal(packed, false)
})

test('a tree with no tag for its installer version is left to the pin, never called not packable', (t) => {
  const { root, dir } = aRepository(t, { tagged: false })
  const sha = aChange(dir, join('installer', 'a_module.mjs'))
  const { status, said } = pack(root, dir, sha)
  assert.doesNotMatch(said, new RegExp(NOT_PACKABLE))
  assert.equal(status, COULD_NOT_RUN_EXIT, said)
})
