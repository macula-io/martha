// Every test file stops what it started (martha#56).
//
// This exists so a test file that leaves a server, socket, timer or child
// running after its tests fails by name, naming the file and what it left,
// instead of passing silently: --test-force-exit (every_test_run_ends.ts) ends
// such a file's process, so without this the leak would never show.
//
// The test script loads fail_a_test_file_that_leaves_something_running.ts into
// every test file's process (--import). It notes what the process holds before
// the file runs, and when --test-force-exit ends the process, after every test
// and every hook, it lets the event loop turn a few times first: a server closed
// in t.after leaves the list only once the loop has turned. Whatever is still
// held then, beyond what was there before the file ran, fails the file.

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
