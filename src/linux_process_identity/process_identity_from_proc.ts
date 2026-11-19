// Which process holds a pid, as the Linux kernel says it: the host contract's
// `processes.identityOf` (#42). Host-neutral host glue: Linux facts, not a coding
// tool's, so every host adapter on Linux composes this one.
//
// The identity is when the process started, boot included.
//
// Field 22 of /proc/<pid>/stat is the process's start time in clock ticks since
// boot. A pid the kernel hands out again goes to a process with another start
// time, which is what lets a launch record die with its process. Ticks since
// boot repeat after a reboot, so the start time also names the boot, from
// /proc/sys/kernel/random/boot_id, which the kernel draws afresh at every boot.
// A record from another boot is dead; a boot that cannot be read is no boot,
// and nobody binds.
//
// The second field of the stat line is the command name in parentheses and may
// itself hold spaces or parentheses, so the fields are counted from the last
// closing parenthesis. Where there is no /proc (another kernel), every process
// reads as absent and the binder binds nobody.
//
// `lookupOf` is the same read for a caller that must act on the answer rather
// than only compare it (martha#124): binding nobody is safe on a read that
// failed, and removing a directory is not. So a lookup says which of three
// things it found -- the process a pid holds now, that this kernel no longer
// holds the pid, or that it could not say and why -- and only the second is
// ever proof that a process is gone.
//
// A pid means nothing outside the pid namespace it was read in: the same number
// names another process, or none, in a namespace beside this one. So the
// namespace is read here too (`readlink /proc/self/ns/pid`), and a caller that
// acts across processes compares it before it trusts any pid (martha#124).

import { readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

import type { Processes } from '../host_contract/host_contract.ts'

/** The part of the contract this file provides. */
export type ProcessIdentities = Pick<Processes, 'identityOf'>

/** A process a pid holds: its pid, and when it started, boot included. */
export interface ProcessIdentity {
  readonly pid: number
  readonly process_started_at: string
}

/**
 * What a lookup found: the process a pid holds now; that the kernel no longer
 * holds the pid; or that this kernel could not say, and why. A caller that
 * removes something must treat 'unknown' as alive, never as gone.
 */
export type ProcessLookup =
  | { readonly found: 'held'; readonly identity: ProcessIdentity }
  | { readonly found: 'gone' }
  | { readonly found: 'unknown'; readonly why: string }

/** The part of the contract this file provides, the lookup beside it, and the pid namespace it answers from. */
export type ProcessLookups = ProcessIdentities & {
  readonly lookupOf: (pid: number) => ProcessLookup
  readonly pidNamespace: NamespaceOfAProcess
}

/**
 * The pid namespace a process runs in, as `readlink /proc/self/ns/pid` gives it
 * (`pid:[4026531836]`), or undefined when this kernel will not say. Two
 * processes in different pid namespaces cannot name each other's pids at all,
 * so a pid is only evidence inside the namespace it was read in (martha#124).
 */
export type NamespaceOfAProcess = () => string | undefined

/** The start time's place among the fields that follow the command name (field 3 onwards). */
const START_TIME_AFTER_COMMAND = 22 - 3

/** Where the kernel says which boot this is, under its /proc. */
const BOOT_ID = join('sys', 'kernel', 'random', 'boot_id')

/** A boot id as the kernel writes it. */
const BOOT_ID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A pid namespace as `readlink /proc/self/ns/pid` writes it. */
export const PID_NAMESPACE_FORM = /^pid:\[\d+\]$/

/** Process identities under a /proc root; the live kernel's are `linuxProcessIdentities`. */
export function procProcessIdentities(proc_root: string): ProcessLookups {
  const lookupOf = (pid: number): ProcessLookup => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return { found: 'unknown', why: `${pid} is no pid` }

    const boot = bootOrWhy(proc_root)
    if ('why' in boot) return { found: 'unknown', why: boot.why }

    const stat_path = join(proc_root, String(pid), 'stat')
    const stat = textOrWhy(stat_path)
    if ('code' in stat) {
      // The kernel keeps no pid it has no directory for: that one is proof.
      // Any other failure -- EMFILE, EACCES, EPERM -- is this process failing
      // to read, not the process having ended (#124).
      return stat.code === 'ENOENT' ? { found: 'gone' } : { found: 'unknown', why: `${stat_path} could not be read (${stat.code})` }
    }

    const ticks = startTimeIn(stat.text)
    if (ticks === null) return { found: 'unknown', why: `${stat_path} is no stat line` }
    return { found: 'held', identity: { pid, process_started_at: `${boot.boot}/${ticks}` } }
  }

  return {
    identityOf: (pid) => {
      const lookup = lookupOf(pid)
      return lookup.found === 'held' ? lookup.identity.process_started_at : null
    },
    lookupOf,
    pidNamespace: () => namespaceIn(proc_root),
  }
}

/** The pid namespace this process is in, under `proc_root`; undefined when the kernel will not name it. */
function namespaceIn(proc_root: string): string | undefined {
  try {
    const named = readlinkSync(join(proc_root, 'self', 'ns', 'pid')).trim()
    return PID_NAMESPACE_FORM.test(named) ? named : undefined
  } catch {
    return undefined
  }
}

/**
 * Where this machine's kernel shows its processes: every reader of the live process tree takes it from here. The relay
 * (../claude_code_relay) is the one reader that holds its own copy of the word, because the host installs the relay as a
 * copy of its own folder and a hooks module imports only its own files (martha#437); the relay's tests read this
 * constant, so its copy cannot drift from this one unseen.
 */
export const PROC_ROOT = '/proc'

/** The live kernel's process identities. */
export const linuxProcessIdentities: ProcessLookups = procProcessIdentities(PROC_ROOT)

/** The start time in one /proc/<pid>/stat line, or null when the line is not one. */
export function startTimeIn(stat: string): string | null {
  const command_end = stat.lastIndexOf(')')
  if (command_end === -1) return null

  const start_time = stat.slice(command_end + 1).trim().split(/\s+/)[START_TIME_AFTER_COMMAND]
  return start_time !== undefined && /^\d+$/.test(start_time) ? start_time : null
}

function bootOrWhy(proc_root: string): { readonly boot: string } | { readonly why: string } {
  const path = join(proc_root, BOOT_ID)
  const read = textOrWhy(path)
  if ('code' in read) return { why: `${path} could not be read (${read.code})` }
  const boot = read.text.trim()
  return BOOT_ID_FORM.test(boot) ? { boot } : { why: `${path} holds no boot id` }
}

export function textOrWhy(path: string): { readonly text: string } | { readonly code: string } {
  try {
    return { text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { code: (error as NodeJS.ErrnoException).code ?? String(error) }
  }
}

/** The parent pid's place among the fields that follow the command name (field 3 onwards): field 4. */
const PARENT_AFTER_COMMAND = 4 - 3

/** The parent pid in one /proc/<pid>/stat line, or null when the line is not one. */
export function parentIn(stat: string): number | null {
  const command_end = stat.lastIndexOf(')')
  if (command_end === -1) return null
  const parent = stat.slice(command_end + 1).trim().split(/\s+/)[PARENT_AFTER_COMMAND]
  return parent !== undefined && /^\d+$/.test(parent) ? Number(parent) : null
}

/** One process on the way up from a process: its pid, and its identity as `identityOf` reads it, or null. */
export interface AProcessSeen {
  readonly pid: number
  readonly identity: string | null
}

/**
 * The processes above `pid` under a /proc root, its parent first and never `pid` itself (martha#619): read once, up to
 * the first process the kernel will not show, or to pid 1. What a process that daemonized out of its tree had above it
 * is gone from this walk, which is why it is a speed bump and not a wall.
 */
export function ancestorsUnder(proc_root: string, pid: number): readonly AProcessSeen[] {
  const identities = procProcessIdentities(proc_root)
  const seen: AProcessSeen[] = []
  const visited = new Set<number>([pid])
  let at = pid
  for (;;) {
    const stat = textOrWhy(join(proc_root, String(at), 'stat'))
    const parent = 'text' in stat ? parentIn(stat.text) : null
    if (parent === null || parent < 1 || visited.has(parent)) return seen
    visited.add(parent)
    seen.push({ pid: parent, identity: identities.identityOf(parent) })
    at = parent
  }
}

/** The session id's place among the fields that follow the command name (field 3 onwards): field 6. */
const SESSION_AFTER_COMMAND = 6 - 3
/** The session id in one /proc/<pid>/stat line, or null when the line is not one. */
export function sessionIn(stat: string): number | null {
  const command_end = stat.lastIndexOf(')')
  if (command_end === -1) return null
  const session = stat.slice(command_end + 1).trim().split(/\s+/)[SESSION_AFTER_COMMAND]
  return session !== undefined && /^\d+$/.test(session) ? Number(session) : null
}

/** The process-group id's place among the fields that follow the command name (field 3 onwards): field 5. */
const GROUP_AFTER_COMMAND = 5 - 3
/** The process-group id in one /proc/<pid>/stat line, or null when the line is not one (martha#802). */
export function groupIn(stat: string): number | null {
  const command_end = stat.lastIndexOf(')')
  if (command_end === -1) return null
  const group = stat.slice(command_end + 1).trim().split(/\s+/)[GROUP_AFTER_COMMAND]
  return group !== undefined && /^\d+$/.test(group) ? Number(group) : null
}

/** Where a process is typed in (martha#619): the terminal on its standard input, or null, and its session id, or null. */
export function whereItIsTypedUnder(proc_root: string, pid: number): { readonly tty: string | null; readonly session: number | null } {
  let tty: string | null = null
  try {
    tty = readlinkSync(join(proc_root, String(pid), 'fd', '0'))
  } catch {
    tty = null
  }
  const stat = textOrWhy(join(proc_root, String(pid), 'stat'))
  return { tty, session: 'text' in stat ? sessionIn(stat.text) : null }
}

/** A process that has ended and waits for its parent to read it: in its session still, but running nothing. */
const ENDED_STATE = 'Z'

/** The sessions of the children of `pid` under a /proc root, as they are now (martha#724); none once `pid` is gone. */
export function sessionsOfTheChildrenOf(proc_root: string, pid: number): readonly number[] {
  const children = textOrWhy(join(proc_root, String(pid), 'task', String(pid), 'children'))
  const sessions: number[] = []
  for (const child of 'text' in children ? children.text.trim().split(/\s+/).filter((word) => word !== '') : []) {
    const stat = textOrWhy(join(proc_root, child, 'stat'))
    const session = 'text' in stat ? sessionIn(stat.text) : null
    if (session !== null) sessions.push(session)
  }
  return sessions
}

/** Every process under a /proc root that is in one of `sessions` and has not ended (martha#724). */
export function processesInSessionsUnder(proc_root: string, sessions: readonly number[]): readonly number[] {
  const found: number[] = []
  for (const entry of readdirSync(proc_root)) {
    if (!/^\d+$/.test(entry)) continue
    const stat = textOrWhy(join(proc_root, entry, 'stat'))
    if (!('text' in stat)) continue
    const session = sessionIn(stat.text)
    const state = stat.text.slice(stat.text.lastIndexOf(')') + 1).trim().split(/\s+/)[0]
    if (session !== null && sessions.includes(session) && state !== ENDED_STATE) found.push(Number(entry))
  }
  return found
}
