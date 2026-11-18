// A member's window without its crew tools (martha#658): opened when a session of the member reads withdrawn, told to
// the Supervisor once, counted while the member works on without the tools, and closed by the next session of that
// member that earns held. A core slice: the host adapter gives the fact (`ServedToolsHeld`) and the calls it answers,
// and nothing here knows a host's record type, field or file.
//
// The window belongs to the member, not the session: the tools have never come back in the session that lost them, so
// the window is closed in the successor, by a refresh (the predecessor the launcher already gives a refresh, never a
// hook input's, T8) or by a relaunch. It is kept as one file per member in the crew's own store, so a relaunched
// launcher still finds it, and the notice is told at most once per (member, loss start): the window is kept before the
// notice is sent, and a window that is open sends nothing again.
//
// The milestones the member owes are counted here while the window is open, from the calls the launcher answers for
// the session that lost the tools: its main turns, and the git pushes and merges in its shell lines. The design read
// them from the gates' journal, but the relay's journal keeps only its last lines, so it cannot cover a window.
//
// Only typed values reach these words: the fact's time, its cause through the closed set, a count of failed servers,
// and Martha's own counts. No string the transcript carries is ever written here.

import type { CrewPlace, Refused, ServedToolsCause, ServedToolsHeld } from '../host_contract/host_contract.ts'
import type { CrewToolsOnARow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { LOG_A_MILESTONE } from '../keep_the_ledger/keep_the_ledger.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { readTheGitCallsInAShellLine } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'

/** The place in the crew's store that keeps each member's window, one file per member. */
export const CREW_TOOLS_PLACE = 'served_tools_windows'

/** The crew's raw stream of windows opened and closed, apart from any package's ledger: a loss is no package's act. */
export const CREW_TOOLS_STREAM = 'member_served_tools'

/** The stream's word for a window opened, and for one closed. */
export const CREW_TOOLS_LOST = 'served_tools_lost'
export const CREW_TOOLS_BACK = 'served_tools_back'

/** What closed a window: the session that lost the tools, its refresh, or a later launch of the member. */
export const SAME_SESSION = 'same_session'
export const REFRESH = 'refresh'
export const RELAUNCH = 'relaunch'
export type ClosedBy = typeof SAME_SESSION | typeof REFRESH | typeof RELAUNCH

/** The git commands a window counts as milestones the member owes a logged milestone for, each with the window field it counts in. */
export const COUNTED_GIT_COMMANDS = { push: 'pushes', merge: 'merges' } as const
type CountedField = (typeof COUNTED_GIT_COMMANDS)[keyof typeof COUNTED_GIT_COMMANDS]

/** One member's window, as its file keeps it. */
export interface ACrewToolsWindow {
  readonly member: string
  /** The session that lost the tools. */
  readonly session: string
  /** When the host withdrew them, on the host's record or the launcher's clock. */
  readonly from: number
  readonly cause_neutral: boolean
  readonly causes: readonly ServedToolsCause[]
  readonly failed_servers: number
  /** Main turns the session ran with the window open. */
  readonly turns: number
  readonly pushes: number
  readonly merges: number
  /** Set once the window is closed: when, and by what. */
  readonly to?: number
  readonly closed_by?: ClosedBy
}


/** What one fact does to a member's window. */
export type AWindowStep =
  | { readonly step: 'none' }
  | { readonly step: 'opened'; readonly window: ACrewToolsWindow }
  | { readonly step: 'closed'; readonly window: ACrewToolsWindow }

const isOpen = (window: ACrewToolsWindow | undefined): window is ACrewToolsWindow => window !== undefined && window.to === undefined

/** What closed the window, seen from the session that earned held: itself, its refresh's predecessor, or neither. */
function closedByOf(window: ACrewToolsWindow, session: string, predecessor: string | null): ClosedBy {
  if (session === window.session) return SAME_SESSION
  return predecessor === window.session ? REFRESH : RELAUNCH
}

/**
 * The step one fact takes, for the session it was read in: a withdrawal opens a window when none is open, a held fact
 * closes the open one, and nothing else changes anything. A second withdrawal while a window is open is the same loss.
 */
export function theWindowStep(open: ACrewToolsWindow | undefined, fact: ServedToolsHeld, member: string, session: string, predecessor: string | null): AWindowStep {
  if (fact.state === 'withdrawn' && !isOpen(open)) {
    const { at, cause_neutral, causes, failed_servers } = fact
    return { step: 'opened', window: { member, session, from: at, cause_neutral, causes, failed_servers, turns: 0, pushes: 0, merges: 0 } }
  }
  if (fact.state === 'held' && isOpen(open)) return { step: 'closed', window: { ...open, to: fact.at, closed_by: closedByOf(open, session, predecessor) } }
  return { step: 'none' }
}

/** The window with one more main turn counted, when it is open and the turn is the window's own session's. */
export function aTurnCounted(window: ACrewToolsWindow | undefined, session: string): ACrewToolsWindow | undefined {
  return isOpen(window) && window.session === session ? { ...window, turns: window.turns + 1 } : undefined
}

/** The window with the pushes and merges of one shell line counted, when it is open and the call is its session's. */
export function aShellLineCounted(window: ACrewToolsWindow | undefined, session: string, line: string): ACrewToolsWindow | undefined {
  if (!isOpen(window) || window.session !== session) return undefined
  const fields = readTheGitCallsInAShellLine(line)
    .map((call) => (call.command !== undefined && Object.hasOwn(COUNTED_GIT_COMMANDS, call.command) ? COUNTED_GIT_COMMANDS[call.command as keyof typeof COUNTED_GIT_COMMANDS] : undefined))
    .filter((field): field is CountedField => field !== undefined)
  if (fields.length === 0) return undefined
  return fields.reduce<ACrewToolsWindow>((counted, field) => ({ ...counted, [field]: counted[field] + 1 }), window)
}

/** What a member's row says of its tools: lost while its window is open, else what this session's fact says. */
export function crewToolsOnTheRow(window: ACrewToolsWindow | undefined, fact: ServedToolsHeld): CrewToolsOnARow {
  if (isOpen(window)) return { state: 'lost', since: window.from }
  return fact.state === 'held' ? { state: 'held' } : { state: 'unknown' }
}

// --- the words -----------------------------------------------------------------------------------------------------

const timeOf = (at: number): string => new Date(at).toISOString()

/** Why the host withdrew them, in Martha's words, from the closed set and the counts. */
function whyOf(window: ACrewToolsWindow): string {
  const causes = window.causes.map((cause) => (cause === 'left_the_configuration' ? 'the tool server left its configuration' : 'another cause')).join(' and ')
  const neutral = window.cause_neutral ? 'it blames the session for nothing' : 'it did not say the session is blameless'
  return `the host recorded ${causes === '' ? 'no cause' : causes}, ${neutral}, ${String(window.failed_servers)} failed server(s)`
}

/** The one notice the Supervisor is told when a member's window opens. */
export function theNoticeOf(window: ACrewToolsWindow): string {
  return (
    `${window.member} has worked without its crew tools since ${timeOf(window.from)} (session ${window.session}): ${whyOf(window)}. ` +
    `It cannot report, log or message the crew until a later session holds them again. The remedy is yours: a restart from its handover (martha restart ${window.member}).`
  )
}

/** The one line the Supervisor is told when the window closes. */
export function theBackLineOf(window: ACrewToolsWindow): string {
  return `${window.member} holds its crew tools again since ${timeOf(window.to ?? window.from)} (${window.closed_by ?? RELAUNCH}); the window opened ${timeOf(window.from)}.`
}

/** What a successor is handed at its start while its member's window is open: the window, and the beats it owes. */
export function theOwedLineOf(window: ACrewToolsWindow): string {
  const milestones = window.pushes + window.merges
  const each = milestones === 0 ? `no ${LOG_A_MILESTONE}` : `one ${LOG_A_MILESTONE} for each of ${String(window.pushes)} push(es) and ${String(window.merges)} merge(s)`
  return (
    `Your session ${window.session} lost its crew tools at ${timeOf(window.from)} and ran ${String(window.turns)} turn(s) without them. ` +
    `You owe one ${REPORT_WHERE_THE_WORK_STANDS} now, and ${each} it made in that time.`
  )
}

// --- the window's file ---------------------------------------------------------------------------------------------

/** What ends a window's file name: the member's name comes before it. */
const WINDOW_FILE_SUFFIX = '.json'

const theWindowFile = (member: string): string => `${member}${WINDOW_FILE_SUFFIX}`

/** The member a file in the place is the window of, or undefined for a name no window is kept under. */
export const theMemberOfTheFile = (name: string): string | undefined =>
  name.endsWith(WINDOW_FILE_SUFFIX) && name.length > WINDOW_FILE_SUFFIX.length ? name.slice(0, -WINDOW_FILE_SUFFIX.length) : undefined

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const CAUSES: readonly ServedToolsCause[] = ['left_the_configuration', 'other']
const CLOSED_BY: readonly ClosedBy[] = [SAME_SESSION, REFRESH, RELAUNCH]

/** A window as its file holds it, or undefined for a file that is not one: a broken file is no window. */
function windowIn(text: string, member: string): ACrewToolsWindow | undefined {
  let held: unknown
  try {
    held = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof held !== 'object' || held === null) return undefined
  const w = held as Record<string, unknown>
  return w['member'] === member && isTheOpening(w) && isTheClosing(w) ? (held as ACrewToolsWindow) : undefined
}

/** Whether a kept window's opening fields read: its session, its time, the host's typed cause, and its counts. */
const isTheOpening = (w: Record<string, unknown>): boolean =>
  typeof w['session'] === 'string' &&
  isCount(w['from']) &&
  typeof w['cause_neutral'] === 'boolean' &&
  Array.isArray(w['causes']) &&
  w['causes'].every((cause) => CAUSES.includes(cause as ServedToolsCause)) &&
  [w['failed_servers'], w['turns'], w['pushes'], w['merges']].every(isCount)

/** Whether a kept window's closing fields read: both absent while it is open, both present once it closed. */
const isTheClosing = (w: Record<string, unknown>): boolean =>
  w['to'] === undefined ? w['closed_by'] === undefined : isCount(w['to']) && CLOSED_BY.includes(w['closed_by'] as ClosedBy)

/** The member's window, as its file in the place holds it; undefined when it has none or the file is not one. */
export function theWindowOf(place: CrewPlace, member: string): ACrewToolsWindow | undefined {
  const read = place.read(theWindowFile(member))
  return read !== undefined && 'text' in read ? windowIn(read.text, member) : undefined
}

/** Keeps the window whole as its member's file, or says why it could not. */
export function keepTheWindow(place: CrewPlace, window: ACrewToolsWindow): Refused | undefined {
  return place.keep(theWindowFile(window.member), `${JSON.stringify(window)}\n`)
}

/** The stream's row for a window that opened or closed: typed values only. */
export function theWindowRow(window: ACrewToolsWindow): Readonly<Record<string, unknown>> {
  return { event: window.to === undefined ? CREW_TOOLS_LOST : CREW_TOOLS_BACK, ...window }
}
