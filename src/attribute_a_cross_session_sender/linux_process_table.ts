// When a process started, as the Linux kernel says it.
//
// Field 22 of /proc/<pid>/stat is the process's start time in clock ticks since
// boot. A pid the kernel hands out again goes to a process with another start
// time, which is what lets a launch record die with its process.
//
// The second field is the command name in parentheses and may itself hold spaces
// or parentheses, so the fields are counted from the last closing parenthesis.
// Where there is no /proc (another kernel), every process reads as absent and the
// binder binds nobody.

import { readFileSync } from 'node:fs'

import type { ProcessTable } from './attribute_a_cross_session_sender.ts'

/** The start time's place among the fields that follow the command name (field 3 onwards). */
const START_TIME_AFTER_COMMAND = 22 - 3

export const linuxProcessTable: ProcessTable = {
  startTimeOf(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null

    const stat = statOf(pid)
    if (stat === undefined) return null

    return startTimeIn(stat)
  },
}

/** The start time in one /proc/<pid>/stat line, or null when the line is not one. */
export function startTimeIn(stat: string): string | null {
  const command_end = stat.lastIndexOf(')')
  if (command_end === -1) return null

  const start_time = stat.slice(command_end + 1).trim().split(/\s+/)[START_TIME_AFTER_COMMAND]
  return start_time !== undefined && /^\d+$/.test(start_time) ? start_time : null
}

function statOf(pid: number): string | undefined {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8')
  } catch {
    return undefined
  }
}
