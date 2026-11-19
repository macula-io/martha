// The launchers a test run left behind (martha#559).
//
// A launch test starts real launchers: a `script -qec ... launcher.ts` pair under a `mkdtemp` home, which is the only
// way to hold a pseudo-terminal and a process group the way the owner's terminal does. Each name is all a reader needs:
// the home is made under the temp dir with the prefix named once below, and the launcher, its shell, the terminal
// `script` holds and the member started there all carry that home in their command line.
//
// What makes one a leftover is not the home but who is above it. A run that is still running has a test runner in its
// ancestors — `node --test`, which this removes nothing from — and everything it started is its own for as long as it
// exists. A run that was killed leaves its launchers reparented away from any runner, and nothing below them will ever
// end them: that is the process this names.
//
// It names, it never stops: killing a process on a check's own say is the owner's to do, and a gate that ended
// processes would be a worse fault than the pile it reports. Silence is earned, not assumed: these are the processes
// this machine has, read from the kernel, so an empty answer means the check looked and found none.
//
// Nothing here reads the machine: the processes are handed to it, so the same rule is pinned by a test that has no
// processes of its own.

import { MINUTE_MS } from '../../src/declare_crew/declare_crew.ts'

/** The prefix a test's throwaway home is made with: one name, read by the tests that make one and by this rule. */
export const A_LAUNCH_HOME_PREFIX = 'martha-cc-launch-'

/** A process as this machine lists it: enough of it to place it under a run, and to say which one it is. */
export interface AProcessSeen {
  readonly pid: number
  readonly ppid: number
  /** Its command line, arguments separated by spaces. */
  readonly command_line: string
  /** When it started, as the kernel's own /proc/<pid> directory holds it: what says how long it has stood. */
  readonly started_at: number
}

/** A launcher a run left behind: the process, the home it was started from, and what it is running. */
export interface ALauncherLeft {
  readonly pid: number
  readonly home: string
  readonly command_line: string
}

/** The milliseconds in a second: what a kernel's clock ticks, and its boot time in seconds, are turned into here. */
export const A_SECOND_MS = 1000

/** Where field 22 sits among the fields after the command name, whose first is field 3 (state). */
const START_TIME_AFTER_COMMAND = 22 - 3

/**
 * Field 22 of a stat line: when the process started, in clock ticks since boot; nothing for a line too short to hold
 * it. The fields are counted from the last closing parenthesis, because the command name in the second field may hold
 * spaces and parentheses of its own.
 */
export const startTicksIn = (stat_line: string): number | undefined => {
  const ticks = Number(stat_line.slice(stat_line.lastIndexOf(')') + 2).split(' ')[START_TIME_AFTER_COMMAND])
  return Number.isInteger(ticks) && ticks >= 0 ? ticks : undefined
}

/** The parent a stat line names, as field 4, counted the same way; nothing for one too short to hold it. */
export const parentIn = (stat_line: string): number | undefined => {
  const parent = Number(stat_line.slice(stat_line.lastIndexOf(')') + 2).split(' ')[1])
  return Number.isInteger(parent) && parent >= 0 ? parent : undefined
}

/**
 * When a process started, as an epoch in milliseconds, from the three things the kernel gives: its start in clock
 * ticks since boot (field 22), the boot's own time in seconds (`btime`), and how many clock ticks the kernel counts to
 * a second (`CLK_TCK`).
 *
 * It is never the timestamp of the process's /proc directory (review r=1, Jupiter): procfs stamps that when the
 * directory is first looked at, not when the process started, so a chain that had stood for hours read as newborn, sat
 * under the age this rule cuts at, and a real leftover passed for clean. The tests could not see it because they
 * planted that timestamp themselves.
 */
export const startedAtOf = (start_ticks: number, boot_time_seconds: number, clock_ticks_per_second: number): number =>
  boot_time_seconds * A_SECOND_MS + (start_ticks / clock_ticks_per_second) * A_SECOND_MS

/** How many ancestors deep a runaway chain is followed before it is read as no runner: a tree is never this deep. */
const ANCESTORS_FOLLOWED = 64

/** The command that runs a test file: the runner a live run has above everything it started. */
const A_TEST_RUN = '--test'

/** The home a command line names, when it names one a test run made: the path of a directory carrying the prefix. */
const theRunHomeNamed = (command_line: string): string | undefined => {
  for (const word of command_line.split(/[\s'"]+/)) {
    const at = word.indexOf(`/${A_LAUNCH_HOME_PREFIX}`)
    if (at === -1) continue
    // The home is the one directory the word names under the prefix: whatever follows it in the word is a file in it.
    const name = word.slice(at + 1).split('/')[0] ?? ''
    if (name.length > A_LAUNCH_HOME_PREFIX.length) return `${word.slice(0, at)}/${name}`
  }
  return undefined
}

/** Whether any ancestor of the process runs tests: a run that is still there is not a run that left anything. */
function aTestIsAbove(pid: number, seen: ReadonlyMap<number, AProcessSeen>): boolean {
  let at = seen.get(pid)?.ppid
  for (let deep = 0; deep < ANCESTORS_FOLLOWED && at !== undefined && at > 1; deep += 1) {
    const ancestor = seen.get(at)
    if (ancestor === undefined) return false
    if (ancestor.command_line.includes(A_TEST_RUN)) return true
    at = ancestor.ppid
  }
  return false
}

/**
 * Every launcher a run left behind: a process that names a home a test run made, with no test runner above it, and that
 * has stood longer than any test holds a launcher for.
 *
 * The terminal `script`, the shell it starts and the launcher itself each name the home, and each is answered for on its
 * own: a run killed hard leaves all three, and a reader that named only one of them would call the other two clean.
 *
 * The wait is not a grace period for the kill: a suite running beside this one starts and ends `script` pairs the whole
 * time, and some of those are reparented away from their spawner while their run is alive and well. A pair that has
 * stood longer than a test ever holds one is not on its way anywhere.
 */
export const theLaunchersLeft = (seen: readonly AProcessSeen[], now: number): readonly ALauncherLeft[] => {
  const byPid = new Map(seen.map((one) => [one.pid, one]))
  return seen.flatMap((one) => {
    const home = theRunHomeNamed(one.command_line)
    if (home === undefined || aTestIsAbove(one.pid, byPid) || now - one.started_at < A_LEFTOVER_STANDS_MS) return []
    return [{ pid: one.pid, home, command_line: one.command_line.trim() }]
  })
}

/** The line a launcher a run left behind is shown as, naming what would end it. */
export const theLineOf = (left: ALauncherLeft): string =>
  `pid ${left.pid} still runs a launcher a run left behind, from ${left.home}: ${left.command_line}`

/**
 * How long a launcher, or a home a run made, must have stood before it is read as left behind: longer than any single
 * test holds a launcher for or holds a place before the launcher it starts is named by it.
 */
export const A_LEFTOVER_STANDS_MS = 30 * MINUTE_MS

/** A home a run made, as the filesystem has it: its path, and when it was last written. */
export interface AHomeSeen {
  readonly path: string
  readonly last_written_at: number
}

/**
 * Every home a run made that outlived its launcher: one carrying the prefix that nothing alive names any more, and that
 * has stood unwritten long enough that no test could still be on its way to starting the launcher that names it.
 *
 * A run's home is not named by the run's own process — it is named by the launcher, the shell and the terminal that
 * were started under it — so this is the only side of a home that can be read at all, and the age is what keeps a place
 * a test has made and not yet launched in from being named as abandoned.
 */
export const theHomesLeft = (homes: readonly AHomeSeen[], named: ReadonlySet<string>, now: number): readonly AHomeSeen[] =>
  homes.filter((home) => home.path.includes(A_LAUNCH_HOME_PREFIX) && !named.has(home.path) && now - home.last_written_at > A_LEFTOVER_STANDS_MS)

/** The line a home that outlived its launcher is shown as. */
export const theHomeLineOf = (home: AHomeSeen, now: number): string =>
  `${home.path} was left by a run whose launcher is gone: nothing names it, and it has not been written for ${Math.round((now - home.last_written_at) / MINUTE_MS)} minute(s)`

/** Every home a test run made that these processes name, whether or not the process naming it is a leftover. */
export const theHomesNamed = (seen: readonly AProcessSeen[]): ReadonlySet<string> =>
  new Set(seen.flatMap((one) => {
    const home = theRunHomeNamed(one.command_line)
    return home === undefined ? [] : [home]
  }))
