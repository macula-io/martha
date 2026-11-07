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

import { readFileSync, readlinkSync } from 'node:fs'
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

/** The live kernel's process identities. */
export const linuxProcessIdentities: ProcessLookups = procProcessIdentities('/proc')

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

function textOrWhy(path: string): { readonly text: string } | { readonly code: string } {
  try {
    return { text: readFileSync(path, 'utf8') }
  } catch (error) {
    return { code: (error as NodeJS.ErrnoException).code ?? String(error) }
  }
}
