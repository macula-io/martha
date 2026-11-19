// A handle on the test run a member started (martha#802).
//
// Every member on this machine runs the same suite, often at the same time, and until this existed the only way to stop
// one was a pattern match on the command line — which names every session's run. On 2026-11-19 one member's
// `pgrep -f "npm test"` listed three runs, and the three pids it killed were a peer's: the tool's wrapper, npm and every
// test file's node all carry the same words, and the process table says nothing about whose run is whose.
//
// So a run started through `npm run test:mine` writes one record here before its suite can start, and `npm run
// stop:my-run` signals the process group that record names and nothing else. The record lives under the per-user runtime
// directory, never in the checkout (the launch gate binds an approved launch to the tree git would write, untracked files
// and all, so a record dropped there would change the approved tree on every run) and never in the state root (that is
// Martha's product state, read by `martha ls` and the leftovers scan).
//
// One module computes the root, writes a record, reads it and removes it: the runner and the stopper both ask here, so a
// `test:mine` and a `stop:my-run` can never look in two places. The root follows XDG_RUNTIME_DIR when that is an
// absolute path, else the system's own temporary directory — never TMPDIR, which differs between the processes a test
// sets it for, and would leave the stopper looking where no run is.
//
//   node prove_the_core/the_record_of_a_test_run.ts path                      the directory the records live under
//   node prove_the_core/the_record_of_a_test_run.ts record <pid> <worktree>   a record for that run; its token is printed
//   node prove_the_core/the_record_of_a_test_run.ts list                      every record, one per line: token pid worktree
//
// Exit 0 answered; 2 refused, with its words.

import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import process from 'node:process'

import { SYSTEM_TEMPORARY_DIRECTORY } from '../src/host_contract/host_contract.ts'
import { linuxProcessIdentities } from '../src/linux_process_identity/process_identity_from_proc.ts'

const NAME = 'the_record_of_a_test_run'

/** The directory the records live under, inside the runtime base: the one name `test:mine` and `stop:my-run` share. */
export const RECORDS_DIRECTORY = 'martha-test-runs'

/** The file a token's directory holds. */
export const RECORD_FILE = 'run.json'

/** A token's directory is the owner's own, and so is the record inside it. */
export const A_TOKEN_DIRECTORYS_MODE = 0o700
export const A_RECORDS_MODE = 0o600

/**
 * One record: the run's process-group leader, the identity that leader had when the record was written, and the checkout
 * that started it. Every member on the box runs as the same uid, so the checkout is the only thing that tells one
 * member's run from a peer's.
 */
export interface TheRecordOfATestRun {
  readonly token: string
  readonly pid: number
  readonly identity: string
  readonly worktree: string
  readonly started_at: string
}

/** The errno of a failed call, or undefined when it carries none. */
const theCodeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code

/**
 * The base the records live under: the per-user runtime directory when it is an absolute path, else the system's own
 * temporary directory, which is the base `short_relay_root.ts` takes for the relay root and the reason it takes it.
 */
const theBase = (): string => {
  const runtime = process.env['XDG_RUNTIME_DIR']
  return runtime !== undefined && isAbsolute(runtime) ? runtime : SYSTEM_TEMPORARY_DIRECTORY
}

/** The directory every record lives under: one answer for the runner, the stopper and their tests. */
export const theRunsRoot = (): string => join(theBase(), RECORDS_DIRECTORY)

/** A new token, one per run: sixteen hex characters. */
export const aNewToken = (): string => randomBytes(8).toString('hex')

/** The path of the record under `token`. */
export const theRecordPathOf = (token: string): string => join(theRunsRoot(), token, RECORD_FILE)

/** A token's own directory: mode 0700 before anything is written inside it. A umask only ever clears bits, so the
 * directory can be no looser than this, whatever a member's umask says. */
const aTokenDirectory = (token: string): string => {
  const directory = join(theRunsRoot(), token)
  mkdirSync(directory, { recursive: true, mode: A_TOKEN_DIRECTORYS_MODE })
  return directory
}

/**
 * Writes `record` under its own token, mode 0600: the one place a record is written, whether it names a run this
 * machine started (`recordTheRun`) or one a test plants.
 */
export function writeTheRecord(record: TheRecordOfATestRun): void {
  aTokenDirectory(record.token)
  writeFileSync(theRecordPathOf(record.token), `${JSON.stringify(record, null, 2)}\n`, { mode: A_RECORDS_MODE })
}

/**
 * A record of the run whose process-group leader is `pid`, started in `worktree`. The leader's identity is read here and
 * written with the record, so a leader that has already gone is refused rather than recorded; and the record is on the
 * disk when this returns, before the caller lets the suite run a word.
 */
export function recordTheRun(pid: number, worktree: string): TheRecordOfATestRun {
  const identity = linuxProcessIdentities.identityOf(pid)
  if (identity === null) throw new Error(`${NAME}: process ${pid} has gone, so no record was written`)
  const record: TheRecordOfATestRun = { token: aNewToken(), pid, identity, worktree, started_at: new Date().toISOString() }
  writeTheRecord(record)
  return record
}

/**
 * The record under `token`, or nothing when there is none. A record that is there but cannot be read is thrown, never
 * read as absent: a token the root lists and this cannot parse is a record to look at, not a run to forget.
 */
export function readTheRecord(token: string): TheRecordOfATestRun | undefined {
  try {
    return JSON.parse(readFileSync(theRecordPathOf(token), 'utf8')) as TheRecordOfATestRun
  } catch (error) {
    if (theCodeOf(error) === 'ENOENT') return undefined
    throw error
  }
}

/** Every token the root holds a directory for, whether or not each one's record can be read. */
export function theTokensRecorded(): readonly string[] {
  try {
    return readdirSync(theRunsRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    if (theCodeOf(error) === 'ENOENT') return []
    throw error
  }
}

/** Every record the root holds, each read afresh. */
export const everyRecord = (): readonly TheRecordOfATestRun[] =>
  theTokensRecorded().flatMap((token) => {
    const record = readTheRecord(token)
    return record === undefined ? [] : [record]
  })

/** Removes a token's directory and the record inside it. */
export const removeTheRecord = (token: string): void => rmSync(join(theRunsRoot(), token), { recursive: true, force: true })

/**
 * Whether any process is left in the group `group`, asked of the kernel without signalling anything. A group id is
 * handed to no other process while a member of it lives, so this answers about the run the record names and no other.
 */
export function theGroupIsGone(group: number): boolean {
  try {
    process.kill(-group, 0)
    return false
  } catch (error) {
    return theCodeOf(error) === 'ESRCH'
  }
}

/** A pid as the record command takes it: a whole number above zero. */
const isAPid = (word: string): boolean => /^[1-9][0-9]*$/.test(word)

/** The root, printed. */
function thePath(): number {
  console.log(theRunsRoot())
  return 0
}

/** A record for the run `pid` leads in `worktree`, its token printed, or why none was written. */
function theRecord(pid: string, worktree: string): number {
  try {
    if (!isAPid(pid)) throw new Error(`${pid} is no pid`)
    console.log(recordTheRun(Number(pid), realpathSync(worktree)).token)
    return 0
  } catch (error) {
    console.error(`${NAME}: ${(error as Error).message}`)
    return 2
  }
}

/** Every record, one per line. */
function theList(): number {
  for (const record of everyRecord()) console.log(`${record.token} ${record.pid} ${record.worktree}`)
  return 0
}

/** The answer for what was asked, or a refusal naming what can be asked. */
function theAnswer(asked: readonly string[]): number {
  const [what, ...rest] = asked
  if (what === 'path') return thePath()
  if (what === 'record' && rest.length === 2) return theRecord(rest[0] as string, rest[1] as string)
  if (what === 'list') return theList()
  console.error(`${NAME}: usage: path | record <pid> <worktree> | list`)
  return 2
}

if (import.meta.main) process.exitCode = theAnswer(process.argv.slice(2))
