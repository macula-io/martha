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
// nothing and is never the test. Each launch writes a record of the processes
// that hold its directory -- the launcher the moment the directory is made, and
// the member once it has started -- and a sweep removes a directory only when
// every process the record names is provably gone. A member can outlive its
// launcher (the launcher is SIGKILLed, the member's own group is not in reach),
// and its host still loads the relay from that directory, so the member's death
// is part of the proof.
//
// Proof, never the absence of an answer. A lookup can fail to read the kernel --
// EMFILE, EACCES, a boot id this kernel will not give -- and none of those is a
// dead process. So the lookup says which of three things it found, and a
// directory goes only on one of two readings: the kernel holds no such pid
// (ENOENT), or it holds that pid for another process, another start time or
// another boot (process_identity_from_proc.ts `lookupOf`). An answer of
// 'unknown' leaves the directory where it is, as does a record a sweep cannot
// vouch for: a directory with no record, or one that is not the file a launch
// wrote with the mode it writes, is left alone, never guessed at. Better a
// leftover than another launch's live directory.
//
// The namespace. A pid means nothing outside the pid namespace it was read in.
// A desktop container commonly shares this user's runtime dir -- a Wayland or
// PipeWire bind mount is enough -- and then both sides write into one relay
// root while neither can name the other's pids: a live container launch reads
// as gone here, and this namespace's live launch reads as gone there. So the
// record carries the writer's pid namespace (`readlink /proc/self/ns/pid`), and
// a sweep acts only on a record whose namespace is its own. A record from
// another namespace, one that names none, and a sweep that cannot say which
// namespace it is itself, all leave the directory where it is.
//
// The window between a member starting and its place in the record being
// written. On the owner's terminal the member is held until its launcher says
// yes, and that hold now writes the member too, so a launcher killed at any
// point after the member exists leaves a record that names it
// (launch_a_claude_code_member.ts). Detached, there is no hold: the record is
// written a few instructions after the spawn, and a launcher killed inside them
// leaves a directory nothing has recorded as held. That path closing needs a
// lock, not a faster sequence.
//
// The sweep is hygiene, not correctness: a new launch uses a fresh uuid, so
// nothing depends on a leftover going. What it must never do is take away a
// directory whose launcher or member is still running.
//
// Where there is no /proc (another kernel) no identity can be read, so no record
// is written, and a sweep leaves every directory alone: leftovers then stay what
// they were before this file, and the owner's `rm -rf` clears them.

import { chmodSync, closeSync, constants, type Stats, fstatSync, lstatSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process, { getuid } from 'node:process'

import {
  linuxProcessIdentities,
  PID_NAMESPACE_FORM,
  type ProcessIdentity,
  type ProcessLookup,
} from '../linux_process_identity/process_identity_from_proc.ts'
import { removeTheTree } from './relay_copy.ts'

/** The record a launch leaves in its own directory: which processes hold it. */
export const LAUNCHER_RECORD_NAME = 'launcher.json'

/** Only the owner may read or write the record. */
export const LAUNCHER_RECORD_MODE = 0o600

/** The record being written again, beside it, before it takes its place. */
const RECORD_BEING_WRITTEN = `${LAUNCHER_RECORD_NAME}.new`

const PERMISSION_BITS = 0o777

/** What a launch's record says: the processes that held its directory. */
export interface LaunchRecord {
  /** The process that made the directory. */
  readonly launcher: ProcessIdentity
  /** The member the launcher started in it, once it has started. */
  readonly member?: ProcessIdentity
  /**
   * The pid namespace the launch ran in, `pid:[4026531836]`. The pids above mean
   * nothing outside it, so a sweep acts only on a record from its own.
   */
  readonly namespace: string
}

/** How a caller reads the kernel: the lookup, never the bare identity (see 'unknown' above). */
export type LookupsOfProcesses = (pid: number) => ProcessLookup

/** How a caller reads its own pid namespace (see 'the namespace' above). */
export type NamespaceOfThisProcess = () => string | undefined

/**
 * Writes `pid`'s record into `directory`, the launch directory it has just made;
 * or why the record could not be written. No record is written where this
 * kernel cannot name the process, and no sweep then touches the directory.
 */
export function recordTheLauncher(directory: string, pid: number = process.pid): string | undefined {
  const launcher = identityOfRunning(pid)
  const namespace = linuxProcessIdentities.pidNamespace()
  // A process this kernel cannot name, or a launch that cannot say which pid
  // namespace it is in, leaves no record -- and no sweep then acts on it.
  if (launcher === undefined || namespace === undefined) return undefined
  const path = join(directory, LAUNCHER_RECORD_NAME)
  try {
    writeFileSync(path, JSON.stringify({ launcher, namespace }), { mode: LAUNCHER_RECORD_MODE, flag: 'wx' })
    // The mode a write asks for is cut down by the umask; the record is read
    // only when it carries the exact one, so make it exact here.
    chmodSync(path, LAUNCHER_RECORD_MODE)
  } catch (error) {
    return `${path} could not be written (${codeOf(error)}), so a later launch could not tell this directory is a leftover`
  }
  return undefined
}

/**
 * Adds the member the launcher has started to the record in `directory`, so a
 * sweep keeps the directory while either process lives; or why it could not be
 * added. A member that has already ended adds nothing: the directory is then
 * the launcher's to clear, and a sweep waits for the same proof it always did.
 */
export function recordTheMember(directory: string, pid: number): string | undefined {
  const lookup = linuxProcessIdentities.lookupOf(pid)
  if (lookup.found === 'gone') return undefined
  if (lookup.found === 'unknown') {
    return `${pid} could not be named by this kernel (${lookup.why}), so a later launch could not tell its directory is still held`
  }
  const record = launcherRecordIn(directory)
  if (record === undefined) {
    return `${join(directory, LAUNCHER_RECORD_NAME)} could not be read back, so the member could not be added to it`
  }
  return writeTheRecordAgain(directory, { ...record, member: lookup.identity })
}

/**
 * Removes every launch directory in `relay_root` whose recorded processes are
 * all provably gone, through `removeTheTree`; returns the directories it
 * removed. A directory any of them still holds, or holds in doubt, stays.
 */
export function sweepLeftoverLaunchDirectories(
  relay_root: string,
  lookupOf: LookupsOfProcesses = linuxProcessIdentities.lookupOf,
  namespaceOf: NamespaceOfThisProcess = linuxProcessIdentities.pidNamespace,
): readonly string[] {
  const here = namespaceOf()
  // A process that cannot say which pid namespace it is in can prove nothing
  // about another one, and the pids in every record are read from this one.
  if (here === undefined) return []
  const removed: string[] = []
  for (const name of namesIn(relay_root)) {
    const directory = join(relay_root, name)
    if (isNotADirectory(directory)) continue
    const record = launcherRecordIn(directory)
    if (record === undefined) continue
    // The record's pids are read from its own namespace, not this one: a
    // container sharing this runtime dir would read as gone here.
    if (record.namespace !== here) continue
    if (!everyRecordedProcessIsGone(record, lookupOf)) continue
    removeTheTree(directory)
    removed.push(directory)
  }
  return removed
}

/** True only when each process the record names is one this kernel is sure it does not hold. */
function everyRecordedProcessIsGone(record: LaunchRecord, lookupOf: LookupsOfProcesses): boolean {
  return recordedProcessesIn(record).every((process_named) => isProvablyGone(lookupOf(process_named.pid), process_named))
}

function recordedProcessesIn(record: LaunchRecord): readonly ProcessIdentity[] {
  return record.member === undefined ? [record.launcher] : [record.launcher, record.member]
}

function isProvablyGone(lookup: ProcessLookup, recorded: ProcessIdentity): boolean {
  if (lookup.found === 'gone') return true
  // The pid is held still, but by another process: another start time, or
  // another boot, which the identity names as well.
  return lookup.found === 'held' && lookup.identity.process_started_at !== recorded.process_started_at
}

/** The identity of a process running now, or undefined when this kernel cannot name it. */
function identityOfRunning(pid: number): ProcessIdentity | undefined {
  const lookup = linuxProcessIdentities.lookupOf(pid)
  return lookup.found === 'held' ? lookup.identity : undefined
}

/**
 * Writes the record again with `record`, by a file beside it renamed into place,
 * so a sweep reads either the old record whole or the new one whole.
 */
function writeTheRecordAgain(directory: string, record: LaunchRecord): string | undefined {
  const path = join(directory, LAUNCHER_RECORD_NAME)
  const beside = join(directory, RECORD_BEING_WRITTEN)
  try {
    writeFileSync(beside, JSON.stringify(record), { mode: LAUNCHER_RECORD_MODE, flag: 'wx' })
    chmodSync(beside, LAUNCHER_RECORD_MODE)
    renameSync(beside, path)
  } catch (error) {
    rmSync(beside, { force: true })
    return `${path} could not be written (${codeOf(error)}), so a later launch could not tell this directory is still held`
  }
  return undefined
}

/** lstat, so a link to a directory is not a directory here. */
function isNotADirectory(directory: string): boolean {
  return lstatOrUndefined(directory)?.isDirectory() !== true
}

/** The record in `directory`, when it is one this file wrote, for this user; otherwise undefined. */
function launcherRecordIn(directory: string): LaunchRecord | undefined {
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

function asRecord(parsed: unknown): LaunchRecord | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const { launcher, member, namespace } = parsed as Partial<LaunchRecord>
  const the_launcher = asIdentity(launcher)
  // A record from before a launch wrote its namespace -- or one whose namespace
  // is not a namespace -- is not one a sweep can vouch for: it stays.
  if (the_launcher === undefined || typeof namespace !== 'string' || !PID_NAMESPACE_FORM.test(namespace)) return undefined
  if (member === undefined) return { launcher: the_launcher, namespace }
  const the_member = asIdentity(member)
  return the_member === undefined ? undefined : { launcher: the_launcher, member: the_member, namespace }
}

function asIdentity(named: unknown): ProcessIdentity | undefined {
  if (typeof named !== 'object' || named === null) return undefined
  const { pid, process_started_at } = named as Partial<ProcessIdentity>
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
