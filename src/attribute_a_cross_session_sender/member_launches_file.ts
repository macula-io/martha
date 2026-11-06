// The launcher's records as a file in the crew's state directory.
//
// Written whole, to a file only its owner may read or write, by renaming a
// finished copy into place so a reader never sees half a file. Read back with
// every row checked: a file that is missing, unreadable, malformed, or open to
// anyone but its owner vouches for nothing, and the binder then binds nobody.
//
// The mode check is a speed bump, not a boundary: every member runs as the
// same OS user that owns this file (the residual the binder states).

import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { getuid } from 'node:process'

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import type { MemberLaunch, MemberLaunchStore } from './attribute_a_cross_session_sender.ts'

/** Only the owner may read or write it. */
export const MEMBER_LAUNCHES_FILE_MODE = 0o600

const PERMISSION_BITS = 0o777

/** The launcher's records, kept in one file at this path. */
export function memberLaunchesFile(path: string): MemberLaunchStore {
  return {
    launches: () => readLaunches(path),
    write: (launches) => writeLaunches(path, launches),
  }
}

function writeLaunches(path: string, launches: readonly MemberLaunch[]): void {
  const finished = `${path}.${randomUUID()}.next`
  writeFileSync(finished, JSON.stringify({ launches }), { mode: MEMBER_LAUNCHES_FILE_MODE, flag: 'wx' })
  chmodSync(finished, MEMBER_LAUNCHES_FILE_MODE)
  renameSync(finished, path)
}

function readLaunches(path: string): readonly MemberLaunch[] {
  if (!ownedAndClosed(path)) return []

  const parsed = parseOrNothing(path)
  if (!isRecord(parsed) || !Array.isArray(parsed['launches'])) return []

  const rows: unknown[] = parsed['launches']
  return rows.every(isMemberLaunch) ? rows : []
}

function ownedAndClosed(path: string): boolean {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && stat.uid === getuid?.() && (stat.mode & PERMISSION_BITS) === MEMBER_LAUNCHES_FILE_MODE
  } catch {
    return false
  }
}

function parseOrNothing(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMemberLaunch(value: unknown): value is MemberLaunch {
  if (!isRecord(value)) return false
  const { member_name, node_id, pid, process_started_at } = value
  return (
    typeof member_name === 'string' &&
    member_name.trim() !== '' &&
    typeof node_id === 'string' &&
    NODE_ID.test(node_id) &&
    node_id === node_id.toLowerCase() &&
    typeof pid === 'number' &&
    Number.isSafeInteger(pid) &&
    pid > 0 &&
    typeof process_started_at === 'string' &&
    process_started_at !== ''
  )
}
