// The end of a member's running turn, as the refresh flow carries it (martha#311; moved here by martha#443 R2).
//
// This exists so the flow's beat can end a turn its handover waits behind, and conclude that end, without the flow
// holding the end's steps: the end is announced in the ledger before it is ordered, held at a tool boundary, concluded
// when the turn it names ends, and the flow given up once its ends are spent. The flow calls in here; this calls the
// flow's own acts back only through the places it is handed (TheEndsPlaces), so it never imports the flow at run time.

import { MINUTE_MS, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { CrewPlace } from '../host_contract/host_contract.ts'
import { announceAct, concludeAct, REFRESH_FORCED, type Outcome } from '../log_ledger/log_ledger.ts'
import { keepTheFlow, NO_ACT, type ARefresh } from '../refresh_a_member/refresh_a_member.ts'
import type { TheAct, TheRefreshPlaces, TheSessionsQuestion } from '../refresh_a_member/the_refresh_flow.ts'
import { OWNER_DIALOGS_FIELD } from '../show_dashboard_beat/show_dashboard_beat.ts'
import {
  anEndIsDue,
  anEndOutlived,
  theEndAnnounced,
  theEndLine,
  theFlowEnded,
  theFlowEndExpired,
  theFlowEnding,
  theFlowGivenUp,
  theFlowNotEnded,
  theGiveUpLine,
  type AnEndPending,
} from './end_a_running_turn.ts'

/**
 * The flow's places, with the two acts of the flow the end calls back (martha#443 R2, the owner's ruling): one line to
 * the Supervisor, and that line told once per flow. The flow hands them in, so this file never imports the flow.
 */
export interface TheEndsPlaces extends TheRefreshPlaces {
  readonly tellTheSupervisor: (places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, settings: CrewSettings, line: string) => ARefresh
  readonly sayToTheSupervisor: (places: TheRefreshPlaces, settings: CrewSettings, line: string) => void
}

/**
 * The word an order carries the end of the running turn under (martha#311): the one the mod answers by asking the host
 * to end the turn the order names. It reports no outcome: the flow concludes the end from that turn's own end. The core
 * decides when; every host's mod must carry this word, and the mod's copy is declared in
 * src/claude_code_relay/coincidences.ts.
 */
export const CARRY_THE_END = 'end_the_turn'

/** What an end is concluded with once the turn it was held on ended (martha#311). */
export const THE_TURN_ENDED = 'turn_ended'

/** What an end the mod held for a ceiling behind a running tool is concluded with (ruling D on martha#311). */
export const A_TOOL_WAS_STILL_RUNNING = 'a tool was still running'

/** The flow that was given up on this very turn holds a new one back until another turn runs (martha#311). */
export function heldByTheTurnItGaveUpOn(flow: ARefresh | undefined, question: TheSessionsQuestion): boolean {
  return flow?.gave_up_on !== undefined && flow.gave_up_on !== '' && flow.gave_up_on === question.turn_id
}

/** The crew's ceiling in milliseconds: how long a handover waits behind a running turn (martha#311). */
const ceilingOf = (settings: CrewSettings): number => settings.handover_ceiling_minutes * MINUTE_MS

/**
 * The flow with a pending end dropped when it no longer holds. A new session started (design 3d): the act stays open,
 * so the successor checks it. Or the end is a ceiling old, held behind a tool that never finished (ruling D): it is
 * concluded as blocked and spends one end, so a flow behind a hung tool is given up rather than ended forever.
 */
export async function withAnOutlivedEndDropped(places: TheRefreshPlaces, place: CrewPlace, flow: ARefresh, question: TheSessionsQuestion, settings: CrewSettings, now: number): Promise<ARefresh> {
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
export function theEndedTurnIsTheOneHeld(flow: ARefresh, question: TheSessionsQuestion): flow is ARefresh & { readonly ending: AnEndPending } {
  return flow.ending !== undefined && !question.turn_running && question.turn_id === flow.ending.turn_id
}

/**
 * The end, concluded when the turn it was held on ended (design §5): ended whether the abort landed or the turn ended
 * first, and counted. It restarts the stall window (3b) and sends the Supervisor one line. An abort the host refused
 * while the turn ran ends nothing, and the end expires a ceiling on (ruling D).
 */
export async function concludeTheEnd(places: TheEndsPlaces, place: CrewPlace, flow: ARefresh & { readonly ending: AnEndPending }, settings: CrewSettings, now: number): Promise<TheAct> {
  const pending = flow.ending
  await concludeTheEndsAct(places, pending, { succeeded: true, detail: THE_TURN_ENDED })
  keepTheFlow(place, places.member, theFlowEnded(flow, now))
  places.sayToTheSupervisor(places, settings, theEndLine({ member: places.member, what: pending.what }))
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
export async function theEndOfTheRunningTurn(
  places: TheEndsPlaces,
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
function giveUp(places: TheEndsPlaces, place: CrewPlace, flow: ARefresh, spent: { readonly why: string; readonly turn_id: string }, settings: CrewSettings, now: number): TheAct {
  const told = places.tellTheSupervisor(places, place, flow, settings, theGiveUpLine({ member: places.member, why: spent.why }))
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
