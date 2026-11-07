// Streams of rows that are only ever appended to, as files in one directory: the
// host contract's RowStore on a POSIX machine (#41). Host-neutral host glue, like
// ../linux_process_identity: a directory, not a coding tool's store, so every
// host adapter on such a machine composes this one.
//
// One directory per stream, one file per row, named by its position. Five rules,
// from the threat model on martha#41:
//
//   - A STREAM NAME IS NEVER A PATH (T9). The directory's name is the stream's
//     UTF-8 bytes in base64url behind a fixed letter, so `..`, `/`, NUL and a
//     leading dot are letters like any other, and no two names share a directory.
//   - ONE ROW PER POSITION (T10). A row is written whole under a staging name,
//     opened with O_CREAT | O_EXCL | O_NOFOLLOW, then linked to its position's
//     name. A link never replaces a file, so of two writers at one position the
//     second finds it taken: with an expected length it rejects ROW_STREAM_MOVED,
//     without one it takes the next free position.
//   - A READ NEVER SKIPS (T11). A gap, an entry the store never writes, a row not
//     readable as a JSON object, a link, or a file not owned by this user or open
//     to anyone else: the read rejects. A ledger that skipped a row would hide an
//     act that was sent, and its successor would send it twice.
//   - A ROW IS KEPT ONLY ONCE IT IS ON DISK (T11). The row's file is fsynced
//     before it is linked, and after the link the stream's directory, the rows
//     directory and its parent are fsynced too, so a crash after `append`
//     resolves cannot lose the name of a row whose act then ran. When a flush
//     fails after the link, the row is in the stream: the append rejects with
//     ROW_NOT_DURABLE and its position, and the stream takes no more appends in
//     this process, so a retry cannot write the same row twice.
//   - THE DIRECTORIES ARE CLOSED. The rows directory and every stream directory
//     are real directories, owned by this user, that nobody else may write into.
//
// The checks are speed bumps, not a boundary: every member runs as the same OS
// user that owns these files (A13, closed by the signed roster, martha#24).

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { getuid } from 'node:process'

import { ROW_NOT_DURABLE, ROW_STREAM_MOVED, type Row, type RowStore, type StoredRow } from '../host_contract/host_contract.ts'

/** Only the owner may read or write a row, or enter a stream. */
export const ROW_FILE_MODE = 0o600
export const STREAM_DIRECTORY_MODE = 0o700

/** What ends a row's file name, and what starts a file still being written. */
export const ROW_SUFFIX = '.row.json'
export const STAGING_PREFIX = '.staging-'

/** The letter every stream directory's name starts with, so none is empty or dotted. */
const STREAM_MARK = 's'

const ROW_FILE_NAME = new RegExp(`^(0|[1-9][0-9]*)${ROW_SUFFIX.replaceAll('.', '\\.')}$`)
const PERMISSION_BITS = 0o777
const WRITABLE_BY_OTHERS = 0o022

/** The rows of every stream, one directory per stream under this one. */
export function rowStreamsDirectory(directory: string): RowStore {
  return {
    append: async (stream, row, expected_length) => appendRow(directory, stream, row, expected_length),
    read: async (stream) => readRows(directory, stream),
  }
}

/** The directory a stream's rows live in, as a name under the rows directory. */
export function streamDirectoryNameOf(stream: string): string {
  return `${STREAM_MARK}${Buffer.from(stream, 'utf8').toString('base64url')}`
}

/** The file a row at this position is kept in. */
export function rowFileNameOf(position: number): string {
  return `${position}${ROW_SUFFIX}`
}

/**
 * The streams, by directory, that hold a row this process linked and could not
 * make durable, and its position. Kept for the process, across store instances:
 * no later append to such a stream is kept, so a retry cannot write the row twice.
 */
const STREAMS_NOT_DURABLE = new Map<string, number>()

function notDurable(stream: string, position: number, cause?: unknown): Error {
  return Object.assign(
    new Error(`${stream} holds a row at ${position} that could not be made durable: nothing more is appended to it`, { cause }),
    { code: ROW_NOT_DURABLE, position },
  )
}

function moved(stream: string, length: number, expected: number): Error {
  return Object.assign(new Error(`${stream} holds ${length} rows, not ${expected}`), { code: ROW_STREAM_MOVED })
}

function appendRow(directory: string, stream: string, row: Row, expected_length: number | undefined): number {
  const text = JSON.stringify(row)
  if (typeof text !== 'string' || !isRow(JSON.parse(text))) throw new Error(`A row for ${stream} is not a JSON object.`)

  const stream_directory = openStreamDirectory(directory, stream)
  const left = STREAMS_NOT_DURABLE.get(stream_directory)
  if (left !== undefined) throw notDurable(stream, left)
  const staging = join(stream_directory, `${STAGING_PREFIX}${randomUUID()}`)
  writeWhole(staging, text)
  try {
    return linkAtNextPosition(directory, stream_directory, stream, staging, expected_length)
  } finally {
    fs.rmSync(staging, { force: true })
  }
}

/**
 * Links the staged row at the stream's next position and makes it durable,
 * trying the next position again when another append took this one, unless the
 * caller expected a length, which the taken position has now moved.
 */
function linkAtNextPosition(
  directory: string,
  stream_directory: string,
  stream: string,
  staging: string,
  expected_length: number | undefined,
): number {
  for (;;) {
    const length = rowsIn(stream_directory, stream).length
    if (expected_length !== undefined && length !== expected_length) throw moved(stream, length, expected_length)
    if (linkedAt(staging, join(stream_directory, rowFileNameOf(length)))) {
      keepDurable(directory, stream_directory, stream, length)
      return length
    }
    if (expected_length !== undefined) throw moved(stream, length + 1, expected_length)
  }
}

/**
 * Puts the names a linked row hangs from on disk: its position in the stream's
 * directory, the stream's directory in the rows directory, and the rows
 * directory in its parent, which the host may have made just before. When one
 * cannot be flushed, the row is in the stream and not durable: the stream takes
 * no more appends in this process, and the append rejects naming the position.
 */
function keepDurable(directory: string, stream_directory: string, stream: string, position: number): void {
  try {
    syncDirectory(stream_directory)
    syncDirectory(directory)
    syncDirectory(dirname(directory))
  } catch (cause) {
    STREAMS_NOT_DURABLE.set(stream_directory, position)
    throw notDurable(stream, position, cause)
  }
}

/** Puts the staged row at its position; false when another row holds it already. */
function linkedAt(staging: string, position_path: string): boolean {
  try {
    fs.linkSync(staging, position_path)
    return true
  } catch (error) {
    if ((error as { code?: unknown }).code === 'EEXIST') return false
    throw error
  }
}

function writeWhole(path: string, text: string): void {
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW
  const descriptor = fs.openSync(path, flags, ROW_FILE_MODE)
  try {
    // The mode the file was opened with is masked by the process's umask.
    fs.fchmodSync(descriptor, ROW_FILE_MODE)
    fs.writeFileSync(descriptor, text)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

/** Flushes a directory's entries to disk, so a name linked or made in it survives a crash. */
function syncDirectory(path: string): void {
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY)
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
}

function readRows(directory: string, stream: string): readonly StoredRow[] {
  checkClosedDirectory(directory, 'the rows directory')
  const stream_directory = join(directory, streamDirectoryNameOf(stream))
  if (!fs.existsSync(stream_directory)) return []
  checkClosedDirectory(stream_directory, `the directory of ${stream}`)
  return rowsIn(stream_directory, stream)
}

/** The stream's directory, made closed if it is new, and checked either way. */
function openStreamDirectory(directory: string, stream: string): string {
  checkClosedDirectory(directory, 'the rows directory')
  const stream_directory = join(directory, streamDirectoryNameOf(stream))
  try {
    fs.mkdirSync(stream_directory, { mode: STREAM_DIRECTORY_MODE })
  } catch (error) {
    if ((error as { code?: unknown }).code !== 'EEXIST') throw error
  }
  checkClosedDirectory(stream_directory, `the directory of ${stream}`)
  return stream_directory
}

/** Every row of a stream, in order, or a rejection naming what it cannot vouch for. */
function rowsIn(stream_directory: string, stream: string): StoredRow[] {
  const positions: number[] = []
  for (const entry of fs.readdirSync(stream_directory)) {
    if (entry.startsWith(STAGING_PREFIX)) continue
    const match = ROW_FILE_NAME.exec(entry)
    if (match === null) throw new Error(`${stream} holds an entry the row store never writes: ${entry}`)
    positions.push(Number(match[1]))
  }
  positions.sort((a, b) => a - b)
  return positions.map((position, index) => {
    if (position !== index) throw new Error(`${stream} has no row at position ${index}: a row is missing.`)
    return { position, row: readRowFile(join(stream_directory, rowFileNameOf(position)), stream, position) }
  })
}

/** Opens without following a link, checks the open file itself, and reads that same file. */
function readRowFile(path: string, stream: string, position: number): Row {
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.uid !== getuid?.() || (stat.mode & PERMISSION_BITS) !== ROW_FILE_MODE) {
      throw new Error(`The row at ${position} of ${stream} is not a file only this user may read and write.`)
    }
    const row: unknown = JSON.parse(fs.readFileSync(descriptor, 'utf8'))
    if (!isRow(row)) throw new Error(`The row at ${position} of ${stream} is not a JSON object.`)
    return row
  } finally {
    fs.closeSync(descriptor)
  }
}

function checkClosedDirectory(path: string, what: string): void {
  const stat = fs.lstatSync(path)
  if (!stat.isDirectory() || stat.uid !== getuid?.() || (stat.mode & WRITABLE_BY_OTHERS) !== 0) {
    throw new Error(`${what} is not a directory of this user's that nobody else may write into.`)
  }
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
