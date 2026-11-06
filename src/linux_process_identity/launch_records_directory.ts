// The launcher's records as files in one directory: the launcher's seam (#42),
// which an adapter keeps for the launcher and hands slices only as
// `readingOnly(store)`, the contract's `stores.launches`. Host-neutral host glue:
// a Linux directory, not a coding tool's store, so every host adapter on Linux
// composes this one. No slice imports it (prove_the_core checks).
//
// One file per key, `<key>.launch.json`, so two launches at once never read,
// change and write back the same list. A file is written whole under a staging
// name and renamed into place, so a reader never sees half a record. The key is
// encoded before it becomes a file name, so no key is ever a path: `/`, `..` and
// every other character a name could steer with are written as %XX.
//
// Read back, the directory vouches for nothing (`all` returns no rows) unless all
// of these hold:
//
//   - the directory is a real directory, owned by this user, and no one else may
//     write into it, so no one else can swap a record in;
//   - every entry is a record or a staging file, nothing else, and a record's
//     name is a key exactly as this file encodes one;
//   - every record is opened without following a link, and the checks run on the
//     opened file itself, then that same file is read. Checking a path and then
//     opening it again would let it be swapped in between;
//   - every record is a regular file owned by this user that only this user may
//     read or write, and holds JSON.
//
// What a row must say, and that it names the member its key names, is the
// binder's to decide (src/attribute_a_cross_session_sender/), not this file's.
//
// The checks are speed bumps, not a boundary: every member runs as the same OS
// user that owns these files (the residual the binder states).

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'
import { getuid } from 'node:process'

import type { KeyedRow, KeyedRowStore, Row } from '../host_contract/host_contract.ts'

/** Only the owner may read or write a record. */
export const LAUNCH_RECORD_FILE_MODE = 0o600

/** What ends a record's file name. */
export const LAUNCH_RECORD_SUFFIX = '.launch.json'

/** What starts a file still being written. */
export const STAGING_PREFIX = '.staging-'

const PERMISSION_BITS = 0o777
const WRITABLE_BY_OTHERS = 0o022

/** The launcher's records, one file per key in this directory. */
export function launchRecordsDirectory(directory: string): KeyedRowStore {
  return {
    all: () => readRecords(directory),
    keep: (key, row) => keepRecord(directory, key, row),
    drop: (key) => fs.rmSync(recordPath(directory, key), { force: true }),
  }
}

/** A key as it is written in a file name: never empty, never a path. */
export function fileNameOf(key: string): string {
  if (key === '') throw new Error('A launch record is kept under a key, and an empty one is not a key.')
  return `${encodeURIComponent(key).replaceAll('.', '%2E')}${LAUNCH_RECORD_SUFFIX}`
}

/** The key a file name holds, or undefined when the name is not one this file writes. */
export function keyOf(file_name: string): string | undefined {
  if (!file_name.endsWith(LAUNCH_RECORD_SUFFIX)) return undefined
  try {
    const key = decodeURIComponent(file_name.slice(0, -LAUNCH_RECORD_SUFFIX.length))
    return key !== '' && fileNameOf(key) === file_name ? key : undefined
  } catch {
    return undefined
  }
}

function recordPath(directory: string, key: string): string {
  return join(directory, fileNameOf(key))
}

function keepRecord(directory: string, key: string, row: Row): void {
  const path = recordPath(directory, key)
  const staged = join(directory, `${STAGING_PREFIX}${randomUUID()}`)
  fs.writeFileSync(staged, JSON.stringify(row), { mode: LAUNCH_RECORD_FILE_MODE, flag: 'wx' })
  fs.chmodSync(staged, LAUNCH_RECORD_FILE_MODE)
  fs.renameSync(staged, path)
}

function readRecords(directory: string): readonly KeyedRow[] {
  if (!directoryIsClosed(directory)) return []

  const entries = entriesOf(directory)
  if (entries === undefined) return []

  const records: KeyedRow[] = []
  for (const entry of entries) {
    if (entry.startsWith(STAGING_PREFIX)) continue

    const key = keyOf(entry)
    if (key === undefined) return []

    const row = readRecord(join(directory, entry))
    if (row === undefined) return []
    records.push({ key, row })
  }
  return records
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

function readRecord(path: string): Row | undefined {
  let fd: number
  try {
    fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch {
    return undefined
  }

  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.uid !== getuid?.() || (stat.mode & PERMISSION_BITS) !== LAUNCH_RECORD_FILE_MODE) {
      return undefined
    }
    const row: unknown = JSON.parse(fs.readFileSync(fd, 'utf8'))
    return typeof row === 'object' && row !== null && !Array.isArray(row) ? (row as Row) : undefined
  } catch {
    return undefined
  } finally {
    fs.closeSync(fd)
  }
}
