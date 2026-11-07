// Martha's own state for one project, kept outside its checkout (martha#98).
//
// This exists so a clone, a pull or a pull request can never carry an approval or a member's node id into a
// crew: what the owner approved and who the members are is kept where the checkout cannot reach, in
// `<state root>/<sha256 of the project's real path>`.
//
// The state root and each project's directory are made mode 0700. Every file in them is mode 0600, written
// whole under a staging name and renamed into place, or (the approvals) appended to. Each time it is opened,
// the directory is refused unless it is a real directory, not a link, owned by this user and written by no
// one else; each file is refused unless it is a regular file owned by this user that no one else may read or
// write. A file that does not parse is refused whole, never read in part.
//
// The checks are speed bumps, not a boundary: a member runs as the owner's OS user, so its shell can write
// here. It is the residual martha#1 decision 2 accepts for the roster and the launch records
// (../linux_process_identity/launch_records_directory.ts).

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'
import { getuid } from 'node:process'

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import { fingerprintOf, type ConfigEntry } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** Only the owner may enter, list or write a state directory. */
export const STATE_DIRECTORY_MODE = 0o700

/** Only the owner may read or write a state file. */
export const STATE_FILE_MODE = 0o600

/** Each member's node id, by its name. */
export const MEMBERS_FILE = 'members.json'

/** The owner's approvals, one JSON line each. */
export const APPROVALS_FILE = 'approvals.jsonl'

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
function keepStateFile(state: MarthaState, name: string, text: string): void {
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
export const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

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
export const isInstant = (text: unknown): boolean => typeof text === 'string' && !Number.isNaN(Date.parse(text)) && new Date(text).toISOString() === text

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

const APPEND = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW

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

/** Keeps `value` as one JSON line at the end of the state file `name`; or why it could not be kept. `what` names one such value. */
export function appendStateLine(state: MarthaState, name: string, value: unknown, what: string): Refused | undefined {
  const opened = openForAppend(join(state.directory, name), what)
  if ('refusal' in opened) return opened
  try {
    fs.writeSync(opened.descriptor, `${JSON.stringify(value)}\n`)
    return undefined
  } finally {
    fs.closeSync(opened.descriptor)
  }
}

/** Keeps one more approval, as one line at the end of the file; or why it could not be kept. */
export function appendApproval(state: MarthaState, approval: Approval): Refused | undefined {
  return appendStateLine(state, APPROVALS_FILE, approval, 'approval')
}
