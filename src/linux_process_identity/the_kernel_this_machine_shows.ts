// What this machine's kernel says about a process, as a reader of the leftovers a run leaves reads it (martha#472):
// the processes of this user, what environment each was given, the pid namespace each runs in and the pid it has
// there, and the identity a launch record compares. Each is read here, and handed on as one answer.
//
// Nothing here judges what it read: which of these readings names a member, and what to say about one that cannot be
// read, is find_a_member_a_run_left_behind's to decide. This is the machine's side of that question, on Linux.

import { readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { getuid } from 'node:process'

import { filesOnThisMachine } from './files_and_processes_on_this_machine.ts'
import { launchRecordsUnder, type TheStatesConventions } from './launch_records_under_a_state_root.ts'
import { PID_NAMESPACE_FORM, procProcessIdentities } from './process_identity_from_proc.ts'

/** Every process of this user the kernel lists, as pids. */
function everyProcessOfThisUser(proc_root: string): readonly number[] {
  const mine = getuid?.()
  return readdirSync(proc_root)
    .filter((entry) => /^\d+$/.test(entry))
    .filter((entry) => {
      try {
        return statSync(join(proc_root, entry)).uid === mine
      } catch {
        return false
      }
    })
    .map(Number)
}

/** A process's environment, as the kernel gives it, or why this reader cannot have it. */
function environmentReadIn(proc_root: string, pid: number): { readonly env: Record<string, string> } | { readonly cannot_tell: string } {
  try {
    const raw = readFileSync(join(proc_root, String(pid), 'environ'), 'utf8')
    const pairs = raw.split('\0').flatMap((entry) => {
      const at = entry.indexOf('=')
      return at > 0 ? [[entry.slice(0, at), entry.slice(at + 1)] as const] : []
    })
    return { env: Object.fromEntries(pairs) }
  } catch (error) {
    return { cannot_tell: (error as NodeJS.ErrnoException).code ?? 'no answer' }
  }
}

/** The pid namespace a process runs in, as `readlink /proc/<pid>/ns/pid` gives it, or undefined when it will not say. */
function namespaceOf(proc_root: string, pid: number): string | undefined {
  try {
    const named = readlinkSync(join(proc_root, String(pid), 'ns', 'pid')).trim()
    return PID_NAMESPACE_FORM.test(named) ? named : undefined
  } catch {
    return undefined
  }
}

/** The last entry of the kernel's `NSpid` line: the pid a process has in its own namespace. */
function ownPidOf(proc_root: string, pid: number): number | undefined {
  try {
    const line = /^NSpid:\s+(.+)$/m.exec(readFileSync(join(proc_root, String(pid), 'status'), 'utf8'))?.[1]
    const last = (line ?? '').trim().split(/\s+/).filter((one) => /^\d+$/.test(one)).at(-1)
    return last === undefined ? undefined : Number(last)
  } catch {
    return undefined
  }
}

/** Whether the kernel holds this pid for a process that has already ended: its state is Z. */
function isAZombie(proc_root: string, pid: number): boolean {
  try {
    const stat = readFileSync(join(proc_root, String(pid), 'stat'), 'utf8')
    return /\)\s+Z\s/.test(stat)
  } catch {
    return false
  }
}

/** The owner's home, from the password database: the one home that is never a run's. */
export const theOwnersHome = (): string => userInfo().homedir

/**
 * What the kernel under `proc_root` says about every process of this user, as one reader. Every answer comes from that
 * one tree — the processes, their start times and their namespaces — so a reader handed another tree reads that tree
 * and not half of this machine's.
 */
export function theProcessesOfThisMachineShow(proc_root: string) {
  const identities = procProcessIdentities(proc_root)
  return {
    pids: everyProcessOfThisUser(proc_root),
    environmentOf: (pid: number) => {
      const read = environmentReadIn(proc_root, pid)
      if ('env' in read) return read
      // A process that ended between being listed and being read holds no member, and neither does a zombie: a member
      // that has read its end is a member that stopped. Both are read as no environment at all and said nothing of.
      if (identities.identityOf(pid) === null || isAZombie(proc_root, pid)) return { env: {} }
      return read
    },
    namespaceOf: (pid: number) => namespaceOf(proc_root, pid),
    ownPidOf: (pid: number) => ownPidOf(proc_root, pid),
    identityOf: (pid: number) => identities.identityOf(pid),
    readers_namespace: identities.pidNamespace(),
  }
}

/**
 * Everything a reader of the leftovers a run leaves needs from this machine, as one set of readings: the kernel's
 * answer about every process of this user, and the records a home's state root holds, under the crew's conventions
 * `the_state` names. What a reading means, and where a home's state root is, is find_a_member_a_run_left_behind's and
 * the state's to decide: this answers only about the machine.
 */
export function theReadingsThisMachineGives(proc_root: string, the_state: TheStatesConventions) {
  return {
    ...theProcessesOfThisMachineShow(proc_root),
    recordsUnder: launchRecordsUnder(the_state),
    owners_home: theOwnersHome(),
    realPathOf: filesOnThisMachine.realPathOf,
  }
}
