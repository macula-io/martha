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

import type { Row, RowStore } from '../host_contract/host_contract.ts'
import type { Ingestion, Session } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { RECORD_LOST, type SessionRecordStore } from '../take_in_a_turn/take_in_a_turn.ts'

/** What prefixes a session's stream name; the rest is the session id, which the store encodes. */
export const SESSION_RECORD_STREAM = 'session-record:'

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

type Loaded = { readonly readable: true; length: number; last: Session | undefined } | { readonly readable: false }

/** The session records of one launcher, in these rows. */
export function sessionRecordsIn(rows: RowStore): SessionRecords {
  const loaded = new Map<string, Loaded>()
  const pending = new Map<string, Session>()

  return {
    load: async (session_id) => {
      if (loaded.has(session_id)) return
      try {
        const stored = await rows.read(streamOf(session_id))
        const last = stored.at(-1)
        loaded.set(session_id, { readable: true, length: stored.length, last: last === undefined ? undefined : recordOf(last.row) })
      } catch {
        loaded.set(session_id, { readable: false })
      }
    },
    store: {
      read: (session_id) => {
        const pendingRecord = pending.get(session_id)
        if (pendingRecord !== undefined) return pendingRecord
        const state = loaded.get(session_id)
        return state === undefined || !state.readable ? LOST : state.last
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
      await rows.append(streamOf(session_id), session as unknown as Row, state.length)
      state.length += 1
      state.last = session
    },
    check: async (session_id) => {
      const state = loaded.get(session_id)
      if (state === undefined || !state.readable) {
        throw new Error(`The record of session ${session_id} cannot be vouched for: its stream could not be read.`)
      }
      const stored = await rows.read(streamOf(session_id))
      if (stored.length !== state.length) {
        throw new Error(`The record of session ${session_id} holds ${stored.length} rows where this launcher kept ${state.length}.`)
      }
    },
  }
}

const streamOf = (session_id: string): string => `${SESSION_RECORD_STREAM}${session_id}`

const isIngestion = (value: unknown): value is Ingestion => {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    Object.keys(entry).length === 2 &&
    typeof entry.path === 'string' &&
    (entry.from_node_id === null || typeof entry.from_node_id === 'string')
  )
}

/** A row as a record, or the lost record when it is not one. */
export function recordOf(row: Row): Session {
  const ingested = row.ingested
  if (Object.keys(row).length !== 1 || !Array.isArray(ingested) || !ingested.every(isIngestion)) return LOST
  return { ingested: ingested.map((entry) => ({ path: entry.path, from_node_id: entry.from_node_id })) }
}
