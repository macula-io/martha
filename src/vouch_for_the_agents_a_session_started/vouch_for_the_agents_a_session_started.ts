// What a launcher knows of the agents its member's session started, and whether one may be vouched for (martha#170).
//
// The host stamps `agent_id` on a SubagentStart and a SubagentStop, and on every tool call the agent makes under the
// member's own session id; the member's own calls carry none. So the launcher can name an agent and can count what it
// did, which is what "vouched" needs: seen to start, seen to stop, every call it made answered here, and nothing those
// calls read that the gate counts.
//
// The table is the launcher's own, one run per agent id, and this slice only reads and notes it: what a vouched agent's
// answer means for the shell is the relay's (../answer_the_relay), and the host's own table of which tools hand an
// agent's answer back is the adapter's (../claude_code_host).

import { theAgentInAToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

type Body = Readonly<Record<string, unknown>>

const isBody = (value: unknown): value is Body => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

/**
 * One agent the host started under a member's session (martha#170), and whether it may be vouched for.
 *
 * The host stamps `agent_id` on a SubagentStart and a SubagentStop, and on every tool call the agent makes under the
 * member's own session id; the member's own calls carry none. So the launcher can name an agent and can count what it
 * did, which is what "vouched" needs: seen to start, seen to stop, every call it made answered here, and nothing those
 * calls read that the gate counts.
 */
export interface AgentRun {
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

/** Every run this launcher keeps, by the id the host stamped on the agent. */
export type TheRunTable = Map<string, AgentRun>

/** How the launcher places an agent a tool result or a call names, from its own run of that agent. */
export interface HowAnAgentStands {
  readonly id: string
  readonly state: 'vouched' | 'running' | 'unknown'
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

/** The agent a call names, if the host stamped one: absent for the member's own calls. */
export function agentIdOf(call: Body): string | undefined {
  const id = call['agent_id']
  return isText(id) ? id : undefined
}

/** How this launcher knows the agent a tool result hands back (martha#170). */
export function agentStateOf(runs: TheRunTable, id: unknown): HowAnAgentStands | undefined {
  if (!isText(id)) return undefined
  const run = runs.get(id)
  if (run === undefined) return { id, state: 'unknown' }
  if (vouchedRun(run)) return { id, state: 'vouched' }
  return { id, state: run.stopped ? 'unknown' : 'running' }
}

/** The agents started under this session that have not stopped, by id: the shell is refused while any of them runs. */
export function agentsRunning(runs: TheRunTable, session_id: string): readonly string[] {
  return [...runs.entries()]
    .filter(([, run]) => run.session_id === session_id && !run.stopped)
    .map(([id, run]) => (run.started ? id : `an agent this launcher never saw start (${id})`))
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
export function agentOfAResult(
  runs: TheRunTable,
  call: { readonly agent_id: string | undefined },
  answer: unknown,
): HowAnAgentStands | undefined {
  const fromTheAnswer = theAgentInAToolResult(answer)
  if (fromTheAnswer !== undefined) return agentStateOf(runs, fromTheAnswer)
  return call.agent_id === undefined ? undefined : agentStateOf(runs, call.agent_id)
}

/** The run this launcher keeps for an agent, made on first sight: a call with an id it never saw start is still one. */
export function runOf(runs: TheRunTable, session_id: string, agent_id: string): AgentRun {
  const existing = runs.get(agent_id)
  if (existing !== undefined) return existing
  const run: AgentRun = { session_id, calls_seen: new Set(), calls_answered: new Set(), started: false, stopped: false, calls_recorded: [] }
  runs.set(agent_id, run)
  return run
}

/** A call the agent made, by the host's `tool_use_id`: one of the calls "every call it made" counts. */
export function noteCallSeen(runs: TheRunTable, session_id: string, agent_id: string, call: unknown): void {
  const run = runOf(runs, session_id, agent_id)
  const id = isBody(call) && isText(call['tool_use_id']) ? call['tool_use_id'] : undefined
  if (id !== undefined) run.calls_seen.add(id)
}

/** That same call, answered here. */
export function noteCallAnswered(runs: TheRunTable, agent_id: string, call: unknown): void {
  const run = runs.get(agent_id)
  const id = isBody(call) && isText(call['tool_use_id']) ? call['tool_use_id'] : undefined
  if (run !== undefined && id !== undefined) run.calls_answered.add(id)
}

/** The rows an agent's own call recorded: text it read from outside the member's own inputs (martha#170). */
export function noteItsCallsRecorded(runs: TheRunTable, agent_id: string, recorded: readonly string[]): void {
  runs.get(agent_id)?.calls_recorded.push(...recorded)
}

/** A call the agent made, noted as one of its calls; the member's own calls carry no id and note nothing (martha#170). */
export function noteTheAgentsCall(runs: TheRunTable, session_id: string, body: Body): string | undefined {
  const agent_id = agentIdOf((body['call'] ?? {}) as Body)
  if (agent_id !== undefined) noteCallSeen(runs, session_id, agent_id, body['call'])
  return agent_id
}

/** That same call, answered here, back with the agent it belonged to (martha#170). */
export function noteAnAgentsAnswer(runs: TheRunTable, body: Body): string | undefined {
  const agent_id = agentIdOf((body['call'] ?? {}) as Body)
  if (agent_id !== undefined) noteCallAnswered(runs, agent_id, body['call'])
  return agent_id
}

/**
 * The rows an agent's answered call read, kept on its run: an agent that read text the gate counts is not vouched for,
 * and its answer records B7 when it stops (martha#170, the design's case 7). A call with no agent, or one that read
 * nothing, keeps nothing.
 */
export function noteWhatItsCallsRead(runs: TheRunTable, agent_id: string | undefined, recorded: readonly string[]): void {
  if (agent_id !== undefined && recorded.length > 0) noteItsCallsRecorded(runs, agent_id, recorded)
}

/**
 * The agents whose run stands between a member and its shell (martha#170): the member's own calls only, because an
 * agent's own calls are the ones being recorded, and the shell a member loses while its agent runs is about the text
 * the agent hands back, not about the agent's own work.
 */
export function agentsToHold(runs: TheRunTable, session_id: string, agent_id: string | undefined): readonly string[] {
  return agent_id === undefined ? agentsRunning(runs, session_id) : []
}
