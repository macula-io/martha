// What the launcher keeps of a checkout it has read (martha#177): the record of what the gate hashed last time, and
// git's own index of that read, kept in Martha's state and never in the checkout.
//
// A launch reads the checkout's tree, and every recheck reads it again. On a large checkout that is every file, every
// time. Both halves of that read can be answered from the last one: git skips a file whose stat still matches its
// index, and the gate skips a file whose bytes it has already hashed
// (../judge_a_checkouts_tree/the_launchers_tree_record.ts), so an unchanged checkout costs git's own stat walk and
// nothing more.
//
// Rules:
//
//   - OUTSIDE THE CHECKOUT. `<state root>/<project>/tree-read/<sha256 of the checkout's top>/`: this project's state,
//     beside the approvals. Nothing in the checkout is read for it and nothing there is written, so an author who
//     ships a pull request cannot put one in place.
//   - THE DIRECTORY IS CLOSED. A real directory, this user's, mode 0700: made so when it is missing, refused when it is
//     not, so a read that cannot keep its work falls back to reading every file rather than keeping it somewhere else.
//   - THE RECORD AND THE INDEX ARE WRITTEN WHOLE. Each is staged beside itself, every byte counted, fsynced, renamed
//     into place, and read as nothing at all unless it is a regular file of this user's that nobody else may read.
//   - ONE INDEX PER KEY. The index is kept for one key — the object format and the tree whose attributes the read
//     obeys — and dropped when another key asks for it, so blobs hashed under one attribute tree are never used for a
//     read made under another. Git reads and writes the file in place; a read that cannot use it (a lock another read
//     holds) refuses, and the gate reads again with a fresh index of its own.
//
// The checks are speed bumps, not a boundary: a member runs as the owner's OS user, so its shell can write here. It is
// the residual martha#1 decision 2 accepts for the rest of Martha's state: what a shell that can write this can forge
// is no more than what it can already forge in the approvals beside it.

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { getuid } from 'node:process'

import type { KeptTreeRead, Refused, TreeReadPlace } from '../host_contract/host_contract.ts'
import { PERMISSION_BITS, STATE_DIRECTORY_MODE, STATE_FILE_MODE, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { STAGING_PREFIX } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'

/** The directory under a project's state that holds what the launcher keeps of each checkout it reads (martha#177). */
export const TREE_READ_PLACE = 'tree-read'

/** The record's name, inside one checkout's directory. */
export const RECORD_NAME = 'record'

/** Git's index's name, inside one checkout's directory. */
export const INDEX_NAME = 'index'

/** What the index was made under, beside it: a key other than this one and the index is not used. */
export const INDEX_KEY_NAME = 'index.key'

/** What the launcher keeps of each checkout of the project whose state this is (martha#177). */
export function keepWhatTheLauncherHashed(state: MarthaState): TreeReadPlace {
  return {
    keptFor(top: string): KeptTreeRead | Refused {
      const directory = join(state.directory, TREE_READ_PLACE, createHash('sha256').update(top).digest('hex'))
      const why = closedDirectory(join(state.directory, TREE_READ_PLACE)) ?? closedDirectory(directory)
      return why === undefined ? keptIn(directory) : { refusal: `Martha keeps no read of ${top}: ${why}.` }
    },
  }
}

/** `path` made mode 0700 when it is missing, then checked: why it may not hold what the launcher keeps, or undefined. */
function closedDirectory(path: string): string | undefined {
  if (fs.lstatSync(path, { throwIfNoEntry: false }) === undefined) fs.mkdirSync(path, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const found = fs.lstatSync(path, { throwIfNoEntry: false })
  if (found === undefined) return `${path} is missing`
  if (found.isSymbolicLink() || !found.isDirectory()) return `${path} is not a directory of Martha's`
  if (found.uid !== getuid?.()) return `${path} is not owned by this user`
  return (found.mode & PERMISSION_BITS) === STATE_DIRECTORY_MODE ? undefined : `${path} may be read or written by others`
}

/** The record and the index kept in `directory`, as the gate asks for them. */
function keptIn(directory: string): KeptTreeRead {
  const record = join(directory, RECORD_NAME)
  const index = join(directory, INDEX_NAME)
  return {
    read: () => readAKeptFile(record),
    keep: (bytes) => keepWhole(record, bytes),
    indexFor: (key) => indexKeptFor(directory, index, key),
  }
}

/** The index kept for `key`: the one already there when it was kept for the same key, and none at all otherwise. */
function indexKeptFor(directory: string, index: string, key: string): string {
  const stamp = join(directory, INDEX_KEY_NAME)
  const kept = readAKeptFile(stamp)
  if (kept !== undefined && Buffer.from(kept).toString('utf8') === key) return index
  fs.rmSync(index, { force: true })
  keepWhole(stamp, Buffer.from(key))
  return index
}

/** A kept file's bytes, or undefined when none is kept, or what is there is not a file only this user may read and write. */
function readAKeptFile(path: string): Uint8Array | undefined {
  let descriptor: number
  try {
    descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch {
    return undefined
  }
  try {
    const found = fs.fstatSync(descriptor)
    if (!found.isFile() || found.uid !== getuid?.()) return undefined
    return (found.mode & PERMISSION_BITS) === STATE_FILE_MODE ? fs.readFileSync(descriptor) : undefined
  } catch {
    return undefined
  } finally {
    fs.closeSync(descriptor)
  }
}

/** Keeps these bytes whole, under a staging name beside the file and then renamed into place; a file not kept whole is not kept. */
function keepWhole(path: string, bytes: Uint8Array): void {
  const staged = join(dirname(path), `${STAGING_PREFIX}${randomUUID()}`)
  if (!writtenWhole(staged, bytes)) {
    fs.rmSync(staged, { force: true })
    return
  }
  fs.renameSync(staged, path)
}

/** These bytes written whole to `staged`, mode 0600 and fsynced, counting every byte; false when they were not. */
function writtenWhole(staged: string, bytes: Uint8Array): boolean {
  let descriptor: number
  try {
    descriptor = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, STATE_FILE_MODE)
  } catch {
    return false
  }
  try {
    if (fs.writeSync(descriptor, bytes) !== bytes.length) return false
    fs.chmodSync(staged, STATE_FILE_MODE)
    fs.fsyncSync(descriptor)
    return true
  } catch {
    return false
  } finally {
    fs.closeSync(descriptor)
  }
}
