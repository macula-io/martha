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
//   1. turns job control on (set -m);
//   2. starts the member as a job, without the launcher's pipe, so no member
//      can write a pid of its choosing where the launcher reads the group to
//      kill: a group of its own whose id is its pid, in the owner's session;
//   3. writes that pid to the launcher on MEMBER_PID_FD and closes it, so the
//      launcher records the member's own pid and kills its group. The shell's
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
// A command that cannot be run is not refused at start here, as it is when
// detached: the member starts, and stops at once with 127 or 126.
//
// What the member gets as the foreground job is the terminal it was handed
// anyway, through its inherited stdio: reading it, writing it and setting its
// modes. What it gains is the terminal's signals. It keeps none of it once its
// group is dead: step 5 runs whenever the job ends, and the launcher kills the
// group whenever it stops or exits (launch_a_claude_code_member.ts).

import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process'
import { isatty } from 'node:tty'

/** The job-control shell: a fixed path, never looked up through the member's PATH. */
export const JOB_SHELL = '/bin/bash'

/** Privileged mode: the shell reads no BASH_ENV, imports no function and ignores SHELLOPTS. */
const NOTHING_FROM_THE_ENVIRONMENT = '-p'

/** The descriptor on which the script tells the launcher the member's pid. */
export const MEMBER_PID_FD = 3

/** The name the script runs under ($0), as `ps` shows it. */
export const JOB_SHELL_NAME = 'martha-member-job'

/** The script, fixed: the member's command reaches it only as "$@". */
export const FOREGROUND_JOB_SCRIPT = [
  'set -m',
  `"$@" ${MEMBER_PID_FD}>&- &`,
  `echo "$!" >&${MEMBER_PID_FD}`,
  `exec ${MEMBER_PID_FD}>&-`,
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
 * inherited and the launcher's standard input is a terminal.
 */
export function isOnTheOwnersTerminal(stdio: StdioOptions): boolean {
  return stdio === 'inherit' && isatty(0)
}

export interface ForegroundJob {
  /** The job-control shell; it exits once the member has and the terminal is given back. */
  readonly shell: ChildProcess
  /** The member's pid, which is also its group's id; undefined when it never started. */
  readonly member: Promise<number | undefined>
}

/** Starts a member as the foreground job of the owner's terminal, which the launcher inherits. */
export function startForegroundJob(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv },
): ForegroundJob {
  const stdio: StdioOptions = ['inherit', 'inherit', 'inherit', 'pipe']
  const shell = spawn(JOB_SHELL, [NOTHING_FROM_THE_ENVIRONMENT, '-c', FOREGROUND_JOB_SCRIPT, JOB_SHELL_NAME, command, ...args], { ...options, stdio })
  const said = shell.stdio[MEMBER_PID_FD]
  const member = new Promise<number | undefined>((resolve) => {
    if (said === null || said === undefined) return resolve(undefined)
    // The first line is the pid.
    let text = ''
    said.on('data', (chunk: Buffer) => {
      text += chunk.toString()
      const end = text.indexOf('\n')
      if (end === -1) return
      const pid = Number(text.slice(0, end))
      resolve(Number.isInteger(pid) && pid > 1 ? pid : undefined)
    })
    said.once('close', () => resolve(undefined))
    shell.once('error', () => resolve(undefined))
  })
  return { shell, member }
}
