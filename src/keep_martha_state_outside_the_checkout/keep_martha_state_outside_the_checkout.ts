// Martha's own state for one project, kept outside its checkout (martha#98).
//
// This exists so a clone, a pull or a pull request can never carry an approval or a member's node id into a
// crew: what the owner approved and who the members are is kept where the checkout cannot reach, in
// `<state root>/<sha256 of the project's real path>`.
//
// The state root and each project's directory are made mode 0700. Every file in them is mode 0600, written
// whole under a staging name and renamed into place, or (the approvals) appended to. Each time it
// is opened, the directory is refused unless it is a real directory, not a link, owned by this user and written by
// no one else; each file is refused unless it is a regular file owned by this user that no one else may read or
// write. A file that does not parse is refused whole, never read in part.
//
// A launch's own writes are one file per launch, under OWN_WRITES_PLACE (martha#162), and each file keeps one line
// for each path that launch wrote (martha#157): a write replaces the line for its own path, so a launch that writes
// one file a thousand times costs what its paths cost, not what its writes cost, and the file is read whole to be
// rewritten whole, under a staging name and renamed into place. What that gives a reader is what it already asked
// for — the latest write at each path — so the launch's recheck is answered as it was before, and a reader of the
// history gets each launch's latest write at each path rather than every write at it.
//
// A file is refused whole only for a line that was finished and is not an own write, or a short write caught as it
// happened. A last line the writer never finished is read as a record when it is one whole record whose newline the
// disk did not take, and dropped when the write was cut short (martha#157): a partial record never counts, a whole
// one is not lost to a crash, and a path behind a record that was cut short is vouched for by nothing, so it refuses
// by name and the rest of the launch goes on.
//
// One launch's file cannot stop another launch, which is what a torn record used to do to a whole project, and the
// files past OWN_WRITES_LAUNCHES_KEPT, newest by their last record, are pruned when a launch starts, so the state of
// a project no longer grows with every launch it ever had.
//
// Residual, stated: pruning can take a running launch's file when OWN_WRITES_LAUNCHES_KEPT other launches of the same
// project have written since it last did. Its next write makes the file again, and the paths it wrote before then are
// no longer own writes, so its next recheck stops it and names martha approve: a running launch is lost, not a change
// waved through.
//
// The checks are speed bumps, not a boundary: a member runs as the owner's OS user, so its shell can write
// here. It is the residual martha#1 decision 2 accepts for the roster and the launch records
// (../linux_process_identity/launch_records_directory.ts).

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { getuid } from 'node:process'

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import { fingerprintOf, type ConfigEntry } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import {
  latestAtEachPath,
  lineOfOwnWrite,
  ownWriteOfLine,
  type OwnWrite,
  type OwnWrites,
  type OwnWritesHistoryStore,
  type OwnWritesOfTheHistory,
  type OwnWritesStore,
} from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'

/** Only the owner may enter, list or write a state directory. */
export const STATE_DIRECTORY_MODE = 0o700

/** Only the owner may read or write a state file. */
export const STATE_FILE_MODE = 0o600

/** Each member's node id, by its name. */
export const MEMBERS_FILE = 'members.json'

/** The owner's approvals, one JSON line each. */
export const APPROVALS_FILE = 'approvals.jsonl'

/** The directory inside Martha's state that holds each launch's own writes, one file per launch (martha#132, #162). */
export const OWN_WRITES_PLACE = 'own-writes'

/** What ends the name of one launch's own-writes file. */
export const OWN_WRITES_SUFFIX = '.jsonl'

/** How many launches' own writes are kept: the newest by the last record each kept, so a reader of the history has one. */
export const OWN_WRITES_LAUNCHES_KEPT = 64

/** How many random bytes a node id holds: 64 hex digits, the shape NODE_ID accepts. */
const NODE_ID_BYTES = 32

/** The bits of a mode that say who may read, write and enter. */
export const PERMISSION_BITS = 0o777
const WRITABLE_BY_OTHERS = 0o022
const OPEN_TO_OTHERS = 0o077
const STAGING_PREFIX = '.staging-'

/** One project's state directory, opened and checked. */
export interface MarthaState {
  readonly directory: string
}

/** One yes of the owner's: the fingerprint, what they were shown, and when. */
export interface Approval {
  readonly fingerprint: string
  readonly approved_at: string
  readonly entries: readonly ConfigEntry[]
  readonly tree: string | null
}

type Refused = { readonly refusal: string }

/** Why a directory may not hold Martha's state, or undefined when it may. */
function unsafeDirectory(path: string): string | undefined {
  const found = fs.lstatSync(path, { throwIfNoEntry: false })
  if (found === undefined) return `${path} is missing`
  if (found.isSymbolicLink()) return `${path} is a link, not a directory of Martha's`
  if (!found.isDirectory()) return `${path} is not a directory`
  if (found.uid !== getuid?.()) return `${path} is not owned by this user`
  if ((found.mode & WRITABLE_BY_OTHERS) !== 0) return `${path} may be written by others (mode ${(found.mode & PERMISSION_BITS).toString(8)})`
  return undefined
}

/** Makes `path` mode 0700 when it is missing, then checks it; why it may not hold state, or undefined. */
function closedDirectory(path: string): string | undefined {
  if (fs.lstatSync(path, { throwIfNoEntry: false }) === undefined) fs.mkdirSync(path, { recursive: true, mode: STATE_DIRECTORY_MODE })
  return unsafeDirectory(path)
}

/** The state directory of the project at `root`, under `state_root`: made when missing, refused when unsafe. */
export function openState(state_root: string, root: string): MarthaState | Refused {
  const project = createHash('sha256').update(fs.realpathSync(root)).digest('hex')
  const directory = join(state_root, project)
  const unsafe = closedDirectory(state_root) ?? closedDirectory(directory)
  return unsafe === undefined ? { directory } : { refusal: `Martha keeps no state there: ${unsafe}.` }
}

/** A directory inside the state, made mode 0700 when missing; why it may not be used, or its path. */
export function stateSubdirectory(state: MarthaState, name: string): { readonly path: string } | Refused {
  const path = join(state.directory, name)
  const unsafe = closedDirectory(path)
  return unsafe === undefined ? { path } : { refusal: `Martha keeps no state there: ${unsafe}.` }
}

/** A state file's text, '' when it is missing, or why it may not be read. */
export function readStateFile(path: string): { readonly text: string } | Refused {
  let descriptor: number
  try {
    descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' ? { text: '' } : { refusal: `${path} could not be read (${code ?? String(error)}).` }
  }
  try {
    const found = fs.fstatSync(descriptor)
    if (!found.isFile() || found.uid !== getuid?.() || (found.mode & OPEN_TO_OTHERS) !== 0) {
      return { refusal: `${path} is not a file only this user may read and write, so Martha does not trust it.` }
    }
    return { text: fs.readFileSync(descriptor, 'utf8') }
  } finally {
    fs.closeSync(descriptor)
  }
}

/** Writes a state file whole: under a staging name, then renamed into place. */
export function keepStateFile(state: MarthaState, name: string, text: string): void {
  const staged = join(state.directory, `${STAGING_PREFIX}${randomUUID()}`)
  fs.writeFileSync(staged, text, { mode: STATE_FILE_MODE, flag: 'wx' })
  fs.chmodSync(staged, STATE_FILE_MODE)
  fs.renameSync(staged, join(state.directory, name))
}

const isNodeIds = (value: unknown): value is Record<string, string> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every((id) => typeof id === 'string' && NODE_ID.test(id) && id === id.toLowerCase())

function readNodeIds(path: string): { readonly ids: Record<string, string> } | Refused {
  const read = readStateFile(path)
  if ('refusal' in read) return read
  if (read.text === '') return { ids: {} }
  try {
    const ids: unknown = JSON.parse(read.text)
    return isNodeIds(ids) ? { ids } : { refusal: `${path} does not hold a node id of 64 lowercase hex digits per member.` }
  } catch {
    return { refusal: `${path} is not JSON.` }
  }
}

/**
 * The node id of each named member: the one kept for it, or 32 random bytes made now and kept. The owner never
 * types one. In solo mode a node id only names a member in its launch record; nothing signs with it.
 */
export function nodeIdsFor(state: MarthaState, names: readonly string[]): { readonly ids: Readonly<Record<string, string>> } | Refused {
  const path = join(state.directory, MEMBERS_FILE)
  const kept = readNodeIds(path)
  if ('refusal' in kept) return kept
  const missing = names.filter((name) => !Object.hasOwn(kept.ids, name))
  if (missing.length === 0) return kept
  const ids = { ...kept.ids, ...Object.fromEntries(missing.map((name) => [name, randomBytes(NODE_ID_BYTES).toString('hex')])) }
  keepStateFile(state, MEMBERS_FILE, `${JSON.stringify(ids, null, 2)}\n`)
  return { ids }
}

/** A sha256 in hex, as the launch gate writes a file's. */
const SHA256_HEX = /^[0-9a-f]{64}$/

/** A git object id, sha1 or sha256, as git names the checkout's tree. */
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/** The fields of an approval, and of each entry kind approve can keep: the gate refuses a symlink or an unreadable entry whatever was approved. */
const APPROVAL_FIELDS = ['approved_at', 'entries', 'fingerprint', 'tree']
const ENTRY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  absent: ['kind', 'path'],
  directory: ['kind', 'path'],
  file: ['kind', 'path', 'sha256'],
}

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export const hasExactly = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort())

const isEntry = (value: unknown): value is ConfigEntry => {
  const fields = isRecord(value) && typeof value['kind'] === 'string' ? ENTRY_FIELDS[value['kind']] : undefined
  if (fields === undefined || !isRecord(value) || !hasExactly(value, fields) || typeof value['path'] !== 'string') return false
  return value['kind'] !== 'file' || (typeof value['sha256'] === 'string' && SHA256_HEX.test(value['sha256']))
}

/** True when `text` is the instant toISOString writes for it, as approve keeps one. */
const isInstant = (text: unknown): boolean => typeof text === 'string' && !Number.isNaN(Date.parse(text)) && new Date(text).toISOString() === text

/** An approval only as approve keeps one: its exact fields, an instant, entries the gate writes, and the gate's own fingerprint over them. */
const isApproval = (value: unknown): value is Approval => {
  if (!isRecord(value) || !hasExactly(value, APPROVAL_FIELDS) || !isInstant(value['approved_at'])) return false
  const { entries, tree, fingerprint } = value
  if (!Array.isArray(entries) || !entries.every(isEntry)) return false
  if (tree !== null && !(typeof tree === 'string' && GIT_OBJECT_ID.test(tree))) return false
  return fingerprint === fingerprintOf({ entries, tree })
}

function approvalOf(line: string): Approval | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return isApproval(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Every approval the owner gave for this project, in the order given; or why the file is not trusted. */
export function readApprovals(state: MarthaState): { readonly approvals: readonly Approval[] } | Refused {
  const path = join(state.directory, APPROVALS_FILE)
  const read = readStateFile(path)
  if ('refusal' in read) return read
  const lines = read.text.split('\n').filter((line) => line !== '')
  const approvals = lines.map(approvalOf)
  const bad = approvals.indexOf(undefined)
  if (bad !== -1) return { refusal: `${path} line ${bad + 1} is not an approval, so Martha reads none of it.` }
  return { approvals: approvals as Approval[] }
}

const NEWLINE = '\n'

/** The byte a line ends with, which is what tells a record that was finished from one that was not. */
const NEWLINE_BYTE = NEWLINE.charCodeAt(0)

const APPEND = fs.constants.O_RDWR | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW

/** A state file opened to append, or why it may not be: a link, or anything that is not a file only this user may read and write. */
function openForAppend(path: string, what: string): { readonly descriptor: number } | Refused {
  let descriptor: number
  try {
    descriptor = fs.openSync(path, APPEND, STATE_FILE_MODE)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { refusal: `${path} could not be opened to append to (${code ?? String(error)}), so Martha keeps no ${what} in it.` }
  }
  const found = fs.fstatSync(descriptor)
  if (found.isFile() && found.uid === getuid?.() && (found.mode & OPEN_TO_OTHERS) === 0) return { descriptor }
  fs.closeSync(descriptor)
  return { refusal: `${path} is not a file only this user may read and write, so Martha keeps no ${what} in it.` }
}

/**
 * Cuts a last line that was never finished off an appended-to file, so the next record is not appended after a torn
 * one (martha#162). A crash mid-append, or a write cut short, leaves one, and what it held is never kept. Only the
 * approvals are appended to: a launch's own writes are written whole (martha#157).
 */
function cutOffAnUnfinishedLine(descriptor: number): void {
  const size = fs.fstatSync(descriptor).size
  if (size === 0) return
  const bytes = fs.readFileSync(descriptor)
  if (bytes[size - 1] === NEWLINE_BYTE) return
  // The newline is found in the bytes, never in the decoded text: ftruncate takes a byte offset, and a text's own
  // index stops being one as soon as a record holds a character that is not ASCII — a path in Japanese, an accent
  // (martha#162 r=1).
  fs.ftruncateSync(descriptor, bytes.lastIndexOf(NEWLINE_BYTE) + 1)
}

/**
 * Keeps `line` at the end of the state file at `path`; or why it could not be kept. `what` names what one line
 * holds. The bytes written are counted (martha#162): a record kept only in part is cut back off the file and refused
 * here, so a short write never leaves half a record for the next read to trip over. The path is the caller's rather
 * than `state.directory` plus a name, so a caller that keeps its file elsewhere, as the own writes once did, can.
 */
export function appendStateLine(path: string, line: string, what: string): Refused | undefined {
  const opened = openForAppend(path, what)
  if ('refusal' in opened) return opened
  const { descriptor } = opened
  try {
    cutOffAnUnfinishedLine(descriptor)
    const text = `${line}${NEWLINE}`
    const bytes = Buffer.byteLength(text)
    const before = fs.fstatSync(descriptor).size
    const written = writtenBy(() => fs.writeSync(descriptor, text))
    if (typeof written === 'string') {
      fs.ftruncateSync(descriptor, before)
      return { refusal: `${path} could not be written (${written}), so Martha keeps no ${what} in it.` }
    }
    if (written !== bytes) {
      fs.ftruncateSync(descriptor, before)
      return { refusal: `${path} kept only ${written} of the ${bytes} bytes of an ${what}, so Martha keeps none of it.` }
    }
    fs.fsyncSync(descriptor)
    return undefined
  } finally {
    fs.closeSync(descriptor)
  }
}

/** The bytes `write` wrote, or the error's code when it could not write at all. */
function writtenBy(write: () => number): number | string {
  try {
    return write()
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error)
  }
}

/** Keeps one more approval, as one line at the end of the file; or why it could not be kept. */
export function appendApproval(state: MarthaState, approval: Approval): Refused | undefined {
  return appendStateLine(join(state.directory, APPROVALS_FILE), JSON.stringify(approval), 'approval')
}

/** What one own write is called in a refusal. */
const ONE_OWN_WRITE = 'own write'

/** An own write kept under no launch at all, which is no place to keep one. */
const NOT_UNDER_A_LAUNCH = 'An own write is kept under the launch that made it, and an empty name is not a launch.'

/** The own writes' directory in this project's state, made mode 0700 when missing; or why it may not be used. */
function ownWritesDirectory(state: MarthaState): { readonly path: string } | Refused {
  return stateSubdirectory(state, OWN_WRITES_PLACE)
}

/** The name one launch's own writes are kept under: never a path, and never a dot a person or git could steer with. */
function ownWritesFileNameOf(launch: string): string | undefined {
  return launch === '' ? undefined : `${encodeURIComponent(launch).replaceAll('.', '%2E')}${OWN_WRITES_SUFFIX}`
}

/** The launch a file name keeps own writes for, or undefined when the name is not one this file writes. */
function launchOfOwnWritesFileName(name: string): string | undefined {
  if (!name.endsWith(OWN_WRITES_SUFFIX)) return undefined
  try {
    const launch = decodeURIComponent(name.slice(0, -OWN_WRITES_SUFFIX.length))
    return ownWritesFileNameOf(launch) === name ? launch : undefined
  } catch {
    return undefined
  }
}

/** Why one launch's own writes are not trusted, and what the reader can do about it (martha#162). */
const untrusted = (path: string, why: string, remedy: string): Refused => ({
  refusal: `${path} ${why}, so Martha reads none of this launch's own writes. ${remedy}`,
})

/** The way back for a launch's own recheck: a new start keeps a file of its own, and the refused one is left behind. */
export const START_AGAIN = 'Start the member again: each start keeps a file of its own.'

/**
 * The way back in a signed run, which no new start helps (martha#162 r=5): the run is judged against the branch the
 * owner signed and the members' own writes, so a file that no own write vouches for runs once that branch holds it,
 * or once it is gone.
 */
export const WHAT_A_SIGNED_RUN_NEEDS = "A run sees a file only when the signed branch holds it or a member's own write vouches for it: commit it to the signed branch, or remove it."

/** What the text of a launch's file holds: its records, the first finished line that is not one, and its unfinished tail. */
interface RecordsOfText {
  readonly writes: readonly OwnWrite[]
  /** The number of the first line that was finished and is not an own write, or undefined when every one of them is. */
  readonly badLine: number | undefined
  /** The last line, when the writer never finished it: '' when it did. */
  readonly unfinished: string
}

/** The text of a launch's file, read as the records it holds. */
function recordsOf(text: string): RecordsOfText {
  const finished = text.endsWith(NEWLINE) ? text : text.slice(0, text.lastIndexOf(NEWLINE) + 1)
  const parsed = finished
    .split(NEWLINE)
    .filter((line) => line !== '')
    .map(ownWriteOfLine)
  const bad = parsed.indexOf(undefined)
  return { writes: parsed.filter((write): write is OwnWrite => write !== undefined), badLine: bad === -1 ? undefined : bad + 1, unfinished: text.slice(finished.length) }
}

/**
 * The own writes kept in one launch's file, in the order kept; a missing file is none, and one bad line that was
 * finished refuses it whole. A last line the writer never finished is a record when it is one whole record whose
 * newline the disk did not take, and dropped when the write was cut short (martha#157): it can only ever be the
 * last, so what was finished before it is read as it was.
 */
function readOwnWritesOf(path: string, remedy: string): OwnWrites {
  const read = readStateFile(path)
  if ('refusal' in read) return read
  const { writes, badLine, unfinished } = recordsOf(read.text)
  if (badLine !== undefined) return untrusted(path, `line ${badLine} is not an ${ONE_OWN_WRITE}`, remedy)
  const last = unfinished === '' ? undefined : ownWriteOfLine(unfinished)
  return { writes: last === undefined ? writes : [...writes, last] }
}

/**
 * Keeps `write` in the file at `path`, which keeps one line for each path the launch wrote (martha#157): the write
 * takes the place of the line for its own path, at the position of the last write, which is the order a reader of
 * that launch's writes asks for. The file is written whole under a staging name and renamed into place, so a write
 * the disk does not take leaves the file as it was, and a file that cannot be trusted is refused, never rewritten.
 */
function keepOwnWriteAt(path: string, write: OwnWrite, what: string): Refused | undefined {
  const read = readStateFile(path)
  if ('refusal' in read) return read
  const { writes, badLine } = recordsOf(read.text)
  if (badLine !== undefined) return { refusal: `${path} line ${badLine} is not an ${ONE_OWN_WRITE}, so Martha keeps no ${what} in it.` }
  const text = latestAtEachPath([...writes, write])
    .map((kept) => `${lineOfOwnWrite(kept)}${NEWLINE}`)
    .join('')
  return keepWhole(path, text, what)
}

/** Writes `text` to `path` whole: under a staging name beside it, every byte counted, then renamed into place. */
function keepWhole(path: string, text: string, what: string): Refused | undefined {
  const staged = join(dirname(path), `${STAGING_PREFIX}${randomUUID()}`)
  const refused = keepStaged(staged, text, path, what)
  if (refused !== undefined) {
    fs.rmSync(staged, { force: true })
    return refused
  }
  fs.renameSync(staged, path)
  return undefined
}

/** `text` written whole to the staging file `staged`, counting every byte; or why it was not. */
function keepStaged(staged: string, text: string, path: string, what: string): Refused | undefined {
  let descriptor: number
  try {
    descriptor = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, STATE_FILE_MODE)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { refusal: `${path} could not be written (${code ?? String(error)}), so Martha keeps no ${what} in it.` }
  }
  try {
    const bytes = Buffer.byteLength(text)
    const written = writtenBy(() => fs.writeSync(descriptor, text))
    if (typeof written === 'string') return { refusal: `${path} could not be written (${written}), so Martha keeps no ${what} in it.` }
    if (written !== bytes) return { refusal: `${path} kept only ${written} of the ${bytes} bytes of an ${what}, so Martha keeps none of it.` }
    fs.fsyncSync(descriptor)
    return undefined
  } finally {
    fs.closeSync(descriptor)
  }
}

/** Keeps one own write in the file its launch keeps (martha#162, #157); or why it could not be kept. */
function appendOwnWriteOf(directory: string, write: OwnWrite): string | undefined {
  const name = ownWritesFileNameOf(write.launch)
  if (name === undefined) return NOT_UNDER_A_LAUNCH
  return keepOwnWriteAt(join(directory, name), write, ONE_OWN_WRITE)?.refusal
}

/**
 * The own writes of one launch, kept one line for each path it wrote in a file of that launch's own: the only file a
 * recheck of the launch reads, and the only one a bad line in it can refuse (martha#162, #157).
 */
export function ownWritesKeptForLaunch(state: MarthaState, launch: string): OwnWritesStore {
  const directory = ownWritesDirectory(state)
  const name = ownWritesFileNameOf(launch)
  if ('refusal' in directory) return { append: () => directory.refusal, all: () => directory }
  if (name === undefined) return { append: () => NOT_UNDER_A_LAUNCH, all: () => ({ refusal: NOT_UNDER_A_LAUNCH }) }
  const path = join(directory.path, name)
  return {
    append: (write) =>
      write.launch === launch ? keepOwnWriteAt(path, write, ONE_OWN_WRITE)?.refusal : `An own write of another launch is not kept in ${path}.`,
    all: () => readOwnWritesOf(path, START_AGAIN),
  }
}

/**
 * Every own write still kept, launch by launch, and the launches in the order of their first record: the history a
 * reader of it (#129) asks for. At each path a launch keeps the last write it made there rather than every write,
 * since that is the write whose bytes the checkout holds (martha#162, #157).
 *
 * One launch's file that cannot be read does not take the history with it (martha#162 r=4): the history reads the
 * other launches and names the file it passed over. Nothing that launch's member wrote is an own write then, so a
 * path behind one of those writes refuses by name, and the owner can approve the tree and run.
 */
export function ownWritesKeptForTheHistory(state: MarthaState): OwnWritesHistoryStore {
  return {
    append: (write) => {
      const directory = ownWritesDirectory(state)
      return 'refusal' in directory ? directory.refusal : appendOwnWriteOf(directory.path, write)
    },
    all: () => readOwnWritesKeptForTheHistory(state),
  }
}

/** What one launch kept, read back whole. */
interface LaunchOwnWrites {
  readonly launch: string
  readonly writes: readonly OwnWrite[]
}

function readOwnWritesKeptForTheHistory(state: MarthaState): OwnWritesOfTheHistory {
  const directory = ownWritesDirectory(state)
  if ('refusal' in directory) return directory
  let names: string[]
  try {
    names = fs.readdirSync(directory.path)
  } catch (error) {
    return { refusal: `${directory.path} could not be read (${(error as NodeJS.ErrnoException).code ?? String(error)}).` }
  }
  const kept: LaunchOwnWrites[] = []
  const unread: string[] = []
  for (const [name, launch] of names.sort().map((name) => [name, launchOfOwnWritesFileName(name)] as const)) {
    if (launch === undefined) continue
    const read = readOwnWritesOf(join(directory.path, name), WHAT_A_SIGNED_RUN_NEEDS)
    if ('refusal' in read) {
      unread.push(read.refusal)
      continue
    }
    kept.push({ launch, writes: read.writes })
  }
  const firstRecord = (one: LaunchOwnWrites): string => one.writes[0]?.recorded_at ?? ''
  // The names are read in order, and this sort is stable, so two launches whose first record is the same instant are
  // read in the order of their names, and the same history comes back every time.
  return { writes: kept.sort((one, other) => firstRecord(one).localeCompare(firstRecord(other))).flatMap((one) => one.writes), unread }
}

/**
 * Removes the own writes of the launches past the newest OWN_WRITES_LAUNCHES_KEPT, by the last record each kept, so a
 * project's state stops growing with every launch it ever had (martha#162); what could not be removed, and why.
 */
export function pruneOwnWritesOfOldLaunches(state: MarthaState): readonly string[] {
  const directory = ownWritesDirectory(state)
  if ('refusal' in directory) return [directory.refusal]
  let names: string[]
  try {
    names = fs.readdirSync(directory.path).filter((name) => launchOfOwnWritesFileName(name) !== undefined)
  } catch (error) {
    return [`${directory.path} could not be read (${(error as NodeJS.ErrnoException).code ?? String(error)}).`]
  }
  if (names.length <= OWN_WRITES_LAUNCHES_KEPT) return []
  const byLastRecord = names
    .map((name) => ({ name, path: join(directory.path, name), last: lastRecordTimeOf(join(directory.path, name)) }))
    .sort((one, other) => other.last - one.last || one.name.localeCompare(other.name))
  return byLastRecord.slice(OWN_WRITES_LAUNCHES_KEPT).flatMap(({ path }) => {
    try {
      fs.rmSync(path)
      return []
    } catch (error) {
      return [`${path} could not be removed (${(error as NodeJS.ErrnoException).code ?? String(error)}).`]
    }
  })
}

/** When the last record was kept in an own-writes file: the file's own last change, or 0 when it cannot be told. */
function lastRecordTimeOf(path: string): number {
  const found = fs.lstatSync(path, { throwIfNoEntry: false })
  return found === undefined ? 0 : found.mtimeMs
}
