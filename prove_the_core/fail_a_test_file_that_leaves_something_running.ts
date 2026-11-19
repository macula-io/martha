// Loaded into every test file's process by the test script (--import), before the file runs: see
// every_test_file_cleans_up.ts for why and how.
//
// Before the file's own code runs, the file is given two directories of its own — its TMPDIR and its XDG_RUNTIME_DIR —
// made under the run's roots (keep_a_test_run_in_one_temporary_root.ts), so everything the file makes in a temporary
// directory or a socket path is inside them (martha#724).
//
// --test-force-exit ends the process through process.exit once every test and hook is done. The exit is held here until
// stdout and stderr have handed on what was written to them, and then for SETTLE_TURNS turns of the loop; then what the
// file left running, and what it left in either of its directories, is judged: either fails the file, by its name and
// what it left, on stderr and with exit code 1. The directories go with the file, red or green.
//
// It also ends the process when the run that started it is gone
// (every_test_run_ends.ts: endWithTheRun, martha#683): force-exit bounds a run left to finish, and does nothing for a
// runner killed from outside.

import { dirname, relative } from 'node:path'
import process from 'node:process'

import { endWithTheRun } from './every_test_run_ends.ts'
import {
  entriesIn,
  leakReportOf,
  leftoverReportOf,
  leftRunning,
  removeTheFilesDirectories,
  runtimeLeftoverReportOf,
  SETTLE_TURNS,
  takeTheFilesDirectories,
  theCompileCacheIn,
} from './every_test_file_cleans_up.ts'

const before = process.getActiveResourcesInfo()
// The file's own directories, set before its first line runs: a tmpdir() its own modules call already answers them.
const files = takeTheFilesDirectories()
process.env.TMPDIR = files.temp
process.env.XDG_RUNTIME_DIR = files.runtime
// Node's own compile cache is not what the file leaves: a child that runs npm gets it under the run's root, beside this
// file's directory, and never inside the directory its leftovers are judged from (every_test_file_cleans_up.ts).
process.env.NODE_COMPILE_CACHE = theCompileCacheIn(dirname(files.temp), process.env)
const exit = process.exit.bind(process)
// The run that started this file is gone once the runner is: end with it rather than outlive it for hours (martha#683).
endWithTheRun(exit)
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
/** Resolves once what was written to `stream` before has been handed on: writes to one stream complete in order. */
const flushed = (stream: NodeJS.WriteStream): Promise<void> => new Promise((resolve) => stream.write('', () => resolve()))

/** What the file left in either of its directories, the temp one first: both started empty, so any entry is its own. */
const leftInItsDirectories = (): { readonly temp: readonly string[]; readonly runtime: readonly string[] } => ({
  temp: entriesIn(files.temp),
  runtime: entriesIn(files.runtime),
})

async function exitOnceSettled(code: Parameters<typeof process.exit>[0]): Promise<void> {
  // The runner reports each test to its parent over stdout; a report still on its way is the runner's write, not
  // something the file left.
  await Promise.all([flushed(process.stdout), flushed(process.stderr)])
  for (let turns = 0; turns < SETTLE_TURNS; turns += 1) await turn()
  const left = leftRunning(before, process.getActiveResourcesInfo())
  const behind = leftInItsDirectories()
  const clean = left.length === 0 && behind.temp.length === 0 && behind.runtime.length === 0
  // The directories go whether the file was clean or not: what it left is named on stderr, above.
  if (!clean) process.stderr.write(`${linesThatFailTheFile(left, behind)}\n`)
  removeTheFilesDirectories(files)
  if (clean) return exit(code)
  exit(1)
}

/** The lines that fail a file for what it left, by its own name, on stderr and in words a person can act on. */
function linesThatFailTheFile(
  left: readonly string[],
  behind: { readonly temp: readonly string[]; readonly runtime: readonly string[] },
): string {
  const file = relative(process.cwd(), process.argv[1] ?? '')
  return [
    ...(left.length === 0 ? [] : [leakReportOf(file, left)]),
    ...(behind.temp.length === 0 ? [] : [leftoverReportOf(file, behind.temp)]),
    ...(behind.runtime.length === 0 ? [] : [runtimeLeftoverReportOf(file, behind.runtime)]),
  ].join('\n')
}

process.exit = ((code) => {
  void exitOnceSettled(code)
  return undefined as never
}) as typeof process.exit
