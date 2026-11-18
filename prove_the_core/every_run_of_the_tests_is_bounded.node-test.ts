// Every run of the tests that ships is bounded (martha#683).
//
// The rule is every_run_of_the_tests_is_bounded.ts. This reads the files that ship a run — every tracked shell script
// and every workflow — and fails by file and line for a run missing one of the three things that bound it. It then
// plants a file missing each of the three, one at a time, so a check that stopped looking for one fails here by name
// rather than passing every run.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { unboundedRunsIn, type AShippedFile } from './every_run_of_the_tests_is_bounded.ts'

/** The repository this check reads. */
const repository = join(import.meta.dirname, '..')

/** The files the repository ships that can start a run: its shell scripts, and its workflows. */
function theShippedRuns(): AShippedFile[] {
  const paths = execFileSync('git', ['-C', repository, 'ls-files', '*.sh', '.github/workflows/*.yml'], { encoding: 'utf8' })
    .split('\n')
    .filter((path) => path !== '')
  return paths.map((path) => ({ path, text: readFileSync(join(repository, path), 'utf8') }))
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

test('every shell script and workflow that starts a run of the tests bounds it (martha#683)', () => {
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
