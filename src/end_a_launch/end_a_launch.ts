// How a member's launch starts and ends: the process group it runs in, the hold that records it before it may run,
// the arguments and environment the host is spawned with, and the cleanup that leaves nothing behind
// (#41, #94, #104, #124).
//
// The member runs in a process group of its own, so one SIGKILL reaches the host and its tool servers. On the owner's
// terminal it is that terminal's foreground job, held until it is recorded, and runs only then; detached, it is
// recorded on its spawn, before this process can reap it. When it exits, by itself or killed, its launch record is
// dropped, the server closed and both directories removed. If the launcher itself exits first, or is ended by SIGTERM
// or SIGINT, its handlers do the same on the way out.
//
// `NOT_STARTED` is the start of every refusal a launch gives, and it is here because the slices that refuse a member
// (the launcher, and the one that asks the host what it loads) both import this one, so none of them imports another
// back: a pure move keeps the import graph one way.

import { type ChildProcess, spawn } from 'node:child_process'
import process from 'node:process'

import { type LaunchRecorded, recordMemberLaunch, recordMemberStopped } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { switchesThatRunNothingFromACheckout } from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import { CLAUDE_SERVERS, launchEnvironment } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { isOnTheOwnersTerminal, startForegroundJob, type ForegroundJob } from '../start_the_member_on_the_owners_terminal/member_on_the_owners_terminal.ts'
import { recordTheMember } from '../sweep_leftover_launch_directories/leftover_relay_directories.ts'
import { meshServersPlaced } from '../place_the_hosts_settings/the_hosts_settings.ts'
import type { ClaudeCodeMemberLaunch, LaunchMade, MemberStopped } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'

/** The start of every refusal: the member was not started. */
export const NOT_STARTED = 'The member is not started'

/** The signals that end the launcher without its 'exit' event, and so clean up on their own. */
const LAUNCHER_END_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT']

/** Sends SIGKILL to a whole process group; a group already gone is no error. */
export function killGroup(group: number): void {
  try {
    process.kill(-group, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/**
 * How a spawned member's start ended: the pid the launcher kills the group of,
 * or why there is none. On the owner's terminal the job-control shell says it
 * (member_on_the_owners_terminal.ts); detached, the member is the spawned child.
 */
async function memberStartOf(
  command: string,
  spawned: Error | undefined,
  job: ForegroundJob<RecordedWhileHeld> | undefined,
  childPid: number | undefined,
  record: (pid: number) => LaunchRecorded,
): Promise<RecordedStart> {
  if (spawned !== undefined) return { refusal: `${command} could not be started (${spawned.message}).` }
  if (job !== undefined) {
    const held = await job.member
    if ('refusal' in held) return held
    const { recorded, inTheLaunchRecord } = held.admission
    return { pid: held.pid, recorded, inTheLaunchRecord }
  }
  // Read on the spawn, with no turn of the event loop since, so this process
  // has not reaped the child yet and the kernel still answers for its pid.
  return childPid === undefined
    ? { refusal: `${command} could not be started (no pid).` }
    : { pid: childPid, recorded: record(childPid), inTheLaunchRecord: false }
}

/** A member held on the owner's terminal, recorded before it may run: it runs only when the record holds. */
interface RecordedWhileHeld {
  readonly admitted: boolean
  readonly recorded: LaunchRecorded
  /** Whether the launch directory's own record already names the member, put there inside this hold. */
  readonly inTheLaunchRecord: boolean
}

/**
 * The member's place in its launch directory's record, written while the hold
 * still holds it (#124). A launcher killed at any point after the member exists
 * then leaves a record that names it, and a sweep cannot take away a running
 * member's directory. The member is admitted only when this says it is recorded,
 * so a write that fails refuses the member instead of leaving its directory
 * unrecorded; a launch record that could not be kept refuses it just the same.
 */
export function recordedInsideTheHold(directory: string, pid: number, recorded: LaunchRecorded): RecordedWhileHeld {
  if (!recorded.recorded) return { admitted: false, recorded, inTheLaunchRecord: false }
  const whyNotRecorded = recordTheMember(directory, pid)
  return whyNotRecorded === undefined
    ? { admitted: true, recorded, inTheLaunchRecord: true }
    : { admitted: false, recorded: { recorded: false, refusal: whyNotRecorded }, inTheLaunchRecord: false }
}

/** How a member's start ends: its pid, which is also its group's id, and its launch record; or why it did not start. */
type RecordedStart =
  | { readonly pid: number; readonly recorded: LaunchRecorded; readonly inTheLaunchRecord: boolean }
  | { readonly refusal: string }

/** Closes the relay's server and removes the socket directory and the snapshot, in that order. */
async function removeWhatTheLaunchMade(made: LaunchMade): Promise<void> {
  await made.server.close()
  made.relayDirectory.remove()
  made.removeSnapshot()
}

/** A member that started: its process, its pid, and whether the launcher recorded it while it was held. */
interface StartedMember {
  readonly child: ChildProcess
  readonly pid: number
  readonly recorded: LaunchRecorded
  readonly launchRecords: ReturnType<typeof launchRecordsDirectory>
}

/** What the host is spawned with: its arguments, and its environment with the relay's socket. */
export interface Starting {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
}

/**
 * The arguments and the environment the host starts with, built once (martha#135). The relay records what the
 * declaration names out of them, and `spawn` gets them unchanged.
 */
export function whatTheHostStartsWith(
  launch: ClaudeCodeMemberLaunch,
  made: Pick<LaunchMade, 'prepared' | 'hostEnv' | 'relayDirectory' | 'emptyDirectory' | 'settingsArgs' | 'pluginDir'>,
): Starting {
  return {
    args: [...launch.args, ...made.prepared.switches.args, ...made.settingsArgs, '--plugin-dir', made.pluginDir],
    env: {
      ...launchEnvironment(made.hostEnv, switchesThatRunNothingFromACheckout(made.hostEnv, made.emptyDirectory)),
      [RELAY_SOCKET_VARIABLE]: made.relayDirectory.socket_path,
    },
  }
}

/** Step 4: `claude` in a process group of its own; or why it did not start, with everything the launch made gone. */
export async function startedMember(
  launch: ClaudeCodeMemberLaunch,
  made: LaunchMade,
  starting: Starting,
): Promise<StartedMember | string> {
  const { prepared, relayDirectory } = made
  const { args: memberArgs, env } = starting
  // The host hands a server its own environment and then the settings files' env,
  // so the server's is built from both.
  const placed = meshServersPlaced(prepared.carried_files[CLAUDE_SERVERS], launch, prepared.snapshot_dir, { ...env, ...made.settingsEnv })
  if (placed !== undefined) {
    await removeWhatTheLaunchMade(made)
    return `${NOT_STARTED}: ${placed}`
  }
  const launchRecords = launchRecordsDirectory(launch.places.launch_records)
  const record = (pid: number): LaunchRecorded =>
    recordMemberLaunch(launchRecords, linuxProcessIdentities, {
      member_name: launch.member_name,
      node_id: launch.node_id,
      pid,
      checkout: launch.place.launch_dir,
      started_at: new Date().toISOString(),
    })
  // The member is held until its callback says yes, so its place in the launch
  // directory's record is written inside the same hold: a launcher killed in
  // between then leaves a record that already names its member (#124).
  const job = isOnTheOwnersTerminal(launch.stdio)
    ? startForegroundJob(made.binary, memberArgs, { cwd: launch.place.launch_dir, env }, (pid) =>
        recordedInsideTheHold(relayDirectory.directory, pid, record(pid)),
      )
    : undefined
  // On the owner's terminal `child` is the job-control shell: it exits once the
  // member has and the terminal is given back, so its exit is the member's.
  const child = job?.shell ?? spawn(made.binary, memberArgs, { cwd: launch.place.launch_dir, env, detached: true, stdio: launch.stdio })

  const spawned = await new Promise<Error | undefined>((resolve) => {
    child.once('spawn', () => resolve(undefined))
    child.once('error', resolve)
  })
  const start = await memberStartOf(launch.command, spawned, job, child.pid, record)
  if ('refusal' in start) {
    await endTheLaunch(child, made)
    return `${NOT_STARTED}: ${start.refusal}`
  }
  // A member the hold already put in the launch directory's record needs no second write.
  const memberError = start.inTheLaunchRecord ? undefined : await recordTheStartedMember(relayDirectory.directory, start.pid, child, made)
  if (memberError !== undefined) return memberError
  return { child, pid: start.pid, recorded: start.recorded, launchRecords }
}

/**
 * Adds the started member to the launch directory's record, so a sweep keeps it
 * while either the launcher or the member lives; or ends the launch and says why.
 * A member holds that directory as much as its launcher does: it can outlive a
 * launcher killed hard, and its host still loads the relay from that copy
 * (leftover_relay_directories.ts).
 */
async function recordTheStartedMember(
  directory: string,
  member: number,
  child: ChildProcess,
  made: LaunchMade,
): Promise<string | undefined> {
  const recorded = recordTheMember(directory, member)
  if (recorded === undefined) return undefined
  await endTheLaunch(child, made)
  return `${NOT_STARTED}: ${recorded}`
}

/** Kills the member's process if it still runs, and removes everything the launch made. */
async function endTheLaunch(child: ChildProcess, made: LaunchMade): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await removeWhatTheLaunchMade(made)
}

/**
 * Kills the member's group and removes both directories if the launcher exits
 * first, or is ended by SIGTERM or SIGINT; returns what takes those handlers off.
 */
export function cleanUpIfTheLauncherEnds(pid: number, made: LaunchMade): () => void {
  const onLauncherExit = (): void => {
    killGroup(pid)
    made.relayDirectory.remove()
    made.removeSnapshot()
  }
  process.once('exit', onLauncherExit)
  // SIGTERM and SIGINT end the process without 'exit', so each cleans up too.
  // The signal is raised again once this launcher's handlers are off, unless
  // some other part of the process still listens for it, so it still ends the
  // launcher the way it would have.
  const onLauncherSignal = (signal: NodeJS.Signals): void => {
    offLauncherEnd()
    onLauncherExit()
    // A `once` listener registered before this one has already been removed
    // when this runs, so it counts as 0 here: the signal is raised again before
    // that listener's own asynchronous shutdown can finish. A part of the
    // process that needs one must keep listening with `on`.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal)
  }
  const offLauncherEnd = (): void => {
    process.off('exit', onLauncherExit)
    for (const signal of LAUNCHER_END_SIGNALS) process.off(signal, onLauncherSignal)
  }
  for (const signal of LAUNCHER_END_SIGNALS) process.once(signal, onLauncherSignal)
  return offLauncherEnd
}

/**
 * Settles once the member exited and everything the launch made is gone: its
 * group killed, its launch record dropped, the server closed, both directories
 * removed and the launcher's own end handlers off.
 */
export function whenTheMemberStops(
  child: ChildProcess,
  pid: number,
  launch: ClaudeCodeMemberLaunch,
  launchRecords: ReturnType<typeof launchRecordsDirectory>,
  made: LaunchMade,
  offLauncherEnd: () => void,
  ended: () => string | null,
): Promise<MemberStopped> {
  return new Promise<MemberStopped>((resolve) => {
    child.once('exit', (exit_code, signal) => {
      void (async () => {
        const stopped_because = ended()
        killGroup(pid)
        recordMemberStopped(launchRecords, launch.member_name)
        await removeWhatTheLaunchMade(made)
        offLauncherEnd()
        resolve({ exit_code, signal, stopped_because })
      })()
    })
  })
}
