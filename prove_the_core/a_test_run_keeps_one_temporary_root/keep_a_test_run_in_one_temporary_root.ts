// One test run lives inside one temporary root (martha#724).
//
// npm test runs each stage of the suite through this module. It makes two roots of the run's own — a runtime root for
// the sockets and short paths, a temp root for TMPDIR — hands them to the command in its environment, runs it with its
// output and its exit code passed through, and removes them in a finally. So everything a run writes into a temporary
// place is inside them, and each test file's process is given a directory of its own inside them
// (fail_a_test_file_that_leaves_something_running.ts).
//
// The two bases are the ones a short socket needs. The runtime root goes under XDG_RUNTIME_DIR when the machine keeps
// one, else under the system's temporary directory, which TMPDIR does not move; the temp root goes under the inherited
// TMPDIR, as given and never resolved, because a suite run under a long TMPDIR reached through a link is one of the
// suite's own stages (ci.yml) and must keep measuring that shape.
//
// The runtime root is not trusted to fit: the deepest socket this repository builds is a launched member's, and its
// path is measured from the code's own pieces (the runtime directory the command nests under, the relay root's name,
// a launch's uuid) against the address a socket holds. A base that does not fit is not used; the system temporary
// directory is tried; and a run where neither fits is refused by name rather than failing a launch halfway.
//
// A run that is killed hard leaves its roots behind. Each root carries an owner file, the pid and start time of the run
// that made it, so the next run can tell a dead one from a live one: a root whose owner this kernel no longer holds, or
// holds as another process — another boot, a reused pid — is removed, and a live run's root is never touched. A root
// whose owner file cannot be read is kept and said so on stderr: the rule for anything that removes is that 'unknown'
// is not 'gone' (process_identity_from_proc.ts).

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import { SYSTEM_TEMPORARY_DIRECTORY } from '../../src/host_contract/host_contract.ts'
import { RELAY_ROOT_PREFIX } from '../../src/drive_the_recorded_host/short_relay_root.ts'
import { linuxProcessIdentities } from '../../src/linux_process_identity/process_identity_from_proc.ts'
import { theCommandsRuntimeDirectory } from '../../src/run_the_martha_command/run_the_martha_command.ts'
import { longestSocketPath, RELAY_SOCKET_NAME } from '../../src/serve_the_relay_to_a_launch/relay_directory.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'
import {
  entriesIn,
  makeAPerFileDirectory,
  RUN_RUNTIME_ROOT_VARIABLE,
  RUN_TEMP_ROOT_VARIABLE,
  theCompileCacheIn,
  theRuntimeBase,
} from '../a_test_run_ends/every_test_file_cleans_up.ts'

const NAME = 'keep_a_test_run_in_one_temporary_root'

/** The module npm test runs every stage of the suite through, as the test script names it. */
export const THE_WRAPPER = `./prove_the_core/a_test_run_keeps_one_temporary_root/${NAME}.ts`

/** The name a run's roots are made under: five characters and mkdtemp's six, which is what the socket budget counts. */
export const RUN_ROOT_PREFIX = 'm724-'

/** The file a root carries, naming the run that made it. */
const OWNER_FILE = 'owner.json'

/** Who made a root: the run's pid, and when that process started, boot included (null where the kernel will not say). */
interface TheRunsOwnRoot {
  readonly pid: number
  readonly process_started_at: string | null
}

/** The roots of one run: the runtime root its per-file runtime directories go in, and the temp root its TMPDIRs go in. */
export interface TheRunsRoots {
  readonly runtime: string
  readonly temp: string
}

/** What this kernel says of a pid, the read every removal in this repository rests on. */
const identities = linuxProcessIdentities

/** The owner file of a new root, written before anything else can be put in the root. */
const ownerOfThisRun = (): TheRunsOwnRoot => ({ pid: process.pid, process_started_at: identities.identityOf(process.pid) })

/** A new root of `base`'s, carrying the name of the run that made it. */
function makeARoot(base: string): string {
  const root = mkdtempSync(join(base, RUN_ROOT_PREFIX))
  writeFileSync(join(root, OWNER_FILE), `${JSON.stringify(ownerOfThisRun())}\n`, { mode: 0o600 })
  return root
}

/** What a root's owner file says, or why it cannot be read. */
function theOwnerOf(root: string): TheRunsOwnRoot | string {
  try {
    const held = JSON.parse(readFileSync(join(root, OWNER_FILE), 'utf8')) as Partial<TheRunsOwnRoot>
    if (typeof held.pid !== 'number') return `${OWNER_FILE} names no pid`
    return { pid: held.pid, process_started_at: typeof held.process_started_at === 'string' ? held.process_started_at : null }
  } catch (error) {
    return `${OWNER_FILE} could not be read (${(error as NodeJS.ErrnoException).code ?? String(error)})`
  }
}

/** Whether `root` is a directory this user owns: the only kind a sweep may judge, and the only kind it could remove. */
function isARootOfThisUser(root: string): boolean {
  try {
    const found = statSync(root)
    return found.isDirectory() && found.uid === (process.getuid?.() ?? -1)
  } catch {
    return false
  }
}

/** Says on the run's stderr why a root was left where it was: a sweep that cannot judge something never guesses. */
const sayWhyTheRootStays = (root: string, why: string): void => void process.stderr.write(`${NAME}: ${root} is kept: ${why}\n`)

/**
 * Removes `root` when the run that made it is gone: its owner's pid is no longer held by any process, or is held by
 * another process — another boot, a pid handed out again. A live run's root stays, and so does one this kernel will not
 * speak about, or whose owner file cannot be read.
 */
function sweepOneRoot(root: string): void {
  if (!isARootOfThisUser(root)) return
  const owner = theOwnerOf(root)
  if (typeof owner === 'string') return sayWhyTheRootStays(root, owner)
  const lookup = identities.lookupOf(owner.pid)
  if (lookup.found === 'unknown') return sayWhyTheRootStays(root, lookup.why)
  const alive = lookup.found === 'held' && lookup.identity.process_started_at === owner.process_started_at
  if (!alive) removeTheTree(root)
}

/** Removes every root a run left behind under `base`, and touches nothing else there. */
function sweepTheRootsLeftIn(base: string): void {
  for (const name of entriesIn(base)) if (name.startsWith(RUN_ROOT_PREFIX)) sweepOneRoot(join(base, name))
}

/**
 * The deepest relay socket path this repository can build inside a per-file directory of `runtime_root`: a launched
 * member's, `<runtime root>/fNNNN/martha-relay-XXXXXX/martha-<uid>/<uuid>/relay.sock`. Every piece is the code's own —
 * the relay root's name, the directory the command nests under this user's runtime scope, a launch's uuid — so a change
 * to any of them moves this measurement with it, and nothing here is a number written twice.
 */
function theDeepestSocketPath(runtime_root: string): string {
  const per_file = makeAPerFileDirectory(runtime_root)
  try {
    const relay_root = mkdtempSync(join(per_file, RELAY_ROOT_PREFIX))
    return join(theCommandsRuntimeDirectory(relay_root), randomUUID(), RELAY_SOCKET_NAME)
  } finally {
    removeTheTree(per_file)
  }
}

/** What is wrong with `runtime_root` for the deepest socket: its length, or undefined when it fits. */
function theBudgetProblem(runtime_root: string): string | undefined {
  const longest = longestSocketPath()
  const deepest = theDeepestSocketPath(runtime_root)
  const bytes = Buffer.byteLength(deepest)
  if (bytes <= longest) return undefined
  return `${deepest} is ${String(bytes)} bytes, longer than the ${String(longest)} a socket address holds on ${process.platform}`
}

/**
 * A runtime root whose deepest socket fits: one under `base` when it does, else one under the system's temporary
 * directory, which TMPDIR does not move; or a refusal by name when neither base can hold it.
 */
function aRuntimeRootThatFits(base: string): string {
  const under = makeARoot(base)
  const problem = theBudgetProblem(under)
  if (problem === undefined) return under
  removeTheTree(under)
  if (base === SYSTEM_TEMPORARY_DIRECTORY) throw new Error(`${NAME}: no base holds the deepest relay socket: ${problem}`)
  const fallback = makeARoot(SYSTEM_TEMPORARY_DIRECTORY)
  const fallbackProblem = theBudgetProblem(fallback)
  if (fallbackProblem === undefined) return fallback
  removeTheTree(fallback)
  throw new Error(`${NAME}: neither ${base} nor ${SYSTEM_TEMPORARY_DIRECTORY} holds the deepest relay socket: ${fallbackProblem}`)
}

/** The two roots of one run: the sweep of what earlier runs left comes first, so this run never judges its own. */
function rootsForTheRun(env: NodeJS.ProcessEnv): TheRunsRoots {
  for (const base of new Set([theRuntimeBase(env), SYSTEM_TEMPORARY_DIRECTORY, tmpdir()])) sweepTheRootsLeftIn(base)
  const temp = makeARoot(tmpdir())
  try {
    return { runtime: aRuntimeRootThatFits(theRuntimeBase(env)), temp }
  } catch (error) {
    removeTheTree(temp)
    throw error
  }
}

/** Runs `command` with the run's roots in its environment, its output and its exit code passed through. */
function runTheCommand(command: readonly string[], roots: TheRunsRoots): Promise<number> {
  const [program, ...args] = command
  if (program === undefined) return Promise.reject(new Error(`${NAME} was given no command to run`))
  const env = {
    ...process.env,
    [RUN_RUNTIME_ROOT_VARIABLE]: roots.runtime,
    [RUN_TEMP_ROOT_VARIABLE]: roots.temp,
    TMPDIR: roots.temp,
    XDG_RUNTIME_DIR: roots.runtime,
    NODE_COMPILE_CACHE: theCompileCacheIn(roots.temp, process.env),
  }
  return new Promise((resolve) => {
    const child = spawn(program, args, { env, stdio: 'inherit' })
    const forward = (signal: NodeJS.Signals) => () => void child.kill(signal)
    process.on('SIGINT', forward('SIGINT'))
    process.on('SIGTERM', forward('SIGTERM'))
    // A command that cannot start runs nothing, and says so by name rather than by a stack trace: the run fails.
    const couldNotStart = (error: Error): void => {
      process.stderr.write(`${NAME}: ${program} could not start (${error.message})\n`)
      resolve(1)
    }
    child.once('error', couldNotStart)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

/**
 * Runs `command` as one test run: its roots made, its environment handed them, its output and exit code passed through,
 * and its roots removed when it ends, however it ends.
 */
export async function keepOneTestRunInOneTemporaryRoot(command: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const roots = rootsForTheRun(env)
  try {
    return await runTheCommand(command, roots)
  } finally {
    removeTheTree(roots.runtime)
    removeTheTree(roots.temp)
  }
}

if (import.meta.main) process.exitCode = await keepOneTestRunInOneTemporaryRoot(process.argv.slice(2))
