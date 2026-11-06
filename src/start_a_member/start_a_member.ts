// `martha start <member>`: start one member of the declared crew on the config its owner approved (martha#98).
//
// This exists so an owner starts a member by its name, and never by building a launch by hand: the declaration
// (../declare_crew) is read once and names the member, Martha's state outside the checkout
// (../keep_martha_state_outside_the_checkout) holds its node id and the owner's approvals, and the launcher
// (../launch_a_claude_code_member) starts it on the owner's terminal.
//
// Before the launcher is asked, three things refuse a start by name, each with the command that fixes it: no
// declaration (martha init), a member the crew does not have (the crew's names), and a config the owner has not
// approved (martha approve). A config that is approved is named to the owner with when they approved it, so an
// approval they never gave is on their own screen before the member starts.
//
// The member's policy lets no node id hand it executable text: for the first release the owner relays every
// hand-off between members (martha#51 ruling), and a turn the owner types is host-attested as theirs.

import fs from 'node:fs'
import process from 'node:process'

import type { StdioOptions } from 'node:child_process'
import type { DocumentStore } from '../host_contract/host_contract.ts'
import { DeclarationRefused, declareCrew, type CrewSettings } from '../declare_crew/declare_crew.ts'
import {
  nodeIdsFor,
  PERMISSION_BITS,
  readApprovals,
  stateSubdirectory,
  STATE_DIRECTORY_MODE,
  type Approval,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import {
  CLAUDE_CODE,
  launchClaudeCodeMember,
  NOT_STARTED,
  type LauncherPlaces,
  type MemberStarted,
} from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { decideLaunch, fingerprintOf, readLaunchState } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** The launcher's places, and where its approved snapshots go. */
export type MemberPlaces = LauncherPlaces & { readonly snapshot_root: string }

/** The directories inside Martha's state that the launcher keeps a member's files in, in the order MemberPlaces names them. */
const STATE_PLACES = ['rows', 'launches', 'snapshots', 'mesh-servers'] as const

/** Why the relay root may not hold a launch's socket, or undefined; made mode 0700 when missing. */
function closedRelayRoot(relay_root: string): string | undefined {
  if (fs.lstatSync(relay_root, { throwIfNoEntry: false }) === undefined) fs.mkdirSync(relay_root, { recursive: true, mode: STATE_DIRECTORY_MODE })
  const found = fs.lstatSync(relay_root)
  const closed = found.isDirectory() && found.uid === process.getuid?.() && (found.mode & PERMISSION_BITS) === STATE_DIRECTORY_MODE
  return closed ? undefined : `${NOT_STARTED}: ${relay_root} is not a directory of this user's that only this user may enter.`
}

/** The launcher's places in Martha's state, and the relay root for its sockets; or why one cannot be used. */
export function launcherPlacesOf(state: MarthaState, relay_root: string): MemberPlaces | { readonly refusal: string } {
  const made = STATE_PLACES.map((name) => stateSubdirectory(state, name))
  const refused = made.find((place) => 'refusal' in place)
  if (refused !== undefined && 'refusal' in refused) return refused
  const [rows, launch_records, snapshot_root, mesh_servers] = made.map((place) => ('path' in place ? place.path : ''))
  const unsafe = closedRelayRoot(relay_root)
  if (unsafe !== undefined) return { refusal: unsafe }
  return { rows: rows!, launch_records: launch_records!, snapshot_root: snapshot_root!, mesh_servers: mesh_servers!, relay_root }
}

export interface MemberStartRequest {
  /** The project's absolute path: where the member starts. */
  readonly root: string
  /** The owner's home: the launch gate reads no config at it or above it. */
  readonly home: string
  /** The member's name in the declaration. */
  readonly member: string
  /** The owner's own arguments for the host. */
  readonly args: readonly string[]
  readonly state: MarthaState
  readonly places: MemberPlaces
  /** The host's command: `claude`, or a path to it. */
  readonly command: string
  readonly inherited: Readonly<Record<string, string | undefined>>
  readonly stdio: StdioOptions
  readonly documents: DocumentStore
  tellOwner(line: string): void
}

/** The declaration, or why there is none to start from. */
async function settingsOf(request: MemberStartRequest): Promise<CrewSettings | string> {
  try {
    return await declareCrew(request.documents, request.root)
  } catch (error) {
    if (!(error instanceof DeclarationRefused)) throw error
    const fix = error.field === null && error.message.endsWith('is missing') ? ' Run martha init to declare a crew here.' : ''
    return `${NOT_STARTED}: ${error.message}.${fix}`
  }
}

/** The approval the start is on, undefined when the checkout needs none, or why it may not start. */
function approvalInUse(request: MemberStartRequest, approvals: readonly Approval[]): Approval | undefined | string {
  const launch = readLaunchState({ host: CLAUDE_CODE, launch_dir: request.root, stop_dir: request.home }, thisMachine)
  const fingerprint = fingerprintOf(launch)
  const fingerprints = approvals.map((approval) => approval.fingerprint)
  if (decideLaunch({ host: CLAUDE_CODE, ...launch, approved_fingerprints: fingerprints }).allow) {
    return approvals.find((approval) => approval.fingerprint === fingerprint)
  }
  const unapproved = decideLaunch({ host: CLAUDE_CODE, ...launch, approved_fingerprints: [fingerprint] }).allow
  if (!unapproved) return undefined
  const present = launch.entries.filter((entry) => entry.kind !== 'absent').map((entry) => entry.path)
  return `${NOT_STARTED}: this checkout holds config that starts code by itself (${present.join(', ')}), and you have not approved it as it is now. Run martha approve, read what it shows, and answer yes.`
}

/** Everything a start needs before the launcher is asked, or why it may not start. */
async function readyToStart(request: MemberStartRequest): Promise<{ readonly node_id: string; readonly model: string | null; readonly approval: Approval | undefined } | string> {
  const settings = await settingsOf(request)
  if (typeof settings === 'string') return settings
  const member = settings.members.find((candidate) => candidate.name === request.member)
  const names = settings.members.map((candidate) => candidate.name)
  if (member === undefined) return `${NOT_STARTED}: ${request.member} is not on this crew (its members are ${names.join(', ')}).`
  const ids = nodeIdsFor(request.state, names)
  if ('refusal' in ids) return `${NOT_STARTED}: ${ids.refusal}`
  const kept = readApprovals(request.state)
  if ('refusal' in kept) return `${NOT_STARTED}: ${kept.refusal}`
  const approval = approvalInUse(request, kept.approvals)
  if (typeof approval === 'string') return approval
  return { node_id: ids.ids[member.name]!, model: member.model, approval }
}

/** Starts the named member of the crew declared at `root`, on the config its owner approved. */
export async function startMember(request: MemberStartRequest): Promise<MemberStarted> {
  const ready = await readyToStart(request)
  if (typeof ready === 'string') {
    request.tellOwner(ready)
    return { started: false, refusal: ready }
  }
  if (ready.approval !== undefined) {
    request.tellOwner(`Starting ${request.member} on the config you approved at ${ready.approval.approved_at} (fingerprint ${ready.approval.fingerprint}).`)
  }
  const { snapshot_root, ...places } = request.places
  return launchClaudeCodeMember({
    member_name: request.member,
    node_id: ready.node_id,
    place: { host: CLAUDE_CODE, launch_dir: request.root, stop_dir: request.home, snapshot_root, approved_fingerprints: ready.approval === undefined ? [] : [ready.approval.fingerprint] },
    policy: { may_send_executable_text: [] },
    places,
    command: request.command,
    args: [...(ready.model === null ? [] : ['--model', ready.model]), ...request.args],
    inherited: request.inherited,
    stdio: request.stdio,
    tellOwner: (line) => request.tellOwner(line),
  })
}
