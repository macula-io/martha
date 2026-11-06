// The launcher of one Claude Code member (#41, on #16's launch gate).
//
// This exists so a member runs only on the config the owner approved, with its
// every prompt and tool call answered by the core, and so the launcher can stop
// it whole when the checkout stops matching what was approved.
//
// A hooks module cannot run the core (it has no Node), so the core runs here,
// and the member's relay (../claude_code_relay) asks it over a Unix socket made
// for this launch alone. In order:
//
//   1. `prepareLaunch`: on a refusal nothing starts, and the refusal goes to the
//      owner.
//   2. A fresh 0700 directory for the relay socket (relay_directory.ts); a
//      pre-existing path, a link or a parent others may write refuses the launch.
//      Inside it, an empty 0500 directory: where the member's git looks for
//      hooks and direnv for its config (../refuse_code_a_checkout_runs_itself).
//   3. The relay's server on that socket, answering with memberRelay.
//   4. `claude` in a process group of its own, so one SIGKILL reaches the host
//      and its tool servers: the owner's arguments first, then the launch gate's
//      switches and the relay plugin. `--mcp-config` takes every argument after
//      it until the next flag, so the owner's prompt goes before it. The
//      environment is `launchEnvironment(inherited, switches)`, then the
//      settings that keep a checkout from running its hooks, install scripts
//      and .envrc through the member's own commands (martha#24), plus the
//      socket's path.
//   5. `recordMemberLaunch` with the writable store only the launcher holds
//      (#42). A launch that cannot be recorded is stopped.
//
// When the member exits, by itself or killed: its group is sent SIGKILL so no
// tool server outlives it, its launch record is dropped, the server closes, and
// the socket directory and the snapshot are removed. If the launcher itself
// exits first, or is ended by SIGTERM or SIGINT, it kills the group and removes
// both directories on the way out.
//
// What the launcher does not do yet: hand a turn to the model or register a
// tool for it (the contract's `delivery.handToModel` and `tools.register`). No
// slice calls either today; the relay would carry them as calls on the engine's
// `$`. Nor does it read the approvals or the policy itself: the caller passes
// them, until the crew's declaration (port map step 2) holds them.

import { spawn, type StdioOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  bindNothing,
  recordMemberLaunch,
  recordMemberStopped,
} from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import {
  makeEmptyDirectory,
  switchesThatRunNothingFromACheckout,
} from '../refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import {
  launchEnvironment,
  prepareLaunch,
  type SnapshotPlace,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { memberRelay } from './answer_the_relay.ts'
import { makeRelayDirectory } from './relay_directory.ts'
import { serveTheRelay } from './serve_the_relay.ts'
import { sessionRecordsIn } from './session_records_in_rows.ts'

/** The relay plugin's folder, as `--plugin-dir` names it. */
export const RELAY_PLUGIN_DIR = fileURLToPath(new URL('../claude_code_relay', import.meta.url))

/** The empty directory inside a launch's relay directory (../refuse_code_a_checkout_runs_itself). */
export const EMPTY_DIRECTORY_NAME = 'nothing'

/** The host this launcher starts. */
export const CLAUDE_CODE = 'claude-code'

/** Where the launcher keeps a member's files: directories this user owns. */
export interface LauncherPlaces {
  /** The row streams, the session records among them. */
  readonly rows: string
  /** The launcher's records, which the binder reads (#14). */
  readonly launch_records: string
  /** The parent of each launch's relay socket directory: owned by this user, written by no one else. */
  readonly relay_root: string
}

export interface ClaudeCodeMemberLaunch {
  readonly member_name: string
  readonly node_id: string
  /** Where the member starts and what the owner approved there, for `prepareLaunch`. */
  readonly place: SnapshotPlace
  readonly policy: Policy
  readonly places: LauncherPlaces
  /** The host's command: `claude`, or a path to it. */
  readonly command: string
  /** The owner's own arguments, the prompt among them; they go before Martha's. */
  readonly args: readonly string[]
  /** The environment the member inherits, before the launch gate drops what would bring config back. */
  readonly inherited: Readonly<Record<string, string | undefined>>
  readonly stdio: StdioOptions
  /** Shows the owner a line: a refusal, what was not carried, why a member was stopped. */
  tellOwner(line: string): void
}

/** How a member's process ended. */
export interface MemberStopped {
  readonly exit_code: number | null
  readonly signal: string | null
}

export type MemberStarted =
  | {
      readonly started: true
      readonly pid: number
      /** Settles once the member exited and everything the launch made is gone. */
      readonly stopped: Promise<MemberStopped>
      /** Sends SIGKILL to the member's process group. */
      stop(why: string): void
    }
  | { readonly started: false; readonly refusal: string }

const NOT_STARTED = 'The member is not started'

/** The signals that end the launcher without its 'exit' event, and so clean up on their own. */
const LAUNCHER_END_SIGNALS: readonly NodeJS.Signals[] = ['SIGTERM', 'SIGINT']

/** Sends SIGKILL to a whole process group; a group already gone is no error. */
function killGroup(group: number): void {
  try {
    process.kill(-group, 'SIGKILL')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

/** Starts one Claude Code member on its approved config, with its relay answered here. */
export async function launchClaudeCodeMember(launch: ClaudeCodeMemberLaunch): Promise<MemberStarted> {
  const refuse = (refusal: string): MemberStarted => {
    launch.tellOwner(refusal)
    return { started: false, refusal }
  }
  if (launch.place.host !== CLAUDE_CODE) return refuse(`${NOT_STARTED}: this launcher starts ${CLAUDE_CODE}, not ${launch.place.host}.`)

  const prepared = prepareLaunch(launch.place, thisMachine)
  if (!prepared.allow) return refuse(prepared.refusal)
  const removeSnapshot = (): void => rmSync(prepared.snapshot_dir, { recursive: true, force: true })
  for (const path of prepared.not_carried) launch.tellOwner(`Not loaded for ${launch.member_name}: ${path}`)

  const relayDirectory = makeRelayDirectory(join(launch.places.relay_root, randomUUID()))
  if (!relayDirectory.made) {
    removeSnapshot()
    return refuse(relayDirectory.refusal)
  }
  const emptyDirectory = join(relayDirectory.directory, EMPTY_DIRECTORY_NAME)
  const empty = makeEmptyDirectory(emptyDirectory)
  if (!empty.made) {
    relayDirectory.remove()
    removeSnapshot()
    return refuse(empty.refusal)
  }

  let group: number | undefined
  const stop = (why: string): void => {
    launch.tellOwner(`${launch.member_name} is stopped: ${why}`)
    if (group !== undefined) killGroup(group)
  }

  const relay = memberRelay({
    records: sessionRecordsIn(rowStreamsDirectory(launch.places.rows)),
    launch: {
      host: launch.place.host,
      launch_dir: launch.place.launch_dir,
      stop_dir: launch.place.stop_dir,
      approved_fingerprints: launch.place.approved_fingerprints,
    },
    policy: launch.policy,
    names: { ownNameOf: ownNameOfCalledTool },
    binder: bindNothing,
    stopMember: stop,
  })

  let server
  try {
    server = await serveTheRelay(relay, relayDirectory.socket_path)
  } catch (error) {
    relayDirectory.remove()
    removeSnapshot()
    return refuse(`${NOT_STARTED}: its relay socket could not be served (${(error as NodeJS.ErrnoException).code ?? String(error)}).`)
  }

  const hostEnv = launchEnvironment(launch.inherited, prepared.switches)
  const env = {
    ...launchEnvironment(hostEnv, switchesThatRunNothingFromACheckout(hostEnv, emptyDirectory)),
    [RELAY_SOCKET_VARIABLE]: relayDirectory.socket_path,
  }
  const child = spawn(launch.command, [...launch.args, ...prepared.switches.args, '--plugin-dir', RELAY_PLUGIN_DIR], {
    cwd: launch.place.launch_dir,
    env,
    detached: true,
    stdio: launch.stdio,
  })

  const spawned = await new Promise<Error | undefined>((resolve) => {
    child.once('spawn', () => resolve(undefined))
    child.once('error', resolve)
  })
  if (spawned !== undefined || child.pid === undefined) {
    await server.close()
    relayDirectory.remove()
    removeSnapshot()
    return refuse(`${NOT_STARTED}: ${launch.command} could not be started (${spawned?.message ?? 'no pid'}).`)
  }
  group = child.pid
  const pid = child.pid

  const launchRecords = launchRecordsDirectory(launch.places.launch_records)
  const onLauncherExit = (): void => {
    killGroup(pid)
    relayDirectory.remove()
    removeSnapshot()
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

  const stopped = new Promise<MemberStopped>((resolve) => {
    child.once('exit', (exit_code, signal) => {
      void (async () => {
        killGroup(pid)
        recordMemberStopped(launchRecords, launch.member_name)
        await server.close()
        relayDirectory.remove()
        removeSnapshot()
        offLauncherEnd()
        resolve({ exit_code, signal })
      })()
    })
  })

  const recorded = recordMemberLaunch(launchRecords, linuxProcessIdentities, {
    member_name: launch.member_name,
    node_id: launch.node_id,
    pid,
  })
  if (!recorded.recorded) {
    stop(recorded.refusal)
    await stopped
    return { started: false, refusal: recorded.refusal }
  }

  return { started: true, pid, stopped, stop }
}
