// The refresh flow, from the launcher's side: one question the mod asks, and the one act it is told to take (martha#255).
//
// This exists so the decision of when a member hands over is the core's and the mod's is only the hand: the mod asks
// what this session should do now, carrying what only the session knows (its context, the turn's last answer), and is
// answered with nothing, a prompt to submit, or a clear to run. Nothing here submits a prompt or clears a session.
//
// A flow is kept in the crew's own store, one file per member, and read back before every act, so a launcher that
// restarted carries on rather than starting again. Its phase is written onto the member's row as well, because the
// owner watches the dashboard and should not have to ask whether a refresh is in flight.

import { declareCrew, MINUTE_MS, REFRESH_BETWEEN_TASKS, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, DocumentStore, HandoverStampStore, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { keepTheMilestone, whatWasSent } from '../keep_the_ledger/keep_the_ledger.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import type { TheEndsHold } from './hold_the_end.ts'
import { announceAct, concludeAct, REFRESH_FORCED, type LedgerHost, type Outcome } from '../log_ledger/log_ledger.ts'
import { parkAMember, parkedPlace, theNewestHandover, theParkOf, type AHandover, type TheDeclaration } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { sendACrewMessage } from '../send_a_crew_message/send_a_crew_message.ts'
import { OWNER_DIALOGS_FIELD, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { CREW_HANDOVER_WRITTEN, CREW_REFRESH_DECLINED, HANDOVERS_PLACE } from '../write_my_handover/write_my_handover.ts'
import {
  aDeclineIsAllowed,
  anEndIsDue,
  anEndOutlived,
  LIVE_PHASES,
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
  theEndAnnounced,
  theEndLine,
  theFlowEnded,
  theFlowEndExpired,
  theFlowEnding,
  theFlowGivenUp,
  theFlowNotEnded,
  theGiveUpLine,
  theHandoverPrompt,
  theAskedLine,
  theLimitLine,
  theResumePrompt,
  theSendBackNote,
  theStormLine,
  whatBecameOfTheHandover,
  type ARefresh,
  type AnEndPending,
  type Due,
  type HandoverVerdict,
  type RefreshTrigger,
} from './refresh_a_member.ts'

/** What the mod asks the launcher for: what this session should do now (martha#255). */
export const THE_REFRESH_ASK = 'the_refresh_of_this_session'

/**
 * The act a session is told to take: nothing, one prompt, or the clear. The mod reads this one shape and does it.
 * `refresh` is the flow's phase for the member's row, written by the launcher in the same row write that carries the
 * context the session just reported — one write, because a second one in the same millisecond is refused as older.
 */
export type TheAct =
  | { readonly act: 'none'; readonly refresh?: TheRowPhase }
  | { readonly act: 'prompt'; readonly text: string; readonly refresh?: TheRowPhase }
  | { readonly act: typeof CARRY_THE_CLEAR; readonly refresh?: TheRowPhase }
  | { readonly act: typeof CARRY_THE_END; readonly turn_id: string; readonly refresh?: TheRowPhase }

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
  /**
   * Whether the question comes from the mod's beat while the main turn runs (martha#311), rather than from a turn's end
   * or a session's start. `turn_id` is then the running turn's, kept by the mod from that turn's start.
   */
  readonly turn_running: boolean
}

/** The host's own reading of a session (martha#255), as the mod hands it over untouched. */
interface AHostsUsage {
  readonly context?: { readonly percent?: number | null }
  readonly cost?: { readonly usd?: number | null }
}

/** The host's usage, read as the object it is, or undefined when what arrived is not one. */
function usageIn(args: Readonly<Record<string, unknown>>): AHostsUsage | undefined {
  const usage = args['usage']
  return typeof usage === 'object' && usage !== null ? (usage as AHostsUsage) : undefined
}

/**
 * A share of the context limit as the host reports it, or 0 when it reports none this launcher can trust (martha#255).
 * The host's own number is taken as it comes: a session that says nothing about its context has not reached a limit.
 */
function aPercentOf(usage: AHostsUsage | undefined): number {
  const percent = usage?.context?.percent
  return typeof percent === 'number' && Number.isFinite(percent) ? percent : 0
}

/** What the session has cost as the host reports it, or null when it reports nothing this launcher can trust. */
function aCostOf(usage: AHostsUsage | undefined): number | null {
  const cost = usage?.cost?.usd
  return typeof cost === 'number' ? cost : null
}

/** What each field of the question must be, and what is said when it is not: read in order, the first miss refused. */
const QUESTION_FIELDS: readonly ((args: Readonly<Record<string, unknown>>) => string | undefined)[] = [
  (args) => (typeof args['turn_id'] === 'string' && typeof args['answer'] === 'string' ? undefined : 'the refresh question carries no turn, or no answer for one'),
  // The beat's mark (martha#311): 1 while the main turn runs, and nothing else; a mod sending another value is not one
  // this launcher reads, and a beat read as a turn's end would judge the stall the beat must not.
  (args) => (args['turn_running'] === undefined || args['turn_running'] === 1 ? undefined : 'the refresh question marks a running turn with something other than 1'),
]

/** The question the refresh flow is answered on, read strictly: a shape this launcher does not know is refused. */
export function theQuestionIn(args: Readonly<Record<string, unknown>>, session_id: string): TheSessionsQuestion | string {
  const refused = QUESTION_FIELDS.map((holds) => holds(args)).find((said) => said !== undefined)
  if (refused !== undefined) return refused
  const usage = usageIn(args)
  const turn_id = args['turn_id'] as string
  // At a session's start the host stamps no turn, which is the one reading of "first question" there is (martha#255):
  // the mod reported the empty turn before, and now says nothing about it that could disagree with its own turn id.
  return { session_id, percent: aPercentOf(usage), cost_usd: aCostOf(usage), turn_id, answer: args['answer'] as string, at_start: turn_id === '', turn_running: args['turn_running'] === 1 }
}

/** Everything this flow is decided over: the crew's store, the member's row, and the declaration. */
export interface TheRefreshPlaces {
  readonly member: string
  readonly stores: TheCrewFilesStores
  readonly beats: DashboardStore
  readonly stamps?: HandoverStampStore
  readonly root: string
  readonly documents: DocumentStore
  /** The models the host runs (martha#315), which the declaration is read back against. */
  readonly models: readonly string[]
  readonly ledger: LedgerHost
  /** The share this member's session began at, by session id: the reference every threshold is measured from. */
  readonly began_at: Map<string, number>
  /** The end of a running turn as the launcher holds it at a tool boundary (martha#311, ruling D). */
  readonly ends: TheEndsHold
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
  if (!question.turn_running) places.ends.aTurnEnded(question.session_id, question.turn_id)
  const opened = await theOpenFlow(places)
  if ('act' in opened) return opened.act
  const beganAt = places.began_at.get(question.session_id) ?? placeBegan(places, question)
  const now = places.ledger.clock.now()
  const flow = opened.flow
  if (flow !== undefined && LIVE_PHASES.includes(flow.phase)) {
    return await carryOn(places, opened.place, flow, question, opened.settings, now)
  }
  if (heldByTheTurnItGaveUpOn(flow, question)) return NO_ACT
  const due = theDueOf(places, question, opened, beganAt)
  if (!due.due) return NO_ACT
  return startTheFlow(places, opened.place, due, question, flow, beganAt, now)
}

/** What a question is answered over: the member's flow as the store keeps it, the place it is kept in, and the crew. */
interface AnOpenFlow {
  readonly place: CrewPlace
  readonly flow: ARefresh | undefined
  readonly settings: CrewSettings
}

/** The member's flow, or the act that says why the store could not be read — never a flow read as absent. */
async function theOpenFlow(places: TheRefreshPlaces): Promise<AnOpenFlow | { readonly act: TheAct }> {
  const settings = await settingsOrNull(places)
  if (settings === null) return { act: NO_ACT }
  const place = refreshesPlace(places)
  if ('refusal' in place) return { act: saidOnTheRow(`its refresh flow cannot be read: ${place.refusal}`) }
  const read = theFlowOf(place, places.member)
  if (read !== undefined && 'refusal' in read) return { act: saidOnTheRow(read.refusal) }
  return { place, flow: read, settings }
}

/** Whether a refresh is due, over what this session reported and what the launcher knows of it. */
function theDueOf(places: TheRefreshPlaces, question: TheSessionsQuestion, opened: AnOpenFlow, beganAt: number): Due {
  return aRefreshIsDue({
    percent: question.percent,
    started_at_percent: beganAt,
    finished_report: finishedReportIn(places),
    refresh_between_tasks: opened.settings.house_rules[REFRESH_BETWEEN_TASKS],
    parked: isParked(places),
    asked: aWaitingAsk(opened.place, places.member) !== undefined,
    flow: opened.flow,
  })
}

/** The flow a due ask begins: kept whole, and the ask that started it taken up, once. */
function startTheFlow(
  places: TheRefreshPlaces,
  place: CrewPlace,
  due: { readonly due: true; readonly trigger: RefreshTrigger },
  question: TheSessionsQuestion,
  previous: ARefresh | undefined,
  beganAt: number,
  now: number,
): TheAct {
  const starting = aFlowStarting({
    trigger: due.trigger,
    reason: reasonOf(due.trigger),
    at: now,
    started_at_percent: beganAt,
    percent: question.percent,
    asked_on: finishedReportIn(places),
    refreshed_at: previous === undefined ? [] : previous.refreshed_at,
    // A decline ends its flow, so a member that keeps declining at the limit would be a line per ask. The flow that
    // follows a decline carries whether the Supervisor was told, and the clear, which ends a flow by `resumed`, resets it.
    told: previous?.phase === 'declined' && previous.told,
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
  if (flow.phase === 'clearing') return await carryTheClear(places, place, flow, question, settings, now, aFlowStalled(flow, now))
  const current = await withAnOutlivedEndDropped(places, place, flow, question, settings, now)
  if (theEndedTurnIsTheOneHeld(current, question)) return await concludeTheEnd(places, place, current, settings, now)
  return await carryTheHandover(places, place, current, question, settings, now)
}

/** The flow that was given up on this very turn holds a new one back until another turn runs (martha#311). */
function heldByTheTurnItGaveUpOn(flow: ARefresh | undefined, question: TheSessionsQuestion): boolean {
  return flow?.gave_up_on !== undefined && flow.gave_up_on !== '' && flow.gave_up_on === question.turn_id
}

/** The crew's ceiling in milliseconds: how long a handover waits behind a running turn (martha#311). */
const ceilingOf = (settings: CrewSettings): number => settings.handover_ceiling_minutes * MINUTE_MS

/**
 * The flow with a pending end dropped when it no longer holds. A new session started (design 3d): the act stays open,
 * so the successor checks it. Or the end is a ceiling old, held behind a tool that never finished (ruling D): it is
 * concluded as blocked and spends one end, so a flow behind a hung tool is given up rather than ended forever.
 */
async function withAnOutlivedEndDropped(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, question: TheSessionsQuestion, settings: CrewSettings, now: number): Promise<ARefresh> {
  if (flow.ending === undefined) return flow
  const hold = anEndOutlived(flow.ending, { now, ceiling_ms: ceilingOf(settings), at_start: question.at_start })
  if (hold === 'holds') return flow
  if (hold === 'expired') places.ends.anEndExpired(question.session_id)
  if (hold === 'expired') await concludeTheEndsAct(places, flow.ending, { succeeded: false, detail: A_TOOL_WAS_STILL_RUNNING })
  const dropped = hold === 'expired' ? theFlowEndExpired(flow, now) : theFlowNotEnded(flow)
  keepTheFlow(place, places.member, dropped)
  return dropped
}

/**
 * Whether the turn that just ended is the one an end is held on (placement ruling on martha#311): the turn's own end
 * is the outcome, so the mod reports none. A beat, a start, or a subagent's turn ending is never it.
 */
function theEndedTurnIsTheOneHeld(flow: ARefresh, question: TheSessionsQuestion): flow is ARefresh & { readonly ending: AnEndPending } {
  return flow.ending !== undefined && !question.turn_running && question.turn_id === flow.ending.turn_id
}

/**
 * The end, concluded when the turn it was held on ended (design §5): ended whether the abort landed or the turn ended
 * first, and counted. It restarts the stall window (3b) and sends the Supervisor one line. An abort the host refused
 * while the turn ran ends nothing, and the end expires a ceiling on (ruling D).
 */
async function concludeTheEnd(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh & { readonly ending: AnEndPending }, settings: CrewSettings, now: number): Promise<TheAct> {
  const pending = flow.ending
  await concludeTheEndsAct(places, pending, { succeeded: true, detail: THE_TURN_ENDED })
  keepTheFlow(place, places.member, theFlowEnded(flow, now))
  sayToTheSupervisor(places, settings, theEndLine({ member: places.member, what: pending.what }))
  return { act: 'none', refresh: { phase: 'handing_over', reason: `its running turn was ended so its handover can run (${pending.what})` } }
}

/** Concludes the end's ledger act, when one was announced; an outcome the store will not keep leaves the act open. */
async function concludeTheEndsAct(places: TheRefreshPlaces, pending: AnEndPending, outcome: Outcome): Promise<void> {
  if (pending.ledger_row === null) return
  const work = { package: pending.ledger_row.package, member: places.member }
  await concludeAct(places.ledger, { ...work, announced_at: pending.ledger_row.at, outcome }).catch(() => undefined)
}

/**
 * A beat while the handover waits behind the running turn (design §2): nothing, the end of that turn, or the flow given
 * up when its ends are spent. The beat never judges the stall (3c).
 */
async function theEndOfTheRunningTurn(
  places: TheRefreshPlaces,
  place: CrewPlace,
  flow: ARefresh,
  question: TheSessionsQuestion,
  settings: CrewSettings,
  now: number,
): Promise<TheAct> {
  const end = anEndIsDue({ turn_id: question.turn_id, flow, dialogs_open: dialogsOpen(places), percent: question.percent, now, ceiling_ms: ceilingOf(settings) })
  if (end.kind === 'none') return NO_ACT
  if (end.kind === 'give_up') return giveUp(places, place, flow, { why: end.why, turn_id: question.turn_id }, settings, now)
  return await announceTheEnd(places, place, flow, { session_id: question.session_id, turn_id: question.turn_id, what: theEndAnnounced(end) }, now)
}

/** How many dialogs the member's row holds open for the owner: the host's word, never the row's working state. */
function dialogsOpen(places: TheRefreshPlaces): number {
  return places.beats.read(places.member)?.[OWNER_DIALOGS_FIELD]?.length ?? 0
}

/** The flow given up once its ends are spent: the Supervisor told once, and no new flow on the same turn. */
function giveUp(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, spent: { readonly why: string; readonly turn_id: string }, settings: CrewSettings, now: number): TheAct {
  const told = tellTheSupervisor(places, place, flow, settings, theGiveUpLine({ member: places.member, why: spent.why }))
  const given = theFlowGivenUp(told, spent.why, spent.turn_id, now)
  keepTheFlow(place, places.member, given)
  return { act: 'none', refresh: { phase: 'abandoned', reason: given.reason } }
}

/**
 * The end, announced before it is ordered (design §5): its ledger row first, in the package the member holds, then the
 * pending end in the flow, then the order. A store that will not keep the row gives no order, and the next beat tries
 * again; a flow that cannot be kept concludes the row as not sent.
 */
async function announceTheEnd(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, end: { readonly session_id: string; readonly turn_id: string; readonly what: string }, now: number): Promise<TheAct> {
  const ledger_row = await announceTheEndsAct(places, end.what)
  if (ledger_row === undefined) return NO_ACT
  const pending: AnEndPending = { turn_id: end.turn_id, announced: now, what: end.what, ledger_row }
  const refused = keepTheFlow(place, places.member, theFlowEnding(flow, pending))
  if (refused !== undefined) {
    await concludeTheEndsAct(places, pending, { succeeded: false, detail: `the flow could not be kept, so the turn was not ended: ${refused.refusal}` })
    return NO_ACT
  }
  const refresh = { phase: 'handing_over', reason: `ending its running turn so its handover can run (${end.what})` } as const
  // Held from here on, in the step that looks at what is in flight: carried now, or on the yes to the last call.
  return places.ends.hold(end.session_id, end.turn_id) === 'now' ? { act: CARRY_THE_END, turn_id: end.turn_id, refresh } : { act: 'none', refresh }
}

/** The end's ledger row: null when the member holds no package, undefined when the store would not keep it. */
async function announceTheEndsAct(places: TheRefreshPlaces, what: string): Promise<AnEndPending['ledger_row'] | undefined> {
  const held = places.beats.read(places.member)?.holds ?? ''
  if (held === '') return null
  try {
    return { package: held, at: await announceAct(places.ledger, { package: held, member: places.member, act: { kind: REFRESH_FORCED, what } }) }
  } catch {
    return undefined
  }
}

/** A flow whose clear was told: the successor's first question resumes it, and a clear that never made one is abandoned. */
async function carryTheClear(
  places: TheRefreshPlaces,
  place: CrewPlace,
  flow: ARefresh,
  question: TheSessionsQuestion,
  settings: CrewSettings,
  now: number,
  stalled: boolean,
): Promise<TheAct> {
  const aSuccessorAsks = flow.clear_from !== '' && question.session_id !== flow.clear_from && question.at_start
  if (aSuccessorAsks) return await resume(places, place, flow, now)
  if (stalled) return abandon(places, place, flow, 'the clear never produced a new session', now, settings)
  return NO_ACT
}

/**
 * A flow that is handing over: the member's answer to the ask, judged first (design 3a), so the window never throws a
 * written handover away; then the beat's end of the running turn; and only at a turn's end or a start, with no end
 * pending, the stall window (3c, 3d).
 */
async function carryTheHandover(
  places: TheRefreshPlaces,
  place: CrewPlace,
  flow: ARefresh,
  question: TheSessionsQuestion,
  settings: CrewSettings,
  now: number,
): Promise<TheAct> {
  const answer = question.answer
  if (answer.includes(CREW_REFRESH_DECLINED)) return declined(places, place, flow, answer, settings, now)
  if (answer.includes(CREW_HANDOVER_WRITTEN)) return theWrittenHandover(places, place, flow, question, settings, now)
  if (question.turn_running) return await theEndOfTheRunningTurn(places, place, flow, question, settings, now)
  if (flow.ending === undefined && aFlowStalled(flow, now)) return abandon(places, place, flow, 'no answer to the handover ask', now, settings)
  return NO_ACT
}

/** A handover the member says it wrote: accepted and cleared, sent back once, or abandoned. */
function theWrittenHandover(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, question: TheSessionsQuestion, settings: CrewSettings, now: number): TheAct {
  const judged = theJudgementOf(places, flow)
  if (judged.kind === 'sent_back') return sentBack(places, place, flow, judged.missing, now)
  if (judged.kind === 'not_written') return sentBackOnceOrAbandoned(places, place, flow, judged.why, now, settings)
  return clearTheSession(places, place, flow, question, settings, judged.missing, now)
}

/** What the handover the member just wrote is: accepted, sent back with what was missing, or cleared anyway. */
function theJudgementOf(places: TheRefreshPlaces, flow: ARefresh): HandoverVerdict {
  const newest = theMembersNewestHandover(places)
  const unread = newest === undefined || 'refusal' in newest
  return whatBecameOfTheHandover({
    stamp: unread ? newest : stampOf(places, newest.file),
    text: unread ? '' : newest.content,
    asked_at: flow.asked_at,
    holds: holdsOf(places),
    sent_back: flow.sent_back,
    at_limit: flow.trigger === 'at_the_limit',
  })
}

/** A handover that was never written: sent back once, and abandoned the second time, with the reason on the row. */
function sentBackOnceOrAbandoned(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, why: string, now: number, settings: CrewSettings): TheAct {
  return flow.sent_back >= 1 ? abandon(places, place, flow, why, now, settings) : sentBack(places, place, flow, [why], now)
}

/** The clear itself, with the row saying what the handover was missing — and the storm that parks a member that loops. */
function clearTheSession(
  places: TheRefreshPlaces,
  place: CrewPlace,
  flow: ARefresh,
  question: TheSessionsQuestion,
  settings: CrewSettings,
  missing: readonly string[],
  now: number,
): TheAct {
  if (isAStorm(flow.refreshed_at, now)) parkForTheStorm(places, flow, settings, now)
  const cleared = theFlowClearing({ ...flow, refreshed_at: [...flow.refreshed_at, now] }, question.session_id, missing, now)
  keepTheFlow(place, places.member, cleared)
  return {
    act: CARRY_THE_CLEAR,
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

/**
 * The member's own decline: kept with its ground, never honoured when someone else asked for the refresh, and said once
 * to the Supervisor when it was taken at the limit.
 */
function declined(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, answer: string, settings: CrewSettings, now: number): TheAct {
  const ground = answer.slice(answer.indexOf(CREW_REFRESH_DECLINED) + CREW_REFRESH_DECLINED.length).trim().replace(/^[:\s-]+/, '')
  const said = ground === '' ? 'it gave no ground' : ground
  if (!aDeclineIsAllowed(flow.trigger)) return abandon(places, place, flow, `declined a refresh that was asked for: ${said}`, now, settings)
  // A decline at the limit is the member saying it cannot reach a safe point at all, and the Supervisor hears it once:
  // the design's row and one line, not a line per turn.
  const ended =
    flow.trigger === 'at_the_limit' && !flow.told
      ? tellTheSupervisor(places, place, flow, settings, theLimitLine({ member: places.member, percent: flow.percent, said }))
      : flow
  keepTheFlow(place, places.member, theFlowDeclined(ended, said, now))
  return { act: 'none', refresh: { phase: 'declined', reason: `declined: ${said}` } }
}

/**
 * Ends a flow with its reason, on the row and in the store, and tells the member nothing. A refresh someone asked for
 * that ends here is the member failing to write the handover an instruction needed, so the Supervisor is told once.
 */
function abandon(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, why: string, now: number, settings: CrewSettings): TheAct {
  const ended =
    flow.trigger === 'asked' && !flow.told
      ? tellTheSupervisor(places, place, flow, settings, theAskedLine({ member: places.member, why }))
      : flow
  keepTheFlow(place, places.member, theFlowAbandoned(ended, why, now))
  return { act: 'none', refresh: { phase: 'abandoned', reason: why } }
}

/**
 * Says one line to the crew's supervisor, once per flow: the flow is kept with `told` before anything is sent, so a
 * second ask in the same flow sends nothing more, and the line is kept in the ledger as well, so a Supervisor that was
 * not listening still reads it. A crew with no such member keeps the row and sends nothing.
 */
function tellTheSupervisor(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, settings: CrewSettings, line: string): ARefresh {
  const told = { ...flow, told: true }
  keepTheFlow(place, places.member, told)
  sayToTheSupervisor(places, settings, line)
  return told
}

/**
 * One line to the member whose role is `supervisor`, on the crew's channel and in the ledger of the package the member
 * holds. A crew with no such member sends nothing: the row still says what happened.
 */
function sayToTheSupervisor(places: TheRefreshPlaces, settings: CrewSettings, line: string): void {
  const supervisor = settings.members.find((one) => one.role === SUPERVISOR)
  if (supervisor === undefined) return
  const held = places.beats.read(places.member)?.holds ?? ''
  // A milestone is kept in the ledger of the package the member holds, and a member that holds none has no ledger to
  // keep it in: the line still goes on the channel.
  if (held !== '') void keepTheMilestone(places.ledger, { package: held, member: places.member, event: 'checkpoint', note: line })
  void sendACrewMessage(places.ledger, {
    member: places.member,
    roster: settings.members.map((one) => one.name),
    package: held === '' ? null : held,
    to: [supervisor.name],
    text: line,
  })
}

/** Parks the member a storm would loop, and says one line about it in the crew's own channel. */
function parkForTheStorm(places: TheRefreshPlaces, flow: ARefresh, settings: CrewSettings, now: number): void {
  const declaration: TheDeclaration = { members: settings.members.map((one) => ({ name: one.name, role: one.role })), mode: { may: settings.mode.may } }
  parkAMember(places, { actor: places.member, member: places.member, reason: A_STORM_PARK, at: new Date(now), declaration })
  const newest = theMembersNewestHandover(places)
  const file = newest === undefined || 'refusal' in newest ? 'no handover the store would read' : newest.file
  sayToTheSupervisor(places, settings, theStormLine({ member: places.member, percents: [...flow.refreshed_at.map(() => flow.percent), flow.percent], file }))
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
  // The task, and nothing that moves when the row is written again: `at` is rewritten by every question the mod asks, so
  // a name carrying it named a different report every turn. Only a report that names another task changes this one.
  return row.task
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
export function askAMemberToRefresh(host: { readonly stores: TheCrewFilesStores }, member: string, reason: string, at: number): { readonly refusal: string } | undefined {
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
    return await declareCrew(places.documents, places.root, places.models)
  } catch {
    return null
  }
}

/**
 * The word an order carries a text under (martha#255): the one the mod answers by submitting it as a prompt.
 *
 * The mod holds no import of the core — the host installs it as a copy of its own folder — so its copy of this word is
 * declared an exception in src/check_no_literal_restates_a_value/exceptions.ts, and a reworded order makes that entry
 * stale and the gate red by name (r=2 R1).
 */
export const CARRY_A_TEXT = 'submit'

/** The word an order carries the clear under (martha#255): the one the mod answers by clearing the session. */
export const CARRY_THE_CLEAR = 'clear'

/**
 * The word an order carries a model under (martha#315): the one the mod answers by running the host's own model command
 * with the model the order names, once the turn has ended. A switch cannot run inside the turn whose tool call asked for
 * it, so it waits for this order, which the mod already asks for at every turn's end.
 */
export const CARRY_A_MODEL = 'model'

/**
 * The word an order carries the end of the running turn under (martha#311): the one the mod answers by asking the host
 * to end the turn the order names. It reports no outcome: the flow concludes the end from that turn's own end. The core
 * decides when; every host's mod must carry this word, and the mod's copy is declared in
 * src/check_no_literal_restates_a_value/exceptions.ts.
 */
export const CARRY_THE_END = 'end_the_turn'

/** What an end is concluded with once the turn it was held on ended (martha#311). */
export const THE_TURN_ENDED = 'turn_ended'

/** What an end the mod held for a ceiling behind a running tool is concluded with (ruling D on martha#311). */
export const A_TOOL_WAS_STILL_RUNNING = 'a tool was still running'

/**
 * The order the mod carries out (martha#255): the one thing it is told to do, and the text for the one that needs
 * it. It is answered in place of the act, so the mod reads three words and decides nothing.
 *
 * The third word, `'none'`, is spelled out here rather than held as a constant: see `theOrderOf`.
 */
export type TheOrder =
  | { readonly carry: typeof CARRY_A_TEXT; readonly text: string }
  | { readonly carry: typeof CARRY_THE_CLEAR }
  | { readonly carry: typeof CARRY_A_MODEL; readonly model: string }
  | { readonly carry: typeof CARRY_THE_END; readonly turn_id: string }
  | { readonly carry: 'none' }

/**
 * The act as the order the mod runs: a prompt is a text to submit, a clear is the clear, and nothing is nothing.
 *
 * `'none'` is the one word here with no constant of its own (r=2 R1). A constant makes every literal equal to its
 * value stale at once, and `'none'` is the gate's own word for a path nothing gates and a room nothing holds: 88 of
 * them in 15 files, nearly all meaning something else. It needs no copy held either, because the mod already reads an
 * order it cannot make out as no act at all — the same thing `'none'` says — so a reworded `'none'` cannot make the mod
 * do anything but nothing. ./crew_answers.node-test.ts holds both halves of that: the launcher's own `'none'` does
 * nothing, and neither does an order the mod cannot read.
 */
export function theOrderOf(act: TheAct): TheOrder {
  if (act.act === 'prompt') return { carry: CARRY_A_TEXT, text: act.text }
  if (act.act === CARRY_THE_END) return { carry: CARRY_THE_END, turn_id: act.turn_id }
  return act.act === CARRY_THE_CLEAR ? { carry: CARRY_THE_CLEAR } : { carry: 'none' }
}

/**
 * Whether the crew's model may be switched after this order (martha#311): only when the flow orders nothing, and never
 * on a beat taken while the turn runs, since a switch cannot run inside a turn; it waits for the turn's end.
 */
export const aSwitchMayFollow = (order: TheOrder, question: TheSessionsQuestion): boolean => order.carry === 'none' && !question.turn_running
