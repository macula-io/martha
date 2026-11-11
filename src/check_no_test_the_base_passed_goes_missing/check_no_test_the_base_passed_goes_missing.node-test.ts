// The dropped-test check bites (martha#274). A branch that carries a file at its pre-base content drops a test
// the base passed, and every job stayed green on 2026-11-11 (8ca6eb3). Each case below builds a throwaway
// repository and runs the command the workflow runs, so the exit codes here are the ones CI reads. Everything a
// test makes is removed after it.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { DROPS_TEST_FILE_TRAILER, DROPS_TEST_TRAILER } from './check_no_test_the_base_passed_goes_missing.ts'

const REPO = join(import.meta.dirname, '..', '..')
const MAIN = join(import.meta.dirname, 'main.ts')
const THE_ONE_FILE = 'src/check_no_test_the_base_passed_goes_missing/check_no_test_the_base_passed_goes_missing.ts'

/** The manifest a planted base carries: one glob, the shape this repository's own test script has. */
const MANIFEST = '{"scripts":{"test":"node --test \'src/**/*.node-test.ts\'"}}'

interface Commit {
  readonly files: Readonly<Record<string, string | null>>
  readonly message?: string
}

const scratch = (t: TestContext): string => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-dropped-test-'))
  t.after(() => removeTheTree(dir))
  return dir
}

const git = (dir: string, args: readonly string[]): string => {
  const answer = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  assert.equal(answer.status, 0, `git ${args.join(' ')}: ${answer.stderr}`)
  return answer.stdout
}

const write = (dir: string, path: string, text: string): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

/** A repository whose commits are given in order; its shas, oldest first. A null is a file removed. */
const repositoryWith = (t: TestContext, commits: readonly Commit[]): { readonly dir: string; readonly shas: readonly string[] } => {
  const dir = scratch(t)
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 'planted@example.invalid'])
  git(dir, ['config', 'user.name', 'planted'])
  const shas = commits.map((commit) => {
    for (const [path, text] of Object.entries(commit.files)) {
      if (text === null) rmSync(join(dir, path), { force: true })
      else write(dir, path, text)
    }
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-q', '-m', commit.message ?? 'a commit'])
    return git(dir, ['rev-parse', 'HEAD']).trim()
  })
  return { dir, shas }
}

const oneTest = (title: string): string => `test('${title}', () => {})\n`

/** The command the workflow runs, from this working directory. */
const run = (args: readonly string[]) => spawnSync(process.execPath, [MAIN, ...args], { encoding: 'utf8' })

const check = (dir: string, base: string, head: string) => run(['--repository', dir, '--base', base, '--head', head])

const dropTrailer = (path: string, title: string): string => `fix: drop a test\n\n${DROPS_TEST_TRAILER}: ${path} :: ${title}`

test('a title the base passed and the tip no longer holds fails, naming the file and the title (the 2026-11-11 shape)', (t) => {
  const kept = oneTest('one')
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': kept + oneTest('the crew place is refused') } },
    { files: { 'src/x/a.node-test.ts': kept } },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /src\/x\/a\.node-test\.ts/)
  assert.match(answer.stderr, /the crew place is refused/)
})

test('a file carried back to a byte-identical earlier copy drops what the base added to it', (t) => {
  const earlier = oneTest('one')
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': earlier } },
    { files: { 'src/x/a.node-test.ts': earlier + oneTest('two') } },
    { files: { 'src/x/a.node-test.ts': earlier } },
  ])
  const answer = check(dir, shas[1] ?? '', shas[2] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /two/)
})

test('a file the test scripts do not name is not judged', (t) => {
  const { dir, shas } = repositoryWith(t, [
    {
      files: {
        'package.json': MANIFEST,
        'src/x/a.node-test.ts': oneTest('one'),
        'README.md': "# a heading\n\ntest('a title no test script names')\n",
      },
    },
    { files: { 'README.md': null } },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 0, answer.stderr)
})

test('a deliberate removal passes when a commit in the range says which title it drops', (t) => {
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one') } },
    {
      files: { 'src/x/a.node-test.ts': '' },
      message: dropTrailer('src/x/a.node-test.ts', 'one'),
    },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 0, answer.stderr)
})

test('a claim for a title that is still at the tip is a failure of its own', (t) => {
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one') } },
    {
      files: { 'src/x/a.node-test.ts': oneTest('one') + oneTest('two') },
      message: dropTrailer('src/x/a.node-test.ts', 'two'),
    },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /still there/)
})

test('the closing line counts the claims that excuse nothing, not only the missing tests (martha#274 r=2)', (t) => {
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one') } },
    {
      files: { 'src/x/a.node-test.ts': oneTest('one') + oneTest('two') },
      message: dropTrailer('src/x/a.node-test.ts', 'two'),
    },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /0 test\(s\) the base passed are not at the tip, 1 claim\(s\) that excuse nothing/)
})

test('a test file removed whole passes only with a claim for the file, and otherwise names every title', (t) => {
  const base = { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one') + oneTest('two') } }
  const refused = repositoryWith(t, [base, { files: { 'src/x/a.node-test.ts': null } }])
  const answer = check(refused.dir, refused.shas[0] ?? '', refused.shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /one/)
  assert.match(answer.stderr, /two/)
  const claimed = repositoryWith(t, [
    base,
    { files: { 'src/x/a.node-test.ts': null }, message: `fix: drop a file\n\n${DROPS_TEST_FILE_TRAILER}: src/x/a.node-test.ts` },
  ])
  const passing = check(claimed.dir, claimed.shas[0] ?? '', claimed.shas[1] ?? '')
  assert.equal(passing.status, 0, passing.stderr)
})

test('a title reworded in place fails naming the old title, and its claim lets it pass', (t) => {
  const base = { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one') } }
  const refused = repositoryWith(t, [base, { files: { 'src/x/a.node-test.ts': oneTest('one, reworded') } }])
  const answer = check(refused.dir, refused.shas[0] ?? '', refused.shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /'one'/)
  const claimed = repositoryWith(t, [
    base,
    {
      files: { 'src/x/a.node-test.ts': oneTest('one, reworded') },
      message: dropTrailer('src/x/a.node-test.ts', 'one'),
    },
  ])
  assert.equal(check(claimed.dir, claimed.shas[0] ?? '', claimed.shas[1] ?? '').status, 0)
})

test('a title in a comment or a string is not a test, and a template title is compared as written', (t) => {
  const { dir, shas } = repositoryWith(t, [
    {
      files: {
        'package.json': MANIFEST,
        'src/x/a.node-test.ts': oneTest('real'),
        'src/x/b.node-test.ts': 'test(`Bash is refused after ${source}`, () => {})\n',
      },
    },
    {
      files: {
        'src/x/a.node-test.ts': '// test(\'real\', () => {})\nconst note = "test(\'real\')"\n',
        'src/x/b.node-test.ts': '',
      },
    },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /'real'/)
  assert.match(answer.stderr, /Bash is refused after \$\{source\}/)
})

test('a test file the plant never names is caught from the glob, not from a written list', (t) => {
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one'), 'src/y/b.node-test.ts': oneTest('two') } },
    { files: { 'src/y/b.node-test.ts': '' } },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /src\/y\/b\.node-test\.ts/)
})

test('a test file directly under the glob’s own folder is judged, not only one a folder deeper (martha#274 r=2)', (t) => {
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/a.node-test.ts': oneTest('one') + oneTest('directly under the core') } },
    { files: { 'src/a.node-test.ts': oneTest('one') } },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /src\/a\.node-test\.ts/)
  assert.match(answer.stderr, /directly under the core/)
})

test('an installer test file is judged from the installer manifest at the base', (t) => {
  const installer = '{"scripts":{"test":"node --test \'*/*.node-test.mjs\'"}}'
  const { dir, shas } = repositoryWith(t, [
    {
      files: {
        'package.json': MANIFEST,
        'installer/package.json': installer,
        'installer/a/b.node-test.mjs': oneTest('the installer refuses'),
      },
    },
    { files: { 'installer/a/b.node-test.mjs': '' } },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /installer\/a\/b\.node-test\.mjs/)
  assert.match(answer.stderr, /the installer refuses/)
})

test('a base that is not a commit in the repository is exit 2, never a pass', (t) => {
  const { dir, shas } = repositoryWith(t, [{ files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one') } }])
  const answer = check(dir, '0'.repeat(40), shas[0] ?? '')
  assert.equal(answer.status, 2, answer.stderr)
})

test('a test file moved in place is compared at its new path', (t) => {
  const text = oneTest('one') + oneTest('two')
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': text } },
    { files: { 'src/x/a.node-test.ts': null, 'src/y/moved.node-test.ts': text } },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 0, answer.stderr)
})

test('two tests with one title are counted as two, so dropping one is caught', (t) => {
  const twice = oneTest('the same words') + oneTest('the same words')
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': twice } },
    { files: { 'src/x/a.node-test.ts': oneTest('the same words') } },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /the same words/)
})

test('a skipped or todo test is not the call the base made, and a skip option is', (t) => {
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one') + oneTest('two') } },
    {
      files: {
        'src/x/a.node-test.ts': 'test.skip(\'one\', () => {})\ntest(\'two\', { skip: true }, () => {})\n',
      },
    },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /one/)
  assert.doesNotMatch(answer.stderr, /two/)
})

test('a package folder with no manifest at the base is skipped, and its absence is said', (t) => {
  const { dir, shas } = repositoryWith(t, [
    { files: { 'package.json': MANIFEST, 'src/x/a.node-test.ts': oneTest('one') } },
    { files: { 'src/x/a.node-test.ts': '' } },
  ])
  const answer = check(dir, shas[0] ?? '', shas[1] ?? '')
  assert.equal(answer.status, 1, answer.stderr)
  assert.match(answer.stderr, /installer/)
})

test('a manifest at the base that is not JSON is exit 2, and no glob at all is exit 2', (t) => {
  const broken = repositoryWith(t, [
    { files: { 'package.json': '{ not json', 'src/x/a.node-test.ts': oneTest('one') } },
    { files: { 'src/x/a.node-test.ts': '' } },
  ])
  assert.equal(check(broken.dir, broken.shas[0] ?? '', broken.shas[1] ?? '').status, 2)
  const empty = repositoryWith(t, [
    { files: { 'package.json': '{"scripts":{"test":"node --test"}}' } },
    { files: { 'package.json': '{"scripts":{"test":"node --test"}}', 'README.md': '# a heading\n' } },
  ])
  assert.equal(check(empty.dir, empty.shas[0] ?? '', empty.shas[1] ?? '').status, 2)
})

test('the trailer names are written in one file, so the workflow and the tests read them from there', () => {
  const files = git(REPO, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter((path) => path !== '' && path !== THE_ONE_FILE)
  const restated = files.filter((path) => readFileSync(join(REPO, path), 'utf8').includes(DROPS_TEST_TRAILER))
  assert.deepEqual(restated, [])
})
