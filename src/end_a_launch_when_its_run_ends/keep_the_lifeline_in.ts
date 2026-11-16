// The end of the lifeline a run keeps (#472).
//
// This exists so the runs that start a member under a home of its own — the recorded-host driver, its synchronous
// sibling, and a test's own harness — say plainly that the member must not outlive them: the run opens a FIFO, hands
// the launcher only its read end at RUN_LIFELINE_FD, and keeps the write end for as long as it exists.
//
// Two rules keep that end the run's alone, and both are the difference between a lifeline and a decoration:
//   - the write end is opened by this process and by nothing else. A descriptor this process opens is close-on-exec,
//     so no child of the run inherits it: the run's end goes when the run does, and only then.
//   - the read end is the launcher's, handed over as the child's fourth stream. The run closes its own copy once the
//     child has it, and the launcher takes it in again close-on-exec (the_run_lifeline.ts).
//
// A FIFO and not a pair of Node streams, because the launcher has to reopen its end by path to hold it close-on-exec,
// and the kernel refuses to reopen a socket that way (the_run_lifeline.ts says why this matters).

import { execFileSync, spawn, spawnSync, type ChildProcessByStdio, type StdioOptions } from 'node:child_process'
import { closeSync, constants, openSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'

import { RUN_LIFELINE_VARIABLE } from './the_run_lifeline.ts'

/** The descriptor the launcher is given: the child's fourth stream, after its standard ones. */
export const RUN_LIFELINE_FD = 3

/** The pipe's name inside the run's own directory. */
const LIFELINE_NAME = 'lifeline'

/** What a run holds of its lifeline: the descriptor to hand the child, and what keeps its end open. */
export interface TheRunsEnd {
  /** The descriptor the child is given its end at. */
  readonly fd: number
  /** The named pipe itself, which is what a test looks for in the descriptors of a member's group. */
  readonly path: string
  /** What the run adds to its child's environment, naming that descriptor. */
  readonly environment: Readonly<Record<string, string>>
  /** The child's streams, with the lifeline in the fourth: what a run spawns with. */
  readonly stdio: StdioOptions
  /**
   * The run's own end closes, and the pipe's read end stays open for the child that already has it: from here on this
   * run's launcher is told its run has gone, however long this process lives afterwards.
   */
  closeTheRunsEnd(): void
  /** The run is over: its end closes, and the pipe it made goes with it. */
  close(): void
}

/**
 * The run's end of a lifeline, made as a named pipe under `directory`, which the run removes with its own trees.
 *
 * The read end is opened unblocked so the open cannot wait for a writer, and the write end is opened by this process
 * alone: from here until `close`, or until this process ends however it ends, some run holds the other end open.
 */
export function keepTheLifelineIn(directory: string): TheRunsEnd {
  const path = join(directory, LIFELINE_NAME)
  execFileSync('mkfifo', ['-m', '600', path])
  const read = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  let write: number | undefined = openSync(path, 'w')
  const closeTheRunsEnd = (): void => {
    if (write === undefined) return
    closeSync(write)
    write = undefined
  }
  return {
    fd: RUN_LIFELINE_FD,
    path,
    environment: { [RUN_LIFELINE_VARIABLE]: String(RUN_LIFELINE_FD) },
    // The child gets the read end; this process keeps no copy of it, so the run holds one end and the child the other.
    stdio: ['pipe', 'pipe', 'pipe', read],
    closeTheRunsEnd,
    close: () => {
      closeTheRunsEnd()
      closeSync(read)
      rmSync(path, { force: true })
    },
  }
}

/** What a command run on a pseudo-terminal answered: the status it ended with, and everything it showed. */
export interface RanOnAPty {
  readonly status: number | null
  readonly shown: string
}

/**
 * A command run to its end on a pseudo-terminal, holding a lifeline under `directory` for as long as it runs: the
 * launcher it starts takes its member down if this call's process ends first, and the same read is the child's own.
 */
export function ranOnAPtyHoldingALifeline(
  runner: string,
  command: string,
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly input?: string },
  directory: string,
): RanOnAPty {
  const lifeline = keepTheLifelineIn(directory)
  try {
    const ran = spawnSync(runner, ['-qefc', command, '/dev/null'], {
      cwd: options.cwd,
      env: { ...options.env, ...lifeline.environment },
      stdio: lifeline.stdio,
      input: options.input ?? '',
      encoding: 'utf8',
    })
    return { status: ran.status, shown: (ran.stdout ?? '') + (ran.stderr ?? '') }
  } finally {
    lifeline.close()
  }
}

/** A run's own process, on a pseudo-terminal, with the three streams it reads and writes as its own. */
export type TerminalRun = ChildProcessByStdio<Writable, Readable, Readable>

/**
 * A command started on a pseudo-terminal and left running, holding a lifeline under `directory` until `lifeline.close`
 * or until this process ends: the streams are the run's own, and the fourth descriptor is the launcher's.
 *
 * The compiler reads three standard streams as possibly absent where the fourth descriptor is the lifeline, which is
 * why this one place says they are there: the run writes its own input and reads what the terminal shows.
 */
export function spawnOnAPtyHoldingALifeline(
  runner: string,
  command: string,
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
  directory: string,
): { readonly terminal: TerminalRun; readonly lifeline: TheRunsEnd } {
  const lifeline = keepTheLifelineIn(directory)
  const terminal = spawn(runner, ['-qefc', command, '/dev/null'], {
    cwd: options.cwd,
    env: { ...options.env, ...lifeline.environment },
    stdio: lifeline.stdio,
    detached: true,
  }) as TerminalRun
  return { terminal, lifeline }
}
