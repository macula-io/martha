// A member started on the owner's own terminal runs as that terminal's
// foreground job (martha#54).
//
// This exists so an owner who starts a member from their terminal gets a TUI
// that redraws when the window is resized and takes Ctrl-C and Ctrl-Z as its
// own, and gets their terminal back as it was once the member is gone.
//
// A member always runs in a process group of its own, so one SIGKILL to the
// group stops it and every tool server it started (#41). Started with
// `detached: true` it is also in a session of its own, with no controlling
// terminal: it can still read the inherited terminal (Linux stops only
// background groups of the terminal's own session), but a resize (SIGWINCH)
// and the keys that signal (Ctrl-C, Ctrl-Z) go to the terminal's foreground
// group, which is not the member's. And once it is killed, the terminal is
// left in whatever mode it set (raw, no echo).
//
// Node can make a new session (setsid) but not a new group in the same session
// (setpgid) nor hand a group the terminal (tcsetpgrp). A job-control shell does
// both, so the member is started through one, as a fixed script that takes the
// member's command only as its own arguments ("$@"): nothing from the launch is
// ever part of a shell string. The shell runs privileged (-p), so nothing in the
// member's environment runs in it or changes it: no BASH_ENV file, no exported
// function (one named fg would stand in for the builtin), no SHELLOPTS. In
// order, the script:
//
//   0. ends with NOT_A_COMMAND, before anything starts, when its command is no
//      file it can run (type -P: not on the PATH, not executable, a directory),
//      so the launcher refuses the launch as it does a detached one that cannot
//      be spawned: nothing is said on MEMBER_PID_FD, and the shell's exit status
//      says why;
//   1. turns job control on (set -m);
//   2. starts the member as a job, held: a group of its own whose id is its
//      pid, in the owner's session, that first waits on ADMIT_FD for the
//      launcher's word and only then becomes the member (exec, so the pid and
//      the process's start time are the member's). Without the launcher's pid
//      pipe, so no member can write a pid of its choosing where the launcher
//      reads the group to kill, and without ADMIT_FD once it runs. With no word
//      (the launcher closed ADMIT_FD) the job ends with NOT_ADMITTED and the
//      member never runs;
//   3. writes that pid to the launcher on MEMBER_PID_FD and closes it and its
//      own ADMIT_FD, so the launcher records the member's own pid while the
//      member cannot have exited, and kills its group (martha#94: started at
//      once, a member could read its line and exit before the launcher had
//      read who held its pid, and was refused as not running). The shell's
//      stderr stays the terminal: a non-interactive job-control shell hands
//      the terminal over through it, so fg fails with it redirected, and a
//      member killed by a signal shows the shell's one-line job notice;
//   4. brings the job to the foreground (fg), which hands it the terminal, for
//      as long as it is stopped. A member that touches the terminal before the
//      first fg is stopped for it (SIGTTOU or SIGTTIN) and resumed in the
//      foreground; so is one stopped by Ctrl-Z or by a stop it sent itself,
//      which would otherwise keep the terminal from its owner with no shell
//      that can bring it back. (A non-interactive job-control shell does not
//      hand the terminal to a job started in the foreground; only fg does,
//      which is why the job is started in the background.)
//   5. when the job ends, by itself or killed, the shell has the terminal back
//      for the launcher's group (its own) and puts back the settings it saved
//      when fg handed the terminal over: bash's job control does both, and the
//      tests that kill a member and that let one exit with the terminal changed
//      fail if a bash does not;
//   6. ends the way the member ended: a member killed by a signal ends the
//      shell with the same signal (a shell sees both as 128+n, so a member that
//      exits with 128+n by itself reads as killed by n).
//
// The member is put on the terminal this way only when the launcher's stderr is
// that terminal too (isOnTheOwnersTerminal): bash takes the terminal it hands a
// job from its own stderr, so with stderr redirected fg could never hand it over
// and the member would wait for it forever. Such a launch starts the member
// detached instead, where it still reads the terminal it inherits.
//
// What the member gets as the foreground job is the terminal it was handed
// anyway, through its inherited stdio: reading it, writing it and setting its
// modes. What it gains is the terminal's signals. It keeps none of it once its
// group is dead: step 5 runs whenever the job ends, and the launcher kills the
// group whenever it stops or exits (launch_a_claude_code_member.ts).

import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { Writable } from 'node:stream'
import { isatty } from 'node:tty'

/** The job-control shell: a fixed path, never looked up through the member's PATH. */
export const JOB_SHELL = '/bin/bash'

/** Privileged mode: the shell reads no BASH_ENV, imports no function and ignores SHELLOPTS. */
const NOTHING_FROM_THE_ENVIRONMENT = '-p'

/** The descriptor on which the script tells the launcher the member's pid. */
export const MEMBER_PID_FD = 3

/** The descriptor on which the launcher admits the held member: a line to run it, closed to never. */
export const ADMIT_FD = 4

/**
 * The status a held member's job ends with when the launcher does not admit it.
 * Below 126, so no shell reads it as a command that could not run or was not
 * found, and below 128, so none reads it as a signal.
 */
export const NOT_ADMITTED = 125

/** The name the script runs under ($0), as `ps` shows it. */
export const JOB_SHELL_NAME = 'martha-member-job'

/** Why a launch on the owner's terminal starts nothing: its command is no file this shell can run. */
export const notACommandThisTerminalCanRun = (command: string): string => `${command} is not a command this terminal can run.`

/** The status the script ends with when its command is no file it can run, as a shell's own is. */
export const NOT_A_COMMAND = 127

/** The script, fixed: the member's command reaches it only as "$@". */
export const FOREGROUND_JOB_SCRIPT = [
  `type -P -- "$1" > /dev/null || exit ${NOT_A_COMMAND}`,
  'set -m',
  `{ read -r _ <&${ADMIT_FD} || exit ${NOT_ADMITTED}; exec ${ADMIT_FD}<&- "$@"; } ${MEMBER_PID_FD}>&- &`,
  `echo "$!" >&${MEMBER_PID_FD}`,
  `exec ${MEMBER_PID_FD}>&- ${ADMIT_FD}<&-`,
  // fg prints the job's command line; only that goes nowhere. A job stopped by
  // SIGTSTP (Ctrl-Z) makes bash break out of every loop it is in, and a stop
  // abandons the rest of the list fg is in, so the resuming is a function that
  // calls itself again, with fg and what reads its status commands of their own.
  'resume() {',
  '  fg > /dev/null',
  '  rc=$?',
  '  [ -z "$(jobs -s)" ] || resume',
  '}',
  'resume',
  '[ "$rc" -gt 128 ] && kill -s "$(kill -l "$rc")" "$$"',
  'exit "$rc"',
].join('\n')

/**
 * Whether a launch hands the member the owner's terminal: its stdio is
 * inherited, and the launcher's standard input and its stderr, through which
 * the job-control shell hands the terminal over, are terminals.
 */
export function isOnTheOwnersTerminal(stdio: StdioOptions): boolean {
  return stdio === 'inherit' && isatty(0) && isatty(2)
}

/** How a member's start ends: its pid, which is also its group's id, or why it did not start. */
export type MemberStart = { readonly pid: number } | { readonly refusal: string }

/** What the launcher decided about a held member: whether it runs. */
export interface Admission {
  readonly admitted: boolean
}

/** How a held member's start ends: its pid and what the launcher decided while it was held, or why it did not start. */
export type HeldMemberStart<A extends Admission> = { readonly pid: number; readonly admission: A } | { readonly refusal: string }

export interface ForegroundJob<A extends Admission> {
  /** The job-control shell; it exits once the member has and the terminal is given back. */
  readonly shell: ChildProcess
  /** The member's pid and its admission, or why it never started. */
  readonly member: Promise<HeldMemberStart<A>>
}

/**
 * Starts a member as the foreground job of the owner's terminal, which the
 * launcher inherits. `admit` is asked once, with the member's pid, while the
 * member is held and so cannot have exited; the member runs only when it says
 * so. One that throws admits nobody, and the start ends with why.
 */
export function startForegroundJob<A extends Admission>(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
  admit: (pid: number) => A,
): ForegroundJob<A> {
  const stdio: StdioOptions = ['inherit', 'inherit', 'inherit', 'pipe', 'pipe']
  const shell = spawn(JOB_SHELL, [NOTHING_FROM_THE_ENVIRONMENT, '-c', FOREGROUND_JOB_SCRIPT, JOB_SHELL_NAME, command, ...args], { ...options, stdio })
  const said = shell.stdio[MEMBER_PID_FD]
  // A 'pipe' descriptor past the first three is a socket, which writes.
  const admitFd = shell.stdio[ADMIT_FD]
  const gate = admitFd instanceof Writable ? admitFd : undefined
  // The held member's word: a line runs it; closing the gate unsaid never does.
  const decide = (pid: number): HeldMemberStart<A> => {
    try {
      const admission = admit(pid)
      if (admission.admitted) gate?.end('\n')
      else gate?.destroy()
      return { pid, admission }
    } catch (error) {
      gate?.destroy()
      return { refusal: `${command} was not admitted (${error instanceof Error ? error.message : String(error)}).` }
    }
  }
  const exited = new Promise<number | null>((resolve) => shell.once('exit', (code) => resolve(code)))
  const noPid = `${command} could not be started (no pid).`
  // A shell that said no pid ends on its own: its status says whether its command was one it could not run.
  const whyNot = async (): Promise<HeldMemberStart<A>> => ({ refusal: (await exited) === NOT_A_COMMAND ? notACommandThisTerminalCanRun(command) : noPid })
  const member = new Promise<HeldMemberStart<A>>((resolve) => {
    if (said === null || said === undefined) return resolve({ refusal: noPid })
    // The first line is the pid; the launcher decides on it once.
    let text = ''
    const onData = (chunk: Buffer): void => {
      text += chunk.toString()
      const end = text.indexOf('\n')
      if (end === -1) return
      said.off('data', onData)
      const pid = Number(text.slice(0, end))
      if (Number.isInteger(pid) && pid > 1) return resolve(decide(pid))
      gate?.destroy()
      resolve({ refusal: noPid })
    }
    said.on('data', onData)
    said.once('close', () => void whyNot().then(resolve))
    shell.once('error', (error) => resolve({ refusal: `${command} could not be started (${error.message}).` }))
  })
  return { shell, member }
}
