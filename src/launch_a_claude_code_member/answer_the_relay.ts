// What a member's launcher answers its relay (#41).
//
// This exists so every gate the core keeps is asked, in the launcher, about
// each event the member's host raises, and so every event the launcher cannot
// vouch for is refused.
//
// The relay (../claude_code_relay) forwards the engine's fields unchanged and
// holds no policy. Everything is decided here, by the core, through the
// adapter's mappings (../claude_code_host):
//
// | Event the relay posts | What the launcher does |
// |---|---|
// | session_started (the settings SessionStart hook's input) | `startSession(store, CLAUDE_CODE_SESSION_EVENTS, sessionStartOf(input))`, then `takeInTurn` of each source the launch hands the model by itself (`handed_at_start`, martha#121), then keeps the record |
// | prompt_submitted (`text`, the engine's `origin`, `command`, `isMeta`) | `takeInTurn(session, arrivalOfPrompt(kinds, origin.kind, whatAPromptCarries(body)), binder)`, then keeps the record |
// | tool_called (the engine's call) | the session's stored record read back, a call naming the owner's user settings file denied (martha#122), then `answerToolCall({ tool, session, policy, input, launch, names })` |
// | tool_answered (the same call, after it ran, with the host's answer) | the member's own write kept (martha#132), then `recheckLaunchPassingOwnWrites(launch)`, the settings files read again for a key that turns the relay off (martha#122) or a hook or plugin the owner's user or managed settings now declare (martha#121), then for an MCP tool `takeInTurn(session, { source: sourceOfAMeshToolResult(ownName) }, binder)`: a ring's answer on A5, what answering a ring returns on A4, any other result on B2 — except a `mesh_hello` or `mesh_goodbye` answer whose every leaf came from this launch (`wordsInAMeshAnswer`), which takes nothing in and keeps the member's shell (B9, martha#251); and for one of the host's own `takeInToolResult(session, { tool, input, rows: CLAUDE_CODE_TOOL_RESULT_ROWS, launch, approved_start, host }, binder)`, where `approved_start` is the checkout's tree read when the relay was made, kept only when that state is one the owner approved (martha#127), except a `martha run <name>` whose answer is exactly the one its receipt builds, which records nothing (martha#129) |
//
// Failing closed, per event, so the relay never chooses (Mars's point 3):
//
//   - a session with no start taken, or whose record could not be kept, is
//     refused: its prompts are dropped and its tools denied, for the rest of
//     this process. A refused append (ROW_NOT_DURABLE among them) is never "allow,
//     the row failed";
//   - after a tool ran, anything but a clean recheck and a kept record stops the
//     member: the launcher sends SIGKILL to its process group, and the relay's
//     request is never answered, so the hook never returns;
//   - a body not in the shape the relay sends is refused like the rest.
//
// Events are answered one at a time, in the order they arrive: a host runs tool
// calls in parallel, and each answer reads the record the one before it wrote.

import type { Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { answerToolCall, type ApprovedLaunch } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { CLAUDE_CODE_SESSION_EVENTS, CREW_REFRESH, startSession, type SessionStart } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import {
  CLAUDE_CODE_READ_ATTACHES_NOTHING,
  CLAUDE_CODE_TOOL_RESULT_ROWS,
  isMcpToolCall,
  sessionStartOf,
  type SessionStartHookInput,
} from '../claude_code_host/claude_code_host.ts'
import { namesTheOwnersSettings, type HookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import type { Arrival, ToolNames, TurnSource } from '../host_contract/host_contract.ts'
import { sourceOfAMeshToolResult } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { wordsInAMeshAnswer, type WhatTheLaunchSupplies } from '../prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts'
import { senderOfARingResult } from '../read_a_ring_results_sender/read_a_ring_results_sender.ts'
import { arrivalOfPrompt, CLAUDE_CODE_PROMPT_ORIGINS, whatAPromptCarries } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { recheckLaunchPassingOwnWrites } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import { fingerprintOf, readLaunchState, type StartedWith } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rememberSession, takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { takeInToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { ALLOW, TAKEN, type Answered, type Ran, type RelayEvent, type Refused, type Taken, type TakenWithAHandedLine, type Verdict } from '../claude_code_relay/hooks/relay_protocol.ts'
import type { CrewTools, TheStartLine } from '../a_crews_tools/a_crews_tools.ts'
import type { TurnRaising } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { rememberOwnWriteOfCall } from './remember_own_write_of_a_call.ts'
import type { JournalAnswer, RelayJournal } from './keep_the_relays_journal.ts'
import type { SessionRecords } from '../session_records_in_rows/session_records_in_rows.ts'
import { writesTheOwnersMemory, type OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'

/** What the launcher sends back, or that it is stopping the member and sends nothing. */
export type RelayReply =
  | { readonly answered: true; readonly body: Taken | TakenWithAHandedLine | Refused | Verdict }
  | { readonly answered: false; readonly stopping: string }

export interface MemberRelay {
  answer(event: RelayEvent, body: unknown): Promise<RelayReply>
  /**
   * A tool call the crew's mod posted (martha#254): the core's answer, unchanged, or a refusal naming the tool this
   * launcher registers nothing for. Answered on its own, not through the event queue, so a tool call never waits
   * behind a turn's events.
   */
  answerTool(body: unknown): Promise<Answered | Refused>
  /** `martha run <name>` asks for a signed shape (martha#129); answered outside the event queue, as a run takes long. */
  run(body: unknown): Promise<Ran | Refused>
}

export interface MemberRelayPlace {
  readonly records: SessionRecords
  /** The member's launch, as `prepareLaunch` was given it. */
  readonly launch: ApprovedLaunch
  readonly policy: Policy
  /** How the host names a called tool: the adapter's `host.tools`. */
  readonly names: ToolNames
  /**
   * What this launch started the host with, down to the names its adapter declares (martha#135): the arguments and
   * environment `spawn` got, so a read's exemption can ask what really started the host.
   */
  readonly started_with: StartedWith
  /** `bindNothing` until the host attests a sender (A6, anthropics/claude-code#107216). */
  readonly binder: Binder
  /**
   * What the launch puts into every session it starts by itself, which the
   * owner's approval does not bind: an approved hook's output (A7), a server's
   * instruction block (A11). The adapter's `sourcesALaunchHandsTheModel`.
   */
  readonly handed_at_start: readonly TurnSource[]
  /** The settings files the host reads, watched for a key that turns the relay off (martha#122). */
  readonly hookSettings: HookSettingsWatch
  /**
   * Whether the owner turned the strict gate on in the crew's declaration (martha#259): the launcher reads
   * `house_rules.strict_gate` once and hands it here, and every answer this relay gives follows it. Absent means on, so
   * a place built by a caller that has not heard of the setting keeps the guard.
   */
  readonly strict_gate?: boolean
  /** Where the owner's sessions load memory and instructions from, which a member does not write (martha#136). */
  readonly ownerMemory: OwnerMemoryPlaces
  /** The member's signed runs (martha#129); a member without them runs no shape. */
  readonly signed_runs?: SignedRuns
  /** The crew's tools, answered by the slices behind them (martha#254); a launch with none answers no tool. */
  readonly crew?: CrewTools
  /**
   * What this launch supplied a mesh answer, and which answer may be read as the member's own (martha#251). Absent,
   * no MCP answer is read that way and every one records on B2, as it did before this existed: a caller that cannot
   * say what it supplied gets the taint, not a guess.
   */
  readonly wordless_answers?: Omit<WhatTheLaunchSupplies, 'input'>
  /**
   * What this launch raises every turn the host took in to (martha#253): the crew channel's readers wait on it, so a
   * message is counted as taken in only when the host raised it back. A launch given none raises nothing, and a turn
   * is still recorded.
   */
  readonly turns?: TurnRaising
  /**
   * What this launch is doing, for the run that waits on it (martha#240): a line when it receives an event and one when
   * it answers it. A run watching a launcher with none reads the terminal and the requests alone, as #210 left it.
   */
  readonly journal?: RelayJournal
  /** Sends SIGKILL to the member's process group. */
  stopMember(why: string): void
}

/** Why a run is refused for a member launched without signed runs. */
export const NO_SIGNED_RUNS = 'this member was launched with no signed shapes to run'

const answered = (body: Taken | TakenWithAHandedLine | Refused | Verdict): RelayReply => ({ answered: true, body })
const refused = (why: string): RelayReply => answered({ refused: why })
const denied = (why: string): RelayReply => answered({ deny: why })

/** What the journal's answer line says: the one word a run reading it needs, without the launcher's whole answer. */
const journalAnswerOf = (reply: RelayReply): JournalAnswer => {
  if (!reply.answered) return 'stopped'
  if ('allow' in reply.body) return 'allow'
  if ('deny' in reply.body) return 'deny'
  if ('taken' in reply.body) return 'taken'
  return 'refused'
}

/** Why the launcher answered that, where the answer carries a reason; the journal keeps it beside the answer. */
const refusalReasonOf = (reply: RelayReply): string | undefined => {
  if (!reply.answered) return reply.stopping
  if ('deny' in reply.body) return reply.body.deny
  if ('refused' in reply.body) return reply.body.refused
  return undefined
}

type Body = Readonly<Record<string, unknown>>

const isBody = (value: unknown): value is Body => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** What one member's answers share: its place, and every session it has taken a start of or refused. */
interface RelayState {
  readonly place: MemberRelayPlace
  /** The checkout's tree when this relay was made, before the host started, if the owner approved that state: what a read is exempt against (martha#127). */
  readonly approved_start: string | null
  readonly sessions: Map<string, HostSession>
  readonly broken: Map<string, string>
  /** The agents this host has started under a session, by the id the host stamps (martha#170). */
  readonly agents: Map<string, AgentRun>
}

/**
 * One agent the host started under a member's session (martha#170), and whether it may be vouched for.
 *
 * The host stamps `agent_id` on a SubagentStart and a SubagentStop, and on every tool call the agent makes under the
 * member's own session id; the member's own calls carry none. So the launcher can name an agent and can count what it
 * did, which is what "vouched" needs: seen to start, seen to stop, every call it made answered here, and nothing those
 * calls read that the gate counts.
 */
interface AgentRun {
  readonly session_id: string
  /** The tool calls the agent made, by the host's own `tool_use_id`. */
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

/**
 * Whether an agent may be vouched for: seen to start, seen to stop, every call it made answered here, and nothing those
 * calls read that the gate counts — an agent's answer is its own work on the member's own inputs only if it read no
 * text from outside them.
 */
function vouchedRun(run: AgentRun | undefined): boolean {
  return (
    run !== undefined && run.started && run.stopped && run.calls_recorded.length === 0 && [...run.calls_seen].every((id) => run.calls_answered.has(id))
  )
}

/** The agent a call names, if the host stamped one: absent for the member's own calls. */
function agentIdOf(call: Body): string | undefined {
  const id = call['agent_id']
  return isText(id) ? id : undefined
}

/** How this launcher knows the agent a tool result hands back (martha#170). */
function agentStateOf(state: RelayState, id: unknown): { readonly id: string; readonly state: 'vouched' | 'running' | 'unknown' } | undefined {
  if (!isText(id)) return undefined
  const run = state.agents.get(id)
  if (run === undefined) return { id, state: 'unknown' }
  if (vouchedRun(run)) return { id, state: 'vouched' }
  return { id, state: run.stopped ? 'unknown' : 'running' }
}

/** The agents started under this session that have not stopped: the shell is refused while any of them runs. */
function agentsRunning(state: RelayState, session: HostSession): readonly string[] {
  return [...state.agents.values()]
    .filter((run) => run.session_id === session.id && !run.stopped)
    .map((run) => (run.started ? 'an agent' : 'an agent this launcher never saw start'))
}

/**
 * The agent a tool result belongs to, however the host names it (martha#170).
 *
 * The host stamps the id on the answer for the member's own call (`tool_response.agentId`). When the *agent* makes
 * the call it stamps the id on the call instead and the answer carries none: a real `SubagentHandback` is the agent's
 * own report to its caller, its output is `{success, message}`, and the only id is the one on the call.
 *
 * The id on the call is looked up in the launcher's own run table, exactly as the answer's id is: whatever the call
 * carries, the answer is placed by what this launcher knows of that agent and never by the fact that a call named one.
 * A run it holds and has not seen stop places the answer as a running agent's, whatever brought the run into being:
 * it records nothing, and the `SubagentStop` decides. An id it has no run of, or one whose run stopped without being
 * vouched, is unknown and records on B7 at once.
 * So a handback cannot be used to hand text into the turn and be done with it: vouched, it is the agent's own work on
 * the member's own inputs; anything else, the shell closes on its text.
 */
function agentOfAResult(
  state: RelayState,
  call: { readonly agent_id: string | undefined },
  answer: unknown,
): { readonly id: string; readonly state: 'vouched' | 'running' | 'unknown' } | undefined {
  const fromTheAnswer = agentIdIn(answer)
  if (fromTheAnswer !== undefined) return agentStateOf(state, fromTheAnswer)
  return call.agent_id === undefined ? undefined : agentStateOf(state, call.agent_id)
}

/** The launcher's answers for one member. */
export function memberRelay(place: MemberRelayPlace, sessions: Map<string, HostSession> = new Map<string, HostSession>()): MemberRelay {
  const state: RelayState = {
    place,
    approved_start: approvedStartTree(place.launch),
    sessions,
    broken: new Map<string, string>(),
    agents: new Map<string, AgentRun>(),
  }
  let queue: Promise<unknown> = Promise.resolve()

  const stop = (why: string): RelayReply => stopMember(place, why)

  const handlers: Readonly<Record<RelayEvent, (body: Body) => Promise<RelayReply>>> = {
    session_started: async (body) => sessionStarted(state, body),
    prompt_submitted: async (body) => promptSubmitted(state, body),
    tool_called: async (body) => toolCalled(state, body),
    tool_answered: async (body) => toolAnswered(state, body),
    subagent_started: async (body) => subagentStarted(state, body),
    subagent_stopped: async (body) => subagentStopped(state, body),
  }

  /** What an event gets when its body is no body, or its handler failed. */
  const failed: Readonly<Record<RelayEvent, (why: string) => RelayReply>> = {
    session_started: refused,
    prompt_submitted: refused,
    tool_called: denied,
    tool_answered: stop,
    // An agent's start or stop this launcher cannot take in leaves the agent unvouched for, so its answer closes the
    // shell; the event itself is only refused, never the member stopped, because nothing ran.
    subagent_started: refused,
    subagent_stopped: refused,
  }

  return {
    answer: (event, body) => {
      // The receipt line is stamped here, synchronously, before the event queues: an event waiting its turn is timed
      // from when it arrived rather than from when the queue reached it (martha#240).
      const journaled = place.journal?.received(event, body)
      const next = queue.then(async () => {
        const reply = await answerOne(event, body)
        // Written before the answer goes back, so an event this launcher has answered is on disk at once.
        journaled?.answered(journalAnswerOf(reply), refusalReasonOf(reply))
        return reply
      })
      queue = next.catch(() => undefined)
      return next
    },
    run: async (body) => (place.signed_runs === undefined ? { refused: NO_SIGNED_RUNS } : place.signed_runs.run(body)),
    answerTool: async (body) => answerACoreTool(state, body),
  }

  /** One event, answered; never throws, so the journal's answer line is written whatever the event did. */
  async function answerOne(event: RelayEvent, body: unknown): Promise<RelayReply> {
    if (!isBody(body)) return failed[event]('the relay sent no body the launcher reads')
    try {
      return await handlers[event](body)
    } catch (error) {
      return failed[event](`the launcher failed to answer (${error instanceof Error ? error.message : String(error)})`)
    }
  }
}

/** What a launch with no crew place answers a tool call: nothing, by name (martha#254). */
export const NO_CREW_TOOLS = 'this launch was given no crew place, so it answers no tool'

/**
 * A tool call the crew's mod posted (martha#254): its session, the tool's own name, and its arguments. The core's
 * slice decides the answer, and the launcher hands it back unchanged; a name the crew registers nothing for is
 * refused by name, never answered as though it had been.
 */
async function answerACoreTool(state: RelayState, body: unknown): Promise<Answered | Refused> {
  const place = state.place
  if (place.crew === undefined) return { refused: NO_CREW_TOOLS }
  const call = bodyOfAToolCall(body)
  if (call === undefined) return { refused: 'the tool call is not one this launcher reads: it wants a session, a tool and its arguments' }
  // The mod's question at a refreshed session's start is a tool call, and it can arrive before the host's own `clear`
  // start: taking the session in here is what makes the order of the host's two events not matter (martha#255).
  const why = await takeInARefreshedSession(state, call.session_id)
  if (why !== undefined) return { refused: why }
  return place.crew.answer(call.tool, call.args, call.session_id)
}

/** A tool call's three fields, or undefined when the body is not one. */
function bodyOfAToolCall(body: unknown): { readonly session_id: string; readonly tool: string; readonly args: Readonly<Record<string, unknown>> } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { session_id, tool, args } = body as Record<string, unknown>
  if (typeof session_id !== 'string' || typeof tool !== 'string') return undefined
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return { session_id, tool, args: args as Readonly<Record<string, unknown>> }
}

/** What a mesh tool's result is taken in as: its row, and the node id the result itself attests where the row's station attestation is really there (martha#247). */
function arrivalOfAMeshToolResult(own_name: string, input: unknown, answer: unknown): Arrival {
  const source = sourceOfAMeshToolResult(own_name)
  const sender = senderOfARingResult(own_name, input, answer)
  return sender === undefined ? { source: source as Exclude<TurnSource, 'cross_session'> } : { source: source as Exclude<TurnSource, 'cross_session'>, ...sender }
}

/**
 * The checkout's tree as it is now, before the host starts, when the owner
 * approved this start state; `null` otherwise. A checkout with no config is
 * launched whatever it holds and approves nothing, so it gets `null`, and
 * every read in it counts (decided 2026-11-07, martha#127).
 */
function approvedStartTree(launch: ApprovedLaunch): string | null {
  const state = readLaunchState(launch, thisMachine, launch.approved_tree)
  return launch.approved_fingerprints.includes(fingerprintOf(state)) ? state.tree : null
}

function stopMember(place: MemberRelayPlace, why: string): RelayReply {
  place.stopMember(why)
  return { answered: false, stopping: why }
}

/** The session an event names, or why the launcher cannot vouch for it. */
function sessionNamed(state: RelayState, session_id: unknown): HostSession | string {
  if (!isText(session_id)) return 'the event names no session'
  const lost = state.broken.get(session_id)
  if (lost !== undefined) return lost
  return state.sessions.get(session_id) ?? `no start of session ${session_id} was taken, so nothing it takes in can be recorded`
}

/** Marks the session broken for the rest of this process, and says why. */
function breakSession(state: RelayState, session: HostSession, why: string): string {
  state.sessions.delete(session.id)
  state.broken.set(session.id, why)
  return why
}

/** Keeps the session's record, or marks the session broken and says why. */
async function keep(state: RelayState, session: HostSession): Promise<string | undefined> {
  rememberSession(state.place.records.store, session)
  try {
    await state.place.records.flush(session.id)
    state.sessions.set(session.id, session)
    return undefined
  } catch (error) {
    const code = (error as { code?: unknown }).code
    const why = `the record of session ${session.id} could not be kept (${typeof code === 'string' ? code : String(error)}), so nothing in it is answered for again`
    return breakSession(state, session, why)
  }
}

/** Checks the session's stored record is still the one kept, or marks it broken and says why. */
async function vouchFor(state: RelayState, session: HostSession): Promise<string | undefined> {
  try {
    await state.place.records.check(session.id)
    return undefined
  } catch (error) {
    const code = (error as { code?: unknown }).code
    const why = `the record of session ${session.id} can no longer be vouched for (${typeof code === 'string' ? code : error instanceof Error ? error.message : String(error)}), so nothing in it is answered for again`
    return breakSession(state, session, why)
  }
}

async function sessionStarted(state: RelayState, body: Body): Promise<RelayReply> {
  if (!isText(body.session_id) || !isText(body.source)) return refused('the session start names no session or no source')
  if (state.broken.has(body.session_id)) return refused(state.broken.get(body.session_id) ?? '')
  // A second start of a session this launch already holds changes nothing: re-beginning it would wipe the record the
  // first one kept, which is exactly the wipe a `clear` after a refresh would be (martha#255).
  if (state.sessions.has(body.session_id)) return answered(TAKEN)
  const reported = sessionStartOf(body as SessionStartHookInput)
  await state.place.records.load(reported.session_id)
  const started = startSession(state.place.records.store, CLAUDE_CODE_SESSION_EVENTS, await asTheCrewsRefresh(state, reported))
  // What the crew hands this session is taken in with what the launch hands it (martha#317), before the record is kept:
  // a line the record does not hold would reach the model with no gate behind it.
  const lineToStartOn = await theLineThisSessionStartsOn(state.place.crew)
  const handed = [...state.place.handed_at_start, ...(lineToStartOn?.taken_in ?? [])].reduce(
    (session, source) => takeInTurn(session, { source }, state.place.binder),
    started,
  )
  const why = await keep(state, handed)
  if (why !== undefined) return refused(why)
  return answered(lineToStartOn === null ? TAKEN : { taken: 1, handed: lineToStartOn.line })
}

/**
 * The start the crew's own refresh makes of a session, when this start is the successor's (martha#255): one the crew's
 * flow says it cleared from is started as `crew_refresh` with that predecessor, whatever the host called it. So a
 * `clear` after a refresh can never wipe the record the successor inherited. A session this launch already holds never
 * reaches here — its start was answered as taken — and one it holds is refused a predecessor by
 * `theRefreshTheSessionInherits`, so the refresh that made it stands.
 */
async function asTheCrewsRefresh(state: RelayState, reported: SessionStart): Promise<SessionStart> {
  const predecessor = await theRefreshTheSessionInherits(state, reported.session_id)
  return predecessor === null ? reported : { event: CREW_REFRESH, session_id: reported.session_id, predecessor_id: predecessor }
}

/** The session a clear was told in, when this id is the one the crew is waiting for: the crew's own answer, or none. */
async function theRefreshTheSessionInherits(state: RelayState, session_id: string): Promise<string | null> {
  if (state.place.crew === undefined || state.sessions.has(session_id) || state.broken.has(session_id)) return null
  try {
    return await state.place.crew.thePredecessorOf(session_id)
  } catch {
    return null
  }
}

/**
 * Takes in a session the crew refreshed before the host's own start of it has been answered (martha#255): the mod's
 * question at its start, or the resume prompt it submits, can arrive first, and a session this launcher has not taken
 * in is refused. It is made here exactly as the host's start would make it — inheriting the predecessor's record.
 */
async function takeInARefreshedSession(state: RelayState, session_id: string): Promise<string | undefined> {
  if (state.sessions.has(session_id) || state.broken.has(session_id)) return undefined
  const predecessor = await theRefreshTheSessionInherits(state, session_id)
  if (predecessor === null) return undefined
  await state.place.records.load(session_id)
  const started = startSession(state.place.records.store, CLAUDE_CODE_SESSION_EVENTS, {
    event: CREW_REFRESH,
    session_id,
    predecessor_id: predecessor,
  })
  const handed = state.place.handed_at_start.reduce((session, source) => takeInTurn(session, { source }, state.place.binder), started)
  return keep(state, handed)
}

/**
 * The line this session is handed as it starts (martha#254 design line 53, test 10): the acts of the package this
 * member holds that were sent with no outcome recorded, so a session resuming a package checks what became of them
 * instead of hoping it asks. Null when the member holds no package, nothing of it is waiting, or the ledger cannot be
 * read — a start the ledger could not be read for is still a start, and the member can ask with what_was_sent.
 */
async function theLineThisSessionStartsOn(crew: CrewTools | undefined): Promise<TheStartLine | null> {
  if (crew === undefined) return null
  try {
    return await crew.theLineToHandAtStart()
  } catch {
    return null
  }
}

async function promptSubmitted(state: RelayState, body: Body): Promise<RelayReply> {
  if (isText(body.session_id)) {
    const why = await takeInARefreshedSession(state, body.session_id)
    if (why !== undefined) return refused(why)
  }
  const session = sessionNamed(state, body.session_id)
  if (typeof session === 'string') return refused(session)
  const origin = body.origin
  if (typeof body.text !== 'string' || !isBody(origin) || !isText(origin.kind)) {
    return refused('the prompt carries no text or no origin the engine stamped')
  }
  const arrival = arrivalOfPrompt(CLAUDE_CODE_PROMPT_ORIGINS, origin.kind, whatAPromptCarries(body))
  const why = await keep(state, takeInTurn(session, arrival, state.place.binder))
  if (why !== undefined) return refused(why)
  // The turn is kept, so the host really took it in: it is raised to whatever waits on turns, in the shape the host
  // contract names (martha#253). A prompt this launcher refused is never raised.
  state.place.turns?.prompted(body.text, origin.kind, whatAPromptCarries(body))
  return answered(TAKEN)
}

function callOf(body: Body): { readonly tool: string; readonly input: Body; readonly agent_id: string | undefined } | undefined {
  const call = body.call
  if (!isBody(call) || !isText(call.tool)) return undefined
  const { tool, ...input } = call
  return { tool, input, agent_id: agentIdOf(call) }
}

/** The agent a tool result hands back, as the host stamps it: `tool_response.agentId` (martha#170). */
function agentIdIn(answer: unknown): unknown {
  return isBody(answer) ? answer['agentId'] : undefined
}

/** Whether a tool hands an agent's answer back: the host's own table places every one of these on the subagent row. */
function isAnAgentsAnswerTool(tool: string): boolean {
  return CLAUDE_CODE_TOOL_RESULT_ROWS[tool]?.reads === 'an_agents_answer'
}

/** The run this launcher keeps for an agent, made on first sight: a call with an id it never saw start is still one. */
function runOf(state: RelayState, session: HostSession, agent_id: string): AgentRun {
  const existing = state.agents.get(agent_id)
  if (existing !== undefined) return existing
  const run: AgentRun = { session_id: session.id, calls_seen: new Set(), calls_answered: new Set(), started: false, stopped: false, calls_recorded: [] }
  state.agents.set(agent_id, run)
  return run
}

/** A call the agent made, by the host's `tool_use_id`: one of the calls "every call it made" counts. */
function noteCallSeen(state: RelayState, session: HostSession, agent_id: string, call: unknown): void {
  const run = runOf(state, session, agent_id)
  const id = isBody(call) && isText(call['tool_use_id']) ? call['tool_use_id'] : undefined
  if (id !== undefined) run.calls_seen.add(id)
}

/** That same call, answered here. */
function noteCallAnswered(state: RelayState, agent_id: string, call: unknown): void {
  const run = state.agents.get(agent_id)
  const id = isBody(call) && isText(call['tool_use_id']) ? call['tool_use_id'] : undefined
  if (run !== undefined && id !== undefined) run.calls_answered.add(id)
}

/** The rows an agent's own call recorded: text it read from outside the member's own inputs (martha#170). */
function noteItsCallsRecorded(state: RelayState, agent_id: string, recorded: readonly string[]): void {
  state.agents.get(agent_id)?.calls_recorded.push(...recorded)
}

/** A call the agent made, noted as one of its calls; the member's own calls carry no id and note nothing (martha#170). */
function noteTheAgentsCall(state: RelayState, session: HostSession, body: Body): string | undefined {
  const agent_id = agentIdOf((body['call'] ?? {}) as Body)
  if (agent_id !== undefined) noteCallSeen(state, session, agent_id, body['call'])
  return agent_id
}

/** That same call, answered here, back with the agent it belonged to (martha#170). */
function noteAnAgentsAnswer(state: RelayState, body: Body): string | undefined {
  const agent_id = agentIdOf((body['call'] ?? {}) as Body)
  if (agent_id !== undefined) noteCallAnswered(state, agent_id, body['call'])
  return agent_id
}

/**
 * The rows an agent's answered call read, kept on its run: an agent that read text the gate counts is not vouched for,
 * and its answer records B7 when it stops (martha#170, the design's case 7). A call with no agent, or one that read
 * nothing, keeps nothing.
 */
function noteWhatItsCallsRead(state: RelayState, agent_id: string | undefined, recorded: readonly string[]): void {
  if (agent_id !== undefined && recorded.length > 0) noteItsCallsRecorded(state, agent_id, recorded)
}

/**
 * The agents whose run stands between a member and its shell (martha#170): the member's own calls only, because an
 * agent's own calls are the ones being recorded, and the shell a member loses while its agent runs is about the text
 * the agent hands back, not about the agent's own work.
 */
function agentsToHold(state: RelayState, session: HostSession, agent_id: string | undefined): readonly string[] {
  return agent_id === undefined ? agentsRunning(state, session) : []
}

/** The host says an agent started under this session (martha#170): only this makes an agent one it saw start. */
async function subagentStarted(state: RelayState, body: Body): Promise<RelayReply> {
  const session = sessionNamed(state, body.session_id)
  if (typeof session === 'string') return refused(session)
  if (!isText(body.agent_id)) return refused('the agent start names no agent')
  runOf(state, session, body.agent_id).started = true
  return answered(TAKEN)
}

/**
 * The host says an agent stopped (martha#170), which is the only report of a background agent's answer: the host
 * delivers that text into the member's turn with no tool result to place it on.
 *
 * A vouched agent's answer is nothing new and the shell stays. Any other agent's answer is a subagent's text: it is
 * recorded on B7 here, so the shell closes from this moment on, whichever call the member makes next.
 */
async function subagentStopped(state: RelayState, body: Body): Promise<RelayReply> {
  const session = sessionNamed(state, body.session_id)
  if (typeof session === 'string') return refused(session)
  if (!isText(body.agent_id)) return refused('the agent stop names no agent')
  const run = runOf(state, session, body.agent_id)
  run.stopped = true
  if (vouchedRun(run)) return answered(TAKEN)
  const why = await keep(state, takeInTurn(session, { source: 'subagent' }, state.place.binder))
  return why === undefined ? answered(TAKEN) : refused(why)
}

async function toolCalled(state: RelayState, body: Body): Promise<RelayReply> {
  const { place } = state
  const session = sessionNamed(state, body.session_id)
  if (typeof session === 'string') return denied(session)
  const call = callOf(body)
  if (call === undefined) return denied('the tool call names no tool')
  const unvouched = await vouchFor(state, session)
  if (unvouched !== undefined) return denied(unvouched)
  const agent_id = noteTheAgentsCall(state, session, body)
  const settings = namesTheOwnersSettings(call.input, place.hookSettings.owners_file, place.launch.launch_dir, place.hookSettings.home)
  if (settings !== undefined) return denied(settings)
  const memory = writesTheOwnersMemory(call.tool, call.input, place.ownerMemory, place.launch.launch_dir, place.hookSettings.home, thisMachine)
  if (memory !== undefined) return denied(memory)
  const verdict = answerToolCall({
    tool: call.tool,
    session,
    policy: place.policy,
    input: call.input,
    launch: place.launch,
    names: place.names,
    host: thisMachine,
    agents_running: agentsToHold(state, session, agent_id),
    ...(place.strict_gate === undefined ? {} : { strict_gate: place.strict_gate }),
  })
  if (verdict !== undefined) return denied(verdict.deny)
  place.signed_runs?.callAllowed(call.tool, call.input)
  return answered(ALLOW)
}

async function toolAnswered(state: RelayState, body: Body): Promise<RelayReply> {
  const { place } = state
  const session = sessionNamed(state, body.session_id)
  if (typeof session === 'string') return stopMember(place, session)
  const call = callOf(body)
  if (call === undefined) return stopMember(place, 'a tool ran that the relay could not name')
  // An agent's own call, answered here: what "every call it made was answered" counts (martha#170).
  const answering = noteAnAgentsAnswer(state, body)
  // The receipt is single use: taken now, whatever the answer, so a later call takes none of it (martha#129).
  const kept = place.signed_runs?.callAnswered(call.tool, call.input, body.answer)
  const unvouched = recheckBeforeRecording(place, session, call)
  if (unvouched !== undefined) return stopMember(place, unvouched)
  // A `martha run <name>` whose answer is exactly the one its receipt builds records nothing (martha#129): the run's
  // output is text the owner vouched for, so the shell stays. Every other result records, as #127 leaves it.
  if (kept !== undefined && kept.why === undefined) return answered(TAKEN)
  const { reply, recorded } = await recordToolResult(state, session, call, body.answer)
  noteWhatItsCallsRead(state, answering, recorded)
  return reply
}

/** The own write kept and every recheck, or why the member is stopped (#132, #121, #122). */
function recheckBeforeRecording(place: MemberRelayPlace, session: HostSession, call: { readonly tool: string; readonly input: Body }): string | undefined {
  // Kept before the recheck, so the write this call made is not taken for an outsider's (martha#132).
  const unkept = rememberOwnWriteOfCall(place.launch, { tool: call.tool, input: call.input, session: session.id, home: place.hookSettings.home }, thisMachine)
  if (unkept !== undefined) return unkept
  const launched = recheckLaunchPassingOwnWrites(place.launch, thisMachine)
  return launched.allow ? place.hookSettings.check() : launched.refusal
}

/** What the call's result records: a mesh tool's answer, or the host's own result by #127's table, and the rows it added. */
async function recordToolResult(
  state: RelayState,
  session: HostSession,
  call: { readonly tool: string; readonly input: Body; readonly agent_id: string | undefined },
  answer: unknown,
): Promise<{ readonly reply: RelayReply; readonly recorded: readonly string[] }> {
  const { place } = state
  const agent = isAnAgentsAnswerTool(call.tool) ? agentOfAResult(state, call, answer) : undefined
  // A mesh tool's own session answer may carry nothing of anyone else's (martha#251): read first, so an answer whose
  // every leaf came from this launch takes nothing in and the member keeps the shell it needs for the ring it was
  // about to make. Every other answer, this tool's included when the launch cannot say what it supplied, records on
  // B2 exactly as before.
  const own_name = place.names.ownNameOf(call.tool)
  const wordless = place.wordless_answers === undefined ? undefined : wordsInAMeshAnswer(own_name, answer, { ...place.wordless_answers, input: call.input })
  if (wordless?.reads_nothing === true) return { reply: answered(TAKEN), recorded: [] }
  const taken = isMcpToolCall(call.tool)
    ? takeInTurn(session, arrivalOfAMeshToolResult(own_name, call.input, answer), place.binder)
    : takeInToolResult(
        session,
        {
          tool: call.tool,
          input: call.input,
          rows: CLAUDE_CODE_TOOL_RESULT_ROWS,
          launch: place.launch,
          approved_start: state.approved_start,
          started_with: place.started_with,
          read_attaches_nothing: CLAUDE_CODE_READ_ATTACHES_NOTHING,
          host: thisMachine,
          // An agent's answer is placed by the agent, not by the tool's name alone (martha#170): the id is the one the
          // host stamps on the answer (`tool_response.agentId`) for the member's own Agent call, and the one on the
          // call itself when the agent hands its report back.
          ...(agent === undefined ? {} : { agent }),
        },
        place.binder,
      )
  const recorded = taken.gate.ingested.slice(session.gate.ingested.length).map((ingestion) => ingestion.path)
  if (recorded.length === 0) return { reply: answered(TAKEN), recorded }
  const why = await keep(state, taken)
  return { reply: why === undefined ? answered(TAKEN) : stopMember(place, why), recorded }
}
