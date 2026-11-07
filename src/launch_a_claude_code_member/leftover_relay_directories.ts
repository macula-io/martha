// Leftover launch directories in the relay root (martha#124).
//
// This exists so a launcher that dies without running any of its own cleanup --
// SIGKILL, a crash, a power loss -- leaves nothing in the relay root that a
// later launch or the owner must clear by hand. Since #117 a launch's directory
// holds `relay/`, a copy whose folders are 0500, so a plain `rm -rf <relay
// root>` is refused until its folders are opened up, and nothing opened them for
// a directory whose launcher never came back.
//
// What a sweep may take away. The relay root holds every launch of this user at
// once, and more than one launcher writes into it, so a directory's name proves
// nothing and is never the test. Each launch writes a record of the process that
// made its directory into that directory the moment it is made, and a sweep
// removes a directory only when that record names a process this kernel no
// longer holds: the pid is gone, or the kernel gave it to a process with another
// start time, or this is another boot (process_identity_from_proc.ts). A
// directory with no record a sweep can vouch for is left alone, never guessed
// at: better a leftover than another launch's live directory.
//
// The sweep is hygiene, not correctness: a new launch uses a fresh uuid, so
// nothing depends on a leftover going. What it must never do is take away a
// directory whose launcher is still running.
//
// Where there is no /proc (another kernel) no identity can be read, so no record
// is written, and a sweep leaves every directory alone: leftovers then stay what
// they were before this file, and the owner's `rm -rf` clears them.

import { closeSync, constants, type Stats, fstatSync, lstatSync, openSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process, { getuid } from 'node:process'

import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { removeTheTree } from './relay_copy.ts'

/** The record a launch leaves in its own directory: which process made it. */
export const LAUNCHER_RECORD_NAME = 'launcher.json'

/** Only the owner may read or write the record. */
export const LAUNCHER_RECORD_MODE = 0o600

const PERMISSION_BITS = 0o777

/** Which process holds a pid, as `boot/start-time`, or null when this kernel cannot say. */
export type ProcessIdentities = (pid: number) => string | null

/** What a launch's record says: the process that made its directory, and that process's identity. */
interface LauncherRecord {
  readonly pid: number
  readonly process_started_at: string
}

/**
 * Writes this process's record into `directory`, the launch directory it has just
 * made; or why the record could not be written. No record is written where this
 * kernel cannot name the process, and no sweep then touches the directory.
 */
export function recordTheLauncher(directory: string, pid: number = process.pid): string | undefined {
  const identity = linuxProcessIdentities.identityOf(pid)
  if (identity === null) return undefined
  const record: LauncherRecord = { pid, process_started_at: identity }
  const path = join(directory, LAUNCHER_RECORD_NAME)
  try {
    writeFileSync(path, JSON.stringify(record), { mode: LAUNCHER_RECORD_MODE, flag: 'wx' })
  } catch (error) {
    return `${path} could not be written (${codeOf(error)}), so a later launch could not tell this directory is a leftover`
  }
  return undefined
}

/**
 * Removes every launch directory in `relay_root` whose recorded launcher is
 * provably gone, through `removeTheTree`; returns the directories it removed.
 * A directory whose launcher runs now, or whose record says nothing it can
 * vouch for, stays.
 */
export function sweepLeftoverLaunchDirectories(
  relay_root: string,
  identityOf: ProcessIdentities = (pid) => linuxProcessIdentities.identityOf(pid),
): readonly string[] {
  const removed: string[] = []
  for (const name of namesIn(relay_root)) {
    const directory = join(relay_root, name)
    if (isNotADirectory(directory)) continue
    const record = launcherRecordIn(directory)
    if (record === undefined) continue
    if (identityOf(record.pid) === record.process_started_at) continue
    removeTheTree(directory)
    removed.push(directory)
  }
  return removed
}

/** lstat, so a link to a directory is not a directory here. */
function isNotADirectory(directory: string): boolean {
  return lstatOrUndefined(directory)?.isDirectory() !== true
}

/** The record in `directory`, when it is one this file wrote, for this user; otherwise undefined. */
function launcherRecordIn(directory: string): LauncherRecord | undefined {
  let fd: number
  try {
    fd = openSync(join(directory, LAUNCHER_RECORD_NAME), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch {
    return undefined
  }
  try {
    if (!isOwnRecord(fstatSync(fd))) return undefined
    return asRecord(JSON.parse(readFileSync(fd, 'utf8')))
  } catch {
    return undefined
  } finally {
    closeSync(fd)
  }
}

/** A regular file, owned by this user, with exactly the mode a launch writes its record with. */
function isOwnRecord(stat: Stats): boolean {
  return stat.isFile() && stat.uid === getuid?.() && (stat.mode & PERMISSION_BITS) === LAUNCHER_RECORD_MODE
}

function asRecord(parsed: unknown): LauncherRecord | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { pid, process_started_at } = parsed as Partial<LauncherRecord>
  const aPid = Number.isSafeInteger(pid) && (pid ?? 0) > 0
  return aPid && typeof process_started_at === 'string' ? { pid: pid as number, process_started_at } : undefined
}

function namesIn(relay_root: string): readonly string[] {
  try {
    return readdirSync(relay_root)
  } catch {
    return []
  }
}

function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

function codeOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? String(error)
}
