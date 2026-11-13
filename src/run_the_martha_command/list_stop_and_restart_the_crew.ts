// `martha ls`, `martha stop [<member>]` and `martha restart <member> [--fresh]` (martha#312): the owner's view of which
// members run, the owner's stop and restart, and the hold that lets a launcher start its member again.
//
// Host glue only. The places are this machine's directories, read through the stores the launcher writes; what a
// member is, and how a stop or a restart is asked and carried out, are ../stop_and_restart_a_member's.

import { randomUUID } from 'node:crypto'

import { launchesIn } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { crewFilesDirectory, handoverStampsIn } from '../crew_files_directory/crew_files_directory.ts'
import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import { OWNER } from '../declare_crew/declare_crew.ts'
import { readingOnly, type CrewPlace, type Refused } from '../host_contract/host_contract.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { parkedPlace, theParkOf, type ThePark } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { seeTheCrew } from '../see_the_crew/see_the_crew.ts'
import { stoppingHostOn, type MemberPlaces } from '../start_a_member/start_a_member.ts'
import { holdTheMember, restartAMember, type AStart, type HeldEnd, type Restarted, type StartedMember } from '../stop_and_restart_a_member/restart_a_member.ts'
import { theListLine, theMembersListed } from '../stop_and_restart_a_member/list_the_members.ts'
import {
  LIFECYCLE_PLACE,
  stopAMember,
  theRunningLaunchOf,
  theRequestOf,
  type Stopped,
  type TheRequest,
} from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'

/** Why the owner's stop was asked, as the ledger keeps it. */
export const OWNERS_STOP_REASON = 'the owner ran martha stop'

/** Why the owner's restart was asked, as the ledger keeps it. */
export const OWNERS_RESTART_REASON = 'the owner ran martha restart'

/** Where the verbs read: the launcher's places, and the crew's own directory. */
export interface TheCrewsPlaces extends WhereTheCrewIs {
  readonly settings: CrewSettings
}

/** The launcher's places and the crew's own directory: all a hold needs, with no declaration read. */
export interface WhereTheCrewIs {
  readonly launcher: MemberPlaces
  readonly crew: string
}

/** The launcher's records on this machine, as the binder's own reader reads them. */
const theLaunchesIn = (places: WhereTheCrewIs) => launchesIn(readingOnly(launchRecordsDirectory(places.launcher.launch_records)))

const placeOrRefusal = (crew: string): CrewPlace | Refused => crewFilesDirectory(crew).place(LIFECYCLE_PLACE)

/** One line per declared member, in the declaration's order. */
export function theCrewListed(places: TheCrewsPlaces, now: number): readonly string[] {
  const store = crewFilesDirectory(places.crew)
  const lifecycle = placeOrRefusal(places.crew)
  const parked = parkedPlace({ stores: { crew: store } })
  const names = places.settings.members.map((member) => member.name)
  const parks: Record<string, ThePark> = {}
  const requests: Record<string, TheRequest> = {}
  for (const name of names) {
    parks[name] = 'refusal' in parked ? { kind: 'unreadable', refusal: parked.refusal } : theParkOf(parked, name)
    requests[name] = 'refusal' in lifecycle ? { kind: 'unreadable', refusal: lifecycle.refusal } : theRequestOf(lifecycle, name)
  }
  const listed = theMembersListed({
    members: places.settings.members,
    rows: seeTheCrew(places.settings, dashboardRowsIn(places.launcher.dashboard).all(), now).rows,
    launches: theLaunchesIn(places),
    processes: thisMachine.processes,
    parks,
    requests,
    now,
  })
  return listed.map(theListLine)
}


/**
 * Stops `member`, or, with none named, every declared member that is running (crew-code's `down`), one after another;
 * resolves to what came of each, in the declaration's order.
 */
export async function stopTheCrew(places: TheCrewsPlaces, member: string | undefined): Promise<readonly Stopped[]> {
  const host = stoppingHostOn(places)
  const names = places.settings.members.map((one) => one.name)
  if (member !== undefined && !names.includes(member)) return [{ kind: 'refused', told: `${member} is not on this crew (its members are ${names.join(', ')}).` }]
  const asked = member === undefined ? names.filter((name) => theRunningLaunchOf(host.launches(), host.processes, name) !== undefined) : [member]
  if (asked.length === 0) return [{ kind: 'not_running', told: 'no member of this crew is running, so nothing was stopped.' }]
  const stopped: Stopped[] = []
  for (const name of asked) stopped.push(await stopAMember(host, { member: name, by: OWNER, reason: OWNERS_STOP_REASON, id: randomUUID() }))
  return stopped
}

/** `martha restart <member> [--fresh]`: the owner's restart, asked of the member's launcher and waited for. */
export async function restartTheMember(places: TheCrewsPlaces, member: string, fresh: boolean): Promise<Restarted> {
  const names = places.settings.members.map((one) => one.name)
  if (!names.includes(member)) return { kind: 'refused', told: `${member} is not on this crew (its members are ${names.join(', ')}).` }
  return restartAMember(stoppingHostOn(places), { member, by: OWNER, reason: OWNERS_RESTART_REASON, id: randomUUID(), fresh })
}

/**
 * Holds `member` on this terminal from its first start, starting it again through `start` for each restart asked of
 * it; resolves to how the hold ended.
 */
export function holdOnThisTerminal<Ended>(
  places: WhereTheCrewIs,
  member: string,
  first: StartedMember<Ended>,
  start: (prompt: string | undefined) => Promise<AStart<Ended>>,
  tellOwner: (line: string) => void,
): Promise<HeldEnd<Ended>> {
  const dashboard = dashboardRowsIn(places.launcher.dashboard)
  const host = {
    stores: { lifecycle: placeOrRefusal(places.crew), rows: rowStreamsDirectory(places.launcher.rows), crew: crewFilesDirectory(places.crew) },
    stamps: handoverStampsIn(places.crew),
    processes: thisMachine.processes,
    clock: { now: () => Date.now() },
    rowStateOf: (name: string) => dashboard.read(name)?.state ?? null,
    start,
    tellOwner,
  }
  return holdTheMember(host, member, first)
}
