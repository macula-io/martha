// The launcher's records as files in one directory of the crew's state.
//
// One file per member, `<member>.launch.json`, so two launches at once never
// read, change and write back the same list. A file is written whole under a
// staging name and renamed into place, so a reader never sees half a record.
//
// Read back, the directory vouches for nothing (and the binder binds nobody)
// unless all of these hold:
//
//   - the directory is a real directory, owned by this user, and no one else may
//     write into it, so no one else can swap a record in;
//   - every entry is a record or a staging file, nothing else;
//   - every record is opened without following a link, and the checks run on the
//     opened file itself, then that same file is read. Checking a path and then
//     opening it again would let it be swapped in between;
//   - every record is a regular file owned by this user that only this user may
//     read or write, holds exactly one well-formed row, and names the member its
//     file is named for.
//
// The checks are speed bumps, not a boundary: every member runs as the same OS
// user that owns these files (the residual the binder states).

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'
import { getuid } from 'node:process'

import { NODE_ID } from '../admit_a_room_message/admit_a_room_message.ts'
import { MEMBER_NAME, type MemberLaunch, type MemberLaunchStore } from './attribute_a_cross_session_sender.ts'

/** Only the owner may read or write a record. */
export const MEMBER_LAUNCH_FILE_MODE = 0o600

/** What ends a record's file name. */
export const MEMBER_LAUNCH_SUFFIX = '.launch.json'

/** What starts a file still being written. */
export const STAGING_PREFIX = '.staging-'

const PERMISSION_BITS = 0o777
const WRITABLE_BY_OTHERS = 0o022

/** The launcher's records, one file per member in this directory. */
export function memberLaunchesDirectory(directory: string): MemberLaunchStore {
  return {
    launches: () => readLaunches(directory),
    keep: (launch) => keepLaunch(directory, launch),
    drop: (member_name) => fs.rmSync(recordPath(directory, member_name), { force: true }),
  }
}

function recordPath(directory: string, member_name: string): string {
  if (!MEMBER_NAME.test(member_name)) throw new Error('A member record is named for a member name, and this is not one.')
  return join(directory, `${member_name}${MEMBER_LAUNCH_SUFFIX}`)
}

function keepLaunch(directory: string, launch: MemberLaunch): void {
  const path = recordPath(directory, launch.member_name)
  const staged = join(directory, `${STAGING_PREFIX}${randomUUID()}`)
  fs.writeFileSync(staged, JSON.stringify(launch), { mode: MEMBER_LAUNCH_FILE_MODE, flag: 'wx' })
  fs.chmodSync(staged, MEMBER_LAUNCH_FILE_MODE)
  fs.renameSync(staged, path)
}

function readLaunches(directory: string): readonly MemberLaunch[] {
  if (!directoryIsClosed(directory)) return []

  const entries = entriesOf(directory)
  if (entries === undefined) return []

  const launches: MemberLaunch[] = []
  for (const entry of entries) {
    if (entry.startsWith(STAGING_PREFIX)) continue
    if (!entry.endsWith(MEMBER_LAUNCH_SUFFIX)) return []

    const launch = readRecord(join(directory, entry))
    if (launch === undefined || `${launch.member_name}${MEMBER_LAUNCH_SUFFIX}` !== entry) return []
    launches.push(launch)
  }
  return launches
}

function directoryIsClosed(directory: string): boolean {
  try {
    const stat = fs.lstatSync(directory)
    return stat.isDirectory() && stat.uid === getuid?.() && (stat.mode & WRITABLE_BY_OTHERS) === 0
  } catch {
    return false
  }
}

function entriesOf(directory: string): readonly string[] | undefined {
  try {
    return fs.readdirSync(directory)
  } catch {
    return undefined
  }
}

function readRecord(path: string): MemberLaunch | undefined {
  let fd: number
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch {
    return undefined
  }

  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.uid !== getuid?.() || (stat.mode & PERMISSION_BITS) !== MEMBER_LAUNCH_FILE_MODE) {
      return undefined
    }
    const row: unknown = JSON.parse(fs.readFileSync(fd, 'utf8'))
    return isMemberLaunch(row) ? row : undefined
  } catch {
    return undefined
  } finally {
    fs.closeSync(fd)
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
    MEMBER_NAME.test(member_name) &&
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
