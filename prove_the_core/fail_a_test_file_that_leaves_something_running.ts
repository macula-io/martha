// Loaded into every test file's process by the test script (--import), before
// the file runs: see every_test_file_cleans_up.ts for why and how.
//
// --test-force-exit ends the process through process.exit once every test and
// hook is done. The exit is held here until stdout and stderr have handed on
// what was written to them, and then for SETTLE_TURNS turns of the loop; then
// what the file left running is judged: anything left fails the file, by its
// name and what it left, on stderr and with exit code 1.
//
// It also ends the process when the run that started it is gone
// (every_test_run_ends.ts: endWithTheRun, martha#683): force-exit bounds a run
// left to finish, and does nothing for a runner killed from outside.

import { relative } from 'node:path'
import process from 'node:process'

import { endWithTheRun } from './every_test_run_ends.ts'
import { leakReportOf, leftRunning, SETTLE_TURNS } from './every_test_file_cleans_up.ts'

const before = process.getActiveResourcesInfo()
const exit = process.exit.bind(process)
// The run that started this file is gone once the runner is: end with it rather than outlive it for hours (martha#683).
endWithTheRun(exit)
const turn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
/** Resolves once what was written to `stream` before has been handed on: writes to one stream complete in order. */
const flushed = (stream: NodeJS.WriteStream): Promise<void> => new Promise((resolve) => stream.write('', () => resolve()))

async function exitOnceSettled(code: Parameters<typeof process.exit>[0]): Promise<void> {
  // The runner reports each test to its parent over stdout; a report still on
  // its way is the runner's write, not something the file left.
  await Promise.all([flushed(process.stdout), flushed(process.stderr)])
  for (let turns = 0; turns < SETTLE_TURNS; turns += 1) await turn()
  const left = leftRunning(before, process.getActiveResourcesInfo())
  if (left.length === 0) exit(code)
  process.stderr.write(`${leakReportOf(relative(process.cwd(), process.argv[1] ?? ''), left)}\n`)
  exit(1)
}

process.exit = ((code) => {
  void exitOnceSettled(code)
  return undefined as never
}) as typeof process.exit
