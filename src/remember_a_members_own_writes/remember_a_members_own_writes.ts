// What a member wrote itself, kept so its own change to an approved checkout is never taken for an outsider's
// (martha#132), and so a later run can tell the member's work from anyone else's (martha#129).
//
// One JSON line per own write, appended to `own_writes.jsonl` in the project's state directory, outside the
// checkout (../keep_martha_state_outside_the_checkout). A line names the file, the git blob id and mode it held
// after the call, the tool call that wrote it, the session and the launch it ran in, and when it was kept. The
// order of the lines is what counts; the time is for a person reading the file.
//
// Two readers, two windows:
//   - the launch's own recheck reads only the writes of its launch, and at one path the last one kept wins, so an
//     earlier own write never keeps a path passing after a later one replaced it;
//   - a reader of the member's whole history reads every write, in the order kept.
//
// A line that is not an own write as this file keeps one refuses the whole file, naming the file and the line,
// and a missing file is no own writes. Which calls are own writes, and that the bytes on disk are the call's, is
// the caller's to decide: this file keeps and reads what it is given.

import { createHash } from 'node:crypto'
import { isAbsolute, join } from 'node:path'

import {
  appendStateLine,
  GIT_OBJECT_ID,
  hasExactly,
  isInstant,
  isRecord,
  readStateFile,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The member's own writes, one JSON line each. */
export const OWN_WRITES_FILE = 'own_writes.jsonl'

/** The modes of a regular file in git: a link or a gitlink is never an own write. */
export const OWN_WRITE_MODES = ['100644', '100755'] as const

/** The object formats git names a checkout's objects in (`git rev-parse --show-object-format`). */
export const GIT_OBJECT_FORMATS = ['sha1', 'sha256'] as const

export type OwnWriteMode = (typeof OWN_WRITE_MODES)[number]
export type GitObjectFormat = (typeof GIT_OBJECT_FORMATS)[number]

/** One file a member wrote with a file tool, as it was on disk after the call. */
export interface OwnWrite {
  /** The file's real path, under the checkout's top. */
  readonly path: string
  /** Its git blob id after the call, in the checkout's object format. */
  readonly blob: string
  readonly mode: OwnWriteMode
  /** The tool the host named in the call. */
  readonly tool: string
  readonly tool_use_id: string
  readonly session: string
  /** The launch the member was started as. */
  readonly launch: string
  readonly recorded_at: string
}

type Refused = { readonly refusal: string }
type OwnWrites = { readonly writes: readonly OwnWrite[] } | Refused

const OWN_WRITE_FIELDS: readonly (keyof OwnWrite)[] = ['path', 'blob', 'mode', 'tool', 'tool_use_id', 'session', 'launch', 'recorded_at']
const NAMING_FIELDS = ['tool', 'tool_use_id', 'session', 'launch'] as const

/** What one own write is called in a refusal. */
const ONE_OWN_WRITE = 'own write'

const isName = (value: unknown): boolean => typeof value === 'string' && value !== ''

const isOwnWrite = (value: unknown): value is OwnWrite => {
  if (!isRecord(value) || !hasExactly(value, OWN_WRITE_FIELDS)) return false
  const { path, blob, mode } = value
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  if (typeof blob !== 'string' || !GIT_OBJECT_ID.test(blob)) return false
  if (!(OWN_WRITE_MODES as readonly unknown[]).includes(mode)) return false
  return NAMING_FIELDS.every((field) => isName(value[field])) && isInstant(value['recorded_at'])
}

function ownWriteOf(line: string): OwnWrite | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return isOwnWrite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Keeps one more own write, as one line at the end of the file; or why it could not be kept. */
export function appendOwnWrite(state: MarthaState, write: OwnWrite): Refused | undefined {
  const line = Object.fromEntries(OWN_WRITE_FIELDS.map((field) => [field, write[field]]))
  return appendStateLine(state, OWN_WRITES_FILE, line, ONE_OWN_WRITE)
}

/** Every own write kept for this project, in the order kept; or why the file is not trusted. */
export function allOwnWrites(state: MarthaState): OwnWrites {
  const path = join(state.directory, OWN_WRITES_FILE)
  const read = readStateFile(path)
  if ('refusal' in read) return read
  const writes = read.text
    .split('\n')
    .filter((line) => line !== '')
    .map(ownWriteOf)
  const bad = writes.indexOf(undefined)
  if (bad !== -1) return { refusal: `${path} line ${bad + 1} is not an ${ONE_OWN_WRITE}, so Martha reads none of it.` }
  return { writes: writes as OwnWrite[] }
}

/** The own writes of one launch, the last kept at each path, in the order kept; or why the file is not trusted. */
export function ownWritesOfLaunch(state: MarthaState, launch: string): OwnWrites {
  const all = allOwnWrites(state)
  if ('refusal' in all) return all
  const latest = new Map<string, OwnWrite>()
  for (const write of all.writes.filter((kept) => kept.launch === launch)) {
    latest.delete(write.path)
    latest.set(write.path, write)
  }
  return { writes: [...latest.values()] }
}

/** The id git gives a blob of these bytes, in the checkout's object format. */
export function gitBlobIdOf(bytes: Uint8Array, format: GitObjectFormat): string {
  return createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}
