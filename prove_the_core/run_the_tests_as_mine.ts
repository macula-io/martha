// `npm run test:mine`: the suite, in a process group of its own, with a record this machine can find (martha#802).
//
//   npm run test:mine                          the whole suite, exactly as `npm test` runs it
//   npm run test:mine -- <file>…               one or more files, through `npm run test:file`
//
// The word `test:mine` starts `npm test`; it does not restate a word of it. With files named it starts the single-file
// runner, which keeps its own argument confinement (prove_the_relay_loads/run_the_tests_of_one_file.sh).
//
// The record (the_record_of_a_test_run.ts) names the run's process-group leader, and it is written BEFORE the suite can
// run its first file — by construction, not by timing: the gate is `sh -c 'read -r _ && exec …'`, spawned detached with
// its standard input a pipe. Nothing of the suite runs until this process writes one line to that pipe, and `exec` keeps
// the pid, so the group leader, the identity in the record and the record itself all name the same process.
//
// This process is NOT in that group: it spawned the gate detached, so the gate leads a group and a session of its own.
// A signal this process is given is forwarded to that group, and this process waits for the group to end before it
// removes the record. SIGKILL to this process therefore leaves the suite running AND the record in place, which is what
// `npm run stop:my-run` needs: it stops the run that is still there rather than throwing its handle away.
//
// What a SIGTERM to the group does not reach, said plainly rather than left to be discovered: a process a test file
// started in a group of its own (`detached: true`, `setsid`, `script`, `unshare`). Ending the test file's process does not
// end those, and stopping a run is not cleaning up after a killed one (martha#724, martha#737):
// `npm run check:no-launcher-outlives-its-run` is what finds them afterwards. A run that ends cleanly is its own case.
//
// Exit: the suite's own code; 128 and the signal's number when this process forwarded one; 2 when the run could not be
// started, with its words.

import { spawn, type ChildProcess } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { constants } from 'node:os'
import process from 'node:process'

import { signalAGroupOnThisMachine } from '../src/linux_process_identity/files_and_processes_on_this_machine.ts'
import { recordTheRun, removeTheRecord, theGroupIsGone, type TheRecordOfATestRun } from './the_record_of_a_test_run.ts'

const NAME = 'run_the_tests_as_mine'

/** The shell the gate is started with, and the gate: it runs nothing until one line comes in on its standard input. */
const THE_GATE_SHELL = 'sh'
const THE_GATE = 'read -r _ && exec "$@"'

/** The gate's own `$0`, which the command it runs never reads. */
const THE_GATES_OWN_NAME = 'the-gate'

/** The program the suite is started with, and the script that runs one named file of it. */
const THE_PROGRAM = 'npm'
const THE_WHOLE_SUITE = 'test'
const THE_SINGLE_FILE_SCRIPT = 'test:file'

/** The signals this process forwards to the run's group: the ones a terminal, a tool and a session ending send. */
export const THE_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
type TheSignal = (typeof THE_SIGNALS)[number]

/** How long this process waits for a group it signalled to end before it ends anyway and keeps the record. */
const THE_GROUPS_END_WAIT_MS = 30_000

/** How often that wait looks. */
const THE_WAIT_LOOKS_MS = 100

/** The exit code a shell ends with after a signal: 128 and the signal's own number. */
const theCodeAfter = (signal: TheSignal): number => 128 + (constants.signals[signal] ?? 0)

/** The command the gate runs once it is released: the whole suite, or the one-file runner with the files named. */
const theGateRuns = (files: readonly string[]): readonly string[] =>
  files.length === 0
    ? [THE_PROGRAM, THE_WHOLE_SUITE]
    : [THE_PROGRAM, 'run', THE_SINGLE_FILE_SCRIPT, '--', ...files]

/** The run, with the record that names it. */
interface AStartedRun {
  readonly record: TheRecordOfATestRun
  readonly child: ChildProcess
}

/**
 * The suite behind its gate, and the record of it: spawned detached, recorded, and only then released. A gate that
 * started no process, or no pipe to release it by, is refused rather than left to hang.
 */
function startTheRun(files: readonly string[]): AStartedRun {
  const child = spawn(THE_GATE_SHELL, ['-c', THE_GATE, THE_GATES_OWN_NAME, ...theGateRuns(files)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['pipe', 'inherit', 'inherit'],
  })
  const pid = child.pid
  if (pid === undefined) throw new Error(`${NAME}: the gate started no process`)
  if (child.stdin === null) throw new Error(`${NAME}: the gate started with no line to release it`)
  const record = recordTheRun(pid, realpathSync(process.cwd()))
  child.stdin.end('\n')
  return { record, child }
}

/** The run's own end: the code it ended with, and the signal that ended it when one did. */
const theEndOf = (child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> =>
  new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))

/** Waits for a group to be gone, up to its own bound: what a signalled run gets before this process ends anyway. */
async function theGroupEnds(group: number): Promise<void> {
  const deadline = Date.now() + THE_GROUPS_END_WAIT_MS
  while (!theGroupIsGone(group) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, THE_WAIT_LOOKS_MS))
}

/** One signal this process forwards to the run's group, and the way it is taken back off. */
interface AForwarder {
  readonly signal: TheSignal
  readonly forward: () => void
}

/** A forwarder per signal, each noting the signal and handing it to the group through the one identity-checked call. */
const forwardersFor = (record: TheRecordOfATestRun, noted: { signal?: TheSignal }): readonly AForwarder[] =>
  THE_SIGNALS.map((signal) => {
    const forward = (): void => {
      noted.signal = signal
      // The one call that reads, compares and signals a group (martha#312), so a leader another process has taken is
      // refused. A refused forward changes nothing about this process: the child's own end decides the code below.
      signalAGroupOnThisMachine(record.pid, record.identity, signal)
    }
    process.on(signal, forward)
    return { signal, forward }
  })

/** The suite, started behind its gate, waited for, and its record removed once the run is over. */
async function theSuite(files: readonly string[]): Promise<number> {
  let started: AStartedRun
  try {
    started = startTheRun(files)
  } catch (error) {
    console.error(`${NAME}: ${(error as Error).message}`)
    return 2
  }
  const noted: { signal?: TheSignal } = {}
  const forwarders = forwardersFor(started.record, noted)
  const ended = await theEndOf(started.child)
  for (const forwarder of forwarders) process.off(forwarder.signal, forwarder.forward)
  if (noted.signal !== undefined) await theGroupEnds(started.record.pid)
  removeTheRecord(started.record.token)
  return noted.signal !== undefined ? theCodeAfter(noted.signal) : ended.code ?? 1
}

if (import.meta.main) process.exitCode = await theSuite(process.argv.slice(2))
