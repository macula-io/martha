// The end of the run a test's launcher belongs to (martha#559).
//
// A test file is a run: the test script gives it a process of its own, and every launcher it starts is that run's. Nothing
// in the chain notices when the run goes. The launcher was given no signal, the shell the terminal puts between them is
// only waiting on it, and `script` stays up for as long as the shell does — so a run killed by a shell timeout or by
// `--test-force-exit` leaves a launcher, its shell and its terminal running, each holding a pseudo-terminal, until enough
// of them exist that the next launch test stops reporting.
//
// So the run keeps a pipe open for as long as it exists, and the launcher reads the other end of it BY PATH. A pipe's
// path is the same pipe wherever it is opened from, which is what makes this reachable from a launcher three processes
// below the run, behind `script` and a shell: a descriptor handed that far would have to be arranged at every spawn.
// The run's end is then the kernel's own answer, not a signal that has to find its way down a chain that outlives it.
//
// What the launcher does when its run has gone: it stops the member it started, with the reason the product gives for it,
// and waits for it to be gone; it removes the home the run made for it, before anything can end this process; it ends
// the shell that waits on it, whose `script` then ends with it and closes the terminal; and then it ends.
//
// This is the run's end as a test's launcher reads it. The product reads the same kind of pipe from a descriptor it is
// handed, in src/end_a_launch_when_its_run_ends/the_run_lifeline.ts, because a launcher the owner starts takes its
// lifeline from `martha start`. Neither reader is the other's: this one is a harness's, and it opens the pipe it was
// told the name of.

import { constants, existsSync, openSync, readFileSync, readSync, rmSync } from 'node:fs'
import process from 'node:process'

import { PROC_ROOT } from '../src/linux_process_identity/process_identity_from_proc.ts'
import { THE_RUN_IS_GONE } from '../src/end_a_launch_when_its_run_ends/the_run_lifeline.ts'

/** How often a launcher asks whether its run is still there: often enough that a killed run leaves nothing for long. */
const POLL_FOR_THE_END_MS = 200

/** The member a launcher started, as the launcher's own launch hands it back: enough of it to stop and to wait. */
export interface TheMemberItStarted {
  readonly started: boolean
  readonly stop: (why: string) => void
  readonly stopped: Promise<unknown>
}

/** What a launcher reads to end with its run: the pipe, the home it was given, where its shell noted itself, and its member. */
export interface ALauncherOnItsOwn {
  /** The path of the pipe whose other end the run holds for as long as the run exists. */
  readonly run_ends_at: string
  /** The home the run made for this launcher, which goes with the run. */
  readonly home: string
  /** The file the terminal's shell noted its own pid in, or a name no such file has when there is no terminal. */
  readonly shell_noted_at: string
  /** The member this launcher started, once the launch has settled; nothing when it started none. */
  readonly the_member: () => Promise<TheMemberItStarted | undefined>
}

/** A pipe's end, once read: 0 is the run gone, and a writer still there answers EAGAIN on a pipe opened unblocked. */
function thePipeIsAtItsEnd(fd: number): boolean {
  try {
    return readSync(fd, Buffer.alloc(1), 0, 1, null) === 0
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EAGAIN') return false
    throw error
  }
}

/**
 * The run's end, read from the pipe's path, as a watch: `what` runs the moment the pipe's other end closes. A path this
 * process cannot open is the run gone too — nothing here can be given the benefit of the doubt, since a launcher that
 * read silence as a live run is the orphan this exists to prevent.
 *
 * It is asked, not waited on: the interval never keeps this process up by itself, because what keeps a launcher up is
 * its member, and a launcher that ended its own work must be free to end.
 */
function theRunsEndAt(path: string): (what: () => void) => void {
  let opened: number | undefined
  try {
    opened = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
  } catch {
    opened = undefined
  }
  const fd = opened
  return (what) => {
    if (fd === undefined) return what()
    const asking = setInterval(() => {
      if (!thePipeIsAtItsEnd(fd)) return
      clearInterval(asking)
      what()
    }, POLL_FOR_THE_END_MS)
    asking.unref()
  }
}

/** The pid a note holds, when it holds one and that process still names this launcher's home: nothing otherwise. */
function theShellThatWaitsOnUs(note: string, home: string): number | undefined {
  if (!existsSync(note)) return undefined
  const written = Number(readFileSync(note, 'utf8').trim())
  if (!Number.isInteger(written) || written < 2) return undefined
  // A pid written before a run may name another process now: only one that names this home is ended here, which is the
  // launcher's own shell or nothing at all.
  try {
    return readFileSync(`${PROC_ROOT}/${written}/cmdline`, 'utf8').includes(home) ? written : undefined
  } catch {
    return undefined
  }
}

/** The shell that waits on this launcher, ended: its `script` then ends with it, and the terminal goes. */
function endTheShellThatWaits(shell: number | undefined): void {
  if (shell === undefined) return
  try {
    process.kill(shell, 'SIGTERM')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** Everything a launcher owes its run's end, in this order: the member, the home, the shell, itself. */
async function endingTheLauncher(what: ALauncherOnItsOwn): Promise<void> {
  try {
    // Read before the home goes: the shell noted its pid in a file of that home, and the note is how it is found.
    const shell = theShellThatWaitsOnUs(what.shell_noted_at, what.home)
    const member = await what.the_member()
    if (member?.started === true) {
      member.stop(THE_RUN_IS_GONE)
      await member.stopped
    }
    // The home the run made goes before the shell is ended and not after: ending the shell closes the terminal `script`
    // holds, and a terminal's hangup reaches the foreground group — this process — so a home removed after it is a home
    // removed by nobody. It goes whether or not the member could be stopped: it is the run's, the run is gone, and this
    // process is the only one left that could remove it.
    rmSync(what.home, { recursive: true, force: true })
    endTheShellThatWaits(shell)
  } finally {
    process.exit(0)
  }
}

/**
 * Ends this launcher when the run that started it goes, at once when it already has: the member first, then the home,
 * then the shell that waits on this process, then this process itself (martha#559).
 *
 * Called before the launch, so a run that goes while a member is being admitted is answered as soon as the launch
 * settles rather than not at all.
 */
export function endTheLauncherWhenItsRunGoes(what: ALauncherOnItsOwn): void {
  theRunsEndAt(what.run_ends_at)(() => void endingTheLauncher(what))
}
