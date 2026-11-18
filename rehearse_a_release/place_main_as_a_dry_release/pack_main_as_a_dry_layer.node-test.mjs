// The dry packer of a drifted tree (martha#695, option A): main whose installer/ has moved past the tag its version was
// published at is packed, not refused. It restores installer/ from the tag in its own throwaway clone -- deleting what
// main added first, so the pin's own tag diff comes out empty -- and it packs main's own installer from the sha itself,
// before that restore, so the tarball can only hold main's bytes. What it must never do is put either of those into a
// release; that is refused on the release side, and its own tests are beside the check that reads the release path.
//
// Each case runs the real script from a throwaway repository that holds it beside the real installer manifest and
// names, so the script's own clone of "this repository" is that repository. The cases stop before the release packer
// runs: the throwaway installer has no lock file, so `npm ci` refuses at once and the run exits 2 without the network.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, relative } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DRY_RESTORE_SUBJECT } from './dry_restore.mjs'
import { installerRef, NAMES } from '../../installer/keep_the_names_in_one_place/names.mjs'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SCRIPT = join(HERE, 'pack_main_as_a_dry_layer.sh')
const NAMES_MODULE = join(REPO, 'installer', 'keep_the_names_in_one_place', 'names.mjs')
/** The files the script reads from the tree it packs, copied as they are. */
const CARRIED = [SCRIPT, NAMES_MODULE, join(HERE, 'dry_restore.mjs'), join(REPO, 'installer', 'package.json'), join(REPO, 'package.json')]
const NOT_PACKABLE = 'dry: not packable: installer ahead of its tag'
const NOT_PACKABLE_EXIT = 3
const COULD_NOT_RUN_EXIT = 2
/** The installer file the tag holds, and what main's own installer says after a change, told apart in the tarball. */
const A_MODULE = join('installer', 'a_module.mjs')
/** The same file as the packed tarball holds it: entries are taken from the installer folder it was packed from. */
const A_MODULE_IN_THE_TARBALL = 'a_module.mjs'
const THE_TAGS_BODY = 'export const said = "the tag\'s own"\n'
const MAINS_BODY = 'export const said = "main\'s own"\n'

/** git in `dir`, failing the test on a non-zero exit. @param {string} dir @param {...string} args */
const git = (dir, ...args) => {
  const run = spawnSync('git', ['-c', 'user.name=dry', '-c', 'user.email=dry@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout.trim()
}

/**
 * A repository of the test's own holding the carried files and one installer file, committed, removed when the test
 * ends. With `tagged`, the installer version's own tag points at that first commit. Its own `origin` is a URL that
 * cannot resolve, so a pack that went to the origin instead of to this path would fail (martha#695, T1c).
 * @param {import('node:test').TestContext} t @param {{ tagged: boolean }} options
 */
function aRepository (t, { tagged }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-dry-pack-')))
  t.after(() => removeTheTree(root))
  const dir = join(root, 'repo')
  mkdirSync(dir)
  git(dir, 'init', '--quiet')
  git(dir, 'remote', 'add', 'origin', 'https://cannot-resolve.invalid/martha.git')
  for (const file of CARRIED) {
    const to = join(dir, relative(REPO, file))
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(file, to)
  }
  // The installer's manifest with the fixture's own file in its "files", so the packed tarball holds it and the case
  // can tell main's bytes from the tag's.
  const manifest = JSON.parse(readFileSync(join(dir, 'installer', 'package.json'), 'utf8'))
  manifest.files = [...(manifest.files ?? []), 'a_module.mjs']
  writeFileSync(join(dir, 'installer', 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(dir, A_MODULE), THE_TAGS_BODY)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', 'the published installer')
  if (tagged) git(dir, 'update-ref', installerRef(NAMES.installerVersion), 'HEAD')
  return { root, dir }
}

/** A commit changing `path` in `dir` to `body`, and its sha. @param {string} dir @param {string} path @param {string} body */
function aChange (dir, path, body) {
  writeFileSync(join(dir, path), body)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', `change ${path}`)
  return git(dir, 'rev-parse', 'HEAD')
}

/** A commit adding a file `path` in `dir`, and its sha. @param {string} dir @param {string} path @param {string} body */
function anAddition (dir, path, body) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), body)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', `add ${path}`)
  return git(dir, 'rev-parse', 'HEAD')
}

/**
 * A copy of the script beside the fixture with one difference planted in it: the mutant a case has to turn red.
 * @param {string} dir @param {string | Array<[string, string]>} from @param {string} [to]
 */
function aMutant (dir, from, to) {
  /** @type {Array<[string, string]>} */
  let pairs
  if (Array.isArray(from)) {
    pairs = from
  } else {
    assert.ok(to !== undefined, 'a single mutant names what it plants in place of the line')
    pairs = [[from, to]]
  }
  const at = join(dir, relative(REPO, SCRIPT))
  // Each mutant is planted in the real script, so a case that plants two in a row does not stack them.
  let text = readFileSync(SCRIPT, 'utf8')
  for (const [find, replace] of pairs) {
    assert.ok(text.includes(find), `the mutant is aimed at a line the script holds: ${find}`)
    text = text.replace(find, replace)
  }
  // The mutant stands where the script stands, so the fixture it works in is the same one, and only the planted
  // difference is at work.
  writeFileSync(at, text)
  return at
}

/**
 * The script, run from `dir`'s copy, packing `sha` to a layer under `root`. With `pathFirst`, that folder comes first
 * on the script's PATH; with `script`, that copy of the script runs instead of the one in `dir`.
 * @param {string} root @param {string} dir @param {string} sha @param {{ pathFirst?: string, script?: string }} [how]
 */
function pack (root, dir, sha, how = {}) {
  const out = join(root, 'layer.tar.gz')
  const env = how.pathFirst === undefined ? process.env : { ...process.env, PATH: `${how.pathFirst}${delimiter}${process.env.PATH}` }
  const run = spawnSync('bash', [how.script ?? join(dir, relative(REPO, SCRIPT)), sha, out], { encoding: 'utf8', env })
  return { status: run.status, said: `${run.stdout}${run.stderr}`, packed: existsSync(out) }
}

/** What an entry of the packed tarball holds. @param {string} tarball @param {string} entry */
function inTheTarball (tarball, entry) {
  const run = spawnSync('tar', ['-xzOf', tarball, `package/${entry}`], { encoding: 'utf8' })
  return run.status === 0 ? run.stdout : ''
}

test('a tree whose installer/ is ahead of its tag is packed, with the restore said in a line of its own', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, A_MODULE, MAINS_BODY)
  const { status, said, packed } = pack(root, dir, sha)
  assert.doesNotMatch(said, new RegExp(NOT_PACKABLE))
  assert.match(said, new RegExp(`^dry: installer/ as ${installerRef(NAMES.installerVersion)} published it, restored in a commit of the clone's own \\([0-9a-f]{40}\\)$`, 'm'))
  assert.match(said, /^dry: the installer's own dependencies could not be installed$/m)
  assert.equal(status, COULD_NOT_RUN_EXIT, said)
  assert.equal(packed, false)
})

test('main\'s installer is packed from the sha, beside the layer, named by main\'s sha7 and its own digest', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, A_MODULE, MAINS_BODY)
  const { said } = pack(root, dir, sha)
  const tarball = join(root, `main-installer-${sha.slice(0, 7)}.tgz`)
  assert.ok(existsSync(tarball), said)
  assert.match(said, new RegExp(`^dry: main's installer at ${sha} packed as ${tarball.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(sha256:[0-9a-f]{64}\\)$`, 'm'))
  assert.equal(inTheTarball(tarball, A_MODULE_IN_THE_TARBALL), MAINS_BODY, 'the tarball holds main\'s bytes')
})

test('the tarball is taken from the sha itself, so no order of the restore can reach into it', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, A_MODULE, MAINS_BODY)
  const tarball = join(root, `main-installer-${sha.slice(0, 7)}.tgz`)
  // A pack taken from the clone's own head instead of the sha, in the script's own order: the head is still the sha
  // when it runs, so the tarball is main's, and this is not what the case below is about.
  const fromTheHead = aMutant(dir, 'git -C "${REPO}" archive "${SHA}" installer', 'git -C "${TREE}" archive HEAD installer')
  pack(root, dir, sha, { script: fromTheHead })
  assert.equal(inTheTarball(tarball, A_MODULE_IN_THE_TARBALL), MAINS_BODY, 'packed before the restore, the head is main')
  // And that same pack moved after the restore: this is the shape a tarball packed from the restored tree would have,
  // and it holds the tag's installer while the result line would still say main's.
  const afterTheRestore = aMutant(dir, [
    ['git -C "${REPO}" archive "${SHA}" installer', 'git -C "${TREE}" archive HEAD installer'],
    ['    packMainInstaller\n    restoreTheInstallersTag\n', '    restoreTheInstallersTag\n    packMainInstaller\n']
  ])
  pack(root, dir, sha, { script: afterTheRestore })
  assert.equal(inTheTarball(tarball, A_MODULE_IN_THE_TARBALL), THE_TAGS_BODY, 'packed after it, the head is the tag')
})

test('the restore deletes what main added under installer/, so the pin\'s tag diff comes out empty', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  anAddition(dir, join('installer', 'a_file_main_added.mjs'), 'export const added = 1\n')
  const sha = aChange(dir, A_MODULE, MAINS_BODY)
  const { said } = pack(root, dir, sha)
  assert.match(said, /^dry: installer\/ as .* published it, restored in a commit of the clone's own \([0-9a-f]{40}\)$/m, said)
  assert.doesNotMatch(said, /the restore left installer\//)
})

test('a restore that keeps what main added is refused here, never left for the pin to find', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  anAddition(dir, join('installer', 'a_file_main_added.mjs'), 'export const added = 1\n')
  const sha = aChange(dir, A_MODULE, MAINS_BODY)
  const mutant = aMutant(dir, '  git -C "${TREE}" rm -r -q --ignore-unmatch -- installer\n', '')
  const { status, said } = pack(root, dir, sha, { script: mutant })
  assert.match(said, /^dry: the restore left installer\/ differing from .* \(1 file\(s\)\); nothing was packed$/m, said)
  assert.equal(status, COULD_NOT_RUN_EXIT, said)
})

test('installer/ whose martha names differ from its tag\'s is not packable: nothing is packed, not even the tarball', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const manifest = JSON.parse(readFileSync(join(dir, 'installer', 'package.json'), 'utf8'))
  manifest.martha.command = 'a-command-the-tag-never-published'
  writeFileSync(join(dir, 'installer', 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', 'a command the tag never published')
  const sha = git(dir, 'rev-parse', 'HEAD')
  const { status, said, packed } = pack(root, dir, sha)
  assert.equal(status, NOT_PACKABLE_EXIT, said)
  assert.ok(
    said.includes(`names a different martha.command than ${installerRef(NAMES.installerVersion)} published (a-command-the-tag-never-published against ${NAMES.command}); nothing was packed`),
    said,
  )
  assert.equal(packed, false)
  assert.equal(existsSync(join(root, `main-installer-${sha.slice(0, 7)}.tgz`)), false, 'no tarball either')
})

test('a tree whose installer/ is its tag\'s packs no installer of its own: the published one is the same bytes', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, 'outside_the_installer.mjs', 'export const elsewhere = 1\n')
  const { status, said } = pack(root, dir, sha)
  assert.doesNotMatch(said, /main's installer .* packed as/)
  assert.doesNotMatch(said, /restored in a commit/)
  assert.equal(existsSync(join(root, `main-installer-${sha.slice(0, 7)}.tgz`)), false)
  assert.match(said, /^dry: the installer's own dependencies could not be installed$/m)
  assert.equal(status, COULD_NOT_RUN_EXIT, said)
})

test('a comparison git cannot make, after the tag was found, exits as could-not-run in the packer\'s words', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, A_MODULE, MAINS_BODY)
  // A git that refuses only `diff`, first on the script's PATH: every other git call is the real one.
  const shim = join(root, 'shim')
  mkdirSync(shim)
  const realGit = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  writeFileSync(join(shim, 'git'), `#!/bin/bash\nfor a in "$@"; do [ "$a" = diff ] && { echo 'the shim refuses diff' >&2; exit 128; }; done\nexec ${realGit} "$@"\n`, { mode: 0o755 })
  const { status, said, packed } = pack(root, dir, sha, { pathFirst: shim })
  assert.match(said, new RegExp(`^dry: git could not compare installer/ at ${sha} with ${installerRef(NAMES.installerVersion)}$`, 'm'))
  assert.doesNotMatch(said, new RegExp(NOT_PACKABLE))
  assert.equal(status, COULD_NOT_RUN_EXIT, said)
  assert.equal(packed, false)
})

test('a tree with no tag for its installer version is left to the pin, never called not packable', (t) => {
  const { root, dir } = aRepository(t, { tagged: false })
  const sha = aChange(dir, A_MODULE, MAINS_BODY)
  const { status, said } = pack(root, dir, sha)
  assert.doesNotMatch(said, new RegExp(NOT_PACKABLE))
  assert.doesNotMatch(said, /restored in a commit/)
  assert.equal(status, COULD_NOT_RUN_EXIT, said)
})

test('the clone is of this repository and not of its origin: cloned from the origin, the pack cannot run at all', (t) => {
  const { root, dir } = aRepository(t, { tagged: true })
  const sha = aChange(dir, A_MODULE, MAINS_BODY)
  // The repository's own origin is a URL that cannot resolve, so the run below succeeds only by cloning the local path.
  const { said } = pack(root, dir, sha)
  assert.match(said, /^dry: installer\/ as .* published it/m, said)
  const mutant = aMutant(dir, 'git clone --quiet --no-checkout "${REPO}"', 'git clone --quiet --no-checkout origin')
  const ran = pack(root, dir, sha, { script: mutant })
  assert.equal(ran.packed, false, 'a pack cloned from the origin cannot reach the layer')
  assert.doesNotMatch(ran.said, /^dry: installer\/ as .* published it/m, ran.said)
})

test('the restore commit\'s subject is the one exported constant, so a release-side check and the packer agree on it', () => {
  const text = readFileSync(SCRIPT, 'utf8')
  assert.ok(text.includes('DRY_RESTORE_SUBJECT'), 'the packer reads the subject from dry_restore.mjs')
  assert.equal(text.includes(DRY_RESTORE_SUBJECT), false, 'and never spells it itself')
})
