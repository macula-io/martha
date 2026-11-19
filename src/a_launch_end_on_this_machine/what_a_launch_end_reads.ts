// What a launch end reads of this machine, and the machine the ending slice decides from (#693).
//
// A host adapter, not glue and not a slice: it reads /proc and the clock, which a slice may not, and it composes the
// slices that decide — ../end_a_launch asks for the machine here, and ../tell_a_member_what_its_relaunch_killed decides
// what an end's findings mean. One adapter per concern keeps each host directory under its ceiling (martha#322), which
// is why the group and boot readers live here rather than in ../linux_process_identity.
//
// The group is read before the kill and never after: a killed process has nothing left to read, and the host's
// background children are still alive when its own exit fires.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { constants } from 'node:os'
import process from 'node:process'

import type { CrewStore, FileTree, Processes } from '../host_contract/host_contract.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { killGroup } from '../end_a_launch_when_its_run_ends/the_run_lifeline.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { PROC_ROOT, startTimeIn, textOrWhy } from '../linux_process_identity/process_identity_from_proc.ts'
import type { LaunchMade } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import type { TheMachineAtAnEnd } from '../tell_a_member_what_its_relaunch_killed/the_end_on_this_machine.ts'
import { keepWhatTheEndLeft, ticksPerSecondOnTheMachine } from '../tell_a_member_what_its_relaunch_killed/the_end_on_this_machine.ts'

/** The group id's place among the fields that follow the command name (field 3 onwards): field 5. */
const GROUP_AFTER_COMMAND = 5 - 3

/** The group id in one /proc/<pid>/stat line, or null when the line is not one. */
export function groupIn(stat: string): number | null {
  const command_end = stat.lastIndexOf(')')
  if (command_end === -1) return null

  const group = stat.slice(command_end + 1).trim().split(/\s+/)[GROUP_AFTER_COMMAND]
  return group !== undefined && /^\d+$/.test(group) ? Number(group) : null
}

/** One command a process group held when it was read: its pid, the line the machine held, and its start in ticks. */
export interface ACommandInAGroup {
  readonly pid: number
  readonly command_line: string
  readonly start_ticks: string
}

/** What a group held at the moment it was read, or why this kernel could not say. */
export type AGroupReading = { readonly commands: readonly ACommandInAGroup[] } | { readonly unreadable: string }

/** The command `pid` holds, when it is in `group` and holds one: a kernel thread or a zombie holds no command line. */
function theCommandOf(proc_root: string, group: number, pid: number): readonly ACommandInAGroup[] {
  const stat = textOrWhy(join(proc_root, String(pid), 'stat'))
  if (!('text' in stat) || groupIn(stat.text) !== group) return []
  const ticks = startTimeIn(stat.text)
  const line = textOrWhy(join(proc_root, String(pid), 'cmdline'))
  if (ticks === null || !('text' in line)) return []
  const command_line = line.text.split('\u0000').filter((word) => word !== '').join(' ')
  return command_line === '' ? [] : [{ pid, command_line, start_ticks: ticks }]
}

/**
 * The commands a process group held, as Linux says it (#693): every process whose group is `group`, with the command
 * line the machine held for it. A kill about to be sent to the group can be told what it ends.
 */
export function processesInGroupUnder(proc_root: string, group: number): AGroupReading {
  let names: readonly string[]
  try {
    names = readdirSync(proc_root)
  } catch (error) {
    return { unreadable: `${proc_root} could not be listed (${(error as NodeJS.ErrnoException).code ?? String(error)})` }
  }
  const commands = names.filter((name) => /^\d+$/.test(name)).flatMap((name) => theCommandOf(proc_root, group, Number(name)))
  return { commands }
}

/** The boot's own moment on the machine's clock, from the `btime` line of /proc/stat, or null when it cannot be read. */
export function bootTimeMsUnder(proc_root: string): number | null {
  const stat = textOrWhy(join(proc_root, 'stat'))
  if (!('text' in stat)) return null
  const line = stat.text.split('\n').find((one) => one.startsWith('btime '))
  const seconds = line?.slice('btime '.length).trim()
  return seconds !== undefined && /^\d+$/.test(seconds) ? Number(seconds) * 1000 : null
}

/**
 * A start given in ticks since the boot as a moment on the machine's clock: the boot's own moment plus the ticks at
 * `ticks_per_second`, which the machine answers for itself (`getconf CLK_TCK`) rather than any file guessing it.
 */
export const startedAtMs = (start_ticks: string, boot_time_ms: number, ticks_per_second: number): number =>
  boot_time_ms + Math.round((Number(start_ticks) * 1000) / ticks_per_second)

/** The words a process on this machine was started with, from the kernel's own cmdline; none when it holds none. */
function theWordsAt(pid: number): readonly string[] {
  const words = textOrWhy(join(PROC_ROOT, String(pid), 'cmdline'))
  return 'text' in words ? words.text.split('\u0000').filter((word) => word !== '') : []
}

/** When a path was last written, as this machine's own stat says, or null when it will not say. */
function theWriteTime(path: string): number | null {
  try {
    return statSync(path).mtimeMs
  } catch {
    return null
  }
}

/** What the launcher has to hand an end: the machine's processes and files, as the host contract shapes them. */
export interface ThisMachinesHost {
  readonly processes: Processes
  readonly stores: { readonly files: FileTree }
}

/**
 * This machine, as an end reads it (#693): the group the kernel holds now, each process's own words, and when in the
 * boot a start happened. Built once, at the end, and read synchronously before the group is killed.
 */
export function theMachineAtAnEnd(host: ThisMachinesHost, where: string): TheMachineAtAnEnd {
  const boot_ms = bootTimeMsUnder(PROC_ROOT)
  const ticks = ticksPerSecondOnTheMachine(host, where)
  return {
    processes: host.processes,
    files: host.stores.files,
    modifiedAt: theWriteTime,
    wordsOf: theWordsAt,
    commandsIn: (group) => processesInGroupUnder(PROC_ROOT, group),
    theStartMs: (start_ticks) => (boot_ms === null || ticks === null ? null : startedAtMs(start_ticks, boot_ms, ticks)),
  }
}

/** The launch, as the two things an end keeps need from it: who it is, where it starts, and what it may keep it in. */
export interface WhatAnEndKeepsOfALaunch {
  readonly member_name: string
  readonly place: { readonly launch_dir: string }
  readonly places: { readonly mesh_servers: string }
  readonly leftovers?: { readonly crew: CrewStore; readonly workspace: TheWorkspace | undefined }
}

/**
 * What this launch left, kept in the crew's own place (#693); nothing when the launch was given no crew to keep it in.
 * Called before the group is killed. It never throws: an end that could not read or keep the record still ends the
 * launch, and a record already kept then stands for the refusals.
 */
export function keepWhatTheRunLeft(launch: WhatAnEndKeepsOfALaunch, group: number): void {
  const leftovers = launch.leftovers
  if (leftovers === undefined) return
  keepWhatTheEndLeft({
    member: launch.member_name,
    at_ms: Date.now(),
    group,
    crew: leftovers.crew,
    workspace: leftovers.workspace,
    checkout: launch.place.launch_dir,
    mesh_servers: launch.places.mesh_servers,
    machine: theMachineAtAnEnd(thisMachine, launch.place.launch_dir),
  })
}

/**
 * The signals that end the launcher without its 'exit' event, and so clean up on their own.
 *
 * SIGHUP is the one a run delivers (martha#472): a probe, a recorded-host test or a by-hand check that starts a member
 * hands it a throwaway home, and when that run ends its terminal hangs up, so the kernel sends SIGHUP to the session
 * the launcher and its member run in. Unhandled, the launcher died of the hangup and the member, whose own host does
 * not die of it, kept running under the throwaway home for days. SIGQUIT is the key beside it (Ctrl-\), which would
 * otherwise leave the same member behind.
 */
const LAUNCHER_END_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT']

/**
 * The end signals whose default action dumps core, so the launcher exits with the status a shell reports for a death by
 * the signal rather than raising it again (martha#845). A core holds the launcher's whole memory, and where the host
 * pipes cores to a handler, as systemd-coredump does, the handler records the process's whole environment in the
 * journal even with the core limit at 0. An exit never enters the kernel's core path, so neither is written, and the
 * owner's shell still sees the status it would have. A signal added to the end signals that dumps core belongs here.
 */
const LAUNCHER_END_SIGNALS_THAT_DUMP_CORE: readonly NodeJS.Signals[] = ['SIGQUIT']

/** What a shell adds to a signal's number to report a death by it as an exit status. */
const SHELL_STATUS_OF_A_SIGNAL = 128

/**
 * Kills the member's group and removes both directories if the launcher exits
 * first, or is ended by SIGTERM or SIGINT; returns what takes those handlers off.
 */
export function cleanUpIfTheLauncherEnds(pid: number, made: LaunchMade): () => void {
  const onLauncherExit = (): void => {
    killGroup(pid)
    made.relayDirectory.remove()
    // Before the snapshot goes, what the member's host wrote of its session is kept (martha#646): this handler runs in
    // `exit`, so the keep is synchronous and bounded, and a failure in it never stops the two removals below.
    made.keepTranscripts()
    made.removeSnapshot()
  }
  process.once('exit', onLauncherExit)
  // SIGTERM and SIGINT end the process without 'exit', so each cleans up too.
  // The signal is raised again once this launcher's handlers are off, unless
  // some other part of the process still listens for it, so it still ends the
  // launcher the way it would have. A signal that dumps core is not raised
  // again: the launcher exits with the status a shell gives a death by it.
  const onLauncherSignal = (signal: NodeJS.Signals): void => {
    offLauncherEnd()
    onLauncherExit()
    // A `once` listener registered before this one has already been removed
    // when this runs, so it counts as 0 here: the signal is raised again before
    // that listener's own asynchronous shutdown can finish. A part of the
    // process that needs one must keep listening with `on`.
    if (process.listenerCount(signal) !== 0) return
    if (LAUNCHER_END_SIGNALS_THAT_DUMP_CORE.includes(signal)) process.exit(SHELL_STATUS_OF_A_SIGNAL + constants.signals[signal])
    else process.kill(process.pid, signal)
  }
  const offLauncherEnd = (): void => {
    process.off('exit', onLauncherExit)
    for (const signal of LAUNCHER_END_SIGNALS) process.off(signal, onLauncherSignal)
  }
  for (const signal of LAUNCHER_END_SIGNALS) process.once(signal, onLauncherSignal)
  return offLauncherEnd
}
