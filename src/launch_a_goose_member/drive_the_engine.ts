// The engine driven over ACP by its launch (#541 package A, design G1 and r=7, PASS issuecomment-7010033523): the
// client opened on the engine's stdio, the session made and read back, and every permission request and every update
// put to the launch's one entry, in the entry's one order.
//
// What it holds, in the order it runs:
//   - `initialize`, then `session/new` on the launch's folder with no tool server: the config root names the crew's
//     server and no other, so the client hands the engine none of its own;
//   - the mode check (design r=1 row 2): a session that reports any mode but the one the config set, or none, is refused
//     before any turn; the engine's silence is never read as the mode that asks;
//   - the first read of the session store (design r=5 item 1): the session's row is held to what the launch created,
//     its working folder the launch's own folder among them, and its gate fields are kept as the snapshot;
//   - at every permission request: the call is marked asked (rule (a)), and the store is read back while the engine
//     waits on the answer (design r=6 item 4); a difference stops the member and refuses the call; only then does the
//     request reach the gate (C4's `theGooseGate`, the entry's `aToolCalled`) and the owner's asks after it;
//   - at every update: rule (a) (../speak_acp_to_an_agent/the_calls_an_agent_ran.ts) stops the member on a call run
//     unasked, and an asked call's result is handed to the entry's `aResultCame`, whose stop stops the member;
//   - a refresh's clear (martha#1002, option B, design PASS r=2): a new session opened by the same path, its id added
//     to the sessions the launch opened, read back and made current, and only then the predecessor closed, once its
//     prompt has returned. Only the current session is answered: a permission request or a call's result naming any
//     other session stops the member (T4, the predecessor's turn still running at the clear).
// The entry's calls go through its `inOrder`, the same queue the crew's tool relay answers through.

import type { ChildProcess } from 'node:child_process'

import type { TheAnswersOfOneLaunch } from '../answer_what_a_host_reports/answer_what_a_host_reports.ts'
import { THE_EXTENSION_A_MEMBER_KEEPS } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import type { TheGate } from '../hear_an_acp_agents_asks/hear_an_acp_agents_asks.ts'
import type { AResultOfACall } from '../host_contract/host_contract.ts'
import type { EngineFacts } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { theEnginesNameOf, theGooseGate } from '../speak_acp_to_an_agent/answer_a_goose_call_by_the_entry.ts'
import { AcpClient, type APermissionRequest, type AToolCall, type Decide } from '../speak_acp_to_an_agent/the_acp_client.ts'
import { theCallsAnAgentRan } from '../speak_acp_to_an_agent/the_calls_an_agent_ran.ts'
import { NO_SESSION_READ_BACK } from './the_engines_places.ts'
import { theSessionsFirstRead, theSessionStillHolds, type TheSessionLaunched, type TheSessionsGate } from './the_session_store_read_back.ts'

/** The session's gate fields as the first read took them, kept where the entry's re-check reads them. */
export interface TheSessionsGateKept {
  get(): TheSessionsGate | undefined
  set(gate: TheSessionsGate): void
}

/** A new keeping, empty until the first read. */
export function theSessionsGateKept(): TheSessionsGateKept {
  let kept: TheSessionsGate | undefined
  return { get: () => kept, set: (gate) => void (kept = gate) }
}

/** What driving the engine is given. */
export interface TheEngineToDrive {
  readonly facts: Pick<EngineFacts, 'tool_naming' | 'session_store'>
  /** The engine, started with its stdio piped. */
  readonly child: ChildProcess
  /** The launch's folder: the session's working folder. */
  readonly launch_dir: string
  /** The session store under the launch's root (`theSessionStoreOf`). */
  readonly store: string
  /** What the launch created the session with, besides its id and folder: the mode, the provider, the model, the extensions. */
  readonly launched: Omit<TheSessionLaunched, 'session_id' | 'working_dir'>
  /** The launch's one entry: its order, and the two answers the client reaches. */
  readonly answers: Pick<TheAnswersOfOneLaunch, 'inOrder' | 'aToolCalled' | 'aResultCame'>
  /** Where the snapshot is kept for the entry's re-check (`TheEnginesOwnPlaces.the_sessions_gate`). */
  readonly session_gate: TheSessionsGateKept
  /** The decision after the gate: the owner's asks (../hear_an_acp_agents_asks), made over the launch's gate. */
  readonly decideOver: (gate: TheGate) => Decide
  /** Stops the member, why given: the launch ends the engine. */
  readonly stopMember: (why: string) => void
}

/** A session opened and read back, or why not. */
export type ASessionOpened = { readonly session_id: string } | { readonly refusal: string }

/** The engine, driven: its client, its first session, and the clear's way to the next one. */
export interface TheEngineDriven {
  readonly client: AcpClient
  readonly session_id: string
  /**
   * Opens the next session, reads it back and makes it current, then closes the one it follows (martha#1002). A
   * refusal leaves the member to be stopped: the store may then hold a row the gate does not.
   */
  readonly aNewSession: () => Promise<ASessionOpened>
}

/** Why the member stops when the engine speaks for a session that is not the current one (martha#1002 design point 5). */
export const theLineOfAnotherSession = (what: string, session_id: string, current: string | undefined): string =>
  `the engine sent ${what} for session ${session_id}, and only the current session ${String(current)} is answered`

/** A result in the contract's words, or why it cannot be put to the entry. */
export function aResultOf(call: AToolCall, session_id: string, naming: EngineFacts['tool_naming']): AResultOfACall | { readonly why: string } {
  const tool = theEnginesNameOf({ sessionId: session_id, toolCallId: call.toolCallId, title: '', rawInput: call.rawInput, heard: call }, naming)
  if (tool === undefined) return { why: `the engine named no tool for call ${call.toolCallId}, so its result cannot be recorded` }
  const input = call.rawInput
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { why: `the arguments of call ${call.toolCallId} are not an object, so its result cannot be recorded` }
  return {
    session_id,
    tool,
    input: input as Readonly<Record<string, unknown>>,
    call_id: call.toolCallId,
    answer: call.rawOutput ?? call.content,
    from_a_tool_server: !tool.startsWith(`${THE_EXTENSION_A_MEMBER_KEEPS}${naming.separator}`),
  }
}

/** Opens the engine's session and puts every request and update to the entry; or why the start is refused. */
export async function driveTheEngine(asked: TheEngineToDrive): Promise<TheEngineDriven | { readonly refusal: string }> {
  const { facts, answers } = asked
  const nameOf = (call: AToolCall): string =>
    theEnginesNameOf({ sessionId: '', toolCallId: call.toolCallId, title: '', rawInput: call.rawInput, heard: call }, facts.tool_naming) ?? call.title ?? call.toolCallId
  const calls = theCallsAnAgentRan(nameOf)
  const gate = theGooseGate({ aToolCalled: async (call) => answers.inOrder(async () => answers.aToolCalled(call)) }, facts.tool_naming)
  const decide = asked.decideOver(gate)

  const theSessionHolds = (): string | undefined => {
    const snapshot = asked.session_gate.get()
    return snapshot === undefined ? NO_SESSION_READ_BACK : theSessionStillHolds(facts, asked.store, snapshot)
  }
  const current = (): string | undefined => asked.session_gate.get()?.id
  /** Whether a request names another session than the current one; if so the member is stopped, naming it. */
  const fromAnotherSession = (request: Pick<APermissionRequest, 'sessionId'>): boolean => {
    if (request.sessionId === current()) return false
    asked.stopMember(theLineOfAnotherSession('a permission request', request.sessionId, current()))
    return true
  }
  const atARequest: Decide = async (request, withdrawn) => {
    if (fromAnotherSession(request)) return 'reject'
    calls.asked(request.sessionId, request.toolCallId)
    const why = theSessionHolds()
    if (why !== undefined) {
      asked.stopMember(why)
      return 'reject'
    }
    return decide(request, withdrawn)
  }
  const atAnUpdate = (session_id: string, update: unknown): void => {
    const said = calls.heard(session_id, update)
    if ('stop' in said) asked.stopMember(said.stop)
    if (!('result' in said)) return
    if (session_id !== current()) {
      asked.stopMember(theLineOfAnotherSession(`the result of call ${said.result.toolCallId}`, session_id, current()))
      return
    }
    const result = aResultOf(said.result, session_id, facts.tool_naming)
    if ('why' in result) {
      asked.stopMember(result.why)
      return
    }
    void answers.inOrder(async () => answers.aResultCame(result)).then(
      (answer) => ('stop' in answer ? asked.stopMember(answer.stop) : undefined),
      (error: unknown) => asked.stopMember(`the result of call ${result.call_id ?? ''} could not be answered for (${error instanceof Error ? error.message : String(error)})`),
    )
  }

  // A request outside any turn is already answered cancelled by the client; one naming another session stops the member.
  const client = AcpClient.overAChild(asked.child, atARequest, atAnUpdate, (request) => void fromAnotherSession(request))
  try {
    await client.initialize()
  } catch (error) {
    return { refusal: theSessionNotOpened(error) }
  }
  const opened: string[] = []
  const first = await aSessionOpened(client, asked, opened)
  if ('refusal' in first) return first
  return { client, session_id: first.session_id, aNewSession: async () => theNextSession(client, asked, opened) }
}

/** The next session opened and made current, then the one it follows closed once its prompt has returned; or why not. */
async function theNextSession(client: AcpClient, asked: Parameters<typeof aSessionOpened>[1], opened: string[]): Promise<ASessionOpened> {
  const predecessor = asked.session_gate.get()?.id
  const next = await aSessionOpened(client, asked, opened)
  if ('refusal' in next || predecessor === undefined) return next
  try {
    await client.closeSession(predecessor)
  } catch (error) {
    return { refusal: `the engine's session ${predecessor} was not closed (${error instanceof Error ? error.message : String(error)})` }
  }
  return next
}

/** Why a session was not opened, from what the client threw. */
const theSessionNotOpened = (error: unknown): string => `the engine's session was not opened (${error instanceof Error ? error.message : String(error)})`

/**
 * One session opened on the launch's folder, its mode checked, its id added to the sessions the launch opened, its row
 * read back against what the launch created, and the kept gate moved to it; or why not.
 */
async function aSessionOpened(client: AcpClient, asked: Pick<TheEngineToDrive, 'facts' | 'store' | 'launched' | 'launch_dir' | 'session_gate'>, opened: string[]): Promise<ASessionOpened> {
  try {
    const session = await client.newSession(asked.launch_dir)
    if (session.currentModeId !== asked.launched.mode) {
      return { refusal: `the engine reports mode ${String(session.currentModeId)} for its session, and only ${asked.launched.mode} brings every call to the launch` }
    }
    opened.push(session.sessionId)
    const first = theSessionsFirstRead(asked.facts, asked.store, { ...asked.launched, session_id: session.sessionId, working_dir: asked.launch_dir }, [...opened])
    if ('refusal' in first) return first
    asked.session_gate.set(first.snapshot)
    return { session_id: session.sessionId }
  } catch (error) {
    return { refusal: theSessionNotOpened(error) }
  }
}
