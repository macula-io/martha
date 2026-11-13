// `martha ls`: one line per declared member, saying whether it runs, where, since when, on which model and at what
// (martha#312).
//
// It composes what three readers already answer, and reads none of their stores a second time: the crew's rows as
// ../see_the_crew sees them, the launcher's records, and the park. A record counts as running only while the kernel
// still names the same process at its pid, so a pid handed to another process reads `stopped`, never `running`.

import type { Processes } from '../host_contract/host_contract.ts'
import type { MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { ThePark } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { OFFLINE } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { CrewRow } from '../see_the_crew/see_the_crew.ts'
import { isUnanswered, sameLaunch, theRunningLaunchOf, type TheRequest } from './stop_and_restart_a_member.ts'

/** What `martha ls` says a member is. */
export const LISTED_STATES = ['running', 'stopped', 'parked', OFFLINE] as const
export type ListedState = (typeof LISTED_STATES)[number]

/** One member as `martha ls` shows it. */
export interface ListedMember {
  readonly member: string
  readonly state: ListedState
  readonly checkout: string
  readonly since: string
  readonly model: string
  readonly task: string
  /** What else the owner should know: a request no launcher answered, a park or request nobody can read. */
  readonly note: string
}

/** What the list is made of: each read once, by the reader that owns it. */
export interface WhatTheListReads {
  /** The declaration's members in its order, with the model each is declared on (null for the host's own). */
  readonly members: readonly { readonly name: string; readonly model: string | null }[]
  /** The crew's rows, as see_the_crew answered them. */
  readonly rows: readonly CrewRow[]
  /** The launcher's records as `launchesIn` reads them. */
  readonly launches: readonly MemberLaunch[]
  readonly processes: Pick<Processes, 'identityOf'>
  readonly parks: Readonly<Record<string, ThePark>>
  readonly requests: Readonly<Record<string, TheRequest>>
  readonly now: number
}

/** The note a request leaves on a member's line: one waiting past the deadline means its launcher is gone. */
export const REQUEST_PENDING_LAUNCHER_GONE = 'request pending, launcher gone'

/** Every declared member, in the declaration's order. */
export function theMembersListed(reads: WhatTheListReads): readonly ListedMember[] {
  return reads.members.map((member) => listed(reads, member))
}

type Declared = { readonly name: string; readonly model: string | null }

function listed(reads: WhatTheListReads, member: Declared): ListedMember {
  const row = reads.rows.find((one) => one.member === member.name)
  const launch = theRunningLaunchOf(reads.launches, reads.processes, member.name)
  const park = reads.parks[member.name] ?? { kind: 'not_parked', last_marker: null }
  return {
    member: member.name,
    state: stateOf(launch !== undefined, park.kind === 'parked', row?.state === OFFLINE),
    ...whereAndWhatOf(launch, row),
    model: modelOf(member, row),
    note: [noteOfThePark(park), noteOfTheRequest(reads.requests[member.name], launch, reads.now)].filter((note) => note !== '').join('; '),
  }
}

/** Where a running member runs, since when and at what; a member that is not running lends its line none of these. */
function whereAndWhatOf(launch: MemberLaunch | undefined, row: CrewRow | undefined): Pick<ListedMember, 'checkout' | 'since' | 'task'> {
  if (launch === undefined) return { checkout: '', since: '', task: '' }
  return { checkout: launch.checkout ?? '', since: launch.started_at ?? '', task: row?.task ?? '' }
}

/** The model a member's row names, else the one it is declared on, else none. */
function modelOf(member: Declared, row: CrewRow | undefined): string {
  const reported = row?.host.model ?? ''
  return reported !== '' ? reported : (member.model ?? '')
}

function stateOf(running: boolean, parked: boolean, quiet: boolean): ListedState {
  if (parked) return 'parked'
  if (!running) return 'stopped'
  return quiet ? OFFLINE : 'running'
}

const noteOfThePark = (park: ThePark): string => (park.kind === 'unreadable' ? park.refusal : '')

/**
 * The note a member's request leaves: only a request for the launch running now (r=1 R2). One left from an earlier
 * launch was never asked of the launcher holding the member today, and says nothing about it.
 */
function noteOfTheRequest(request: TheRequest | undefined, launch: MemberLaunch | undefined, now: number): string {
  if (request === undefined) return ''
  if (request.kind === 'unreadable') return request.refusal
  if (request.kind !== 'pending' || launch === undefined || !sameLaunch(request.request.launch, launch)) return ''
  return isUnanswered(request.request, now) ? REQUEST_PENDING_LAUNCHER_GONE : `${request.request.act} asked by ${request.request.by} at ${request.request.at}, pending`
}

/** One member's line: name, state, then whatever of the rest is known, so an empty field leaves no gap. */
export function theListLine(member: ListedMember): string {
  const since = member.since === '' ? '' : `since ${member.since}`
  const fields = [member.checkout, since, member.model, member.task].filter((field) => field !== '')
  const note = member.note === '' ? '' : ` (${member.note})`
  return `${[member.member, member.state, ...fields].join('  ')}${note}`
}
