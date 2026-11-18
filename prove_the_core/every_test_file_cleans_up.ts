// Every test file stops what it started (martha#56), and removes what it made.
//
// This exists so a test file that leaves a server, socket, timer or child
// running after its tests fails by name, naming the file and what it left,
// instead of passing silently: --test-force-exit (every_test_run_ends.ts) ends
// such a file's process, so without this the leak would never show. For the
// same reason a file that leaves one of the names below in the temp directory
// fails by name: a name carrying a run's own pid can never be removed by a
// later run, so each one that leaks stays for good (martha-472-link-<pid>, 95
// of them dangling in the crew machine's /tmp when this was written).
//
// The test script loads fail_a_test_file_that_leaves_something_running.ts into
// every test file's process (--import). It notes what the process holds and
// what the temp directory holds before the file runs, and when
// --test-force-exit ends the process, after every test and every hook, it lets
// the event loop turn a few times first: a server closed in t.after leaves the
// list only once the loop has turned. Whatever is still held, or is still in
// the temp directory, beyond what was there before the file ran, fails the file.

import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

/** How often the loop turns before what is still held counts as left running. */
export const SETTLE_TURNS = 5

/** What each kind of resource Node lists is, in words. */
const RESOURCE_WORDS: Readonly<Record<string, string>> = {
  TCPServerWrap: 'a listening TCP server',
  TCPWrap: 'a TCP socket',
  PipeServerWrap: 'a listening pipe server',
  PipeWrap: 'a pipe',
  UDPWrap: 'a UDP socket',
  ProcessWrap: 'a child process',
  Timeout: 'a timer (setTimeout or setInterval)',
  Immediate: 'a setImmediate callback',
  FSEventWrap: 'a file watcher',
  StatWatcher: 'a file watcher',
  SignalWrap: 'a signal listener',
  TTYWrap: 'a terminal stream',
}

/** What `now` holds beyond `before`, each kind counted: two timers before and three now leave one. */
export function leftRunning(before: readonly string[], now: readonly string[]): string[] {
  const left = [...now]
  for (const resource of before) {
    const at = left.indexOf(resource)
    if (at >= 0) left.splice(at, 1)
  }
  return left
}

/** The line that fails `file` for what it left running. */
export const leakReportOf = (file: string, left: readonly string[]): string =>
  `${file} left running after its tests: ${left
    .map((resource) => (RESOURCE_WORDS[resource] === undefined ? resource : `${RESOURCE_WORDS[resource]} (${resource})`))
    .join(', ')}. Stop it in t.after.`

/**
 * The names a test file must never leave in the temp directory. Each carries a run's own pid, so no later run can
 * know whose it is and remove it: one that leaks is a dangling symlink for good (`martha-472-link-<pid>`, the first
 * of these, left 95 in the crew machine's /tmp). The next leak of this kind is one more prefix here.
 */
export const NEVER_LEFT_IN_THE_TEMP_DIRECTORY = ['martha-472-link-'] as const

/** Every name in the temp directory carrying one of those prefixes, whoever left it. */
export const leftoversInTheTempDirectory = (): string[] =>
  readdirSync(tmpdir()).filter((name) => NEVER_LEFT_IN_THE_TEMP_DIRECTORY.some((prefix) => name.startsWith(prefix)))

/**
 * The names this run could have left: each prefix with this process's own pid. Judging only these is what keeps the
 * check sound while files run side by side — another file's link is made and removed inside its own run, and one
 * seen from here would never be this run's to answer for.
 */
export const thisRunsLeavings = (): string[] => {
  const there = new Set(readdirSync(tmpdir()))
  return NEVER_LEFT_IN_THE_TEMP_DIRECTORY.map((prefix) => `${prefix}${process.pid}`).filter((name) => there.has(name))
}

/** What `now` holds beyond `before`: the names a file left behind. */
export const leftBehind = (before: readonly string[], now: readonly string[]): string[] =>
  now.filter((name) => !before.includes(name))

/** The line that fails `file` for what it left behind in the temp directory. */
export const leftoverReportOf = (file: string, left: readonly string[]): string =>
  `${file} left behind in the temp directory after its tests: ${left.join(', ')}. Remove it in t.after.`
