// What the launcher does with a member's crew tools fact (martha#658), over the crew's own places: on each beat it
// steps the member's window, keeps it, writes its row to the crew's stream and tells the Supervisor once; on each call
// the host adapter answers for the session that lost the tools, it counts the milestones owed; and at a session's start
// it hands the successor what is owed.
//
// The order keeps the notice told at most once per (member, loss start): the window is kept before anything is said,
// and a window the store would not keep says nothing, so the next beat tries again and no second notice can follow a
// first. A window that opened is never told twice, because an open window takes no second withdrawal.

import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { ServedToolsHeld, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { theNudgesGoTo } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { sendACrewMessage } from '../send_a_crew_message/send_a_crew_message.ts'
import type { TheStartLine } from '../hand_a_member_its_crew_text/the_start_line.ts'
import { CREW_TOOLS_FIELD, type CrewToolsOnARow, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import {
  aShellLineCounted,
  aTurnCounted,
  CREW_TOOLS_PLACE,
  CREW_TOOLS_STREAM,
  crewToolsOnTheRow,
  keepTheWindow,
  theBackLineOf,
  theNoticeOf,
  theOwedLineOf,
  theWindowOf,
  theWindowRow,
  theWindowStep,
  type ACrewToolsWindow,
} from './keep_a_members_crew_tools_window.ts'

/**
 * What a host adapter that watches its sessions' tools gives the launcher: the fact for a session, the session a
 * refresh started from as the crew answered it when that session started (never a hook input's, T8), and the calls it
 * answered since it was last asked, which the beat counts into an open window.
 */
export interface TheServedToolsWatch {
  factOf(session_id: string): ServedToolsHeld
  predecessorOf(session_id: string): string | null
  takeTheCalls(): readonly ACallInASession[]
}

/** One call the host adapter answered, and the session it was made in. */
export interface ACallInASession {
  readonly session: string
  readonly call: ACallForTheWindow
}

/** The places a member's window is kept and told over: a structural part of the crew's tool places. */
export interface TheWindowPlaces {
  readonly member: string
  readonly ledger: LedgerHost
  readonly stores: TheCrewFilesStores
  readonly settings?: CrewSettings
  readonly served_tools?: TheServedToolsWatch
}

/** One call the host adapter answered: a main turn started, or a shell line run. */
export type ACallForTheWindow = { readonly turn: true } | { readonly shell: string }

const placeOf = (places: TheWindowPlaces) => {
  const place = places.stores.crew.place(CREW_TOOLS_PLACE)
  return 'refusal' in place ? undefined : place
}

/** One line to the member whose role is the Supervisor; a crew with none is told nothing, and the row still says it. */
async function sayToTheSupervisor(places: TheWindowPlaces, line: string): Promise<void> {
  const settings = places.settings
  const supervisor = settings?.members.find((one) => one.role === SUPERVISOR)
  if (settings === undefined || supervisor === undefined) return
  const roster = settings.members.map((one) => one.name)
  await sendACrewMessage(places.ledger, { member: places.member, roster, receivers: theNudgesGoTo(settings), package: null, to: [supervisor.name], text: line })
}

/**
 * One beat's look at the member's crew tools, for the session the launch is serving now: the window stepped, kept,
 * written and told, and what the row says. Undefined when this launch watches no tools, so the row is left as it was.
 */
export async function heedTheCrewTools(places: TheWindowPlaces, session: string): Promise<CrewToolsOnARow | undefined> {
  const watch = places.served_tools
  const place = placeOf(places)
  if (watch === undefined || place === undefined) return undefined
  for (const one of watch.takeTheCalls()) countForTheWindow(places, one.session, one.call)
  const fact = watch.factOf(session)
  const open = theWindowOf(place, places.member)
  const step = theWindowStep(open, fact, places.member, session, watch.predecessorOf(session))
  if (step.step === 'none') return crewToolsOnTheRow(open, fact)
  if (keepTheWindow(place, step.window) !== undefined) return crewToolsOnTheRow(open, fact)
  await places.ledger.stores.rows.append(CREW_TOOLS_STREAM, theWindowRow(step.window))
  await sayToTheSupervisor(places, step.step === 'opened' ? theNoticeOf(step.window) : theBackLineOf(step.window))
  return crewToolsOnTheRow(step.window, fact)
}

/** Counts one call into the member's open window, when the call is its lost session's; anything else keeps nothing. */
export function countForTheWindow(places: TheWindowPlaces, session: string, call: ACallForTheWindow): void {
  const place = placeOf(places)
  if (place === undefined) return
  const open = theWindowOf(place, places.member)
  const counted: ACrewToolsWindow | undefined = 'turn' in call ? aTurnCounted(open, session) : aShellLineCounted(open, session, call.shell)
  if (counted !== undefined) keepTheWindow(place, counted)
}

/** What a starting session is handed of its member's window: the owed line while the window is open, else nothing. */
export function theOwedLineAtStart(places: TheWindowPlaces): string | null {
  const place = placeOf(places)
  const open = place === undefined ? undefined : theWindowOf(place, places.member)
  return open === undefined || open.to !== undefined ? null : theOwedLineOf(open)
}

/**
 * One beat of a launch that watches its crew tools: the row the beat writes carries what the last look found, and the
 * next look starts once that row has landed. A write of the look's own would carry the beat's own moment, and the newest
 * beat wins, so it would be dropped: the next beat writes it instead. A look that fails leaves the beat as it was.
 */
export function theBeatOverTheCrewTools(places: TheWindowPlaces, sessionOf: () => string, write: (change: (row: DashboardRow) => DashboardRow) => void): () => void {
  let tools: CrewToolsOnARow | undefined
  return () => {
    write((row) => (tools === undefined ? row : { ...row, [CREW_TOOLS_FIELD]: tools }))
    if (places.served_tools !== undefined) void heedTheCrewTools(places, sessionOf()).then((found) => void (tools = found ?? tools), () => undefined)
  }
}

/** The line a starting session is handed, with what it owes for its member's open window after it: Martha's own words. */
export function withTheOwedLine(places: TheWindowPlaces, line: TheStartLine | null): TheStartLine | null {
  const owed = places.served_tools === undefined ? null : theOwedLineAtStart(places)
  return owed === null ? line : { line: line === null ? owed : `${line.line}\n\n${owed}`, taken_in: line?.taken_in ?? [] }
}
