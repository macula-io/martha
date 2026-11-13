// A member's session records, kept in the host's row streams (#41).
//
// This exists so what a session has taken in survives the launcher, the host
// and the machine restarting, and so a record nobody can vouch for reads as
// lost, never as empty.
//
// The core reads and writes a session's record synchronously
// (../take_in_a_turn's SessionRecordStore). The rows are asynchronous, so the
// launcher loads a session's stream before it hands the session to the core, and
// appends what the core wrote before it answers the relay. One stream per
// session, one row per record, each the whole record; the last row is the record.
// An append names the length it expects, so a second writer of the same session
// is refused (ROW_STREAM_MOVED) instead of being interleaved.
//
// Three rules keep it failing closed:
//
//   - a session the launcher has not loaded reads as lost;
//   - a stream that cannot be read, or whose last row is not a record, reads as
//     lost, and takes no append in this process;
//   - an append the store refuses (ROW_STREAM_MOVED, ROW_NOT_DURABLE, anything
//     else) rejects that session's flush, and only that session's; a stream
//     that reads back other than as kept rejects the check the launcher runs
//     before every tool call. The launcher then refuses that session's every
//     event for the rest of the process (Mars's point 3).
//
// THE OWNER'S RELEASE IS AN OVERLAY ON WHAT THIS READS, NEVER A WRITE (martha#321).
// A release is asked for again at load and before every check, and the core is
// handed the record it leaves (../apply_the_owners_release). What the stream
// keeps is the RAW record: a release clears a prefix of it, and what the session
// takes in afterwards is appended to that raw record, so the stream still holds
// what the owner cleared. Writing the cleared record back would make a handover
// stamped before the release fail the carry's digest check, and the successor
// would read as lost — the very refresh the release has to survive.

import type { Row, RowStore } from '../host_contract/host_contract.ts'
import type { Ingestion, Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { RECORD_LOST, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'

/** What prefixes a session's stream name; the rest is the session id, which the store encodes. */
export const SESSION_RECORD_STREAM = 'session-record:'

/**
 * A session's record as the owner's releases leave it (martha#321), read again from wherever the releases are kept.
 *
 * The launcher asks this at load and before every check, because a release is typed while the member may be running.
 */
export type ReleasedRecordIn = (session_id: string, raw: readonly Ingestion[]) => Promise<Session>

/** A record that reads as lost wherever the core reads it. */
export const LOST: Session = Object.freeze({ ingested: Object.freeze([RECORD_LOST]) })

export interface SessionRecords {
  /** Reads a session's stream, so the store can answer for that session. */
  load(session_id: string): Promise<void>
  /** The store the core reads and writes, synchronously. */
  readonly store: SessionRecordStore
  /**
   * Appends the record written for this session since its last flush; rejects
   * with the store's own error. Only this session's record is touched, and a
   * record that fails is dropped, so one session's broken stream never refuses
   * another session of the same launcher.
   */
  flush(session_id: string): Promise<void>
  /**
   * Reads a loaded session's stream again and rejects unless it still holds
   * exactly the rows this launcher kept: a store that no longer vouches for its
   * rows, or a row another writer added, refuses the session.
   */
  check(session_id: string): Promise<void>
}

/** What the owner's release leaves of the last kept record: the record the gate reads, and how much of the raw it cleared. */
interface Release {
  readonly record: Session
  readonly cleared: number
}

type Loaded =
  | { readonly readable: true; length: number; last: Session | undefined; release: Release | undefined }
  | { readonly readable: false }

/** The owner's releases of this record, read now; none when no release is asked for or nothing is kept yet. */
async function releaseOf(
  released: ReleasedRecordIn | undefined,
  session_id: string,
  last: Session | undefined,
): Promise<Release | undefined> {
  if (released === undefined || last === undefined) return undefined
  const record = await released(session_id, last.ingested)
  return { record, cleared: last.ingested.length - record.ingested.length }
}

/**
 * What the stream keeps for the record the core wrote: the raw record it held, with only what the session took in
 * after the release appended to it (martha#321 rule 1). Without a release — or with one that cleared nothing, and the
 * record the core wrote is then the whole of it — what the core wrote is what the stream keeps.
 */
function keptRawOf(last: Session | undefined, written: Session, release: Release | undefined): Session {
  if (release === undefined || release.cleared === 0) return written
  return { ingested: [...(last?.ingested ?? []), ...written.ingested.slice(release.cleared)] }
}

/** The session records of one launcher, in these rows, with the owner's releases applied as they are read. */
export function sessionRecordsIn(rows: RowStore, released?: ReleasedRecordIn): SessionRecords {
  const loaded = new Map<string, Loaded>()
  const pending = new Map<string, Session>()

  return {
    load: async (session_id) => {
      if (loaded.has(session_id)) return
      try {
        const stored = await rows.read(streamOf(session_id))
        const last = stored.at(-1)
        const record = last === undefined ? undefined : recordOf(last.row)
        loaded.set(session_id, { readable: true, length: stored.length, last: record, release: await releaseOf(released, session_id, record) })
      } catch {
        loaded.set(session_id, { readable: false })
      }
    },
    store: {
      read: (session_id) => {
        const pendingRecord = pending.get(session_id)
        if (pendingRecord !== undefined) return pendingRecord
        const state = loaded.get(session_id)
        if (state === undefined || !state.readable) return LOST
        return state.release?.record ?? state.last
      },
      write: (session_id, session) => void pending.set(session_id, session),
    },
    flush: async (session_id) => {
      const session = pending.get(session_id)
      if (session === undefined) return
      pending.delete(session_id)
      const state = loaded.get(session_id)
      if (state === undefined || !state.readable) {
        throw new Error(`The record of session ${session_id} is not kept: its stream could not be read.`)
      }
      const kept = keptRawOf(state.last, session, state.release)
      await rows.append(streamOf(session_id), kept as unknown as Row, state.length)
      state.length += 1
      state.last = kept
      if (state.release !== undefined) state.release = { record: session, cleared: state.release.cleared }
    },
    check: async (session_id) => {
      const state = loaded.get(session_id)
      if (state === undefined || !state.readable) {
        throw new Error(`The record of session ${session_id} cannot be vouched for: its stream could not be read.`)
      }
      // The owner may have released the member since the last call: read the release again before vouching for the
      // record, so the call after the release is answered on the record the release leaves.
      state.release = await releaseOf(released, session_id, state.last)
      const stored = await rows.read(streamOf(session_id))
      if (stored.length !== state.length) {
        throw new Error(`The record of session ${session_id} holds ${stored.length} rows where this launcher kept ${state.length}.`)
      }
    },
  }
}

const streamOf = (session_id: string): string => `${SESSION_RECORD_STREAM}${session_id}`

/** The third key a stored ingestion may carry beside its path and sender: the reason, one sentence (martha#247). */
const isWhy = (entry: Readonly<Record<string, unknown>>): boolean =>
  Object.hasOwn(entry, 'why') && typeof entry.why === 'string'

const isIngestion = (value: unknown): value is Ingestion => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  const keys = Object.keys(entry).length
  return (
    (keys === 2 || (keys === 3 && isWhy(entry))) &&
    typeof entry.path === 'string' &&
    (entry.from_node_id === null || typeof entry.from_node_id === 'string')
  )
}

/** A row as a record, or the lost record when it is not one. */
export function recordOf(row: Row): Session {
  const ingested = row.ingested
  if (Object.keys(row).length !== 1 || !Array.isArray(ingested) || !ingested.every(isIngestion)) return LOST
  return {
    ingested: ingested.map((entry) => ({
      path: entry.path,
      from_node_id: entry.from_node_id,
      ...(entry.why === undefined ? {} : { why: entry.why }),
    })),
  }
}
