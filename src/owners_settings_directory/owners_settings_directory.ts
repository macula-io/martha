// The owner's own settings file on a POSIX machine, and the lock that guards it (martha#359).
//
// This exists so the slice that decides what to do about the owner's default (../put_the_owners_model_back) reads and
// writes no disk of its own: the file is the host's — `<config dir>/settings.json`, where Claude Code's own `/model`
// command saves the switched model as the owner's default for new sessions — and reaching it is glue, as reaching the
// crew's store is (../crew_files_directory).
//
// Three rules, the ones every file of Martha's own state is kept by:
//
//   - A REGULAR FILE OR NOTHING. A link, a folder, or a file this user does not own is refused by name, and the decision
//     above refuses the switch with it: writing bytes back over a link replaces the owner's own arrangement of their
//     files with a plain file.
//   - WRITTEN WHOLE, BESIDE ITSELF. The bytes go to a temporary name in the same directory, opened
//     O_CREAT | O_EXCL | O_NOFOLLOW with the file's own mode, fsynced, and renamed into place, so the owner never reads
//     half a settings file and a crash leaves the file as it was.
//   - ONE LOCK AT A TIME, NAMED FOR THE OWNER. The lock is a file under Martha's state root, named by the sha256 of the
//     config directory's real path, so two members of one crew and two crews of one owner contend for the same lock:
//     what is shared is the owner's file, not the crew. A holder that has died leaves the lock behind, and a lock nobody
//     holds must not stop the owner's default being put back, so a lock whose pid is no longer running is broken by the
//     next taker. A lock whose holder is alive is never broken.
//
// The checks are speed bumps, not a boundary: a member runs as the owner's OS user, so its shell can write here. It is
// the residual martha#1 decision 2 accepts for the rest of Martha's state.

import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { basename, dirname, join } from 'node:path'
import process from 'node:process'

import type { ASwitchLock, Refused, TheOwnersSettingsRead, TheOwnersSettingsStore } from '../host_contract/host_contract.ts'

/** Where the locks live, inside Martha's state root: not a crew's, because what they guard is the owner's own file. */
export const SWITCH_LOCK_PLACE = 'owner-default-locks'

/** Only the owner may enter the locks' directory, or read and write a lock in it. */
export const LOCK_DIRECTORY_MODE = 0o700
export const LOCK_FILE_MODE = 0o600

/** How long a switch waits for the lock before it is refused: a switch refused, never queued behind nothing. */
export const THE_LOCK_WAIT_MS = 5_000

/** How long one attempt waits before it looks again. */
export const THE_LOCK_STEP_MS = 25

/** The mode bits that say who may read, write and enter: kept as the file had them, never widened. */
const PERMISSION_BITS = 0o777

/**
 * The owner's settings file at `settings_file`, and the one lock for its config directory, kept under `lock_root`. The
 * config directory is the file's own directory and is not passed beside it: the file is `<config dir>/settings.json`,
 * and two of them could name a lock and a file that disagree.
 */
export function ownersSettingsIn(settings_file: string, lock_root: string): TheOwnersSettingsStore {
  return {
    read: () => readTheOwnersSettings(settings_file),
    writeBack: (bytes, mode) => writeTheOwnersSettingsBack(settings_file, bytes, mode),
    remove: () => removeTheOwnersSettings(settings_file),
    takeTheLock: () => takeTheSwitchLock(lock_root, dirname(settings_file)),
  }
}

/** The file as it is now, or why it cannot be trusted to be put back: the owner's settings, read whole. */
export function readTheOwnersSettings(file: string): TheOwnersSettingsRead {
  const found = lstatOf(file)
  if ('refusal' in found) return found
  if (found.kind === 'missing') return { kind: 'missing' }
  if (!found.stat.isFile()) {
    return {
      refusal: `${file} is not a regular file, so a switch could not put it back byte for byte and none was made: make it a plain settings file, or stop the member's switch by hand`,
    }
  }
  const bytes = bytesOf(file)
  if ('refusal' in bytes) return bytes
  return { kind: 'file', bytes, mode: found.stat.mode & PERMISSION_BITS }
}

/** What the file at `file` is, or is missing: a stat that never follows a link. */
function lstatOf(file: string): { readonly kind: 'missing' } | { readonly kind: 'held'; readonly stat: fs.Stats } | Refused {
  try {
    return { kind: 'held', stat: fs.lstatSync(file) }
  } catch (error) {
    return codeOf(error) === 'ENOENT'
      ? { kind: 'missing' }
      : { refusal: `${file} could not be read (${told(error)}), so nothing can be said about the owner's default and no switch was made` }
  }
}

/** The file's bytes, or why they cannot be read: a settings file half read is one this glue never hands on. */
function bytesOf(file: string): Uint8Array | Refused {
  try {
    return fs.readFileSync(file)
  } catch (error) {
    return { refusal: `${file} could not be read (${told(error)}), so nothing can be said about the owner's default and no switch was made` }
  }
}

/** Writes `bytes` to `file` whole, in the file's own mode: a temporary name beside it, fsynced, renamed into place. */
export function writeTheOwnersSettingsBack(file: string, bytes: Uint8Array, mode: number): Refused | undefined {
  const temporary = join(dirname(file), `.${basename(file)}.martha-${randomUUID()}`)
  try {
    keepBytesAt(temporary, bytes, mode)
    fs.renameSync(temporary, file)
    return undefined
  } catch (error) {
    removeQuietly(temporary)
    return { refusal: `${file} could not be written back (${told(error)}), so the owner's default may still be the member's model` }
  }
}

/** Removes a file the host made where the owner had none: the restore of a file that was not there is no file. */
export function removeTheOwnersSettings(file: string): Refused | undefined {
  try {
    fs.rmSync(file, { force: true })
    return undefined
  } catch (error) {
    return { refusal: `${file} could not be removed (${told(error)}), so the owner has a settings file they did not have before` }
  }
}

/**
 * Takes the one lock for this owner's config directory, or says why it could not within the bound: another switch is
 * running, or the directory cannot be written. A lock whose holder has died is broken here — the recovery at a launch
 * is that taker — and a lock whose holder is alive is waited for, never broken.
 */
async function takeTheSwitchLock(lock_root: string, config_dir: string): Promise<ASwitchLock | Refused> {
  const file = theLockFileIn(lock_root, config_dir)
  if ('refusal' in file) return file
  const nonce = randomUUID()
  const refused = makeTheLockDirectory(join(lock_root, SWITCH_LOCK_PLACE))
  if (refused !== undefined) return refused
  for (let tried = 0; tried < THE_LOCK_WAIT_MS / THE_LOCK_STEP_MS; tried += 1) {
    if (keepTheLockFile(file.file, nonce)) return { file: file.file, release: () => releaseTheLockFile(file.file, nonce) }
    await new Promise((resolved) => setTimeout(resolved, THE_LOCK_STEP_MS))
  }
  return {
    refusal: `${file.file} is held by another switch on the owner's settings and could not be taken within ${THE_LOCK_WAIT_MS} ms, so no switch was made: the owner's default is not changed by Martha when it cannot be put back`,
  }
}

/** The lock file's path, or why the config directory cannot even be named: a folder that is not there has no real path. */
function theLockFileIn(lock_root: string, config_dir: string): { readonly file: string } | Refused {
  try {
    const real = fs.realpathSync(config_dir)
    return { file: join(lock_root, SWITCH_LOCK_PLACE, `${createHash('sha256').update(real).digest('hex')}.lock`) }
  } catch (error) {
    return { refusal: `${config_dir} could not be resolved (${told(error)}), so the lock that keeps one switch at a time could not be named and no switch was made` }
  }
}

/** Makes the locks' directory, mode 0700, or says why it could not: a lock in a directory anyone may write is no lock. */
function makeTheLockDirectory(directory: string): Refused | undefined {
  try {
    fs.mkdirSync(directory, { recursive: true, mode: LOCK_DIRECTORY_MODE })
    fs.chmodSync(directory, LOCK_DIRECTORY_MODE)
    return undefined
  } catch (error) {
    return { refusal: `${directory} could not be made (${told(error)}), so no switch was made` }
  }
}

/** Keeps a lock file holding this taker's nonce, pid and time, or answers false when someone else holds it. */
function keepTheLockFile(file: string, nonce: string): boolean {
  if (!breakALockNobodyHolds(file)) return false
  try {
    const handle = fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, LOCK_FILE_MODE)
    try {
      fs.writeFileSync(handle, lockHeldBy(nonce))
      fs.fsyncSync(handle)
    } finally {
      fs.closeSync(handle)
    }
    return true
  } catch {
    return false
  }
}

/** What a lock file says: the taker's nonce, its pid, and when it took it, one per line. */
const lockHeldBy = (nonce: string): string => `${nonce}\n${process.pid}\n${new Date().toISOString()}\n`

/** Removes a lock whose holder is not running, and answers whether the name is now free. */
function breakALockNobodyHolds(file: string): boolean {
  const held = readWhole(file)
  if (held === undefined) return true
  const holder = holderPidIn(held)
  if (holder !== undefined && isRunning(holder)) return false
  return removeOnlyIfUnchanged(file, held)
}

/** The pid a lock's text names, when it names one: a lock that was cut short names none and is nobody's. */
function holderPidIn(held: string): number | undefined {
  const pid = Number(held.split('\n')[1])
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

/** Whether a process is running: a signal 0 that is answered, or refused for lack of permission, means it is. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return codeOf(error) === 'EPERM'
  }
}

/** Removes the lock file, and only when it still holds the bytes that were read: never one another taker just made. */
function removeOnlyIfUnchanged(file: string, held: string): boolean {
  if (readWhole(file) !== held) return false
  try {
    fs.rmSync(file, { force: true })
    return true
  } catch {
    return false
  }
}

/** Gives the lock back: removed only while it still says this taker's nonce, so one retaken by another is not removed. */
function releaseTheLockFile(file: string, nonce: string): void {
  const held = readWhole(file)
  if (held === undefined || !held.startsWith(`${nonce}\n`)) return
  removeOnlyIfUnchanged(file, held)
}

/** The whole text of a file, or undefined when it cannot be read whole: a lock read in part names no holder. */
function readWhole(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** The bytes at a temporary name, fsynced and closed: `keepBytesAt`'s half of the write, without the rename. */
function keepBytesAt(temporary: string, bytes: Uint8Array, mode: number): void {
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW
  const handle = fs.openSync(temporary, flags, mode)
  try {
    fs.writeFileSync(handle, bytes)
    fs.fsyncSync(handle)
  } finally {
    fs.closeSync(handle)
  }
  fs.chmodSync(temporary, mode)
}

/** A temporary file nobody will rename, removed: a name left beside the owner's settings is nobody's business. */
function removeQuietly(temporary: string): void {
  try {
    fs.rmSync(temporary, { force: true })
  } catch {
    // The temporary name is this process's own; a disk that will not remove it fails the write that made it.
  }
}

/** An error's code, when it has one: the difference between a file that is not there and one that cannot be read. */
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code

/** What an error says, for a refusal the owner reads. */
const told = (error: unknown): string => (error instanceof Error ? error.message : String(error))
