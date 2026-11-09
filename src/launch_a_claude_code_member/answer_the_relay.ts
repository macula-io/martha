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
// | tool_answered (the same call, after it ran) | the member's own write kept (martha#132), then `recheckLaunchPassingOwnWrites(launch)`, the settings files read again for a key that turns the relay off (martha#122) or a hook or plugin the owner's user or managed settings now declare (martha#121), then for an MCP tool `takeInTurn(session, { source: sourceOfAMeshToolResult(ownName) }, binder)`: a ring's answer on A5, what answering a ring returns on A4, any other result on B2; and for one of the host's own `takeInToolResult(session, { tool, input, rows: CLAUDE_CODE_TOOL_RESULT_ROWS, launch, approved_start, host }, binder)`, where `approved_start` is the checkout's tree read when the relay was made, kept only when that state is one the owner approved (martha#127) |
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
import { CLAUDE_CODE_TOOL_RESULT_ROWS, isMcpToolCall, sessionStartOf, type SessionStartHookInput } from '../claude_code_host/claude_code_host.ts'
import { namesTheOwnersSettings, type HookSettingsWatch } from '../claude_code_host/settings_that_turn_hooks_off.ts'
import type { ToolNames, TurnSource } from '../host_contract/host_contract.ts'
import { sourceOfAMeshToolResult } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { arrivalOfPrompt, CLAUDE_CODE_PROMPT_ORIGINS, whatAPromptCarries } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { recheckLaunchPassingOwnWrites } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import { fingerprintOf, readLaunchState } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rememberSession, takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { takeInToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { ALLOW, TAKEN, type RelayEvent, type Refused, type Taken, type Verdict } from '../claude_code_relay/hooks/relay_protocol.ts'
import { rememberOwnWriteOfCall } from './remember_own_write_of_a_call.ts'
import type { SessionRecords } from './session_records_in_rows.ts'

/** What the launcher sends back, or that it is stopping the member and sends nothing. */
export type RelayReply =
  | { readonly answered: true; readonly body: Taken | Refused | Verdict }
  | { readonly answered: false; readonly stopping: string }

export interface MemberRelay {
  answer(event: RelayEvent, body: unknown): Promise<RelayReply>
}

export interface MemberRelayPlace {
  readonly records: SessionRecords
  /** The member's launch, as `prepareLaunch` was given it. */
  readonly launch: ApprovedLaunch
  readonly policy: Policy
  /** How the host names a called tool: the adapter's `host.tools`. */
  readonly names: ToolNames
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
  /** Sends SIGKILL to the member's process group. */
  stopMember(why: string): void
}

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
}

/** The launcher's answers for one member. */
export function memberRelay(place: MemberRelayPlace): MemberRelay {
  const state: RelayState = {
    place,
    approved_start: approvedStartTree(place.launch),
    sessions: new Map<string, HostSession>(),
    broken: new Map<string, string>(),
  }
  let queue: Promise<unknown> = Promise.resolve()

  const stop = (why: string): RelayReply => stopMember(place, why)

  const handlers: Readonly<Record<RelayEvent, (body: Body) => Promise<RelayReply>>> = {
    session_started: async (body) => sessionStarted(state, body),
    prompt_submitted: async (body) => promptSubmitted(state, body),
    tool_called: async (body) => toolCalled(state, body),
    tool_answered: async (body) => toolAnswered(state, body),
  }

  /** What an event gets when its body is no body, or its handler failed. */
  const failed: Readonly<Record<RelayEvent, (why: string) => RelayReply>> = {
    session_started: refused,
    prompt_submitted: refused,
    tool_called: denied,
    tool_answered: stop,
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
  }
}

/**
 * The checkout's tree as it is now, before the host starts, when the owner
 * approved this start state; `null` otherwise. A checkout with no config is
 * launched whatever it holds and approves nothing, so it gets `null`, and
 * every read in it counts (decided 2026-11-07, martha#127).
 */
function approvedStartTree(launch: ApprovedLaunch): string | null {
  const state = readLaunchState(launch, thisMachine)
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

async function toolCalled(state: RelayState, body: Body): Promise<RelayReply> {
  const { place } = state
  const session = sessionNamed(state, body.session_id)
  if (typeof session === 'string') return denied(session)
  const call = callOf(body)
  if (call === undefined) return denied('the tool call names no tool')
  const unvouched = await vouchFor(state, session)
  if (unvouched !== undefined) return denied(unvouched)
  const settings = namesTheOwnersSettings(call.input, place.hookSettings.owners_file, place.launch.launch_dir, place.hookSettings.home)
  if (settings !== undefined) return denied(settings)
  const verdict = answerToolCall({
    tool: call.tool,
    session,
    policy: place.policy,
    input: call.input,
    launch: place.launch,
    names: place.names,
    host: thisMachine,
  })
  return verdict === undefined ? answered(ALLOW) : denied(verdict.deny)
}

async function toolAnswered(state: RelayState, body: Body): Promise<RelayReply> {
  const { place } = state
  const session = sessionNamed(state, body.session_id)
  if (typeof session === 'string') return stopMember(place, session)
  const call = callOf(body)
  if (call === undefined) return stopMember(place, 'a tool ran that the relay could not name')
  // Kept before the recheck, so the write this call made is not taken for an outsider's (martha#132).
  const unkept = rememberOwnWriteOfCall(place.launch, { tool: call.tool, input: call.input, session: session.id, home: place.hookSettings.home }, thisMachine)
  if (unkept !== undefined) return stopMember(place, unkept)
  const launched = recheckLaunchPassingOwnWrites(place.launch, thisMachine)
  if (!launched.allow) return stopMember(place, launched.refusal)
  const hooksOff = place.hookSettings.check()
  if (hooksOff !== undefined) return stopMember(place, hooksOff)
  const taken = isMcpToolCall(call.tool)
    ? takeInTurn(session, { source: sourceOfAMeshToolResult(place.names.ownNameOf(call.tool)) }, place.binder)
    : takeInToolResult(
        session,
        { tool: call.tool, input: call.input, rows: CLAUDE_CODE_TOOL_RESULT_ROWS, launch: place.launch, approved_start: state.approved_start, host: thisMachine },
        place.binder,
      )
  if (taken.gate.ingested.length === session.gate.ingested.length) return answered(TAKEN)
  const why = await keep(state, taken)
  return why === undefined ? answered(TAKEN) : stopMember(place, why)
}
