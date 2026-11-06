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
// | session_started (the settings SessionStart hook's input) | `startSession(store, CLAUDE_CODE_SESSION_EVENTS, sessionStartOf(input))`, then keeps the record |
// | prompt_submitted (`text`, the engine's `origin`) | `takeInTurn(session, arrivalOfPrompt(kinds, origin.kind), binder)`, then keeps the record |
// | tool_called (the engine's call) | the session's stored record read back, then `answerToolCall({ tool, session, policy, input, launch, names })` |
// | tool_answered (the same call, after it ran) | `recheckLaunch(launch)`, and for an MCP tool `takeInTurn(session, { source: 'mcp_result' }, binder)` |
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
import { isMcpToolCall, sessionStartOf, type SessionStartHookInput } from '../claude_code_host/claude_code_host.ts'
import type { ToolNames } from '../host_contract/host_contract.ts'
import { arrivalOfPrompt, CLAUDE_CODE_PROMPT_ORIGINS } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { recheckLaunch } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { rememberSession, takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { ALLOW, TAKEN, type RelayEvent, type Refused, type Taken, type Verdict } from '../claude_code_relay/hooks/relay_protocol.ts'
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
  /** Sends SIGKILL to the member's process group. */
  stopMember(why: string): void
}

const answered = (body: Taken | Refused | Verdict): RelayReply => ({ answered: true, body })
const refused = (why: string): RelayReply => answered({ refused: why })
const denied = (why: string): RelayReply => answered({ deny: why })

type Body = Readonly<Record<string, unknown>>

const isBody = (value: unknown): value is Body => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** The launcher's answers for one member. */
export function memberRelay(place: MemberRelayPlace): MemberRelay {
  const sessions = new Map<string, HostSession>()
  const broken = new Map<string, string>()
  let queue: Promise<unknown> = Promise.resolve()

  const stop = (why: string): RelayReply => {
    place.stopMember(why)
    return { answered: false, stopping: why }
  }

  /** The session an event names, or why the launcher cannot vouch for it. */
  const sessionNamed = (session_id: unknown): HostSession | string => {
    if (!isText(session_id)) return 'the event names no session'
    const lost = broken.get(session_id)
    if (lost !== undefined) return lost
    return sessions.get(session_id) ?? `no start of session ${session_id} was taken, so nothing it takes in can be recorded`
  }

  /** Keeps the session's record, or marks the session broken and says why. */
  const keep = async (session: HostSession): Promise<string | undefined> => {
    rememberSession(place.records.store, session)
    try {
      await place.records.flush()
      sessions.set(session.id, session)
      return undefined
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const why = `the record of session ${session.id} could not be kept (${typeof code === 'string' ? code : String(error)}), so nothing in it is answered for again`
      sessions.delete(session.id)
      broken.set(session.id, why)
      return why
    }
  }

  /** Checks the session's stored record is still the one kept, or marks it broken and says why. */
  const vouchFor = async (session: HostSession): Promise<string | undefined> => {
    try {
      await place.records.check(session.id)
      return undefined
    } catch (error) {
      const code = (error as { code?: unknown }).code
      const why = `the record of session ${session.id} can no longer be vouched for (${typeof code === 'string' ? code : error instanceof Error ? error.message : String(error)}), so nothing in it is answered for again`
      sessions.delete(session.id)
      broken.set(session.id, why)
      return why
    }
  }

  const sessionStarted = async (body: Body): Promise<RelayReply> => {
    if (!isText(body.session_id) || !isText(body.source)) return refused('the session start names no session or no source')
    if (broken.has(body.session_id)) return refused(broken.get(body.session_id) ?? '')
    const start = sessionStartOf(body as SessionStartHookInput)
    await place.records.load(start.session_id)
    const why = await keep(startSession(place.records.store, CLAUDE_CODE_SESSION_EVENTS, start))
    return why === undefined ? answered(TAKEN) : refused(why)
  }

  const promptSubmitted = async (body: Body): Promise<RelayReply> => {
    const session = sessionNamed(body.session_id)
    if (typeof session === 'string') return refused(session)
    const origin = body.origin
    if (typeof body.text !== 'string' || !isBody(origin) || !isText(origin.kind)) {
      return refused('the prompt carries no text or no origin the engine stamped')
    }
    const arrival = arrivalOfPrompt(CLAUDE_CODE_PROMPT_ORIGINS, origin.kind)
    const why = await keep(takeInTurn(session, arrival, place.binder))
    return why === undefined ? answered(TAKEN) : refused(why)
  }

  const callOf = (body: Body): { readonly tool: string; readonly input: Body } | undefined => {
    const call = body.call
    if (!isBody(call) || !isText(call.tool)) return undefined
    const { tool, ...input } = call
    return { tool, input }
  }

  const toolCalled = async (body: Body): Promise<RelayReply> => {
    const session = sessionNamed(body.session_id)
    if (typeof session === 'string') return denied(session)
    const call = callOf(body)
    if (call === undefined) return denied('the tool call names no tool')
    const unvouched = await vouchFor(session)
    if (unvouched !== undefined) return denied(unvouched)
    const verdict = answerToolCall({
      tool: call.tool,
      session,
      policy: place.policy,
      input: call.input,
      launch: place.launch,
      names: place.names,
    })
    return verdict === undefined ? answered(ALLOW) : denied(verdict.deny)
  }

  const toolAnswered = async (body: Body): Promise<RelayReply> => {
    const session = sessionNamed(body.session_id)
    if (typeof session === 'string') return stop(session)
    const call = callOf(body)
    if (call === undefined) return stop('a tool ran that the relay could not name')
    const launched = recheckLaunch(place.launch)
    if (!launched.allow) return stop(launched.refusal)
    if (!isMcpToolCall(call.tool)) return answered(TAKEN)
    const why = await keep(takeInTurn(session, { source: 'mcp_result' }, place.binder))
    return why === undefined ? answered(TAKEN) : stop(why)
  }

  const handlers: Readonly<Record<RelayEvent, (body: Body) => Promise<RelayReply>>> = {
    session_started: sessionStarted,
    prompt_submitted: promptSubmitted,
    tool_called: toolCalled,
    tool_answered: toolAnswered,
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
