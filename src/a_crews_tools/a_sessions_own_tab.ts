// What a member's own session says about its row, and the row a finished turn settles to (martha#1000, gap 8 of #957).
//
// This exists so the row a member's own tab moves is decided in one place, apart from the table that calls every tool:
// the owner's two overrides typed in a session's tab (`/crew-progress`, `/crew-park`), the task list the host's own task
// tools keep, the background work the host's Stop reports, and the state a finished turn settles to. None of it is the
// member's report — `report_where_the_work_stands` stays the member's own word about itself, and this file is what its
// session and its host say about it beside that word.
//
// It is a second file in ../a_crews_tools for the one reason the repository's structural floor gives: the table's file
// has no room left under the per-file cap, and this is its own concern inside the same slice.
//
// Nothing here decides a tool's name or writes a row's `at`: the caller owns the one writer of the member's row
// (a_crews_tools.ts `writeRow`), and a change that does not beat the row held is dropped there.

import type { AWorkInHandReported, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { parkAMember, unparkAMember, type TheDeclaration } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import {
  AGENTS_FIELD,
  TASKS_FIELD,
  TASK_STATUSES,
  type AnAgentOnARow,
  type ATaskOnARow,
  type DashboardRow,
  type State,
  type TaskStatus,
  type Waits,
} from '../show_dashboard_beat/show_dashboard_beat.ts'

/** What an answer to one of the owner's own asks is: the words the owner reads, or why nothing moved. */
export type AnOwnTabAnswer = { readonly answer: string } | { readonly refused: string }

/**
 * What the owner's `/crew-progress on|off` asks (martha#1000, gap 8 of #957): turn this session's progress reporting on
 * or off. It is the session's own switch, as crew-code's was, so it names no member (register.tsx:6699).
 */
export const THE_PROGRESS_SWITCH_ASK = 'switch_progress_reporting'

/** What the owner's `/crew-park` asks: park the session the command was typed in, or `/crew-park off` unpark it. */
export const THE_OWNERS_PARK_ASK = 'park_this_session'

/**
 * What a member's own report is answered with while its owner has progress reporting off (martha#1000): crew-code's own
 * line, so the member is told rather than left guessing why its report changed nothing (register.tsx:6815).
 */
export const PROGRESS_REPORTING_IS_OFF = 'Progress reporting is off for this session; no need to call this.'

/**
 * What the mod asks when the host's own task tools move this session's task list (martha#1000, gap 8 of #957): the list
 * folded as the session keeps it, written onto the member's row beside the report it is told apart from.
 */
export const THE_TASKS_ASK = 'note_the_tasks_the_session_keeps'

/**
 * The state one session's own tab keeps between calls (martha#1000, gap 8 of #957): the sessions whose owner turned
 * progress reporting off, and — by session id — the work each session has in hand and the wake-ups it scheduled, and
 * whether a turn is running. Kept by session id, because each of these is the session's own fact.
 */
export interface TheSessionsOwnState {
  readonly progress_off: Set<string>
  readonly in_hand: Map<string, readonly AnAgentOnARow[]>
  readonly wakeups: Map<string, number>
  turn_running: boolean
}

/** The state a launch's sessions start with: nothing off, nothing in hand, no turn running. */
export function theSessionsOwnState(): TheSessionsOwnState {
  return { progress_off: new Set<string>(), in_hand: new Map<string, readonly AnAgentOnARow[]>(), wakeups: new Map<string, number>(), turn_running: false }
}

/** What a row-changing function is handed a change by: the one writer of a member's row (a_crews_tools.ts `writeRow`). */
export type WriteTheRow = (change: (row: DashboardRow) => DashboardRow) => void

/** What a session's own tab is answered over, beside its state: this member's name, and the one writer of its row. */
export interface AnOwnTabAsked {
  readonly member: string
  readonly writeTheRow: WriteTheRow
}

/** What the three asks a session's own tab makes are answered over: the row's writer, the session's own state, and the park. */
export interface TheOwnTabAsksPlace {
  readonly asked: AnOwnTabAsked
  readonly own: TheSessionsOwnState
  readonly session: string
  readonly park: ThePlaceAParkIsMovedIn
}

/**
 * The three asks a session's own tab makes (martha#1000, gap 8 of #957): the owner's two overrides, and the host's task
 * list posted by the mod. Undefined when the ask is another's, which the asking file's own questions answer.
 */
export function anAskTheSessionsOwnTabMakes(at: TheOwnTabAsksPlace, name: string, args: Readonly<Record<string, unknown>>): AnOwnTabAnswer | undefined {
  if (name === THE_PROGRESS_SWITCH_ASK) return theProgressSwitched(at.asked, at.own, at.session, args)
  if (name === THE_TASKS_ASK) return theTasksNoted(at.asked, at.own, at.session, args)
  if (name === THE_OWNERS_PARK_ASK) return theOwnersParkMoved(at.park, args)
  return undefined
}

/**
 * The owner's `/crew-progress on|off` (martha#1000, gap 8 of #957): this session's progress reporting, and what the row
 * says when it is turned off. Off is answered to the member's own reports from here on, and the report already taken is
 * cleared from the row — a task and a figure that stand after the owner asked for none would be the session's word and
 * not the member's (crew-code clears the record the same way, register.tsx:6700).
 */
export function theProgressSwitched(asked: AnOwnTabAsked, own: TheSessionsOwnState, session: string, args: Readonly<Record<string, unknown>>): AnOwnTabAnswer {
  const wanted = textOf(args['wanted'])
  if (wanted !== 'on' && wanted !== 'off') return { refused: 'progress reporting is turned on or off: /crew-progress on, or /crew-progress off' }
  if (wanted === 'off') {
    own.progress_off.add(session)
    // The task list is progress too: a reader shows its open task where the report's is blank (see_the_crew), so off
    // clears it with the report, and no list is taken until progress reporting is on again (review r=1).
    asked.writeTheRow(({ [TASKS_FIELD]: _taken, ...row }) => ({ ...row, task: '', progress: { ...row.progress, step: 0 } }))
  } else {
    own.progress_off.delete(session)
  }
  return { answer: `Progress reporting ${wanted} for this session.` }
}

/**
 * Whether this member may put a closing question to the owner (martha#1000, gap 8 of #957): crew-code's rule that a
 * member of a team crew asks its Supervisor, not the owner (register.tsx:3927 #472). The cheap reading comes first, so
 * the crew's routing table is read only at a turn's end and only when that turn's answer ends in a question.
 */
export async function mayPutAQuestionToTheOwner(
  turn: { readonly at_start: boolean; readonly turn_running: boolean; readonly answer: string },
  theNudgesGoToTheOwner: () => Promise<boolean>,
): Promise<boolean> {
  if (turn.at_start || turn.turn_running || !turn.answer.trimEnd().endsWith('?')) return false
  return await theNudgesGoToTheOwner()
}

/** What a park is moved over: this member's name, the crew's own store, and the moment the owner typed it. */
export interface ThePlaceAParkIsMovedIn {
  readonly member: string
  readonly stores: TheCrewFilesStores
  readonly now: number
}

/**
 * The owner's `/crew-park` (martha#1000, gap 8 of #957): the park of the session the command was typed in, moved on the
 * owner's own word. The actor is the member itself, so the declaration's table is not asked — a member may always park
 * itself (`moveThePark`, park_and_wake_a_member.ts:147) — and the reason says who moved it, so the marker reads as the
 * owner's act (crew-code's `/crew-park`, register.tsx:6684).
 */
export function theOwnersParkMoved(place: ThePlaceAParkIsMovedIn, args: Readonly<Record<string, unknown>>): AnOwnTabAnswer {
  const parked = args['parked'] !== false && args['parked'] !== 'off'
  const parking = { actor: place.member, member: place.member, reason: PARKED_BY_THE_OWNER, at: new Date(place.now), declaration: THE_DECLARATION_NOT_ASKED }
  const moved = parked ? parkAMember(place, parking) : unparkAMember(place, parking)
  if ('refusal' in moved) return { refused: moved.refusal }
  return {
    answer: parked
      ? `${place.member} is parked: wake-on-idle no longer wakes it, and /crew-park off unparks it.`
      : `${place.member} is unparked: wake-on-idle wakes it again.`,
  }
}

/** What a park the owner moved from a session's own tab says, so the marker reads as the owner's act and not a member's. */
export const PARKED_BY_THE_OWNER = 'parked by the owner from this session'

/**
 * The declaration a park is granted by, when there is none to ask: a member moving its own park is always allowed, so the
 * table this is handed is never read.
 */
const THE_DECLARATION_NOT_ASKED: TheDeclaration = { members: [], mode: { may: {} } }

/**
 * The host's own task list, as the mod folds it (martha#1000, gap 8 of #957): the row's `tasks` moves, and the member's
 * own `task`, `progress` and `reported_at` are left exactly as its report wrote them, because the two are told apart by
 * which wrote them. A task-list write keeps a wait the member declared: only a report ends a wait (crew-code reg:3794).
 */export function theTasksNoted(asked: AnOwnTabAsked, own: TheSessionsOwnState, session: string, args: Readonly<Record<string, unknown>>): AnOwnTabAnswer {
  // A session whose owner turned progress reporting off takes no task list either: it is progress the owner asked for
  // none of (review r=1).
  if (own.progress_off.has(session)) return { answer: PROGRESS_REPORTING_IS_OFF }
  const tasks = theTasksIn(args['tasks'])
  if (tasks === undefined) return { refused: `a task list is a list of tasks, each with a subject and one of ${TASK_STATUSES.join(', ')}` }
  asked.writeTheRow((row) => ({ ...row, [TASKS_FIELD]: tasks }))
  return { answer: `Noted: this row says the session keeps ${tasks.length} task${tasks.length === 1 ? '' : 's'}.` }
}

/** The task list an ask carries, or undefined when it is not one: each task a subject and one of the three standings. */
export function theTasksIn(value: unknown): readonly ATaskOnARow[] | undefined {
  if (!Array.isArray(value)) return undefined
  const tasks: ATaskOnARow[] = []
  for (const one of value) {
    if (typeof one !== 'object' || one === null) return undefined
    const task = one as Record<string, unknown>
    const subject = task['subject']
    if (typeof subject !== 'string' || !(TASK_STATUSES as readonly unknown[]).includes(task['status'])) return undefined
    tasks.push({ subject, status: task['status'] as TaskStatus })
  }
  return tasks
}

/**
 * The work a session has in hand, written onto the row (martha#1000, gap 8 of #957): the row's `background`, and —
 * because what just ended may be what the row said it waited on — the settle a look between turns makes (martha#169).
 */
export function theWorkInHandHeld(
  asked: AnOwnTabAsked,
  own: TheSessionsOwnState,
  session: string,
  work: AWorkInHandReported,
  now: number,
  is_a_review: (label: string) => boolean,
): void {
  const agents = theAgentsInHand(work, own.in_hand.get(session) ?? [], now)
  own.in_hand.set(session, agents)
  own.wakeups.set(session, work.session_crons)
  asked.writeTheRow((row) => theRowSettledBetweenTurns({ ...row, [AGENTS_FIELD]: agents }, own, session, is_a_review))
}

/** The label the host's own work reads as: its kind, and the words it was started with, cut as crew-code cut them. */
function theLabelOf(task: AWorkInHandReported['background_tasks'][number]): string {
  const kind = task.type === 'subagent' && task.agent_type !== undefined && task.agent_type !== '' ? task.agent_type : task.type
  const words = task.description !== '' ? task.description : (task.command ?? '')
  return `${kind}: ${words.slice(0, 60)}`
}

/**
 * The work in hand after a Stop's report (martha#1000, gap 8 of #957): an agent keeps the host's own id, which is what a
 * later report's absence drops from the row; a background command the host follows by no id keeps none, as crew-code
 * kept it. One that was already in hand keeps the moment it was first in hand, so a re-read does not restamp it.
 */
export function theAgentsInHand(work: AWorkInHandReported, held: readonly AnAgentOnARow[], now: number): readonly AnAgentOnARow[] {
  return work.background_tasks.map((task) => {
    const id = task.type === 'subagent' ? task.id : ''
    const label = theLabelOf(task)
    const before = id === '' ? held.find((agent) => agent.id === '' && agent.label === label) : held.find((agent) => agent.id === id)
    return { id, label, started: before?.started ?? now }
  })
}

/** What a finished turn settles the row's state from (martha#1000, gap 8 of #957): what the member holds, and its last word. */
export interface WhatATurnEndsWith {
  /** The labels of the work in hand the host follows: an agent's, never a background command's (martha#169's rule). */
  readonly in_hand: readonly string[]
  /** The wait on a person the member declared, which only its own next report ends. */
  readonly waits: Waits | null
  /** The scheduled wake-ups the session still holds. */
  readonly wakeups: number
  /** The last line the turn ended with; '' for a turn that said nothing, and for a look between turns. */
  readonly answer: string
  /** Whether this member can put a question to the owner at all: a team crew's member asks its Supervisor instead. */
  readonly may_ask_the_owner: boolean
  /** Whether a label is a review's, as the crew's own review rule reads it (../run_reviews_on_the_review_model). */
  readonly is_a_review: (label: string) => boolean
}

/**
 * The state a finished turn settles to (martha#1000, gap 8 of #957, crew-code register.tsx:3904-3927): a question the
 * member can put to the owner is `needs-you`; a review in flight is `reviewing`; anything else in hand is `waiting`; and
 * nothing is `idle`. It is the launcher's word about a turn that is over, so a member that reported `working` and then
 * ended three turns reads what it holds, not what it said.
 *
 * It reads the work the host follows and the wait the member declared, and not the member's reported progress: Martha's
 * row carries that in its own fields, and a member that has not declared a wait on anyone holds no person up.
 */
export function theStateAFinishedTurnSettlesTo(at: WhatATurnEndsWith): State {
  if (at.answer.trimEnd().endsWith('?') && at.may_ask_the_owner) return 'needs-you'
  if (at.in_hand.some(at.is_a_review)) return 'reviewing'
  return at.in_hand.length > 0 || at.waits !== null || at.wakeups > 0 ? 'waiting' : 'idle'
}

/**
 * The state this session's row settles to, over what its own session holds (martha#1000, gap 8 of #957): the row's own
 * state while a turn runs, and the crew's settle otherwise. Only the work the host follows counts (martha#169): a
 * background command's end is named by nothing, so it would leave an idle member reading as a busy one.
 */
export function theStateThisSessionSettlesTo(
  own: TheSessionsOwnState,
  row: DashboardRow,
  session: string,
  answer: string,
  may_ask_the_owner: boolean,
  is_a_review: (label: string) => boolean,
): State {
  if (own.turn_running) return row.state
  const in_hand = (own.in_hand.get(session) ?? []).filter((agent) => agent.id !== '').map((agent) => agent.label)
  return theStateAFinishedTurnSettlesTo({ in_hand, waits: row.waits, wakeups: own.wakeups.get(session) ?? 0, answer, may_ask_the_owner, is_a_review })
}

/**
 * The row after a look between turns (martha#1000, gap 8 of #957): a row that says it is waiting or reviewing is settled
 * again when what it held is gone, and anything else is the member's own word and left alone (martha#169 review r=2: a
 * turn in hand is the member's own state, and a beat mid-turn has nothing truer to say about it).
 */
export function theRowSettledBetweenTurns(
  row: DashboardRow,
  own: TheSessionsOwnState,
  session: string,
  is_a_review: (label: string) => boolean,
): DashboardRow {
  if (own.turn_running || !holdsASettledWait(row.state)) return row
  const settled = theStateThisSessionSettlesTo(own, row, session, '', false, is_a_review)
  return settled === row.state ? row : { ...row, state: settled }
}

/**
 * The states a look between turns re-reads (martha#1000, gap 8 of #957): a row that says it is waiting or reviewing is
 * settled again when what it held is gone. Anything else is the member's own word — a turn in hand is its own state, and
 * the beat has nothing truer to say about it.
 */
export function holdsASettledWait(state: State): boolean {
  return state === 'waiting' || state === 'reviewing'
}

/** A field of an ask as text, trimmed; '' when it names none. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
