// The refresh flow, from the launcher's side: one question the mod asks, and the one act it is told to take (martha#255).
//
// This exists so the decision of when a member hands over is the core's and the mod's is only the hand: the mod asks
// what this session should do now, carrying what only the session knows (its context, the turn's last answer), and is
// answered with nothing, a prompt to submit, or a clear to run. Nothing here submits a prompt or clears a session.
//
// A flow is kept in the crew's own store, one file per member, and read back before every act, so a launcher that
// restarted carries on rather than starting again. Its phase is written onto the member's row as well, because the
// owner watches the dashboard and should not have to ask whether a refresh is in flight.

import { declareCrew, REFRESH_BETWEEN_TASKS, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, DocumentStore, HandoverStampStore, Stores } from '../host_contract/host_contract.ts'
import { keepTheMilestone, whatWasSent } from '../keep_the_ledger/keep_the_ledger.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { parkAMember, parkedPlace, theNewestHandover, theParkOf, type AHandover, type TheDeclaration } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { sendACrewMessage } from '../send_a_crew_message/send_a_crew_message.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { CREW_HANDOVER_WRITTEN, CREW_REFRESH_DECLINED, HANDOVERS_PLACE } from '../write_my_handover/write_my_handover.ts'
import {
  aDeclineIsAllowed,
  aFlowStalled,
  aFlowStarting,
  aRefreshIsDue,
  isAStorm,
  keepTheFlow,
  refreshesPlace,
  theFlowAbandoned,
  theFlowClearing,
  theFlowDeclined,
  theFlowOf,
  theFlowSentBack,
  theHandoverPrompt,
  theResumePrompt,
  theSendBackNote,
  theStormLine,
  whatBecameOfTheHandover,
  type ARefresh,
  type RefreshTrigger,
} from './refresh_a_member.ts'

/** What the mod asks the launcher for: what this session should do now (martha#255). */
export const THE_REFRESH_ASK = 'the_refresh_of_this_session'

/**
 * The act a session is told to take: nothing, one prompt, or the clear. The mod reads this one shape and does it.
 * `refresh` is the flow's phase for the member's row, written by the launcher in the same row write that carries the
 * context the session just reported — one write, because a second one in the same millisecond is refused as older.
 */
export type TheAct = { readonly act: 'none'; readonly refresh?: TheRowPhase } | { readonly act: 'prompt'; readonly text: string; readonly refresh?: TheRowPhase } | { readonly act: 'clear'; readonly refresh?: TheRowPhase }

/** What the member's row says about the flow: its phase, and why, in the owner's words. */
export interface TheRowPhase {
  readonly phase: string
  readonly reason: string
}

/** The act that does nothing, which is most of them. */
export const NO_ACT: TheAct = { act: 'none' }

/** What the mod reports with its question, and the launcher's own facts about this launch. */
export interface TheSessionsQuestion {
  readonly session_id: string
  /** The member's context as the host reports it, as a share of its limit. */
  readonly percent: number
  readonly cost_usd: number | null
  /** The turn that just ended, and the answer it ended with: '' at a session's start. */
  readonly turn_id: string
  readonly answer: string
  /** Whether this is the session's first question. */
  readonly at_start: boolean
}

/** Everything this flow is decided over: the crew's store, the member's row, and the declaration. */
export interface TheRefreshPlaces {
  readonly member: string
  readonly stores: Pick<Stores, 'crew'>
  readonly beats: DashboardStore
  readonly stamps?: HandoverStampStore
  readonly root: string
  readonly documents: DocumentStore
  readonly ledger: LedgerHost
  /** The share this member's session began at, by session id: the reference every threshold is measured from. */
  readonly began_at: Map<string, number>
}

/** The reason a flow the limit started carries, as the owner reads it on the row. */
const AT_THE_LIMIT = 'its context reached the handover limit'

/** The reason an after-a-task flow carries. */
const AFTER_A_TASK = 'its task finished and its context is large'

/** The reason a flow someone asked for carries. */
const SOMEONE_ASKED = 'the owner or the Supervisor asked for it'

/** Why a storm parks a member: in the owner's words, kept in the marker. */
const A_STORM_PARK = 'two refreshes inside the window: parked so it cannot loop'

/**
 * Answers the session's question: records what it said about itself on the row, carries a flow forward, and says the
 * one act. A store that refuses to answer is said on the row rather than read as "no flow": a member whose flow cannot
 * be read is never refreshed, and the owner is told why instead of watching a member that never hands over.
 */
export async function theRefreshAct(places: TheRefreshPlaces, question: TheSessionsQuestion): Promise<TheAct> {
  const settings = await settingsOrNull(places)
  if (settings === null) return NO_ACT
  const place = refreshesPlace(places)
  if ('refusal' in place) return saidOnTheRow(`its refresh flow cannot be read: ${place.refusal}`)
  const read = theFlowOf(place, places.member)
  if (read !== undefined && 'refusal' in read) return saidOnTheRow(read.refusal)
  const flow = read ?? undefined
  const beganAt = places.began_at.get(question.session_id) ?? placeBegan(places, question)
  const now = places.ledger.clock.now()
  if (flow !== undefined && (flow.phase === 'handing_over' || flow.phase === 'clearing')) {
    return await carryOn(places, place, flow, question, settings, now)
  }
  const finished = finishedReportIn(places)
  const due = aRefreshIsDue({
    percent: question.percent,
    started_at_percent: beganAt,
    finished_report: finished,
    refresh_between_tasks: settings.house_rules[REFRESH_BETWEEN_TASKS],
    parked: isParked(places),
    asked: aWaitingAsk(place, places.member) !== undefined,
    flow,
  })
  if (!due.due) return NO_ACT
  const starting = aFlowStarting({
    trigger: due.trigger,
    reason: reasonOf(due.trigger),
    at: now,
    started_at_percent: beganAt,
    percent: question.percent,
    asked_on: finished,
    refreshed_at: flow?.refreshed_at ?? [],
  })
  keepTheFlow(place, places.member, starting)
  // An ask someone made is consumed here, once: a member that has answered it is not asked again by the same one.
  if (due.trigger === 'asked') consumeTheAsk(place, places.member, now)
  return {
    act: 'prompt',
    text: theHandoverPrompt({ at_limit: due.trigger === 'at_the_limit', percent: question.percent }),
    refresh: { phase: 'handing_over', reason: starting.reason },
  }
}

/** A flow that is already running: the answer it was waiting for, the clear it was told, or the end its window brings. */
async function carryOn(
  places: TheRefreshPlaces,
  place: CrewPlace,
  flow: ARefresh,
  question: TheSessionsQuestion,
  settings: CrewSettings,
  now: number,
): Promise<TheAct> {
  if (flow.phase === 'clearing') {
    // The successor's first question is the one that resumes it, and the flow is over once it has.
    if (flow.clear_from !== '' && question.session_id !== flow.clear_from && question.at_start) return await resume(places, place, flow, now)
    if (aFlowStalled(flow, now)) return abandon(places, place, flow, 'the clear never produced a new session', now)
    return NO_ACT
  }
  if (aFlowStalled(flow, now)) return abandon(places, place, flow, 'no answer to the handover ask', now)
  const answer = question.answer
  if (answer.includes(CREW_REFRESH_DECLINED)) return declined(places, place, flow, answer, now)
  if (!answer.includes(CREW_HANDOVER_WRITTEN)) return NO_ACT
  const newest = theMembersNewestHandover(places)
  const judged = whatBecameOfTheHandover({
    stamp: newest === undefined || 'refusal' in newest ? newest : stampOf(places, newest.file),
    text: newest === undefined || 'refusal' in newest ? '' : newest.content,
    asked_at: flow.asked_at,
    holds: holdsOf(places),
    sent_back: flow.sent_back,
    at_limit: flow.trigger === 'at_the_limit',
  })
  if (judged.kind === 'sent_back') return sentBack(places, place, flow, judged.missing, now)
  if (judged.kind === 'not_written') {
    if (flow.sent_back >= 1) return abandon(places, place, flow, judged.why, now)
    return sentBack(places, place, flow, [judged.why], now)
  }
  // Accepted, or accepted with gaps at the limit and on a second miss: the row says what was missing either way.
  const missing = judged.missing
  if (isAStorm(flow.refreshed_at, now)) parkForTheStorm(places, flow, settings, now)
  keepTheFlow(place, places.member, theFlowClearing({ ...flow, refreshed_at: [...flow.refreshed_at, now] }, question.session_id, missing, now))
  return {
    act: 'clear',
    refresh: {
      phase: 'clearing',
      reason: missing.length === 0 ? 'its handover was written; clearing' : `clearing; its handover was missing ${missing.join('; ')}`,
    },
  }
}

/** The successor: handed its handover's file and the acts of its package that were sent and never concluded. */
async function resume(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, now: number): Promise<TheAct> {
  const newest = theMembersNewestHandover(places)
  const file = newest === undefined || 'refusal' in newest ? 'no handover the store would read' : newest.file
  const held = places.beats.read(places.member)?.holds ?? ''
  const acts = held === '' ? [] : await theActsLeftOpen(places, held)
  keepTheFlow(place, places.member, theFlowAbandoned(flow, 'resumed at a new session', now))
  return { act: 'prompt', text: theResumePrompt({ member: places.member, file, acts }), refresh: { phase: 'resumed', reason: `resumed from ${file}` } }
}

/** The acts of `package` that were sent and never concluded, as the ledger's own line names them. */
async function theActsLeftOpen(places: TheRefreshPlaces, package_name: string): Promise<readonly string[]> {
  try {
    const sent = await whatWasSent(places.ledger, package_name)
    return sent.acts.map((awaiting) => `${awaiting.act.kind} (${awaiting.act.what}) at row ${awaiting.announced_at}`)
  } catch {
    return []
  }
}

/** Sends a handover back once with what was missing, and asks for it again. */
function sentBack(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, missing: readonly string[], now: number): TheAct {
  keepTheFlow(place, places.member, theFlowSentBack(flow, missing, now))
  return { act: 'prompt', text: theSendBackNote(missing), refresh: { phase: 'handing_over', reason: `sent back: ${missing.join('; ')}` } }
}

/** The member's own decline: kept with its ground, and never honoured when someone else asked for the refresh. */
function declined(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, answer: string, now: number): TheAct {
  const ground = answer.slice(answer.indexOf(CREW_REFRESH_DECLINED) + CREW_REFRESH_DECLINED.length).trim().replace(/^[:\s-]+/, '')
  const said = ground === '' ? 'it gave no ground' : ground
  if (!aDeclineIsAllowed(flow.trigger)) return abandon(places, place, flow, `declined a refresh that was asked for: ${said}`, now)
  keepTheFlow(place, places.member, theFlowDeclined(flow, said, now))
  return { act: 'none', refresh: { phase: 'declined', reason: `declined: ${said}` } }
}

/** Ends a flow with its reason, on the row and in the store, and tells the member nothing. */
function abandon(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, why: string, now: number): TheAct {
  keepTheFlow(place, places.member, theFlowAbandoned(flow, why, now))
  return { act: 'none', refresh: { phase: 'abandoned', reason: why } }
}

/** Parks the member a storm would loop, and says one line about it in the crew's own channel. */
function parkForTheStorm(places: TheRefreshPlaces, flow: ARefresh, settings: CrewSettings, now: number): void {
  const declaration: TheDeclaration = { members: settings.members.map((one) => ({ name: one.name, role: one.role })), mode: { may: settings.mode.may } }
  parkAMember(places, { actor: places.member, member: places.member, reason: A_STORM_PARK, at: new Date(now), declaration })
  const supervisor = settings.members.find((one) => one.role === 'supervisor')
  if (supervisor === undefined) return
  const newest = theMembersNewestHandover(places)
  const file = newest === undefined || 'refusal' in newest ? 'no handover the store would read' : newest.file
  const line = theStormLine({ member: places.member, percents: [...flow.refreshed_at.map(() => flow.percent), flow.percent], file })
  // The line is kept in the ledger as well as sent, so a Supervisor that was not listening still reads it.
  void keepTheMilestone(places.ledger, { package: places.beats.read(places.member)?.holds ?? '', member: places.member, event: 'checkpoint', note: line })
  void sendACrewMessage(places.ledger, {
    member: places.member,
    roster: settings.members.map((one) => one.name),
    package: places.beats.read(places.member)?.holds ?? null,
    to: [supervisor.name],
    text: line,
  })
}

/** The member's newest handover, read by the host's stamp, or undefined when the store holds none. */
function theMembersNewestHandover(places: TheRefreshPlaces): AHandover | { readonly refusal: string } | undefined {
  const place = places.stores.crew.place(HANDOVERS_PLACE)
  if ('refusal' in place) return place
  if (places.stamps === undefined) return undefined
  const newest = theNewestHandover(place, places.stamps, places.member)
  if (newest.kind === 'a_handover') return newest.handover
  return newest.kind === 'unreadable' ? { refusal: newest.refusal } : undefined
}

/** The stamp the host kept for `file`, or undefined when it kept none. */
function stampOf(places: TheRefreshPlaces, file: string): HandoverStampStore['read'] extends (file: string) => infer R ? R : never {
  return places.stamps === undefined ? undefined : places.stamps.read(file)
}

/** The packages the member's row says it holds: the lines a handover must carry. */
function holdsOf(places: TheRefreshPlaces): readonly string[] {
  const held = places.beats.read(places.member)?.holds ?? ''
  return held === '' ? [] : [held]
}

/** The report that finished a task, named so one finished task is asked once: '' when the row shows none finished. */
function finishedReportIn(places: TheRefreshPlaces): string {
  const row = places.beats.read(places.member)
  if (row === null || row.progress.of < 1 || row.progress.step < row.progress.of) return ''
  return `${row.task}@${row.at}`
}

/** Whether the member is parked, as the store answers it; a store that will not answer is not "not parked". */
function isParked(places: TheRefreshPlaces): boolean {
  const place = parkedPlace(places)
  if ('refusal' in place) return true
  return theParkOf(place, places.member).kind !== 'not_parked'
}

/** The share this session began at: the first reading this launcher took of it. */
function placeBegan(places: TheRefreshPlaces, question: TheSessionsQuestion): number {
  places.began_at.set(question.session_id, question.percent)
  return question.percent
}

/** The reason an ask someone made is waiting, or undefined: the file is one per member, written whole. */
function aWaitingAsk(place: CrewPlace, member: string): string | undefined {
  return askIn(place, member)?.reason
}

/** The ask waiting for this member, when one is: `seen_at` 0 means nobody has taken it up yet. */
function askIn(place: CrewPlace, member: string): { readonly reason: string } | undefined {
  const read = place.read(`${member}.asked.json`)
  if (read === undefined || 'refusal' in read) return undefined
  try {
    const asked = JSON.parse(read.text) as { readonly reason?: unknown; readonly seen_at?: unknown }
    return typeof asked.reason === 'string' && asked.seen_at === 0 ? { reason: asked.reason } : undefined
  } catch {
    return undefined
  }
}

/** Takes up the ask waiting for this member, once: the file is kept, with the moment it was taken, never deleted. */
export function consumeTheAsk(place: CrewPlace, member: string, now: number): void {
  const waiting = askIn(place, member)
  if (waiting === undefined) return
  place.keep(`${member}.asked.json`, `${JSON.stringify({ reason: waiting.reason, asked_at: now, seen_at: now })}\n`)
}

/**
 * Asks a member to refresh, as the owner or the Supervisor's tool does: the file the member's flow takes up. A member
 * may ask itself too — the crew's practice has the Supervisor tell a member to refresh, and the member call the tool.
 */
export function askAMemberToRefresh(host: { readonly stores: Pick<Stores, 'crew'> }, member: string, reason: string, at: number): { readonly refusal: string } | undefined {
  const place = refreshesPlace(host)
  if ('refusal' in place) return place
  return place.keep(`${member}.asked.json`, `${JSON.stringify({ reason, asked_at: at, seen_at: 0 })}\n`)
}

/** The reason a flow of this trigger carries, as the row says it. */
function reasonOf(trigger: RefreshTrigger): string {
  if (trigger === 'at_the_limit') return AT_THE_LIMIT
  if (trigger === 'after_a_task') return AFTER_A_TASK
  return SOMEONE_ASKED
}

/** Says on the row why a refresh cannot run, and tells the session nothing to do. */
function saidOnTheRow(why: string): TheAct {
  return { act: 'none', refresh: { phase: 'abandoned', reason: why } }
}

/** The declaration this flow is decided over, or null when it cannot be read (the row then says nothing new). */
async function settingsOrNull(places: TheRefreshPlaces): Promise<CrewSettings | null> {
  try {
    return await declareCrew(places.documents, places.root)
  } catch {
    return null
  }
}
