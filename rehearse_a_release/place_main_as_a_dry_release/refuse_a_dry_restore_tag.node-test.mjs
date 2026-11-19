// The release-side guard of martha#695: a release tag whose history holds the dry packer's own commit is refused,
// and it is found from the shallow checkout a release job really has. The deepening is the point -- a shallow clone
// sees one commit and would pass a tag that carries the dry commit two commits back -- so the mutant that skips it
// is the case that proves this test can tell.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DRY_RESTORE_SUBJECT } from './dry_restore.mjs'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SCRIPT = join(REPO, 'pack_a_release', 'refuse_a_dry_restore_tag.sh')
/** Each file the guard reads, and the place it is planted at in the clone. @type {Array<[string, string]>} */
const CARRIED = [
  [SCRIPT, join('pack_a_release', 'refuse_a_dry_restore_tag.sh')],
  [join(HERE, 'dry_restore.mjs'), join('rehearse_a_release', 'place_main_as_a_dry_release', 'dry_restore.mjs')],
  [join(REPO, 'installer', 'package.json'), join('installer', 'package.json')]
]

/** git in `dir`, failing the test on a non-zero exit. @param {string} dir @param {...string} args */
const git = (dir, ...args) => {
  const run = spawnSync('git', ['-c', 'user.name=dry', '-c', 'user.email=dry@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`)
  return run.stdout.trim()
}

/** A commit in `dir` writing `file`, with `subject`. @param {string} dir @param {string} file @param {string} subject */
function aCommit (dir, file, subject) {
  writeFileSync(join(dir, file), `${subject}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', subject)
  return git(dir, 'rev-parse', 'HEAD')
}

/**
 * An origin repository of the test's own, and a shallow clone of it at its last tag, which is the checkout a release
 * job has: one commit, no history. Removed when the test ends.
 * @param {import('node:test').TestContext} t @param {{ commits: { file: string, subject: string }[], tags: Record<string, string> }} how
 */
function anOriginAndItsShallowClone (t, { commits, tags }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'martha-dry-tag-')))
  t.after(() => removeTheTree(root))
  const origin = join(root, 'origin')
  mkdirSync(origin)
  git(origin, 'init', '--quiet')
  for (const { file, subject } of commits) {
    mkdirSync(dirname(join(origin, file)), { recursive: true })
    aCommit(origin, file, subject)
  }
  for (const [tag, at] of Object.entries(tags)) {
    const sha = git(origin, 'log', '--format=%H', `--grep=${at}`, '-1')
    git(origin, 'update-ref', `refs/tags/${tag}`, sha)
  }
  const clone = join(root, 'clone')
  const newestTag = Object.keys(tags).at(-1)
  assert.ok(newestTag !== undefined, 'the case names a tag to clone at')
  git(root, 'clone', '--quiet', '--depth', '1', '--branch', newestTag, `file://${origin}`, clone)
  for (const [from, to] of CARRIED) {
    mkdirSync(dirname(join(clone, to)), { recursive: true })
    copyFileSync(from, join(clone, to))
  }
  return { root, clone }
}

/**
 * The guard as the release runs it, in `clone`, against `tag`. With `mutant`, a copy of it with `from` replaced by
 * `to` runs instead: the case that has to go red.
 * @param {string} clone @param {string} tag @param {{ from: string, to: string }} [mutant]
 */
function refuse (clone, tag, mutant) {
  const script = join(clone, 'pack_a_release', 'refuse_a_dry_restore_tag.sh')
  if (mutant !== undefined) {
    const text = readFileSync(SCRIPT, 'utf8')
    assert.ok(text.includes(mutant.from), `the mutant is aimed at a line the guard holds: ${mutant.from.slice(0, 60)}`)
    writeFileSync(script, text.replace(mutant.from, mutant.to))
  } else {
    copyFileSync(SCRIPT, script)
  }
  const run = spawnSync('bash', [script, tag], { cwd: clone, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return { status: run.status, said: `${run.stdout}${run.stderr}` }
}

const A_DRY_COMMIT = { file: 'the_dry_restore.txt', subject: DRY_RESTORE_SUBJECT }
const AN_ORDINARY_COMMIT = { file: 'an_ordinary_change.txt', subject: 'an ordinary change' }

test('a shallow checkout of a tag that carries a dry run\'s commit is refused, and the commit is named', (t) => {
  const { clone } = anOriginAndItsShallowClone(t, {
    commits: [
      { file: 'first.txt', subject: 'the published release' },
      A_DRY_COMMIT,
      { file: 'last.txt', subject: 'the release being tagged' }
    ],
    tags: { 'v1.0.0': 'the published release', 'v2.0.0': 'the release being tagged' }
  })
  assert.equal(git(clone, 'rev-list', '--count', 'HEAD'), '1', 'the clone really is one commit deep')
  const { status, said } = refuse(clone, 'v2.0.0')
  assert.equal(status, 1, said)
  assert.match(said, new RegExp(`carries a dry run's commit [0-9a-f]{40} \\(${DRY_RESTORE_SUBJECT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\) since v1\\.0\\.0`))
})

test('a guard that skips the deepening would see nothing: the same one-commit clone passes when it does not fetch', (t) => {
  const { clone } = anOriginAndItsShallowClone(t, {
    commits: [
      { file: 'first.txt', subject: 'the published release' },
      A_DRY_COMMIT,
      { file: 'last.txt', subject: 'the release being tagged' }
    ],
    tags: { 'v1.0.0': 'the published release', 'v2.0.0': 'the release being tagged' }
  })
  const shallowFetch = 'git -C "${REPO}" fetch --quiet --no-tags --shallow-exclude="refs/tags/${PREVIOUS}" "${REMOTE}" "refs/tags/${TAG}:refs/tags/${TAG}"'
  const { status, said } = refuse(clone, 'v2.0.0', { from: shallowFetch, to: 'true' })
  assert.equal(status, 0, `${said}\n(the mutant passes, which is why the deepen is what catches the dry commit)`)
})

test('a tag whose history is clean is accepted, and says what it read', (t) => {
  const { clone } = anOriginAndItsShallowClone(t, {
    commits: [
      { file: 'first.txt', subject: 'the published release' },
      AN_ORDINARY_COMMIT,
      { file: 'last.txt', subject: 'the release being tagged' }
    ],
    tags: { 'v1.0.0': 'the published release', 'v2.0.0': 'the release being tagged' }
  })
  const { status, said } = refuse(clone, 'v2.0.0')
  assert.equal(status, 0, said)
  assert.match(said, /^refuse_a_dry_restore_tag: v2\.0\.0 carries no dry run's commit \(since v1\.0\.0\)$/m)
})

test('a tag with no release tag before it is read over its whole history, and the dry commit is still found', (t) => {
  const { clone } = anOriginAndItsShallowClone(t, {
    commits: [
      A_DRY_COMMIT,
      { file: 'last.txt', subject: 'the release being tagged' }
    ],
    tags: { 'v1.0.0': 'the release being tagged' }
  })
  const { status, said } = refuse(clone, 'v1.0.0')
  assert.equal(status, 1, said)
  assert.match(said, /in its whole history/, said)
})

test('a tag this checkout does not hold is could-not-run, never a pass', (t) => {
  const { clone } = anOriginAndItsShallowClone(t, {
    commits: [{ file: 'last.txt', subject: 'the release being tagged' }],
    tags: { 'v1.0.0': 'the release being tagged' }
  })
  const { status, said } = refuse(clone, 'v9.9.9')
  assert.equal(status, 2, said)
  assert.match(said, /this checkout holds no v9\.9\.9/)
})
