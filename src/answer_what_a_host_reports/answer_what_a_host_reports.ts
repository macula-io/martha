// What one launch answers a host's reports from (martha#541, packages 2-4: 1a, 1b).
//
// This exists so every gate the crew keeps is asked in one place that names no host, instead of in the Claude Code
// adapter (#257's finding 1). It is that place: the entry one host's adapter reaches, and every host's after it.
//
// What it holds (1a) is what every answer is made from: the sessions this launch has taken a start of, the record kept
// for each and the reason one can no longer be vouched for, one order its events are answered in, and the checkout's
// tree as it was when the owner approved the launch (what a read is exempt against, martha#127).
//
// What it answers (1b) is the delivery family, in the contract's words: a session's start (`AStartingSession`), a turn
// (`ArrivingTurn`), and a review the host saw fail (`AReviewTheHostSawFail`). And (2) a called tool (`ACalledTool`),
// allowed or denied before it runs. And (3) a ran tool's result (`AResultOfACall`), recorded or the member stopped;
// an agent's start and stop (`AnAgentOfASession`); the crew's tool ask (`ACrewToolAsked`); and a turn the host never
// raised as a prompt. The adapter keeps only its translation, the owner's screen, the signed runs' `run` and the
// guard's git judgements, and still asks this file for the order, the record and a session by name.
//
// It names no host: the types it takes are the slices' and the contract's own, and a host's facts arrive already
// translated by the adapter (packages 2-4's design, comment 6941097792): a start as the outcome its host's table gives
// it, a turn with the arrival the host's origins give it, and the envelope a host writes for a failed agent as a value
// the launcher hands in.

import { theContractACrewHolds, type CoreToolAnswer, type CrewTools, type TheStartLine } from '../a_crews_tools/a_crews_tools.ts'
import { answerToolCall, whatTheCrewRefusesOfACall, type ApprovedLaunch, type ToolCall } from '../answer_a_tool_call/answer_a_tool_call.ts'
import type { Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { startSessionAs } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import {
  agentOfANamedResult,
  agentsToHold,
  anAgentSeenToStart,
  anAgentSeenToStop,
  noteTheAgentsAnsweredCall,
  noteWhatItsCallsRead,
  runOf,
  type AgentRun,
  type TheRunTable,
} from '../vouch_for_the_agents_a_session_started/vouch_for_the_agents_a_session_started.ts'
import type { TheJournalsRecordOfACall } from '../end_a_running_turn/hold_the_end.ts'
import { noteTheCallCounted, theSpendACrewHolds } from '../hold_a_package_to_its_budget/the_budget_tools.ts'
import { theNoticeOfACallPastTheBudget, type ASpendInForce } from '../hold_a_package_to_its_budget/refuse_a_call_past_the_budget.ts'
import { theActsNotAllowed, theNoticeOfACallOutsideTheContract, type TheContractHanded } from '../refuse_calls_outside_the_package_contract/refuse_a_call_outside_the_contract.ts'
import type {
  ACalledTool,
  ACrewToolAsked,
  AnAgentOfASession,
  AResultOfACall,
  AReviewTheHostSawFail,
  Arrival,
  ArrivingTurn,
  AStartingSession,
  TheAnswerToACall,
  TheAnswerToAnAgent,
  TheAnswerToAResult,
  TheAnswerToAStart,
  TheAnswerToATurn,
  ToolNames,
  TurnSource,
} from '../host_contract/host_contract.ts'
import type { LaunchHost } from '../judge_a_checkouts_tree/checkout_tree.ts'
import {
  keepTheModelAReviewResolvedTo,
  nameTheFailedReviewIn,
  type TheReportTheHostWrites,
  type TheReviewSpawns,
  type WhereTheFailedReviewIsTold,
} from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import type { GateMode } from '../read_the_gate_mode/read_the_gate_mode.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { approvedStartTreeOf, type HostSwitches, type StartedWith } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { recheckLaunchPassingOwnWrites } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import { wordsInAMeshAnswer, type WhatTheLaunchSupplies } from '../prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts'
import { sourceOfAMeshToolResult } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { senderOfARingResult } from '../read_a_ring_results_sender/read_a_ring_results_sender.ts'
import { takeInToolResult, type ToolResultRows } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import type { SessionRecords } from '../session_records_in_rows/session_records_in_rows.ts'
import { type HostSession, rememberSession, takeInTurn } from '../take_in_a_turn/take_in_a_turn.ts'

/**
 * What the entry is given for one launch: the record it keeps, the launch the owner approved, and the machine the
 * launch gate reads the checkout through. The adapter builds it from the same values it answers with, so the entry
 * reads nothing the adapter does not.
 */
export interface ThePlacesAHostReportsOver {
  readonly records: SessionRecords
  /** The member's launch, as `prepareLaunch` was given it. */
  readonly launch: ApprovedLaunch
  /**
   * The machine parts the launch gate reads the checkout with: the contract's own `stores.files`, `stores.scratch` and
   * `processes.runNow` (martha#16). The launcher passes the value it runs with; a slice never holds the machine.
   */
  readonly machine: LaunchHost
  /** `bindNothing` until the host attests a sender (A6). */
  readonly binder: Binder
  /** What the launch puts into every session it starts by itself, which the owner's approval does not bind (A7, A11). */
  readonly handed_at_start: readonly TurnSource[]
  /** The crew's tools (martha#254): a launch with none starts no refresh, hands no start line and names no review. */
  readonly crew?: CrewTools | undefined
  /**
   * Why a call this member's billing cannot run is refused before anything else asks of it (martha#957 gap 13): an
   * Artifact call by a member billed by the key, which carries no claude.ai login. Absent, no call is refused for it.
   */
  readonly refusesACallItsBillingCannotRun?: ((tool: string) => string | undefined) | undefined
  /** The crew text this launch hands every session it starts (martha#306); absent, only the start line is handed. */
  readonly crew_text?: string | undefined
  /**
   * The review calls this launch allowed, by the host's id for the call, and what each resolved to (martha#390). One
   * table, made once by the launcher: the entry's tool call writes it, and its result reads and forgets from it.
   */
  readonly reviews: TheReviewSpawns
  /** The envelope this host writes when an agent fails, in its own names; absent, no report names a review. */
  readonly failed_review_report?: TheReportTheHostWrites | undefined
  /** Where a line about a failed review goes (martha#390): the owner's row and the member. Absent, nothing is told. */
  readonly told?: WhereTheFailedReviewIsTold | undefined
  /**
   * The sink a line about a call the gate carried on past is said through (martha#601): the adapter's writer to the
   * process's own error output. Absent, nothing is said.
   */
  readonly note?: ((line: string) => void) | undefined
  /**
   * The agents the host started under this launch's sessions (martha#170). One table, made once by the launcher: a
   * called tool writes it here, and an agent's start, stop and result read it here too.
   */
  readonly agents: TheRunTable
  /** Who may send executable text, as the launch's policy says. */
  readonly policy: Policy
  /** How the host names a called tool: its `host.tools`. */
  readonly names: ToolNames
  /** What the gate does to this member (martha#321); absent means enforced. */
  readonly gate?: GateMode | undefined
  /**
   * Where an audited member's would-be refusals are kept (martha#321); absent, an audited member's call is refused. Typed
   * by the gate's own call, so the entry carries the place without naming the audit, which only its five places may.
   */
  readonly audit?: ToolCall['audit']
  /**
   * The member's signed runs (martha#129); a member without them runs no shape. Only the half the entry calls is named
   * here: the signed runs are host glue, which no slice imports, and the adapter hands its own table in.
   */
  readonly signed_runs?:
    | {
        callAllowed(tool: string, input: Readonly<Record<string, unknown>>): void
        /** The receipt a call's answer takes (martha#129): single use, and `why` undefined when the answer is exactly the one it builds. */
        callAnswered(tool: string, input: Readonly<Record<string, unknown>>, answer: unknown): { readonly why: string | undefined } | undefined
      }
    | undefined
  /**
   * What recording a ran tool's result needs (martha#541, PR 3); absent, a result this launch cannot record stops the
   * member, as any result whose record cannot be kept does.
   */
  readonly results?: WhereAResultIsRecorded | undefined
  /** Where the journal says a call's own answer carried a held end of its turn (martha#498); absent, nothing is said. */
  readonly journal?: TheJournalsRecordOfACall | undefined
  /**
   * Why a call's input writes the owner's settings files (martha#122), or undefined: the adapter's own decision, closed
   * over the files its host reads, the launch's directory and the owner's home. Asked first of all.
   */
  refusesAWriteToTheOwnersSettings(input: Readonly<Record<string, unknown>>): string | undefined
  /**
   * Why a call writes where the owner's sessions load memory from (martha#136), or undefined: the adapter's own
   * decision, closed over its host's places and the machine. Asked second.
   */
  refusesAWriteToTheOwnersMemory(tool: string, input: Readonly<Record<string, unknown>>): string | undefined
}

/**
 * What recording a ran tool's result needs (martha#541, PR 3): the host's own tools by what a result of each reads, the
 * state the launch started in, what it supplies to a mesh answer, and the adapter's two decisions over its own files.
 * Each is a value or a closure the launcher makes, so the entry reads no host's table and holds no path.
 */
export interface WhereAResultIsRecorded {
  /** The host's own tools, by what a result of each reads (martha#127): the adapter's table, handed in as a value. */
  readonly tool_result_rows: ToolResultRows
  /** The host's switches under which a read attaches nothing (martha#127); absent, a read is judged by the tree alone. */
  readonly read_attaches_nothing: HostSwitches | undefined
  /** What the launch was started with (martha#127). */
  readonly started_with: StartedWith | undefined
  /** What this launch supplies to a mesh answer, so one carrying nothing of anyone else's takes nothing in (martha#251). */
  readonly wordless_answers?: Omit<WhatTheLaunchSupplies, 'input'> | undefined
  /**
   * Keeps what this call wrote, so the recheck after it does not take the member's own write for an outsider's
   * (martha#132); why it could not, or undefined. The adapter's decision, closed over its files, home and machine.
   */
  noteWhatThisCallWrote(call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>>; readonly session: string }): string | undefined
  /**
   * Why the owner's settings no longer hold (a key that turns the relay off, martha#122, or a hook or plugin they now
   * declare, martha#121), or undefined. The adapter's watch over its own files; asked after the launch's recheck passed.
   */
  checkTheSettingsStillHold(): string | undefined
}

/** What a launch with no crew place answers the crew's tool ask: nothing, by name (martha#254). */
export const NO_CREW_TOOLS = 'this launch was given no crew place, so it answers no tool'

/** Why a result stops the member when the launch was given nowhere to record one. */
export const NOWHERE_TO_RECORD = 'this launch was given nowhere to record a ran tool’s result, so nothing it ran can be answered for'

/** The table of one launch's agents, made once by the launcher: the entry's call writes it, its agent start, stop and result read it. */
export const agentRunsKept = (): TheRunTable => new Map<string, AgentRun>()

/**
 * One launch's answers, as the adapter reaches them while its handlers have not all moved: the record, the sessions,
 * the order, and the tree the owner approved. Nothing here decides anything, and no member is added for a caller that
 * has not moved: the door narrows as the handlers do.
 */
export interface TheAnswersOfOneLaunch {
  /** The record this launch keeps, as the entry holds it: the adapter reads it here and nowhere else. */
  readonly records: SessionRecords
  /** Runs `work` after every piece of work already asked for, so it reads the record the one before it wrote. */
  inOrder<T>(work: () => Promise<T>): Promise<T>
  /** Whether this launch holds a start of this session. */
  holds(session_id: string): boolean
  /** Why nothing this session takes in may be answered for again, or undefined while it may. */
  brokenBecause(session_id: string): string | undefined
  /** The session an event names, or why the launcher cannot vouch for it. */
  named(session_id: unknown): HostSession | string
  /** Keeps the session's record, or marks it broken and says why. */
  keep(session: HostSession): Promise<string | undefined>
  /** The session as the gate now reads it, or why its record can no longer be vouched for (martha#321). */
  vouchFor(session: HostSession): Promise<HostSession | string>
  /**
   * The checkout's tree as it is now, before the host starts, when the owner approved this start state; `null`
   * otherwise. A checkout with no config is launched whatever it holds and approves nothing, so it gets `null`, and
   * every read in it counts (decided 2026-11-07, martha#127).
   */
  readonly approved_start: string | null
  /**
   * A session's start: kept with every source it is handed, and answered with what it is handed. A second start of a
   * session this launch holds changes nothing (martha#255), and a start the crew says it refreshed inherits its
   * predecessor's record, whatever the host called it.
   */
  aSessionStarted(start: AStartingSession): Promise<TheAnswerToAStart>
  /** A turn: kept in its session's record, a session the crew refreshed taken in first (martha#255), or refused and why. */
  aTurnArrived(session_id: unknown, turn: ArrivingTurn): Promise<TheAnswerToATurn>
  /**
   * The crew's state a prompted turn of this session is handed (martha#984), once the turn is kept: taken into the
   * session's record on its own source BEFORE it is answered, and undefined when there is none, it is the copy this
   * session was last handed, or it could not be read or recorded. A host whose turns are prompted asks it.
   */
  theCrewStateToHand(session_id: string): Promise<string | undefined>
  /** A review the host saw fail (martha#390), named on the row and to the member, for a session this launch holds. */
  aReviewTheHostSawFail(report: AReviewTheHostSawFail): Promise<void>
  /**
   * A called tool, before it runs: allowed, or denied and why. Each refusal is asked in its order (the owner's settings,
   * their memory, the gate, the crew's reviewer-model rule, a held end), and an allowed call is counted against the
   * package's spend before it is allowed (martha#513).
   */
  aToolCalled(call: ACalledTool): Promise<TheAnswerToACall>
  /**
   * A ran tool's result (martha#541, PR 3): the review it resolved, the menu it answered and the agent's call noted, the
   * signed receipt taken, the own write kept and the launch rechecked, then the result recorded. Anything but a clean
   * recheck and a kept record stops the member; a taken result carries the end of its turn when it was the last call
   * in flight under a held end (martha#311 ruling D).
   */
  aResultCame(result: AResultOfACall): Promise<TheAnswerToAResult>
  /** The host says an agent started under a session (martha#170). */
  anAgentStarted(agent: AnAgentOfASession): Promise<TheAnswerToAnAgent>
  /** The host says an agent stopped (martha#170): an unvouched agent's answer is recorded as a subagent's text. */
  anAgentStopped(agent: AnAgentOfASession): Promise<TheAnswerToAnAgent>
  /**
   * A tool the crew's mod asks the launcher to answer (martha#254), its session taken in first when the crew refreshed
   * it before the host's own start arrived (martha#255): the mod's question can come first.
   */
  aCrewToolAsked(ask: ACrewToolAsked): Promise<CoreToolAnswer>
  /** A turn the host never raised as a prompt, kept in its session's record (martha#440); false when it was not kept. */
  aTurnTheHostNeverRaised(session_id: string, arrival: Arrival): Promise<boolean>
}

/** The answers one launch gives, over the sessions it has taken a start of. */
export function answersOver(
  places: ThePlacesAHostReportsOver,
  sessions: Map<string, HostSession> = new Map<string, HostSession>(),
): TheAnswersOfOneLaunch {
  /** Why this session may be answered for no more, for the rest of this process. */
  const broken = new Map<string, string>()

  const approved_start = approvedStartTreeOf(places.launch, places.machine)

  const breakSession = (session: HostSession, why: string): string => {
    sessions.delete(session.id)
    broken.set(session.id, why)
    return why
  }

  /** Keeps the session's record, or marks the session broken and says why. */
  const keep = async (session: HostSession): Promise<string | undefined> => {
    rememberSession(places.records.store, session)
    try {
      await places.records.flush(session.id)
      sessions.set(session.id, session)
      return undefined
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const why = `the record of session ${session.id} could not be kept (${typeof code === 'string' ? code : String(error)}), so nothing in it is answered for again`
      return breakSession(session, why)
    }
  }

  /**
   * Checks the session's stored record is still the one kept, or marks it broken and says why; and answers with the
   * session as the gate now reads it, because the owner may have released it since the last call (martha#321).
   */
  const vouchFor = async (session: HostSession): Promise<HostSession | string> => {
    try {
      await places.records.check(session.id)
      const record = places.records.store.read(session.id)
      return record === undefined ? session : { ...session, gate: record }
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const why = `the record of session ${session.id} can no longer be vouched for (${typeof code === 'string' ? code : error instanceof Error ? error.message : String(error)}), so nothing in it is answered for again`
      return breakSession(session, why)
    }
  }

  const held: TheSessionsHeld = { places, sessions, broken, keep, vouchFor, approved_start, notices_said: new Set<string>(), crew_states_handed: new Map<string, string>() }

  return {
    records: places.records,
    inOrder: oneOrder(),
    holds: (session_id) => sessions.has(session_id),
    brokenBecause: (session_id) => broken.get(session_id),
    named: (session_id) => sessionNamed(session_id, sessions, broken),
    keep,
    vouchFor,
    approved_start,
    aSessionStarted: async (start) => aSessionStartedIn(held, start),
    aTurnArrived: async (session_id, turn) => aTurnArrivedIn(held, session_id, turn),
    theCrewStateToHand: async (session_id) => theCrewStateToHandIn(held, session_id),
    aReviewTheHostSawFail: async (report) => aReviewTheHostSawFailIn(held, report),
    aToolCalled: async (call) => aToolCalledIn(held, call),
    aResultCame: async (result) => aResultCameIn(held, result),
    anAgentStarted: async (agent) => anAgentStartedIn(held, agent),
    anAgentStopped: async (agent) => anAgentStoppedIn(held, agent),
    aCrewToolAsked: async (ask) => aCrewToolAskedIn(held, ask),
    aTurnTheHostNeverRaised: async (session_id, arrival) => aTurnTheHostNeverRaisedIn(held, session_id, arrival),
  }
}

/** What the delivery family's answers share: the launch's places, the sessions it holds and has broken, and how it keeps one. */
interface TheSessionsHeld {
  readonly places: ThePlacesAHostReportsOver
  readonly sessions: Map<string, HostSession>
  readonly broken: ReadonlyMap<string, string>
  keep(session: HostSession): Promise<string | undefined>
  vouchFor(session: HostSession): Promise<HostSession | string>
  /** The checkout's tree when the owner approved this start state, or `null` (martha#127): what a read is exempt against. */
  readonly approved_start: string | null
  /**
   * The notices this launch has told its member, by what they are about (martha#601, rows 110 and 112): each is told
   * once, because every notice reaches the member as a crew message and so as a turn of its own, and a notice repeated
   * on every call past the wall would feed the member a turn for each call it makes.
   */
  readonly notices_said: Set<string>
  /**
   * The crew's state each session was last handed (martha#984): an unchanged state is not handed again, and every start
   * of the session drops it, as a compaction leaves the conversation without the copy.
   */
  readonly crew_states_handed: Map<string, string>
}

/** The session a clear was told in, when this id is the one the crew is waiting for: the crew's own answer, or none. */
async function theRefreshTheSessionInherits({ places, sessions, broken }: TheSessionsHeld, session_id: string): Promise<string | null> {
  if (places.crew === undefined || sessions.has(session_id) || broken.has(session_id)) return null
  try {
    return await places.crew.thePredecessorOf(session_id)
  } catch {
    return null
  }
}

/** A starting session with every source it is handed taken in, before its record is kept (martha#121, martha#317). */
function handedAtStart(places: ThePlacesAHostReportsOver, started: HostSession, line: TheStartLine | null): HostSession {
  return [...places.handed_at_start, ...(line?.taken_in ?? [])].reduce((session, source) => takeInTurn(session, { source }, places.binder), started)
}

/**
 * Takes in a session the crew refreshed before the host's own start of it was answered (martha#255): the mod's question
 * at its start, or the resume prompt it submits, can arrive first. It is made exactly as the start would make it,
 * inheriting the predecessor's record.
 */
async function takeInARefreshedSessionIn(held: TheSessionsHeld, session_id: string): Promise<string | undefined> {
  if (held.sessions.has(session_id) || held.broken.has(session_id)) return undefined
  const predecessor = await theRefreshTheSessionInherits(held, session_id)
  if (predecessor === null) return undefined
  await held.places.records.load(session_id)
  return held.keep(handedAtStart(held.places, startSessionAs(held.places.records.store, { session_id, outcome: 'inherits', predecessor_id: predecessor }), null))
}

/** One queue: each piece of work runs after every piece already asked for, whether that one failed or not. */
function oneOrder(): <T>(work: () => Promise<T>) => Promise<T> {
  let queue: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work)
    queue = next.catch(() => undefined)
    return next
  }
}

async function aSessionStartedIn(held: TheSessionsHeld, start: AStartingSession): Promise<TheAnswerToAStart> {
  const lost = held.broken.get(start.session_id)
  if (lost !== undefined) return { refused: lost }
  held.crew_states_handed.delete(start.session_id)
  // A second start of a session this launch already holds changes nothing: re-beginning it would wipe the record the
  // first one kept, which is exactly the wipe a `clear` after a refresh would be (martha#255).
  if (held.sessions.has(start.session_id)) return { taken: '' }
  await held.places.records.load(start.session_id)
  const started = startSessionAs(held.places.records.store, await asTheCrewsRefresh(held, start))
  const line = await theLineThisSessionStartsOn(held.places.crew, start.session_id)
  const why = await held.keep(handedAtStart(held.places, started, line))
  // The beats a hand carried are marked only once the start is taken, and dropped unmarked when it is refused, so a
  // refused start leaves the next one the beats (martha#658 Done-when 4).
  held.places.crew?.noteTheStart(start.session_id, why === undefined)
  return why === undefined ? { taken: handedAtThisStart(held.places.crew_text, line?.line ?? null) } : { refused: why }
}

/**
 * The start the crew's own refresh makes of a session, when this start is the successor's (martha#255): one the crew
 * says it cleared from inherits that predecessor, whatever the host called the start, so a `clear` after a refresh can
 * never wipe the record the successor inherited.
 */
async function asTheCrewsRefresh(held: TheSessionsHeld, start: AStartingSession): Promise<AStartingSession> {
  const predecessor = await theRefreshTheSessionInherits(held, start.session_id)
  return predecessor === null ? start : { session_id: start.session_id, outcome: 'inherits', predecessor_id: predecessor }
}

async function aTurnArrivedIn(held: TheSessionsHeld, session_id: unknown, turn: ArrivingTurn): Promise<TheAnswerToATurn> {
  const refreshed = typeof session_id === 'string' && session_id !== '' ? await takeInARefreshedSessionIn(held, session_id) : undefined
  const session = refreshed ?? sessionNamed(session_id, held.sessions, held.broken)
  if (typeof session === 'string') return { refused: session }
  const why = await held.keep(takeInTurn(session, turn.arrival, held.places.binder))
  return why === undefined ? { kept: 1 } : { refused: why }
}

/**
 * Names the review the host reports failed (martha#390), only for a session this launch holds and has not broken: a
 * report about a turn the member never took in names nothing. The naming itself is the slice's, unchanged.
 */
async function aReviewTheHostSawFailIn({ places, sessions }: TheSessionsHeld, report: AReviewTheHostSawFail): Promise<void> {
  const { crew, told, failed_review_report } = places
  if (crew === undefined || told === undefined || failed_review_report === undefined || !sessions.has(report.session_id)) return
  const review_model = await crew.theReviewModel()
  if (review_model === null) return
  await nameTheFailedReviewIn(places.reviews, report.text, { origin_kind: report.origin_kind, review_model, report: failed_review_report }, told)
}

/**
 * A called tool, decided before it runs (martha#541, PR 2): the session named and vouched for, the agent's call noted on
 * its run, then every refusal in its order. An allowed call is counted against the package's spend (martha#513, slice
 * 3), after a call past the package's contract or budget is told so in a notice to its member (martha#601, rows 110 and
 * 112); a row the store could not keep is written in the journal and the call runs (row 113). Then it is noted as a
 * signed run, a review it lets through remembered, and its turn's end told it is in flight.
 */
async function aToolCalledIn(held: TheSessionsHeld, call: ACalledTool): Promise<TheAnswerToACall> {
  const { places } = held
  const named = sessionNamed(call.session_id, held.sessions, held.broken)
  if (typeof named === 'string') return { denied: named }
  const session = await held.vouchFor(named)
  if (typeof session === 'string') return { denied: session }
  noteTheAgentsCall(places.agents, session, call)
  const denial = await theDenialOfACall(places, session, call)
  if (denial !== undefined) return { denied: denial }
  // The notice reads the spend before this call is counted, so the call that spends the last unit is not told it is over.
  await noticeACallPastItsPackage(places, held.notices_said, session, call)
  const uncounted = await noteTheCallCounted(places.crew, session.id, places.names.ownNameOf(call.tool))
  if (uncounted !== undefined) places.journal?.noted(A_CALL_NOT_COUNTED, uncounted, call.call_id)
  places.signed_runs?.callAllowed(call.tool, call.input)
  await noteTheReviewThisLaunchLetThrough(places, call)
  places.crew?.ends.aCallAllowed(session.id, call.call_id ?? '')
  return { allowed: 1 }
}

/** The journal's own name for a call the store could not count against its package's budget (martha#601, row 113). */
export const A_CALL_NOT_COUNTED = 'a call not counted against its budget'

/**
 * Tells the member, in one line each, that its allowed call does an act its package's contract leaves out or runs past
 * a spent budget (martha#601, rows 110 and 112): the call runs either way. Each is told once a launch, by what it is
 * about: the package and contract version, and for the contract the acts. A launch with no crew, or none to tell, says
 * nothing.
 */
async function noticeACallPastItsPackage(places: ThePlacesAHostReportsOver, said: Set<string>, session: HostSession, call: ACalledTool): Promise<void> {
  if (places.told === undefined) return
  const spend = await theSpendACrewHolds(places.crew, session.id)
  const contract = await theContractACrewHolds(places.crew, { tool: call.tool, input: call.input }, places.names)
  for (const { about, line } of theNoticesOf(call, spend, contract, places.names.ownNameOf)) {
    if (line === undefined || said.has(about)) continue
    said.add(about)
    await places.told.theMember(line, call.call_id ?? '')
  }
}

/** A notice this call may be told, with what it is about: the key a launch tells it once under. */
interface ANotice {
  readonly about: string
  readonly line: string | undefined
}

/**
 * The budget's notice and the contract's for this call, each keyed by its package, version and, for a contract, acts.
 * The budget's key says which of its two notices it is, so a member told its spend could not be read is still told
 * when the spend is read and found spent.
 */
function theNoticesOf(call: ACalledTool, spend: ASpendInForce | undefined, contract: TheContractHanded, own: (called: string) => string): readonly ANotice[] {
  const budget: ANotice = { about: `budget ${spend?.package ?? ''} ${String(spend?.version)} ${spend?.why_unreadable === undefined ? 'spent' : 'unreadable'}`, line: theNoticeOfACallPastTheBudget({ tool: call.tool }, spend, own) }
  if (contract === undefined) return [budget]
  const acts = theActsNotAllowed({ tool: call.tool, input: call.input }, contract, own)
  return [budget, { about: `contract ${contract.package} ${String(contract.version)} ${acts.join(',')}`, line: theNoticeOfACallOutsideTheContract({ tool: call.tool, input: call.input }, contract, own) }]
}

/** A call an agent made, noted on its run as one of the calls "every call it made" counts; the member's own note nothing. */
function noteTheAgentsCall(agents: TheRunTable, session: HostSession, call: ACalledTool): void {
  if (call.agent_id === undefined) return
  const run = runOf(agents, session.id, call.agent_id)
  if (call.call_id !== undefined) run.calls_seen.add(call.call_id)
}

/** Why this call is refused before it runs, or undefined: a call its billing cannot run, the owner's settings, their memory, the gate, then what the crew refuses beside it (the reviewer-model rule, the workspace guard's first seam, a held end). */
async function theDenialOfACall(places: ThePlacesAHostReportsOver, session: HostSession, call: ACalledTool): Promise<string | undefined> {
  const unbilled = places.refusesACallItsBillingCannotRun?.(call.tool)
  if (unbilled !== undefined) return unbilled
  const settings = places.refusesAWriteToTheOwnersSettings(call.input)
  if (settings !== undefined) return settings
  const memory = places.refusesAWriteToTheOwnersMemory(call.tool, call.input)
  if (memory !== undefined) return memory
  const verdict = answerToolCall({
    tool: call.tool,
    session,
    policy: places.policy,
    input: call.input,
    launch: places.launch,
    names: places.names,
    host: places.machine,
    agents_running: agentsToHold(places.agents, session.id, call.agent_id),
    ...(places.gate === undefined ? {} : { gate: places.gate }),
    audit: places.audit,
  }, places.note ?? (() => {}))?.deny
  if (verdict !== undefined) return verdict
  return whatTheCrewRefusesOfACall(places.crew, call, session.id)
}

/**
 * Keeps a call this launch allowed when it is one of the crew's reviews on its reviewer model (martha#390), so a failure
 * the host reports later can be read as that review's and no other's. An allowed review is also the member taking up
 * again whichever review stopped before it: the line that one left in the row leaves it here (martha#390 r=1).
 */
async function noteTheReviewThisLaunchLetThrough(places: ThePlacesAHostReportsOver, call: ACalledTool): Promise<void> {
  if (places.crew === undefined || call.call_id === undefined) return
  const review_model = await places.crew.theReviewModelOfTheCall({ tool: call.tool, input: call.input })
  if (review_model === null) return
  places.reviews.remember(call.call_id, review_model)
  places.told?.takeTheLineBack()
}

/**
 * A ran tool's result (martha#541, PR 3): recorded, or the member stopped; then, on a taken result and only on one, the
 * end of the turn the launch holds rides on it when this was the last call in flight (martha#311 ruling D).
 */
async function aResultCameIn(held: TheSessionsHeld, result: AResultOfACall): Promise<TheAnswerToAResult> {
  const stop = await theStopAfterARanTool(held, result)
  if (stop !== undefined) return { stop }
  const end = held.places.crew?.ends.aCallAnswered(result.session_id, result.call_id ?? '', held.places.journal)
  return end === undefined ? { taken: 1 } : { taken: 1, end_turn: end }
}

/**
 * Every step a ran tool's result takes, in the order the adapter took them before PR 3 (#132, #121, #122, the lanes):
 * the review it resolved, the menu it answered and the agent's call noted; the signed receipt taken, whatever the
 * answer, so a later call takes none of it (martha#129); the own write kept and the launch rechecked; then, unless the
 * answer is exactly the one a signed run builds, the result recorded. Why the member stops, or undefined.
 */
async function theStopAfterARanTool(held: TheSessionsHeld, result: AResultOfACall): Promise<string | undefined> {
  const { places } = held
  const session = sessionNamed(result.session_id, held.sessions, held.broken)
  if (typeof session === 'string') return session
  const { answering, kept } = noteWhatTheResultAnswered(places, session.id, result)
  const where = places.results
  if (where === undefined) return NOWHERE_TO_RECORD
  const unvouched = recheckBeforeRecording(places, where, session.id, result)
  if (unvouched !== undefined) return unvouched
  // A `martha run <name>` whose answer is exactly the one its receipt builds records nothing (martha#129): the run's
  // output is text the owner vouched for, so the shell stays. Every other result records, as #127 leaves it.
  if (kept !== undefined && kept.why === undefined) return undefined
  const { stop, recorded } = await recordTheResult(held, where, session, result)
  noteWhatItsCallsRead(places.agents, answering, recorded)
  return stop
}

/**
 * What a result answers, noted before anything is rechecked: the model a review this launch allowed resolved to
 * (martha#390), the menu it answered (martha#313, martha#608: what a settle of the owner's asks stands on), and an
 * agent's own call, answered here (martha#170: what "every call it made was answered" counts). Then the signed receipt
 * is taken, back with the agent and the receipt's decision.
 */
function noteWhatTheResultAnswered(
  places: ThePlacesAHostReportsOver,
  session_id: string,
  result: AResultOfACall,
): { readonly answering: string | undefined; readonly kept: { readonly why: string | undefined } | undefined } {
  keepTheModelAReviewResolvedTo(places.reviews, result.call_id, result.resolved_model)
  places.crew?.noteTheCallsAnswer({ tool: result.tool, input: result.input, answer: result.answer }, session_id)
  const answering = noteTheAgentsAnsweredCall(places.agents, result)
  return { answering, kept: places.signed_runs?.callAnswered(result.tool, result.input, result.answer) }
}

/** A turn the host never raised as a prompt, kept in its session's record (martha#440); false when it was not kept. */
async function aTurnTheHostNeverRaisedIn(held: TheSessionsHeld, session_id: string, arrival: Arrival): Promise<boolean> {
  const session = sessionNamed(session_id, held.sessions, held.broken)
  return typeof session !== 'string' && (await held.keep(takeInTurn(session, arrival, held.places.binder))) === undefined
}

/** The own write kept and every recheck, or why the member is stopped (#132, #121, #122). */
function recheckBeforeRecording(places: ThePlacesAHostReportsOver, where: WhereAResultIsRecorded, session_id: string, call: ACalledTool): string | undefined {
  // Kept before the recheck, so the write this call made is not taken for an outsider's (martha#132).
  const unkept = where.noteWhatThisCallWrote({ tool: call.tool, input: call.input, session: session_id })
  if (unkept !== undefined) return unkept
  const launched = recheckLaunchPassingOwnWrites(places.launch, places.machine)
  return launched.allow ? where.checkTheSettingsStillHold() : launched.refusal
}

/** What the call's result records: a tool server's answer, or the host's own result by #127's table, and the rows it added. */
async function recordTheResult(
  held: TheSessionsHeld,
  where: WhereAResultIsRecorded,
  session: HostSession,
  result: AResultOfACall,
): Promise<{ readonly stop: string | undefined; readonly recorded: readonly string[] }> {
  const { places } = held
  // An agent's answer is placed by the agent, not by the tool's name alone (martha#170): the id the host's answer names,
  // else the one on the call itself when the agent hands its report back.
  const agent = where.tool_result_rows[result.tool]?.reads === 'an_agents_answer' ? agentOfANamedResult(places.agents, result, result.answer_names_agent) : undefined
  // A mesh tool's own session answer may carry nothing of anyone else's (martha#251): read first, so an answer whose
  // every leaf came from this launch takes nothing in and the member keeps the shell it needs for the ring it was about
  // to make. Every other answer records on B2 exactly as before.
  const own_name = places.names.ownNameOf(result.tool)
  const wordless = where.wordless_answers === undefined ? undefined : wordsInAMeshAnswer(own_name, result.answer, { ...where.wordless_answers, input: result.input })
  if (wordless?.reads_nothing === true) return { stop: undefined, recorded: [] }
  const taken = result.from_a_tool_server
    ? takeInTurn(session, arrivalOfAMeshToolResult(own_name, result.input, result.answer), places.binder)
    : takeInToolResult(
        session,
        {
          tool: result.tool,
          input: result.input,
          rows: where.tool_result_rows,
          launch: places.launch,
          approved_start: held.approved_start,
          started_with: where.started_with,
          read_attaches_nothing: where.read_attaches_nothing,
          host: places.machine,
          ...(agent === undefined ? {} : { agent }),
        },
        places.binder,
      )
  const recorded = taken.gate.ingested.slice(session.gate.ingested.length).map((ingestion) => ingestion.path)
  if (recorded.length === 0) return { stop: undefined, recorded }
  return { stop: await held.keep(taken), recorded }
}

/** What a mesh tool's result is taken in as: its row, and the node id the result itself attests where the row's station attestation is really there (martha#247). */
function arrivalOfAMeshToolResult(own_name: string, input: unknown, answer: unknown): Arrival {
  const source = sourceOfAMeshToolResult(own_name) as Exclude<TurnSource, 'cross_session'>
  const sender = senderOfARingResult(own_name, input, answer)
  return sender === undefined ? { source } : { source, ...sender }
}

/** The host says an agent started under this session (martha#170): only this makes an agent one it saw start. */
async function anAgentStartedIn(held: TheSessionsHeld, agent: AnAgentOfASession): Promise<TheAnswerToAnAgent> {
  const session = sessionNamed(agent.session_id, held.sessions, held.broken)
  if (typeof session === 'string') return { refused: session }
  anAgentSeenToStart(held.places.agents, session.id, agent.agent_id)
  return { taken: 1 }
}

/**
 * The host says an agent stopped (martha#170), which is the only report of a background agent's answer: the host
 * delivers that text into the member's turn with no tool result to place it on. A vouched agent's answer is nothing
 * new and the shell stays; any other agent's answer is a subagent's text, recorded on B7 here, so the shell closes from
 * this moment on, whichever call the member makes next.
 */
async function anAgentStoppedIn(held: TheSessionsHeld, agent: AnAgentOfASession): Promise<TheAnswerToAnAgent> {
  const session = sessionNamed(agent.session_id, held.sessions, held.broken)
  if (typeof session === 'string') return { refused: session }
  if (anAgentSeenToStop(held.places.agents, session.id, agent.agent_id)) return { taken: 1 }
  const why = await held.keep(takeInTurn(session, { source: 'subagent' }, held.places.binder))
  return why === undefined ? { taken: 1 } : { refused: why }
}

/**
 * A tool the crew's mod asks for (martha#254): the crew's slice decides the answer. The mod's question at a refreshed
 * session's start can arrive before the host's own `clear` start, so the session is taken in here first: that is what
 * makes the order of the host's two events not matter (martha#255).
 */
async function aCrewToolAskedIn(held: TheSessionsHeld, ask: ACrewToolAsked): Promise<CoreToolAnswer> {
  const crew = held.places.crew
  if (crew === undefined) return { refused: NO_CREW_TOOLS }
  const why = await takeInARefreshedSessionIn(held, ask.session_id)
  if (why !== undefined) return { refused: why }
  return crew.answer(ask.tool, ask.args, ask.session_id)
}

/**
 * The crew's state a prompted turn of this session is handed (martha#984): built by the crew for this launch's own
 * member, and taken into the session's record on its own source BEFORE it is answered, so the shell gate stands behind
 * every word the turn is handed. Nothing is handed when the crew has no state, the session was last handed the same
 * text, or the state could not be read or recorded: the turn itself is kept either way, and a failure is noted.
 */
async function theCrewStateToHandIn(held: TheSessionsHeld, session_id: string): Promise<string | undefined> {
  const crew = held.places.crew
  const session = held.sessions.get(session_id)
  if (crew === undefined || session === undefined) return undefined
  const state = await theCrewStateOrWhy(crew)
  if (state === null) return undefined
  if ('why' in state) {
    held.places.note?.(state.why)
    return undefined
  }
  if (held.crew_states_handed.get(session_id) === state.line) return undefined
  const why = await held.keep(state.taken_in.reduce((taken, source) => takeInTurn(taken, { source }, held.places.binder), session))
  if (why !== undefined) {
    held.places.note?.(`the crew's state was not handed: ${why}`)
    return undefined
  }
  held.crew_states_handed.set(session_id, state.line)
  return state.line
}

/** The crew's state, or why the crew could not say it: a read that throws hands nothing, and says why in a note. */
async function theCrewStateOrWhy(crew: CrewTools): Promise<TheStartLine | null | { readonly why: string }> {
  try {
    return await crew.theCrewStateOfATurn()
  } catch (error) {
    return { why: `the crew's state could not be read (${error instanceof Error ? error.message : String(error)})` }
  }
}

/**
 * The line this session is handed as it starts (martha#254 test 10): the acts of the package this member holds that
 * were sent with no outcome recorded. Null when the member holds no package, nothing of it is waiting, or the ledger
 * cannot be read: a start the ledger could not be read for is still a start. The session's id is the host's own start
 * event's, and it is that id the crew's window hand guards on (martha#658 Done-when 4).
 */
async function theLineThisSessionStartsOn(crew: CrewTools | undefined, session_id: string): Promise<TheStartLine | null> {
  if (crew === undefined) return null
  try {
    return await crew.theLineToHandAtStart(session_id)
  } catch {
    return null
  }
}

/**
 * What this session takes in as it starts: the crew text, and then the line naming the acts it holds that were sent
 * with no outcome recorded (martha#254 test 10, martha#306). One string, because a host hands one line into the session
 * before its first prompt; empty when there is neither, and then the start is simply taken.
 */
export function handedAtThisStart(crewText: string | undefined, theLine: string | null): string {
  return [crewText === undefined ? '' : crewText.trim(), theLine === null ? '' : theLine.trim()].filter((part) => part !== '').join('\n\n')
}

/** The session an event names, or why the launcher cannot vouch for it. */
function sessionNamed(
  session_id: unknown,
  sessions: ReadonlyMap<string, HostSession>,
  broken: ReadonlyMap<string, string>,
): HostSession | string {
  if (typeof session_id !== 'string' || session_id === '') return 'the event names no session'
  const lost = broken.get(session_id)
  if (lost !== undefined) return lost
  return sessions.get(session_id) ?? `no start of session ${session_id} was taken, so nothing it takes in can be recorded`
}
