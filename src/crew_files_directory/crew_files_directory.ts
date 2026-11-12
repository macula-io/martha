// The crew's own store, as directories of whole files: the host contract's CrewStore on a POSIX machine (martha#254
// R1, #255). Host-neutral host glue, like ../row_streams_directory: a directory, not a coding tool's store, so every
// host adapter on such a machine composes this one.
//
// The launcher resolves the crew's directory — `<state root>/crews/<sha256 of the git common dir>`, which is
// ../keep_martha_state_outside_the_checkout's to name, because a key's own git runs carry Martha's settings — and hands
// it here. Everything below it is this store's: a place is one directory under it, and a file is kept whole in a place.
//
// Five rules, the ones every file of Martha's own state is kept by:
//
//   - A PLACE IS A NAME, NEVER A PATH. A place name this store did not accept (empty, `.`, `..`, or holding a
//     separator) is refused rather than encoded, because the names are Martha's own — `handovers`, `parked` — and a
//     path where one is expected is a mistake, not something to translate quietly.
//   - A FILE IS WRITTEN WHOLE. Its text goes to a staging name beside it, opened O_CREAT | O_EXCL | O_NOFOLLOW, mode
//     0600, fsynced, and renamed into place, so a reader never sees half of a handover and a crash leaves the file as
//     it was.
//   - A FILE IS READ AS IT IS. The name is opened O_NOFOLLOW and the file that was opened is checked, never one name
//     checked and another read: a link, a file of another user's, or one anyone else may read or write is refused.
//   - THE DIRECTORIES ARE CLOSED. The crew's directory and every place are made mode 0700 and are real directories,
//     owned by this user, that nobody else may write into; one that is not is refused with the reason.
//   - A HALF-WRITTEN FILE IS NOT A FILE. The staging names are left out of what `names` answers.
//
// The checks are speed bumps, not a boundary: a member runs as the owner's OS user, so its shell can write here. It is
// the residual martha#1 decision 2 accepts for the rest of Martha's state.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { basename, join } from 'node:path'
import { getuid } from 'node:process'

import type { CrewPlace, CrewStore, HandoverStamp, HandoverStampStore, Refused } from '../host_contract/host_contract.ts'

/** Only the owner may enter a place, or read and write a file in it. */
export const CREW_DIRECTORY_MODE = 0o700
export const CREW_FILE_MODE = 0o600

/** What starts a file still being written, so it is never read or listed as one. */
export const STAGING_PREFIX = '.staging-'

/** The bits of a mode that say who may read, write and enter. */
const PERMISSION_BITS = 0o777
const OPEN_TO_OTHERS = 0o077
const WRITABLE_BY_OTHERS = 0o022

/** A name this store accepts: one name, never a path, and never one a half-written file is under. */
export function isAPlainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.startsWith(STAGING_PREFIX) && !/[/\\\0]/.test(name)
}

/**
 * The crew's own store over the crew's directory, `crew` (../keep_martha_state_outside_the_checkout's
 * crewStateDirectory). The directory is made 0700 when it is missing, and refused when it is not this user's own.
 */
export function crewFilesDirectory(crew: string): CrewStore {
  return { place: (name) => placeIn(crew, name) }
}

/** The place a crew keeps its handover stamps in: one file per handover file, named as the handover is. */
export const HANDOVER_STAMPS_PLACE = 'handover-stamps'

/**
 * The handover stamps a crew keeps, over its own directory (#255): the host's record of which handovers it wrote, when,
 * and for which member — the one thing that tells a wake which handover is newest, since a file's name carries a day
 * and a day cannot tell two apart. Keyed by the handover's own file, kept as `<place>/<handover file name>`.
 *
 * A store that will not answer is said, never answered `undefined`: a stamp it will not hand over, or will not keep, is
 * a refusal with its reason (martha#255 part 2, decision 1).
 */
export function handoverStampsIn(crew: string): HandoverStampStore {
  return {
    read: (file) => {
      const place = placeIn(crew, HANDOVER_STAMPS_PLACE)
      if ('refusal' in place) return place
      const read = place.read(basename(file))
      if (read === undefined) return undefined
      if ('refusal' in read) return read
      return stampOf(read.text, file)
    },
    write: (file, stamp) => {
      const place = placeIn(crew, HANDOVER_STAMPS_PLACE)
      if ('refusal' in place) return place
      return place.keep(basename(file), `${JSON.stringify(stamp)}\n`)
    },
  }
}

/** The stamp `text` holds for `file`, or why it is no stamp this host would read. */
function stampOf(text: string, file: string): HandoverStamp | Refused {
  let held: unknown
  try {
    held = JSON.parse(text)
  } catch {
    return { refusal: `${file} has a stamp that is not readable as one, so Martha cannot say when it was written.` }
  }
  const { member, predecessor_id, written_at, digest, record_length, record_digest } = (held ?? {}) as Record<string, unknown>
  const whole =
    typeof member === 'string' &&
    typeof predecessor_id === 'string' &&
    typeof written_at === 'string' &&
    typeof digest === 'string' &&
    typeof record_length === 'number' &&
    typeof record_digest === 'string'
  return whole ? (held as HandoverStamp) : { refusal: `${file} has a stamp that is missing what Martha reads one for.` }
}

/** The place `name` under the crew's directory, made 0700 when missing; or why it may not be used. */
function placeIn(crew: string, name: string): CrewPlace | Refused {
  if (!isAPlainName(name)) return { refusal: `${JSON.stringify(name)} is not one place in the crew's store.` }
  const unsafe = closedDirectory(crew)
  if (unsafe !== undefined) return { refusal: `Martha keeps no crew files there: ${unsafe}.` }
  const path = join(crew, name)
  const unclosed = closedDirectory(path)
  if (unclosed !== undefined) return { refusal: `Martha keeps no crew files there: ${unclosed}.` }
  return placeAt(path)
}

/** The place in the directory at `path`, already checked and made. */
function placeAt(path: string): CrewPlace {
  return {
    path,
    keep: (name, text) => keepInPlace(path, name, text),
    read: (name) => readFromPlace(path, name),
    names: () => namesInPlace(path),
  }
}

/** Keeps `text` whole as `name` in the place at `path`; or why it could not. */
function keepInPlace(path: string, name: string, text: string): Refused | undefined {
  if (!isAPlainName(name)) return { refusal: `${JSON.stringify(name)} is not one file in ${path}.` }
  const file = join(path, name)
  const staged = join(path, `${STAGING_PREFIX}${randomUUID()}`)
  const refused = writeWhole(staged, text, file)
  if (refused !== undefined) {
    fs.rmSync(staged, { force: true })
    return refused
  }
  try {
    fs.renameSync(staged, file)
    return undefined
  } catch (error) {
    fs.rmSync(staged, { force: true })
    return { refusal: `${file} could not be replaced (${codeOf(error)}), so Martha keeps nothing in it.` }
  }
}

/** `text` written whole to the staging file `staged`, every byte counted, so `file` is renamed over only once it is on disk. */
function writeWhole(staged: string, text: string, file: string): Refused | undefined {
  let descriptor: number
  try {
    descriptor = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, CREW_FILE_MODE)
  } catch (error) {
    return { refusal: `${file} could not be written (${codeOf(error)}), so Martha keeps nothing in it.` }
  }
  try {
    // The mode the file was opened with is masked by the process's umask, so it is set again on the file itself.
    fs.fchmodSync(descriptor, CREW_FILE_MODE)
    const bytes = Buffer.byteLength(text)
    const written = writtenBy(() => fs.writeSync(descriptor, text))
    if (typeof written === 'string') return { refusal: `${file} could not be written (${written}), so Martha keeps nothing in it.` }
    if (written !== bytes) return { refusal: `${file} kept only ${written} of the ${bytes} bytes, so Martha keeps none of it.` }
    fs.fsyncSync(descriptor)
    return undefined
  } catch (error) {
    return { refusal: `${file} could not be written (${codeOf(error)}), so Martha keeps nothing in it.` }
  } finally {
    fs.closeSync(descriptor)
  }
}

/** The text of `name` in the place at `path`; undefined when there is no such file; or why it may not be read. */
function readFromPlace(path: string, name: string): { readonly text: string } | undefined | Refused {
  if (!isAPlainName(name)) return { refusal: `${JSON.stringify(name)} is not one file in ${path}.` }
  const file = join(path, name)
  let descriptor: number
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch (error) {
    const code = codeOf(error)
    return code === 'ENOENT' ? undefined : { refusal: `${file} could not be read (${code}).` }
  }
  try {
    const found = fs.fstatSync(descriptor)
    if (!found.isFile() || found.uid !== getuid?.() || (found.mode & OPEN_TO_OTHERS) !== 0) {
      return { refusal: `${file} is not a file only this user may read and write, so Martha does not trust it.` }
    }
    return { text: fs.readFileSync(descriptor, 'utf8') }
  } finally {
    fs.closeSync(descriptor)
  }
}

/** Every name in the place at `path`, in no particular order; or why it cannot be listed. */
function namesInPlace(path: string): readonly string[] | Refused {
  try {
    return fs
      .readdirSync(path)
      .filter((name) => !name.startsWith(STAGING_PREFIX))
      .sort()
  } catch (error) {
    return { refusal: `${path} could not be listed (${codeOf(error)}).` }
  }
}

/** Makes `path` mode 0700 when it is missing, then checks it; why it may not hold crew files, or undefined. */
function closedDirectory(path: string): string | undefined {
  if (fs.lstatSync(path, { throwIfNoEntry: false }) === undefined) fs.mkdirSync(path, { recursive: true, mode: CREW_DIRECTORY_MODE })
  const found = fs.lstatSync(path, { throwIfNoEntry: false })
  if (found === undefined) return `${path} is missing`
  if (found.isSymbolicLink()) return `${path} is a link, not a directory of Martha's`
  if (!found.isDirectory()) return `${path} is not a directory`
  if (found.uid !== getuid?.()) return `${path} is not owned by this user`
  if ((found.mode & WRITABLE_BY_OTHERS) !== 0) return `${path} may be written by others (mode ${(found.mode & PERMISSION_BITS).toString(8)})`
  return undefined
}

/** The bytes `write` wrote, or the error's code when it could not write at all. */
function writtenBy(write: () => number): number | string {
  try {
    return write()
  } catch (error) {
    return codeOf(error)
  }
}

const codeOf = (error: unknown): string => (error as NodeJS.ErrnoException).code ?? String(error)
