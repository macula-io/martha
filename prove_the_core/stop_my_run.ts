// `npm run stop:my-run`: stop the test run you started, and nothing else (martha#802).
//
//   npm run stop:my-run                       the one run recorded in this checkout
//   npm run stop:my-run -- --all-mine         every run recorded in this checkout
//   npm run stop:my-run -- --token <t>        that run, while it was started in this checkout
//   npm run stop:my-run -- --force            SIGKILL a group that did not end within the wait
//   npm run stop:my-run -- --by-cwd <dir>     a plain `npm test` with no record, under that directory
//
// A record is YOURS when its worktree is this checkout. Every member on this box runs as the same uid, so the checkout is
// the only thing that tells one member's run from a peer's — never the command words, which is what killed three of a
// peer's processes on 2026-11-19: the tool's wrapper, npm and every test file's node all carry the same words, and a
// pattern match on `cmdline` reaches every session's run on the box.
//
// A record whose group leader is gone, or is no longer the process recorded, is reported and removed; a record whose
// group is still there after the wait is kept, so the handle is never thrown away while the run it names lives.
//
// `--by-cwd` is for a run with no record: a plain `npm test`, or one started before the handle existed. It walks the
// kernel, keeps the groups of this user holding a process whose working directory is under the given one AND whose
// command line is the suite's own (the third stage's program and a `--test` word, read from package.json rather than
// written down here), and signals each. A group ANY of whose processes runs outside that directory is refused, naming
// the process: a group half inside the directory is not signalled at all. What it cannot see, stated rather than left to
// be discovered: a test file that has left the directory, and two runs of the suite in the same worktree. For those the
// record is the answer, which is why `test:mine` exists.
//
// Exit: 0 every run chosen ended; 1 a run was signalled and its group was still there after the wait; 2 refused, by
// name, and nothing was signalled for that one.

import { readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import process from 'node:process'

import { signalAGroupOnThisMachine } from '../src/linux_process_identity/files_and_processes_on_this_machine.ts'
import { groupIn, linuxProcessIdentities, PROC_ROOT } from '../src/linux_process_identity/process_identity_from_proc.ts'
import { manifestOf, testCommandsOf } from './declared_in_package_json.ts'
import {
  everyRecord,
  readTheRecord,
  removeTheRecord,
  theGroupIsGone,
  type TheRecordOfATestRun,
} from './the_record_of_a_test_run.ts'
import { THE_RUNNER_WORD, theSuiteCommandOf } from './the_words_one_run_gets.ts'

const NAME = 'stop_my_run'

/** How long a signalled group is given to end before it is reported still there, and `--force` is asked for. */
export const THE_WAIT_MS = 10_000

/** How often that wait looks. */
const THE_WAIT_LOOKS_MS = 100

/** The repository this module sits in, whose package.json names the suite's own command. */
const THE_REPOSITORY = join(import.meta.dirname, '..')

/** What stopping one run came to: a group that ended, one still there, or a refusal with its words. */
export interface AStop {
  readonly state: 'ended' | 'alive' | 'refused'
  readonly said: string
}

/** The flags this command takes, as it reads them. */
interface MutableOptions {
  token?: string
  allMine: boolean
  force: boolean
  byCwd?: string
  proc: string
}

/** The flags this command takes. */
type TheOptions = Readonly<MutableOptions>

/** What the flags were, or why they were not read. */
type TheReadOptions = TheOptions | { readonly refused: string }

/** The flags' own words. */
const THE_FLAGS = ['--token', '--by-cwd', '--proc']

/** What this command says to a word that is no flag of its own. */
const NOT_A_FLAG = 'is not a flag this takes: --token <t>, --all-mine, --force, --by-cwd <dir>'

/** The lines this process says, each on its own: a refusal on the error stream, everything else on the other. */
const say = (stops: readonly AStop[]): void => {
  for (const stop of stops) {
    if (stop.state === 'refused') console.error(`${NAME}: ${stop.said}`)
    else console.log(`${NAME}: ${stop.said}`)
  }
}

/** 2 when anything was refused, else 1 when a group is still there, else 0: one run answered for. */
const theCodeOf = (stops: readonly AStop[]): number =>
  stops.some((one) => one.state === 'refused') ? 2 : stops.some((one) => one.state === 'alive') ? 1 : 0

/** One flag of `asked` read into `read`: how many words it took, or the refusal that it could not be read. */
function theOneFlag(read: MutableOptions, asked: readonly string[], at: number): { took: number } | { refused: string } {
  const word = asked[at] as string
  if (word === '--all-mine') {
    read.allMine = true
    return { took: 0 }
  }
  if (word === '--force') {
    read.force = true
    return { took: 0 }
  }
  if (!THE_FLAGS.includes(word)) return { refused: `${word} ${NOT_A_FLAG}` }
  const value = asked[at + 1]
  if (value === undefined || value.startsWith('--')) return { refused: `${word} names no value` }
  if (word === '--token') read.token = value
  else if (word === '--by-cwd') read.byCwd = value
  else read.proc = value
  return { took: 1 }
}

/** The flags `asked` gives, or the refusal for the first one that cannot be read. */
function theOptionsOf(asked: readonly string[]): TheReadOptions {
  const read: MutableOptions = { allMine: false, force: false, proc: PROC_ROOT }
  for (let at = 0; at < asked.length; at += 1) {
    const one = theOneFlag(read, asked, at)
    if ('refused' in one) return one
    at += one.took
  }
  return read
}

/** Waits for a group to be gone, up to `within_ms`: whether the kernel says it ended. */
async function theGroupEnds(group: number, within_ms: number): Promise<boolean> {
  const deadline = Date.now() + within_ms
  while (!theGroupIsGone(group)) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, THE_WAIT_LOOKS_MS))
  }
  return true
}

/**
 * SIGKILL to a group the SIGTERM above did not end. The identity cannot be compared again — the leader may already be
 * gone — and it need not be: the kernel hands a group id to no other process while a member of that group lives, and
 * this id was compared against the record when the SIGTERM was sent.
 */
const killTheGroupLeft = (group: number): void => {
  try {
    process.kill(-group, 'SIGKILL')
  } catch {
    // The group ended between the check and the kill: what this wanted.
  }
}

/** One stopped run: SIGTERM through the contract's one call, the wait, and `--force`'s SIGKILL when the wait runs out. */
async function theGroupStopped(group: number, identity: string | null, force: boolean, when: string): Promise<AStop> {
  if (identity === null || linuxProcessIdentities.identityOf(group) === null) return { state: 'refused', said: `the group of process ${group} is gone` }
  const sent = signalAGroupOnThisMachine(group, identity, 'SIGTERM')
  if (!sent.signalled) return { state: 'refused', said: sent.refusal ?? `the group of process ${group} was not signalled` }
  if (await theGroupEnds(group, THE_WAIT_MS)) return { state: 'ended', said: when }
  if (force) killTheGroupLeft(group)
  if (await theGroupEnds(group, force ? THE_WAIT_MS : 0)) return { state: 'ended', said: when }
  return { state: 'alive', said: `the group of process ${group} was signalled and is still there after the wait` }
}

/** One record's run stopped, and its record removed unless the group outlived the wait. */
async function stopOne(record: TheRecordOfATestRun, force: boolean): Promise<AStop> {
  const stop = await theGroupStopped(record.pid, record.identity, force, `run ${record.token} in ${record.worktree} ended`)
  if (stop.state !== 'alive') removeTheRecord(record.token)
  return stop
}

/** The record `token` names, while it was started in `worktree`, or the refusal that it was not. */
function theRecordNamed(token: string, worktree: string): readonly TheRecordOfATestRun[] | AStop {
  const record = readTheRecord(token)
  if (record === undefined) return { state: 'refused', said: `no run is recorded under ${token}` }
  if (record.worktree !== worktree) {
    return { state: 'refused', said: `the record ${token} was started in ${record.worktree}, which is not this one, so it was not signalled` }
  }
  return [record]
}

/** Every record started in `worktree`: the one, the several, or the refusal naming the tokens to choose between. */
function theRecordsHere(worktree: string, options: TheOptions): readonly TheRecordOfATestRun[] | AStop {
  if (options.token !== undefined) return theRecordNamed(options.token, worktree)
  const mine = everyRecord().filter((record) => record.worktree === worktree)
  if (options.allMine || mine.length === 1) return mine
  if (mine.length === 0) {
    return { state: 'refused', said: `no test run of yours is recorded in ${worktree}; a run started with npm run test:mine is` }
  }
  return { state: 'refused', said: `${mine.length} runs are recorded in ${worktree}: ${[...mine.map((one) => one.token)].sort().join(', ')}; name one with --token, or --all-mine` }
}

/** The records stopped from the handle: the chosen runs, or the refusal that chose none. */
async function theRecordsStopped(options: TheOptions): Promise<readonly AStop[]> {
  const worktree = realpathSync(process.cwd())
  const chosen = theRecordsHere(worktree, options)
  if ('state' in chosen) return [chosen]
  return Promise.all(chosen.map((record) => stopOne(record, options.force)))
}

/** The suite's own words, as package.json states them: what tells a run of it from any other process. */
const theSuitesWords = (): { readonly program: string; readonly runnerWord: string } => {
  const words = theSuiteCommandOf(testCommandsOf(manifestOf(THE_REPOSITORY))).words
  return { program: basename(words[0] ?? ''), runnerWord: THE_RUNNER_WORD }
}

/** Whether a process's command line is the suite's own: the same program, and its own `--test` word. */
const runsTheSuite = (command: readonly string[], suite: { readonly program: string; readonly runnerWord: string }): boolean =>
  basename(command[0] ?? '') === suite.program && command.includes(suite.runnerWord)

/** A process's command line, its own words, or nothing when the kernel will not say. */
function commandLineOf(proc_root: string, pid: number): readonly string[] | undefined {
  try {
    return readFileSync(join(proc_root, String(pid), 'cmdline'), 'utf8').split('\u0000').filter((word) => word !== '')
  } catch {
    return undefined
  }
}

/** Where a process's working directory is, as the kernel holds it: nothing when it is gone, or could be anywhere. */
function workingDirectoryOf(proc_root: string, pid: number): string | undefined {
  try {
    return readlinkSync(join(proc_root, String(pid), 'cwd'))
  } catch {
    return undefined
  }
}

/** A process-group id, as field 5 of the process's stat line, or nothing when the kernel will not say. */
function groupOf(proc_root: string, pid: number): number | null {
  try {
    return groupIn(readFileSync(join(proc_root, String(pid), 'stat'), 'utf8'))
  } catch {
    return null
  }
}

/** Whether a path is at or under `directory`: what makes a process one this command was asked about. */
const isUnder = (directory: string, path: string): boolean => {
  const below = relative(directory, path)
  return below === '' || !below.startsWith('..')
}

/** One process group as the walk found it. */
interface AGroupSeen {
  readonly group: number
  /** The processes of it that run the suite with their working directory under the directory asked about. */
  readonly candidates: readonly number[]
  /** The processes of it, if any, that run somewhere else, and so refuse the whole group. */
  readonly outside: readonly number[]
}

/** Everything one process says about which group it is in and where it runs, as the walk adds it. */
const addTo = (groups: Map<number, { candidates: number[]; outside: number[] }>, group: number, pid: number, inside: boolean, is: boolean): void => {
  const held = groups.get(group) ?? { candidates: [], outside: [] }
  if (!inside) held.outside.push(pid)
  else if (is) held.candidates.push(pid)
  groups.set(group, held)
}

/** One process the walk reads: its pid, its group, and the command line the kernel holds for it. */
interface AProcessToRead {
  readonly pid: number
  readonly group: number
  readonly command: readonly string[]
}

/**
 * The process a listed kernel entry names, when it is one this walk reads: never this process, never one of its own
 * group whatever it holds, and never one whose group or command line the kernel will not say.
 */
function theGroupToRead(proc_root: string, entry: string, ownGroup: number | null): AProcessToRead | undefined {
  const pid = /^\d+$/.test(entry) ? Number(entry) : 0
  if (pid === 0 || pid === process.pid) return undefined
  const group = groupOf(proc_root, pid)
  if (group === null || group === ownGroup) return undefined
  const command = commandLineOf(proc_root, pid)
  return command === undefined ? undefined : { pid, group, command }
}

/**
 * The groups this user's kernel holds that run the suite under `directory`, each with the processes of it that do and
 * those of it that run elsewhere. This process's own group is left out whatever it holds: a member who runs a suite and
 * then this command in one shell must not end the shell that called it.
 */
function theGroupsOfTheSuite(proc_root: string, directory: string): readonly AGroupSeen[] {
  const suite = theSuitesWords()
  const ownGroup = groupOf(PROC_ROOT, process.pid)
  const groups = new Map<number, { candidates: number[]; outside: number[] }>()
  for (const entry of readdirSync(proc_root)) {
    const one = theGroupToRead(proc_root, entry, ownGroup)
    if (one === undefined) continue
    const at = workingDirectoryOf(proc_root, one.pid)
    addTo(groups, one.group, one.pid, at !== undefined && isUnder(directory, at), runsTheSuite(one.command, suite))
  }
  return [...groups.entries()].map(([group, held]) => ({ group, ...held }))
}

/** One group the walk found stopped, with the refusal of a group that is half outside the directory. */
async function theGroupSeenStopped(one: AGroupSeen, force: boolean, directory: string): Promise<AStop> {
  const half = one.outside[0]
  if (half !== undefined) {
    return { state: 'refused', said: `process ${half} of group ${one.group} runs outside ${directory}, so that group was not signalled` }
  }
  const identity = linuxProcessIdentities.identityOf(one.group)
  return theGroupStopped(one.group, identity, force, `the ${one.candidates.length} process(es) of the suite in group ${one.group} under ${directory} were stopped`)
}

/** The groups of the suite under `directory` stopped, or the refusal that none of them was. */
async function theGroupsUnderStopped(directory: string, options: TheOptions): Promise<readonly AStop[]> {
  let groups: readonly AGroupSeen[]
  try {
    groups = theGroupsOfTheSuite(options.proc, realpathSync(directory))
  } catch (error) {
    return [{ state: 'refused', said: `${directory} could not be read (${(error as Error).message})` }]
  }
  const candidates = groups.filter((one) => one.candidates.length > 0)
  if (candidates.length === 0) return [{ state: 'refused', said: `no process of the suite is running under ${directory}` }]
  return Promise.all(candidates.map((one) => theGroupSeenStopped(one, options.force, directory)))
}

/** What was asked for, stopped: the records of this checkout, or the suite found under a directory of its own. */
async function theStop(asked: readonly string[]): Promise<readonly AStop[]> {
  const options = theOptionsOf(asked)
  if ('refused' in options) return [{ state: 'refused', said: options.refused }]
  return options.byCwd === undefined ? theRecordsStopped(options) : theGroupsUnderStopped(options.byCwd, options)
}

if (import.meta.main) {
  const stops = await theStop(process.argv.slice(2))
  say(stops)
  process.exitCode = theCodeOf(stops)
}
