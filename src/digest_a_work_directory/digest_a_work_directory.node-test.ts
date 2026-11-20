// `martha digest <dir>`: the line a handoff of work outside git names (martha#985, gap 20 of #957).
//
// The claim the tests hold is agreement with crew-code's `bin/crew digest`, so the oracle here is that program's own
// shell pipeline — `find`, `LC_ALL=C sort`, `sha256sum` — run over the same tree, never a value this file computed by
// repeating the algorithm beside it. Each rule the slice refuses by is one test, and each names the mutant it kills.

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { EXIT_DONE, EXIT_USAGE } from '../show_the_owners_text_safely/show_the_owners_text_safely.ts'
import { digestOf, THE_MANIFEST_SEPARATOR } from './digest_a_work_directory.ts'

const MARTHA = join(import.meta.dirname, '..', '..', 'bin', 'martha')

/** A home of the test's own, removed after the test, and the checkout `martha` runs in inside it. */
function placeWithACheckout(t: TestContext): { readonly home: string; readonly root: string } {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-digest-place-')))
  t.after(() => removeTheTree(home))
  const root = join(home, 'project')
  mkdirSync(root)
  execFileSync('git', ['init', '-q', '.'], { cwd: root })
  return { home, root }
}

/** bin/martha run in the place's checkout, as a stranger runs it. */
function marthaIn(place: { readonly home: string; readonly root: string }, ...args: string[]) {
  const run = spawnSync(process.execPath, [MARTHA, ...args], {
    cwd: place.root,
    encoding: 'utf8',
    input: '',
    env: { PATH: process.env.PATH ?? '', HOME: place.home, XDG_STATE_HOME: join(place.home, 'state'), GIT_CONFIG_NOSYSTEM: '1' },
  })
  return { status: run.status, out: run.stdout, err: run.stderr, said: `${run.stdout}${run.stderr}` }
}


/** A directory of the test's own, removed with everything in it after the test. */
function aTree(t: TestContext, name = 'work'): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'martha-digest-')))
  t.after(() => removeTheTree(home))
  const tree = join(home, name)
  mkdirSync(tree)
  return tree
}

/** crew-code's own pipeline over `directory`, run by the shell it runs in. */
function asCrewCodeDigests(directory: string): string {
  const script = [
    `modes="$(cd "$1" && find . -type f -printf '%m %p\\n' | LC_ALL=C sort)"`,
    `sums="$(cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum)"`,
    `printf '%s@sha256:%s\\n' "$1" "$(printf '%s\\n${THE_MANIFEST_SEPARATOR}\\n%s\\n' "$modes" "$sums" | sha256sum | awk '{ print $1 }')"`,
  ].join('\n')
  return execFileSync('bash', ['-c', script, 'digest', directory], { encoding: 'utf8' }).trim()
}

/** The line the slice answers for `directory`, or a failure naming the refusal. */
async function lineOf(directory: string, runtime_place?: string): Promise<string> {
  const answered = await digestOf({ directory, ...(runtime_place === undefined ? {} : { runtime_place }) })
  assert.ok('line' in answered, 'refusal' in answered ? answered.refusal : '')
  return answered.line
}

/** The refusal the slice answers for `directory`. */
async function refusalOf(directory: string, runtime_place?: string): Promise<string> {
  const answered = await digestOf({ directory, ...(runtime_place === undefined ? {} : { runtime_place }) })
  assert.ok('refusal' in answered, 'line' in answered ? answered.line : '')
  return answered.refusal
}

test('the digest is the one crew-code\'s own shell computes: hidden files, a subdirectory and a mode all count', async (t) => {
  const tree = aTree(t)
  writeFileSync(join(tree, 'plan.md'), 'the plan\n')
  writeFileSync(join(tree, '.hidden'), 'a dot file counts\n')
  mkdirSync(join(tree, 'notes'))
  writeFileSync(join(tree, 'notes', 'one.txt'), 'one\n')
  chmodSync(join(tree, 'plan.md'), 0o755)
  assert.equal(await lineOf(tree), asCrewCodeDigests(tree))
})

test('two runs over the same bytes agree, and a changed byte changes the digest', async (t) => {
  const tree = aTree(t)
  writeFileSync(join(tree, 'a.txt'), 'one\n')
  const first = await lineOf(tree)
  assert.equal(await lineOf(tree), first, 'same bytes, same line')
  writeFileSync(join(tree, 'a.txt'), 'two\n')
  assert.notEqual(await lineOf(tree), first, 'a changed byte changes it')
})

test('a changed mode changes the digest (mutant: the mode left out of the manifest)', async (t) => {
  const tree = aTree(t)
  writeFileSync(join(tree, 'a.sh'), 'run me\n')
  chmodSync(join(tree, 'a.sh'), 0o644)
  const plain = await lineOf(tree)
  chmodSync(join(tree, 'a.sh'), 0o755)
  assert.notEqual(await lineOf(tree), plain)
  assert.equal(await lineOf(tree), asCrewCodeDigests(tree))
})

test('a symlink is refused by name, never followed or skipped', async (t) => {
  const tree = aTree(t)
  writeFileSync(join(tree, 'real.txt'), 'real\n')
  symlinkSync('real.txt', join(tree, 'link.txt'))
  assert.match(await refusalOf(tree), /holds symlinks, which a digest cannot vouch for: \.\/link\.txt$/)
})

test('a directory whose name has whitespace is refused, since a handoff line could not carry it', async (t) => {
  const tree = aTree(t, 'two words')
  writeFileSync(join(tree, 'a.txt'), 'a\n')
  assert.match(await refusalOf(tree), /has whitespace in it; a handoff line cannot name it as one word/)
})

test('a directory holding no files is refused rather than given the digest of nothing', async (t) => {
  const tree = aTree(t)
  assert.match(await refusalOf(tree), /holds no files$/)
})

test('the crew\'s runtime place is left out when it lies inside the directory named', async (t) => {
  const tree = aTree(t)
  writeFileSync(join(tree, 'work.md'), 'the work\n')
  const state = join(tree, 'state')
  mkdirSync(state)
  writeFileSync(join(state, 'a-row.json'), '{}\n')
  const without = join(aTree(t), 'flat')
  mkdirSync(without)
  writeFileSync(join(without, 'work.md'), 'the work\n')
  const hexOf = (line: string): string => line.slice(line.indexOf('@sha256:') + '@sha256:'.length)
  assert.equal(hexOf(await lineOf(tree, state)), hexOf(await lineOf(without)), 'the state inside is not the work')
})

test('martha digest prints the line and ends done', (t) => {
  const place = placeWithACheckout(t)
  const tree = aTree(t)
  writeFileSync(join(tree, 'a.txt'), 'a\n')
  const run = marthaIn(place, 'digest', tree)
  assert.equal(run.status, EXIT_DONE, run.said)
  assert.equal(run.out.trim(), asCrewCodeDigests(tree))
})

test('martha digest with no directory is a way the command is not used, and works nothing out', (t) => {
  const run = marthaIn(placeWithACheckout(t), 'digest')
  assert.equal(run.status, EXIT_USAGE, run.said)
  assert.match(run.said, /usage:/)
})
