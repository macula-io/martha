// Every test run ends on its own (martha#56).
//
// This exists so a test that hangs fails by name within a bounded time, and its
// process exits, instead of running until something outside kills the runner:
// a tool's command timeout kills only the runner, and node --test runs every
// test file in a child process of its own, which is then left running for hours
// on the member's machine, holding whatever it had open.
//
// Two flags on the test script do it, and both are needed (measured on Node
// 26.10 with a test that waits forever holding a listening socket):
//
//   --test-timeout=<ms>  fails a test that runs longer than <ms>, by name. Alone
//                        it is not enough: the cancelled file's process stays
//                        alive while the socket is open, and the runner waits.
//   --test-force-exit    ends each file's process once its tests are done,
//                        whatever it still holds open.
//
// Force-exit alone would end a leaking file silently, so a third flag makes
// every file that leaves something running fail by name:
//
//   --import=<GUARD>     loads fail_a_test_file_that_leaves_something_running.ts
//                        into each file's process (every_test_file_cleans_up.ts).
//
// Every package whose tests npm test runs (PACKAGES: the repository's and the
// installer's, martha#112) passes all three; each imports GUARD by its path from
// its own folder (guardFlagFrom).
//
// The timeout is defined once, in package.json's test script. Nothing restates
// it: what needs it reads it from there (testRunBoundOf).

import { posix } from 'node:path'

import type { Manifest } from './declared_in_package_json.ts'

export const TEST_SCRIPT = 'test'
export const TIMEOUT_FLAG = '--test-timeout'
export const FORCE_EXIT_FLAG = '--test-force-exit'
/** The module every test file's process loads first, to fail the file for what it leaves running, from the repository. */
export const GUARD = 'prove_the_core/fail_a_test_file_that_leaves_something_running.ts'
/**
 * The flag that loads GUARD in the test script of the package in `folder` (a
 * folder of the repository, '.' for the repository itself): each package's
 * script runs from its own folder, so the path is the guard's from there.
 */
export const guardFlagFrom = (folder: string): string => {
  const path = posix.relative(folder, GUARD)
  return `--import=${path.startsWith('../') ? path : `./${path}`}`
}
/** The flag in the repository's own test script. */
export const GUARD_FLAG = guardFlagFrom('.')

/** The test a_test_that_hangs_holding_a_socket.ts holds forever. */
export const HUNG_TEST_NAME = 'a test that waits forever holding a socket'

export type TestRunBound =
  | { readonly bounded: true; readonly timeout_ms: number; readonly flags: readonly string[] }
  | { readonly bounded: false; readonly problems: readonly string[] }

/** The words of a script, split on whitespace; a quoted glob stays one word. */
const wordsOf = (script: string): string[] => script.split(/\s+/).filter((word) => word !== '')

/** Every flag the test script passes to node after --test (the `--test-*` and `--import=` words), bounded or not. */
export const testRunFlagsOf = (manifest: Manifest): string[] =>
  wordsOf(manifest.scripts[TEST_SCRIPT] ?? '').filter((word) => word.startsWith('--test-') || word.startsWith('--import='))

/**
 * Whether the test script of the package in `folder` bounds every test, ends
 * every file's process and fails a file that leaves something running, and with
 * which flags (testRunFlagsOf).
 */
export function testRunBoundOf(manifest: Manifest, folder = '.'): TestRunBound {
  const script = manifest.scripts[TEST_SCRIPT]
  if (script === undefined) return { bounded: false, problems: [`package.json has no "${TEST_SCRIPT}" script`] }
  const words = wordsOf(script)
  const { timeouts, timeout_ms } = timeoutOf(words)
  const problems = [...timeoutProblemsOf(timeouts, timeout_ms), ...exitAndGuardProblemsOf(words, guardFlagFrom(folder))]
  if (problems.length > 0 || timeout_ms === undefined) return { bounded: false, problems }
  return { bounded: true, timeout_ms, flags: testRunFlagsOf(manifest) }
}

/** The script's timeout flags, and the timeout when it says one, once, as a whole number of ms above 0. */
function timeoutOf(words: readonly string[]): { timeouts: string[]; timeout_ms: number | undefined } {
  const timeouts = words.filter((word) => word === TIMEOUT_FLAG || word.startsWith(`${TIMEOUT_FLAG}=`))
  const value = timeouts.length === 1 ? timeouts[0]?.slice(`${TIMEOUT_FLAG}=`.length) : undefined
  const timeout_ms = value !== undefined && /^[1-9][0-9]*$/.test(value) ? Number(value) : undefined
  return { timeouts, timeout_ms }
}

/** What is wrong with the script's timeout: missing, said more than once, or not a whole number of ms. */
const timeoutProblemsOf = (timeouts: readonly string[], timeout_ms: number | undefined): string[] => [
  ...(timeouts.length === 0 ? [`the test script has no ${TIMEOUT_FLAG}, so a test that hangs never fails`] : []),
  ...(timeouts.length > 1 ? [`the test script passes ${TIMEOUT_FLAG} ${timeouts.length} times; it must say it once`] : []),
  ...(timeouts.length === 1 && timeout_ms === undefined
    ? [`the test script's ${TIMEOUT_FLAG} is not ${TIMEOUT_FLAG}=<a whole number of ms above 0>: ${timeouts[0]}`]
    : []),
]

/** What is wrong with the rest: no force-exit, or no guard that fails a file leaving something running. */
const exitAndGuardProblemsOf = (words: readonly string[], guard_flag: string): string[] => [
  ...(words.includes(FORCE_EXIT_FLAG)
    ? []
    : [`the test script has no ${FORCE_EXIT_FLAG}, so a test file that holds a handle open never exits`]),
  ...(words.includes(guard_flag)
    ? []
    : [`the test script has no ${guard_flag}, so a test file that leaves something running passes silently`]),
]
