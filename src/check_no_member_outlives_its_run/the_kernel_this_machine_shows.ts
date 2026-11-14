// What this machine's kernel says about a process, as the leftover-member scan reads it (martha#472): the processes of
// this user, their environments, their pid namespaces and the pid each has in its own, their identities, and the launch
// records a home's state root holds — each read here, vouched for here, and handed to the scan as one answer.

import { readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'
import { getuid } from 'node:process'

import { launchesIn } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { STATE_DIRECTORY_MODE, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities, PID_NAMESPACE_FORM } from '../linux_process_identity/process_identity_from_proc.ts'
import type { WhatTheScanReads } from './the_leftovers_a_run_left.ts'

/** Where the launcher keeps a launch's records under a state root. */
export const LAUNCH_RECORDS_PLACE = 'launches'

/** The reason a records directory this reader will not vouch for is said as. */
export const NOT_OURS = 'is not a directory of yours that only you may enter, so its launch records cannot be vouched for'

/** The reason a records directory holding a row that is not a launch is said as. */
export const NOT_A_LAUNCH = 'holds a record that is not a launch this reader can vouch for'

/** Every process of this user the kernel lists, as pids. */
export function everyProcessOfThisUser(proc_root: string): readonly number[] {
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

/** The last entry of the kernel's `NSpid` line: the pid a process has in its own namespace. */
export function ownPidOf(proc_root: string, pid: number): number | undefined {
  try {
    const line = /^NSpid:\s+(.+)$/m.exec(readFileSync(join(proc_root, String(pid), 'status'), 'utf8'))?.[1]
    const last = (line ?? '').trim().split(/\s+/).filter((one) => /^\d+$/.test(one)).at(-1)
    return last === undefined ? undefined : Number(last)
  } catch {
    return undefined
  }
}

/** The records a home's state root holds, or why this reader will not vouch for them. */
export function recordsUnder(home: string, xdg_state_home: string | undefined): { readonly launches: ReturnType<typeof launchesIn> } | { readonly cannot_tell: string } {
  const directory = join(xdg_state_home ?? join(home, '.local', 'state'), STATE_ROOT_NAME, LAUNCH_RECORDS_PLACE)
  let found
  try {
    found = statSync(directory)
  } catch {
    // No records place in this home is no record: a home that never held a launch says nothing about any member.
    return { launches: [] }
  }
  if (!found.isDirectory() || found.uid !== getuid?.() || (found.mode & 0o777) !== STATE_DIRECTORY_MODE) return { cannot_tell: NOT_OURS }
  const store = launchRecordsDirectory(directory)
  const rows = store.all()
  const launches = launchesIn(store)
  if (rows.length > 0 && launches.length === 0) return { cannot_tell: NOT_A_LAUNCH }
  return { launches }
}

/** What this machine's kernel says, as the scan reads it. */
export function theKernelThisMachineShows(proc_root: string, owners_home: string): WhatTheScanReads {
  return {
    pids: everyProcessOfThisUser(proc_root),
    environmentOf: (pid) => {
      const read = environmentReadIn(proc_root, pid)
      if ('env' in read) return read
      // A process that ended between being listed and being read holds no member, and neither does a zombie: a member
      // that has read its end is a member that stopped. Both are read as no environment at all and said nothing of.
      if (linuxProcessIdentities.identityOf(pid) === null || isAZombie(proc_root, pid)) return { env: {} }
      return read
    },
    namespaceOf: (pid) => {
      try {
        const named = readlinkSync(join(proc_root, String(pid), 'ns', 'pid')).trim()
        return PID_NAMESPACE_FORM.test(named) ? named : undefined
      } catch {
        return undefined
      }
    },
    ownPidOf: (pid) => ownPidOf(proc_root, pid),
    identityOf: (pid) => linuxProcessIdentities.identityOf(pid),
    recordsUnder,
    owners_home,
    readers_namespace: linuxProcessIdentities.pidNamespace(),
  }
}

/** Whether the kernel holds this pid for a process that has already ended: its state is Z. */
/** A process's environment, as the kernel gives it, or why this reader cannot have it. */
export function environmentReadIn(proc_root: string, pid: number): { readonly env: Record<string, string> } | { readonly cannot_tell: string } {
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

export function isAZombie(proc_root: string, pid: number): boolean {
  try {
    const stat = readFileSync(join(proc_root, String(pid), 'stat'), 'utf8')
    return /\)\s+Z\s/.test(stat)
  } catch {
    return false
  }
}

export const theOwnersHome = (): string => userInfo().homedir


