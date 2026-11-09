// What a member wrote itself, so its own change to an approved checkout is never taken for an outsider's
// (martha#132), and so a later run can tell the member's work from anyone else's (martha#129).
//
// One record per own write: the file, the git blob id and mode it held after the call, the tool call that wrote
// it, the session and the launch it ran in, and when it was kept. Records are kept in order, and the order is what
// counts; the time is for a person reading them.
//
// Two readers, two windows:
//   - the launch's own recheck reads only the writes of its launch, and at one path the last one kept wins, so an
//     earlier own write never keeps a path passing after a later one replaced it (`latestOfLaunch`);
//   - a reader of the member's whole history reads every write, in the order kept.
//
// This file holds the record and its rules, and touches nothing. Where the records are kept is the host's: an
// adapter hands the core an OwnWritesStore (../keep_martha_state_outside_the_checkout keeps them in Martha's state,
// outside the checkout). Which calls are own writes, and that the bytes on disk are the call's, is the caller's to
// decide.

import { isAbsolute } from 'node:path'

/** The modes of a regular file in git: a link or a gitlink is never an own write. */
export const OWN_WRITE_MODES = ['100644', '100755'] as const

export type OwnWriteMode = (typeof OWN_WRITE_MODES)[number]

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

/** The own writes read back, or why they are not trusted. */
export type OwnWrites = { readonly writes: readonly OwnWrite[] } | Refused

/** Where a host keeps a project's own writes. */
export interface OwnWritesStore {
  /** Keeps one more own write after the others; why it could not be kept, or undefined. */
  append(write: OwnWrite): string | undefined
  /** Every own write kept, in the order kept; or why they are not trusted. */
  all(): OwnWrites
}

/** The fields of a record, in the order a line is written. */
export const OWN_WRITE_FIELDS: readonly (keyof OwnWrite)[] = ['path', 'blob', 'mode', 'tool', 'tool_use_id', 'session', 'launch', 'recorded_at']
const NAMING_FIELDS = ['tool', 'tool_use_id', 'session', 'launch'] as const

/** A git object id, sha1 or sha256. */
const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const hasExactly = (value: Record<string, unknown>, fields: readonly string[]): boolean =>
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort())
const isName = (value: unknown): boolean => typeof value === 'string' && value !== ''
const isInstant = (text: unknown): boolean => typeof text === 'string' && !Number.isNaN(Date.parse(text)) && new Date(text).toISOString() === text

/** True only for a record exactly as an own write is kept. */
export const isOwnWrite = (value: unknown): value is OwnWrite => {
  if (!isRecord(value) || !hasExactly(value, OWN_WRITE_FIELDS)) return false
  const { path, blob, mode } = value
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  if (typeof blob !== 'string' || !GIT_OBJECT_ID.test(blob)) return false
  if (!(OWN_WRITE_MODES as readonly unknown[]).includes(mode)) return false
  return NAMING_FIELDS.every((field) => isName(value[field])) && isInstant(value['recorded_at'])
}

/** One kept line as an own write, or undefined when it is not one. */
export function ownWriteOfLine(line: string): OwnWrite | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return isOwnWrite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** One own write as the line that keeps it, its fields in their order. */
export const lineOfOwnWrite = (write: OwnWrite): string => JSON.stringify(Object.fromEntries(OWN_WRITE_FIELDS.map((field) => [field, write[field]])))

/** The own writes of one launch, the last kept at each path, in the order kept. */
export function latestOfLaunch(writes: readonly OwnWrite[], launch: string): readonly OwnWrite[] {
  const latest = new Map<string, OwnWrite>()
  for (const write of writes.filter((kept) => kept.launch === launch)) {
    latest.delete(write.path)
    latest.set(write.path, write)
  }
  return [...latest.values()]
}

/** The own writes of one launch in a store, the last kept at each path; or why they are not trusted. */
export function ownWritesOfLaunch(store: OwnWritesStore, launch: string): OwnWrites {
  const all = store.all()
  return 'refusal' in all ? all : { writes: latestOfLaunch(all.writes, launch) }
}
