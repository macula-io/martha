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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Processes } from '../host_contract/host_contract.ts'

/** The part of the contract this file provides. */
export type ProcessIdentities = Pick<Processes, 'identityOf'>

/** The start time's place among the fields that follow the command name (field 3 onwards). */
const START_TIME_AFTER_COMMAND = 22 - 3

/** Where the kernel says which boot this is, under its /proc. */
const BOOT_ID = join('sys', 'kernel', 'random', 'boot_id')

/** A boot id as the kernel writes it. */
const BOOT_ID_FORM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Process identities under a /proc root; the live kernel's are `linuxProcessIdentities`. */
export function procProcessIdentities(proc_root: string): ProcessIdentities {
  return {
    identityOf(pid) {
      if (!Number.isSafeInteger(pid) || pid <= 0) return null

      const boot = bootOf(proc_root)
      const stat = textOf(join(proc_root, String(pid), 'stat'))
      if (boot === null || stat === undefined) return null

      const ticks = startTimeIn(stat)
      return ticks === null ? null : `${boot}/${ticks}`
    },
  }
}

/** The live kernel's process identities. */
export const linuxProcessIdentities: ProcessIdentities = procProcessIdentities('/proc')

/** The start time in one /proc/<pid>/stat line, or null when the line is not one. */
export function startTimeIn(stat: string): string | null {
  const command_end = stat.lastIndexOf(')')
  if (command_end === -1) return null

  const start_time = stat.slice(command_end + 1).trim().split(/\s+/)[START_TIME_AFTER_COMMAND]
  return start_time !== undefined && /^\d+$/.test(start_time) ? start_time : null
}

function bootOf(proc_root: string): string | null {
  const boot = textOf(join(proc_root, BOOT_ID))?.trim()
  return boot !== undefined && BOOT_ID_FORM.test(boot) ? boot : null
}

function textOf(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
