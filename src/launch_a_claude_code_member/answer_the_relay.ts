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
// | tool_answered (the same call, after it ran, with the host's answer) | the member's own write kept (martha#132), then `recheckLaunchPassingOwnWrites(launch)`, the settings files read again for a key that turns the relay off (martha#122) or a hook or plugin the owner's user or managed settings now declare (martha#121), then for an MCP tool `takeInTurn(session, { source: sourceOfAMeshToolResult(ownName) }, binder)`: a ring's answer on A5, what answering a ring returns on A4, any other result on B2; and for one of the host's own `takeInToolResult(session, { tool, input, rows: CLAUDE_CODE_TOOL_RESULT_ROWS, launch, approved_start, host }, binder)`, where `approved_start` is the checkout's tree read when the relay was made, kept only when that state is one the owner approved (martha#127), except a `martha run <name>` whose answer is exactly the one its receipt builds, which records nothing (martha#129) |
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
import { CLAUDE_CODE_SESSION_EVENTS, startSession } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import {
  CLAUDE_CODE_READ_ATTACHES_NOTHING,
  CLAUDE_CODE_TOOL_RESULT_ROWS,
  isMcpToolCall,
  sessionStartOf,
  type SessionStartHookInput,
} from '../claude_code_host/claude_code_host.ts'
import { namesTheOwnersSettings, type HookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import type { ToolNames, TurnSource } from '../host_contract/host_contract.ts'
import { sourceOfAMeshToolResult } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { arrivalOfPrompt, CLAUDE_CODE_PROMPT_ORIGINS, whatAPromptCarries } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { recheckLaunchPassingOwnWrites } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import { fingerprintOf, readLaunchState, type StartedWith } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rememberSession, takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { takeInToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { ALLOW, TAKEN, type Ran, type RelayEvent, type Refused, type Taken, type Verdict } from '../claude_code_relay/hooks/relay_protocol.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { rememberOwnWriteOfCall } from './remember_own_write_of_a_call.ts'
import type { SessionRecords } from './session_records_in_rows.ts'
import { writesTheOwnersMemory, type OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'

/** What the launcher sends back, or that it is stopping the member and sends nothing. */
export type RelayReply =
  | { readonly answered: true; readonly body: Taken | Refused | Verdict }
  | { readonly answered: false; readonly stopping: string }

export interface MemberRelay {
  answer(event: RelayEvent, body: unknown): Promise<RelayReply>
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
  /** Where the owner's sessions load memory and instructions from, which a member does not write (martha#136). */
  readonly ownerMemory: OwnerMemoryPlaces
  /** The member's signed runs (martha#129); a member without them runs no shape. */
  readonly signed_runs?: SignedRuns
  /** Sends SIGKILL to the member's process group. */
  stopMember(why: string): void
}

/** Why a run is refused for a member launched without signed runs. */
export const NO_SIGNED_RUNS = 'this member was launched with no signed shapes to run'

const answered = (body: Taken | Refused | Verdict): RelayReply => ({ answered: true, body })
const refused = (why: string): RelayReply => answered({ refused: why })
const denied = (why: string): RelayReply => answered({ deny: why })

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

/** The launcher's answers for one member. */
export function memberRelay(place: MemberRelayPlace): MemberRelay {
  const state: RelayState = {
    place,
    approved_start: approvedStartTree(place.launch),
    sessions: new Map<string, HostSession>(),
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
      const next = queue.then(async () => {
        if (!isBody(body)) return failed[event]('the relay sent no body the launcher reads')
        try {
          return await handlers[event](body)
        } catch (error) {
          return failed[event](`the launcher failed to answer (${error instanceof Error ? error.message : String(error)})`)
        }
      })
      queue = next.catch(() => undefined)
      return next
    },
    run: async (body) => (place.signed_runs === undefined ? { refused: NO_SIGNED_RUNS } : place.signed_runs.run(body)),
  }
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
  const start = sessionStartOf(body as SessionStartHookInput)
  await state.place.records.load(start.session_id)
  const started = startSession(state.place.records.store, CLAUDE_CODE_SESSION_EVENTS, start)
  const handed = state.place.handed_at_start.reduce(
    (session, source) => takeInTurn(session, { source }, state.place.binder),
    started,
  )
  const why = await keep(state, handed)
  return why === undefined ? answered(TAKEN) : refused(why)
}

async function promptSubmitted(state: RelayState, body: Body): Promise<RelayReply> {
  const session = sessionNamed(state, body.session_id)
  if (typeof session === 'string') return refused(session)
  const origin = body.origin
  if (typeof body.text !== 'string' || !isBody(origin) || !isText(origin.kind)) {
    return refused('the prompt carries no text or no origin the engine stamped')
  }
  const arrival = arrivalOfPrompt(CLAUDE_CODE_PROMPT_ORIGINS, origin.kind, whatAPromptCarries(body))
  const why = await keep(state, takeInTurn(session, arrival, state.place.binder))
  return why === undefined ? answered(TAKEN) : refused(why)
}

function callOf(body: Body): { readonly tool: string; readonly input: Body } | undefined {
  const call = body.call
  if (!isBody(call) || !isText(call.tool)) return undefined
  const { tool, ...input } = call
  return { tool, input }
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
  call: { readonly tool: string; readonly input: Body; readonly agent_id?: string },
  answer: unknown,
): Promise<{ readonly reply: RelayReply; readonly recorded: readonly string[] }> {
  const { place } = state
  const agent = isAnAgentsAnswerTool(call.tool) ? agentStateOf(state, agentIdIn(answer)) : undefined
  const taken = isMcpToolCall(call.tool)
    ? takeInTurn(session, { source: sourceOfAMeshToolResult(place.names.ownNameOf(call.tool)) }, place.binder)
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
          // host stamps on the result (`tool_response.agentId`), for the member's own Agent call and for a handback.
          ...(agent === undefined ? {} : { agent }),
        },
        place.binder,
      )
  const recorded = taken.gate.ingested.slice(session.gate.ingested.length).map((ingestion) => ingestion.path)
  if (recorded.length === 0) return { reply: answered(TAKEN), recorded }
  const why = await keep(state, taken)
  return { reply: why === undefined ? answered(TAKEN) : stopMember(place, why), recorded }
}
