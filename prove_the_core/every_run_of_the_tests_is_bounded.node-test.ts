// Every run of the tests that ships is bounded (martha#683).
//
// The rule is every_run_of_the_tests_is_bounded.ts. This reads every way the repository ships a run — every tracked shell
// script and workflow, every package folder's scripts, and every page's code blocks — and fails by file and line for a
// run missing one of the three things that bound it. It then plants a file missing each of the three, one at a time, so
// a check that stopped looking for one fails here by name rather than passing every run.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { unboundedRunsIn, type AShippedFile } from './every_run_of_the_tests_is_bounded.ts'

/** The repository this check reads. */
const repository = join(import.meta.dirname, '..')

/** Every tracked file of the repository, by its path from the top. */
function theTrackedFiles(): string[] {
  return execFileSync('git', ['-C', repository, 'ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => path !== '')
}

/** A tracked file's text. */
const textOf = (path: string): string => readFileSync(join(repository, path), 'utf8')

/** The scripts a package's manifest carries, each as one line, named by the package and the script it is. */
function thePackageScripts(path: string): AShippedFile[] {
  const manifest: unknown = JSON.parse(textOf(path))
  const scripts = (manifest as { readonly scripts?: Readonly<Record<string, string>> }).scripts ?? {}
  return Object.entries(scripts).map(([name, script]) => ({ path: `${path}#scripts.${name}`, text: script, kind: 'a package script' }))
}

/**
 * Every file the repository ships that can start a run: its shell scripts and its workflows, its package folders'
 * scripts, and its pages of prose, which are read inside their code blocks only.
 */
function theShippedRuns(): AShippedFile[] {
  const tracked = theTrackedFiles()
  const scripts = tracked
    .filter((path) => path.endsWith('.sh'))
    .map((path) => ({ path, text: textOf(path), kind: 'a shell script' as const }))
  const workflows = tracked
    .filter((path) => /^\.github\/workflows\/.*\.ya?ml$/.test(path))
    .map((path) => ({ path, text: textOf(path), kind: 'a workflow' as const }))
  const packages = tracked.filter((path) => path.endsWith('package.json')).flatMap(thePackageScripts)
  const pages = tracked
    .filter((path) => path.endsWith('.md'))
    .map((path) => ({ path, text: textOf(path), kind: 'a page of prose' as const }))
  return [...scripts, ...workflows, ...packages, ...pages]
}

/** The line a planted run of a script is: the repository's own bound flags, each of which a plant may drop. */
const A_RUN = (keep: readonly string[]): string => {
  const words = [
    'node --test',
    keep.includes('timeout') ? '--test-timeout=60000' : '',
    keep.includes('force-exit') ? '--test-force-exit' : '',
    keep.includes('guard') ? '--import=./prove_the_core/fail_a_test_file_that_leaves_something_running.ts' : '',
    "'src/**/*.node-test.ts'",
  ]
  return words.filter((word) => word !== '').join(' ')
}

const ALL_THREE = ['timeout', 'force-exit', 'guard'] as const

test('every shell script, workflow, package script and code block that starts a run of the tests bounds it (martha#683)', () => {
  const unbounded = unboundedRunsIn(theShippedRuns())
  assert.deepEqual(
    unbounded.map((run) => `${run.path}:${run.line}: ${run.problems.join('; ')} — ${run.text}`),
    [],
    'a shipped run of the tests does not bound it: it would leave a file waiting forever in a child process of its own',
  )
})

test('a run is named for each of the three things it may be missing, one at a time (martha#683)', () => {
  for (const dropped of ALL_THREE) {
    const kept = ALL_THREE.filter((one) => one !== dropped)
    const found = unboundedRunsIn([{ path: 'a_script.sh', text: `#!/usr/bin/env bash\n${A_RUN(kept)}\n` }])
    assert.equal(found.length, 1, `a run without ${dropped} was not named`)
    assert.equal(found[0]?.path, 'a_script.sh')
    assert.equal(found[0]?.line, 2, 'the run is named by its own line')
    assert.equal(found[0]?.problems.length, 1, `a run missing only ${dropped} was blamed for something else: ${found[0]?.problems.join('; ')}`)
  }
})

test('a flag variable bounds a run only as an argument of the run, never as a word printed elsewhere on the line (martha#683)', () => {
  const printed = `echo "\${GUARD_FLAG}"\n${A_RUN(['timeout', 'force-exit'])}`
  const found = unboundedRunsIn([{ path: 'a_script.sh', text: printed }])
  assert.equal(found.length, 1, 'a guard flag printed before the run was counted as the run stating it')
  assert.deepEqual(found[0]?.problems.length, 1, `the run was blamed for something else: ${found[0]?.problems.join('; ')}`)

  const passed = [
    '#!/usr/bin/env bash',
    'node --test --test-timeout="${RUN_TIMEOUT_MS}" "${FORCE_EXIT_FLAG}" "${GUARD_FLAG}" a_file.node-test.ts',
  ].join('\n')
  assert.deepEqual(unboundedRunsIn([{ path: 'a_script.sh', text: passed }]), [], 'a run passing the three as variables was named')
})

test('a run continued onto the next line is read as one run, named by the line it starts on (martha#683)', () => {
  const text = [
    '#!/usr/bin/env bash',
    'node --test --test-timeout=60000 \\',
    "  'src/**/*.node-test.ts'",
  ].join('\n')
  const found = unboundedRunsIn([{ path: 'a_script.sh', text }])
  assert.equal(found.length, 1, 'a run split over two lines was not named')
  assert.equal(found[0]?.line, 2, 'the run is named by the line it starts on')
})

test("a page of prose is read inside its code blocks, and a sentence that names the runner is not a run (martha#683)", () => {
  const text = [
    '# A page',
    '',
    'The suite runs it: node --test is what runs every file, as this sentence says.',
    '',
    '```bash',
    A_RUN(['timeout']),
    '```',
    '',
    '```text',
    'nothing runs here either',
    '```',
  ].join('\n')
  const found = unboundedRunsIn([{ path: 'a_page.md', text, kind: 'a page of prose' }])
  assert.equal(found.length, 1, 'the run in the code block was not named, or the sentence was')
  assert.equal(found[0]?.line, 6, 'the run is named by its line in the page')
  assert.equal(found[0]?.problems.length, 2, `the run was blamed for something else: ${found[0]?.problems.join('; ')}`)
})

test('a package script is one line, and a page outside a code block runs nothing (martha#683)', () => {
  const manifest = 'node prove_the_core/no_test_output_carries_the_environment.ts node --test --test-timeout=60000 --test-force-exit --import=./prove_the_core/fail_a_test_file_that_leaves_something_running.ts "src/**/*.node-test.ts"'
  assert.deepEqual(unboundedRunsIn([{ path: 'package.json#scripts.test', text: manifest, kind: 'a package script' }]), [])
  const bare = 'node --test "src/**/*.node-test.ts"'
  assert.equal(unboundedRunsIn([{ path: 'package.json#scripts.test', text: bare, kind: 'a package script' }]).length, 1)
})

test('a run that states all three is not named, and neither is a comment or a planted manifest (martha#683)', () => {
  const text = [
    '#!/usr/bin/env bash',
    `# ${A_RUN([])} is what an unbounded run looks like, on this line only as prose`,
    `printf '%s\\n' "{\\"scripts\\":{\\"test\\":\\"node --test 'src/**/*.node-test.ts'\\"}}" > "$repo/package.json"`,
    A_RUN(ALL_THREE),
    'node --test --test-timeout="${RUN_TIMEOUT_MS}" "${FORCE_EXIT_FLAG}" "${GUARD_FLAG}" a_file.node-test.ts',
  ].join('\n')
  assert.deepEqual(unboundedRunsIn([{ path: 'a_script.sh', text }]), [])
})
