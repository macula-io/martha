// Every test file stops what it started (martha#56), and removes what it made.
//
// This exists so a test file that leaves a server, socket, timer or child running after its tests fails by name,
// naming the file and what it left, instead of passing silently: --test-force-exit (every_test_run_ends.ts) ends such
// a file's process, so without this the leak would never show.
//
// What a file leaves on disk is judged the same way, by another means (martha#724). Every file's process is handed a
// TMPDIR and an XDG_RUNTIME_DIR of its own, made under a run's two roots (keep_a_test_run_in_one_temporary_root.ts), and
// both start empty: so whatever is in them when the file ends is that file's, whatever its name. There is no list of
// names to keep and nothing is removed by name, which is what a shared directory forced on part 1: it watched
// `martha-472-link-<pid>`, a name no later run can know the owner of, and 95 of them still dangle in the crew machine's
// /tmp. A file given no run root — one run by hand, as a guarded run of one file is — is given a pair of directories of
// its own under the same two bases, and removes them when it ends.
//
// The test script loads fail_a_test_file_that_leaves_something_running.ts into every test file's process (--import). It
// notes what the process holds before the file runs, hands the file its directories, and when --test-force-exit ends the
// process, after every test and every hook, it lets the event loop turn a few times first: a server closed in t.after
// leaves the list only once the loop has turned. Whatever is still held, or is still in either directory, fails the
// file by name.

import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'

import { SYSTEM_TEMPORARY_DIRECTORY } from '../../src/host_contract/host_contract.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

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
 * The variables a run's two roots are handed to the command in (keep_a_test_run_in_one_temporary_root.ts), so a file's
 * own directories are made inside them and a run that left its roots behind can be told from a live one.
 */
export const RUN_RUNTIME_ROOT_VARIABLE = 'MARTHA_TEST_RUN_RUNTIME_ROOT'
export const RUN_TEMP_ROOT_VARIABLE = 'MARTHA_TEST_RUN_TEMP_ROOT'

/** A file's own directory in the roots: this letter and four hex characters, the shortest name that rarely clashes. */
export const PER_FILE_DIRECTORY_PREFIX = 'f'
const PER_FILE_NAME_BYTES = 2
/** How many names a file tries before it is refused: a clash is retried, and a run's roots are otherwise empty. */
const PER_FILE_ATTEMPTS = 32
/** Only the file's own process may enter the directory it keeps what it made in. */
const PER_FILE_DIRECTORY_MODE = 0o700

/** Whether `path` was made new; a name already taken is not an error, and anything else is. */
function mkdirIfNew(path: string): boolean {
  try {
    mkdirSync(path, { mode: PER_FILE_DIRECTORY_MODE })
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    return false
  }
}

/**
 * A new directory of `under`'s, named so a file's own is never another file's. The same code makes a file's directories
 * and the probe keep_a_test_run_in_one_temporary_root.ts measures the socket budget with, so both count the same name.
 */
export function makeAPerFileDirectory(under: string): string {
  for (let attempt = 0; attempt < PER_FILE_ATTEMPTS; attempt += 1) {
    const path = join(under, `${PER_FILE_DIRECTORY_PREFIX}${randomBytes(PER_FILE_NAME_BYTES).toString('hex')}`)
    if (mkdirIfNew(path)) return path
  }
  throw new Error(`${String(PER_FILE_ATTEMPTS)} names of ${under} were all taken, so a file cannot be given a directory`)
}

/** The two directories a file's process is given: its own `TMPDIR` and its own `XDG_RUNTIME_DIR`. */
export interface TheFilesDirectories {
  readonly runtime: string
  readonly temp: string
}

/** The runtime directory a run's roots sit in: the one the machine keeps, else the system's temporary directory. */
export const theRuntimeBase = (env: NodeJS.ProcessEnv): string => {
  const runtime = env['XDG_RUNTIME_DIR']
  return runtime !== undefined && isAbsolute(runtime) ? runtime : SYSTEM_TEMPORARY_DIRECTORY
}

/**
 * A file's own directories, made inside the run's roots; or, when no run made any, under the same two bases the run would
 * have made its roots in — the file then removes them itself when it ends. `TMPDIR` is taken as it is given, never
 * resolved: a suite run under a linked `TMPDIR` stays linked (martha#79, and the stage in ci.yml that runs it so).
 */
export function takeTheFilesDirectories(env: NodeJS.ProcessEnv = process.env): TheFilesDirectories {
  const runtime = env[RUN_RUNTIME_ROOT_VARIABLE]
  const temp = env[RUN_TEMP_ROOT_VARIABLE]
  return runtime !== undefined && temp !== undefined
    ? { runtime: makeAPerFileDirectory(runtime), temp: makeAPerFileDirectory(temp) }
    : { runtime: makeAPerFileDirectory(theRuntimeBase(env)), temp: makeAPerFileDirectory(tmpdir()) }
}

/**
 * Where Node's compile cache goes for the children a file starts: the place the environment names, else one directory
 * under the temp root the file's own directory sits in, never in the directory its leftovers are judged from. npm turns
 * the cache on for every script it runs (it sets NODE_COMPILE_CACHE when nothing does), so a file that runs `npm` hands
 * one to its children, and Node's own cache is not the file's leftover (martha#724).
 */
export const theCompileCacheIn = (under: string, env: NodeJS.ProcessEnv): string =>
  env['NODE_COMPILE_CACHE'] ?? join(under, THE_COMPILE_CACHE)

/** The name that cache is made under, beside the run's own directory. */
export const THE_COMPILE_CACHE = 'compile-cache'

/** What is in `directory`, or nothing when it is not there: a file that removed its own directory leaves nothing behind. */
export function entriesIn(directory: string): string[] {
  try {
    return readdirSync(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** The two shapes a recorded-host case and its runs make in a temporary directory: a case's home, and a run's runtime. */
export const A_CASES_HOME = 'martha-model-host-'
const A_RUNS_RUNTIME = /^m-[A-Za-z0-9]{6}$/

/**
 * Removes what appeared in `directory` since `before` was taken, where it is one of the two shapes a recorded-host
 * case's own runs make: a case that stops a run on purpose can cut that run off before its own end reaches the
 * directory it made, and the file still removes what it made, however far that run got (martha#724). A name that was
 * already there when the file began, or that is neither shape, is left alone: what another process keeps in a shared
 * directory is never a file's to remove, which is why this is the one removal by name left in this module.
 */
export function removeWhatAppearedIn(directory: string, before: ReadonlySet<string>): void {
  for (const name of entriesIn(directory)) {
    if (before.has(name)) continue
    if (name.startsWith(A_CASES_HOME) || A_RUNS_RUNTIME.test(name)) removeTheTree(join(directory, name))
  }
}

/** The line that fails `file` for what it left behind in its own temp directory. */export const leftoverReportOf = (file: string, left: readonly string[]): string =>
  `${file} left behind in the temp directory after its tests: ${left.join(', ')}. Remove it in t.after.`

/** The same for the runtime directory the file was given, where its sockets and short paths go. */
export const runtimeLeftoverReportOf = (file: string, left: readonly string[]): string =>
  `${file} left behind in its runtime directory after its tests: ${left.join(', ')}. Remove it in t.after.`

/**
 * Removes the two directories a file was given, whatever it left in them: a red file does not leave the box dirty.
 */
export function removeTheFilesDirectories(directories: TheFilesDirectories): void {
  removeTheTree(directories.runtime)
  removeTheTree(directories.temp)
}
