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
// allowed or denied before it runs. A tool result is added by the pull request that moves it (3). Until then the
// handlers still in the adapter ask this file for the state, and for a refreshed session's take-in; each of those
// members goes when its last caller moves.
//
// It names no host: the types it takes are the slices' and the contract's own, and a host's facts arrive already
// translated by the adapter (packages 2-4's design, comment 6941097792): a start as the outcome its host's table gives
// it, a turn with the arrival the host's origins give it, and the envelope a host writes for a failed agent as a value
// the launcher hands in.

import { theContractACrewHolds, type CrewTools, type TheStartLine } from '../a_crews_tools/a_crews_tools.ts'
import { answerToolCall, type ApprovedLaunch, type ToolCall } from '../answer_a_tool_call/answer_a_tool_call.ts'
import type { Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { startSessionAs } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { noteTheCallCounted, theSpendACrewHolds } from '../hold_a_package_to_its_budget/the_budget_tools.ts'
import type {
  ACalledTool,
  AReviewTheHostSawFail,
  ArrivingTurn,
  AStartingSession,
  TheAnswerToACall,
  TheAnswerToAStart,
  TheAnswerToATurn,
  ToolNames,
  TurnSource,
} from '../host_contract/host_contract.ts'
import type { LaunchHost } from '../judge_a_checkouts_tree/checkout_tree.ts'
import {
  nameTheFailedReviewIn,
  type TheReportTheHostWrites,
  type TheReviewSpawns,
  type WhereTheFailedReviewIsTold,
} from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import type { GateMode } from '../read_the_gate_mode/read_the_gate_mode.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { approvedStartTreeOf } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
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
  /** The crew text this launch hands every session it starts (martha#306); absent, only the start line is handed. */
  readonly crew_text?: string | undefined
  /**
   * The review calls this launch allowed, by the host's id for the call, and what each resolved to (martha#390). One
   * table, made once by the launcher: the adapter's tool call still writes it, and the entry reads and forgets from it.
   */
  readonly reviews: TheReviewSpawns
  /** The envelope this host writes when an agent fails, in its own names; absent, no report names a review. */
  readonly failed_review_report?: TheReportTheHostWrites | undefined
  /** Where a line about a failed review goes (martha#390): the owner's row and the member. Absent, nothing is told. */
  readonly told?: WhereTheFailedReviewIsTold | undefined
  /**
   * The agents the host started under this launch's sessions (martha#170). One table, made once by the launcher: a
   * called tool writes it here, and the adapter's agent start, stop and result read it until they move (PR 3).
   */
  readonly agents: TheAgentRuns
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
  readonly signed_runs?: { callAllowed(tool: string, input: Readonly<Record<string, unknown>>): void } | undefined
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
 * One agent the host started under a member's session (martha#170), and whether it may be vouched for.
 *
 * The host stamps the agent's id on its start and stop, and on every tool call the agent makes under the member's own
 * session id; the member's own calls carry none. So the launcher can name an agent and count what it did, which is
 * what "vouched" needs: seen to start, seen to stop, every call it made answered here, and nothing those calls read
 * that the gate counts.
 */
export interface AgentRun {
  readonly session_id: string
  /** The tool calls the agent made, by the host's id for each. */
  readonly calls_seen: Set<string>
  /** Those of them this launcher answered. */
  readonly calls_answered: Set<string>
  /** Whether this launcher saw the host say the agent started; a call with an id but no start is not vouched. */
  started: boolean
  stopped: boolean
  /**
   * The rows its own calls recorded: text it read that the gate counts, and so text its answer may quote. An agent that
   * read outside the approved tree is not vouched for even with every call answered (martha#170, the design's case 7).
   */
  readonly calls_recorded: string[]
}

/** The agents of one launch, by the id the host stamps. */
export type TheAgentRuns = Map<string, AgentRun>

/** The table of one launch's agents, made once by the launcher. */
export const agentRunsKept = (): TheAgentRuns => new Map<string, AgentRun>()

/** The run kept for an agent, made on first sight: a call with an id it never saw start is still one. */
export function runOf(agents: TheAgentRuns, session_id: string, agent_id: string): AgentRun {
  const existing = agents.get(agent_id)
  if (existing !== undefined) return existing
  const run: AgentRun = { session_id, calls_seen: new Set(), calls_answered: new Set(), started: false, stopped: false, calls_recorded: [] }
  agents.set(agent_id, run)
  return run
}

/**
 * Whether an agent may be vouched for: seen to start, seen to stop, every call it made answered here, and nothing those
 * calls read that the gate counts — an agent's answer is its own work on the member's own inputs only if it read no
 * text from outside them.
 */
export function vouchedRun(run: AgentRun | undefined): boolean {
  return (
    run !== undefined && run.started && run.stopped && run.calls_recorded.length === 0 && [...run.calls_seen].every((id) => run.calls_answered.has(id))
  )
}

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
  /** A review the host saw fail (martha#390), named on the row and to the member, for a session this launch holds. */
  aReviewTheHostSawFail(report: AReviewTheHostSawFail): Promise<void>
  /**
   * Takes in a session the crew refreshed before the host's own start of it was answered, or says why its record could
   * not be kept. The mod's tool call still asks it here until it moves (martha#541, PR 3).
   */
  takeInARefreshedSession(session_id: string): Promise<string | undefined>
  /**
   * A called tool, before it runs: allowed, or denied and why. Each refusal is asked in its order (the owner's settings,
   * their memory, the gate, the crew's reviewer-model rule, a held end), and an allowed call is counted against the
   * package's spend before it is allowed (martha#513).
   */
  aToolCalled(call: ACalledTool): Promise<TheAnswerToACall>
}

/** The answers one launch gives, over the sessions it has taken a start of. */
export function answersOver(
  places: ThePlacesAHostReportsOver,
  sessions: Map<string, HostSession> = new Map<string, HostSession>(),
): TheAnswersOfOneLaunch {
  /** Why this session may be answered for no more, for the rest of this process. */
  const broken = new Map<string, string>()
  let queue: Promise<unknown> = Promise.resolve()

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

  const held: TheSessionsHeld = { places, sessions, broken, keep, vouchFor }

  return {
    records: places.records,
    inOrder: <T>(work: () => Promise<T>): Promise<T> => {
      const next = queue.then(work)
      queue = next.catch(() => undefined)
      return next
    },
    holds: (session_id) => sessions.has(session_id),
    brokenBecause: (session_id) => broken.get(session_id),
    named: (session_id) => sessionNamed(session_id, sessions, broken),
    keep,
    vouchFor,
    approved_start,
    aSessionStarted: async (start) => aSessionStartedIn(held, start),
    aTurnArrived: async (session_id, turn) => aTurnArrivedIn(held, session_id, turn),
    aReviewTheHostSawFail: async (report) => aReviewTheHostSawFailIn(held, report),
    takeInARefreshedSession: async (session_id) => takeInARefreshedSessionIn(held, session_id),
    aToolCalled: async (call) => aToolCalledIn(held, call),
  }
}

/** What the delivery family's answers share: the launch's places, the sessions it holds and has broken, and how it keeps one. */
interface TheSessionsHeld {
  readonly places: ThePlacesAHostReportsOver
  readonly sessions: Map<string, HostSession>
  readonly broken: ReadonlyMap<string, string>
  keep(session: HostSession): Promise<string | undefined>
  vouchFor(session: HostSession): Promise<HostSession | string>
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

async function aSessionStartedIn(held: TheSessionsHeld, start: AStartingSession): Promise<TheAnswerToAStart> {
  const lost = held.broken.get(start.session_id)
  if (lost !== undefined) return { refused: lost }
  // A second start of a session this launch already holds changes nothing: re-beginning it would wipe the record the
  // first one kept, which is exactly the wipe a `clear` after a refresh would be (martha#255).
  if (held.sessions.has(start.session_id)) return { taken: '' }
  await held.places.records.load(start.session_id)
  const started = startSessionAs(held.places.records.store, await asTheCrewsRefresh(held, start))
  const line = await theLineThisSessionStartsOn(held.places.crew)
  const why = await held.keep(handedAtStart(held.places, started, line))
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
 * its run, then every refusal in its order. An allowed call is counted against the package's spend before it runs
 * (martha#513, slice 3), so a call whose row cannot be kept does not run and a member cannot spend where nothing counts
 * it. Only then is it noted as a signed run, a review it lets through remembered, and its turn's end told it is in
 * flight.
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
  const uncounted = await noteTheCallCounted(places.crew, session.id, places.names.ownNameOf(call.tool))
  if (uncounted !== undefined) return { denied: uncounted }
  places.signed_runs?.callAllowed(call.tool, call.input)
  await noteTheReviewThisLaunchLetThrough(places, call)
  places.crew?.ends.aCallAllowed(session.id, call.call_id ?? '')
  return { allowed: 1 }
}

/** A call an agent made, noted on its run as one of the calls "every call it made" counts; the member's own note nothing. */
function noteTheAgentsCall(agents: TheAgentRuns, session: HostSession, call: ACalledTool): void {
  if (call.agent_id === undefined) return
  const run = runOf(agents, session.id, call.agent_id)
  if (call.call_id !== undefined) run.calls_seen.add(call.call_id)
}

/**
 * The agents whose run stands between a member and its shell (martha#170): only for the member's own calls, because an
 * agent's own calls are the ones being recorded. A run the launcher never saw start is named as one.
 */
function agentsToHold(agents: TheAgentRuns, session: HostSession, call: ACalledTool): readonly string[] {
  if (call.agent_id !== undefined) return []
  return [...agents.entries()]
    .filter(([, run]) => run.session_id === session.id && !run.stopped)
    .map(([id, run]) => (run.started ? id : `an agent this launcher never saw start (${id})`))
}

/** Why this call is refused before it runs, or undefined: the owner's settings, their memory, the gate, the crew's reviewer-model rule, a held end. */
async function theDenialOfACall(places: ThePlacesAHostReportsOver, session: HostSession, call: ACalledTool): Promise<string | undefined> {
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
    agents_running: agentsToHold(places.agents, session, call),
    ...(places.gate === undefined ? {} : { gate: places.gate }),
    audit: places.audit,
    contract: await theContractACrewHolds(places.crew, { tool: call.tool, input: call.input }, places.names),
    spend: await theSpendACrewHolds(places.crew, session.id),
  })?.deny
  if (verdict !== undefined) return verdict
  // The crew's reviewer-model rule stands beside the gate and never inside it (martha#315): a call a reviewer's role
  // may not make is refused after the gate has allowed it, and never in place of the gate's own answer. A held end of
  // the turn (martha#311 ruling D) is asked last of all, so it only turns a yes into a no.
  return (await places.crew?.refusesTheSubagent({ tool: call.tool, input: call.input })) ?? places.crew?.ends.deniesACall(session.id)
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
 * The line this session is handed as it starts (martha#254 test 10): the acts of the package this member holds that
 * were sent with no outcome recorded. Null when the member holds no package, nothing of it is waiting, or the ledger
 * cannot be read: a start the ledger could not be read for is still a start.
 */
async function theLineThisSessionStartsOn(crew: CrewTools | undefined): Promise<TheStartLine | null> {
  if (crew === undefined) return null
  try {
    return await crew.theLineToHandAtStart()
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
