// The relay: Martha's hooks module for Claude Code (#41).
//
// This exists so a member's gates in the launcher are fed by what the engine
// itself says (where a prompt came from, which tool is called, how a session
// started), and so the member does nothing the launcher has not answered.
//
// A hooks module runs with no Node and may import only its own files, so the
// core cannot run here: it runs in the member's launcher
// (../../launch_a_claude_code_member). This module only relays, and decides
// nothing. It posts each event over the launcher's Unix socket, with the
// engine's own fields unchanged, and acts on the answer. The answer must be one
// of the exact shapes in relay_protocol.ts. Anything else is a refusal.
//
// What each event does when the launcher does not say yes: a socket error, a
// timeout, a status other than 200, an answer it does not know, a refusal,
// a hook that throws or overruns its budget (each gating hook's `.catch`):
//
//   - classic SessionStart: nothing here. The launcher has no record of the
//     session, so it refuses that session's every prompt and tool call. The
//     settings hook's input carries the host's `source` and `session_id`; the
//     mod's own `session.start` carries neither (Mars's point 2).
//   - prompt.submit: the prompt is dropped and never enters the session. The
//     origin is the one the engine stamped where it queued the prompt, which no
//     hook may set (Mars's point 1). A prompt Martha itself submits comes back
//     through here too, as `plugin`, and is relayed like any other.
//   - tool.call, before the tool runs: `{ deny }`.
//   - tool.call, after the tool ran: the member is stopped. The launcher sends
//     SIGKILL to the member's process group when it refuses, and does not answer.
//     When it cannot be heard, the relay kills its own group the same way, and
//     holds the hook until it dies, with a host call in flight, so no budget runs
//     out. A hook that returned would let the host fire its next hooks
//     (`Stop` at the end of the turn).
//
// Without the launcher's socket in the environment, every event is refused: a
// member started by hand gets no place in the crew.
//
// The engine's types are written here by shape, as the adapter writes them
// (../claude_code_host), so nothing in this repository imports 'claude-code'.

import {
  answeredBody,
  checkedBody,
  dialogBody,
  heardStart,
  RELAY_DEADLINE_MS,
  RELAY_ORIGIN,
  RELAY_PATHS,
  heardTaken,
  heardVerdict,
  subagentBody,
  type Heard,
  type RelayEvent,
} from './relay_protocol.ts'

/** The calls on the engine's `$` this module makes. */
export interface RelayEngine {
  readonly env: { get(name: string): Promise<string | undefined> }
  readonly http: { fetch(url: string, init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string; readonly socketPath: string }): Promise<{ readonly status: number; readonly text: string }> }
  readonly session: { id(): Promise<string> }
  readonly clock: { after(ms: number, fn: () => void): { cancel(): void } }
  readonly fs: { read(path: string): Promise<string> }
  readonly process: { run(argv: readonly string[], init?: { readonly timeoutMs?: number }): Promise<{ readonly exitCode: number }> }
  readonly ui: { toast(text: string): unknown }
  /** Ends the running turn by its id (martha#311); the host rejects when that turn is not the one running. */
  readonly turn: { abort(input: { readonly turnId: string }): Promise<unknown> }
}

/** A hook's `next`: the rest of the chain. */
export type RelayNext<E, R> = (e: E) => Promise<R>

/** A `.catch` handler's `next`, which also says whether the failed hook had called it. */
export interface RelayCaughtNext<E, R> extends RelayNext<E, R> {
  readonly called: boolean
}

export type RelayHook<E, R> = ($: RelayEngine, e: E, next: RelayNext<E, R>) => Promise<R>

/** What runs when a hook throws or overruns its budget: its answer stands for the hook's. */
export type RelayCatch<E, R> = ($: RelayEngine, e: E, next: RelayCaughtNext<E, R>) => Promise<R>

export interface RelayRegistration<E, R> {
  catch(handler: RelayCatch<E, R>): void
}

export interface RelayOn {
  <E, R>(event: string, hook: RelayHook<E, R>): RelayRegistration<E, R>
}

/** The settings SessionStart hook's input: the host's own fields, relayed whole. */
export type ClassicSessionStart = Readonly<Record<string, unknown>>

/** A SubagentStart/SubagentStop hook's input (martha#170): the host's own fields, relayed whole. */
export type ClassicSubagent = Readonly<Record<string, unknown>>

/** A dialog the host raises for the owner (martha#313): its own fields, read once by ./relay_protocol and no other way. */
export type ClassicDialog = Readonly<Record<string, unknown>>

/** The host's own check of a call, before it may ask the owner about one (martha#313): the call it names, and the rest. */
export type ToolChecked = Readonly<Record<string, unknown>>

/**
 * A prompt as the engine submits it: its text, the origin it stamped, and the
 * command and meta mark that tell the launcher typing from an expansion
 * (martha#51), among other fields.
 */
export interface PromptSubmitted {
  readonly text: string
  readonly origin: Readonly<Record<string, unknown>>
  readonly [field: string]: unknown
}

export type PromptAnswer = { readonly drop: string } | Readonly<Record<string, unknown>>

/** A tool call as the engine raises it: the tool's name and its input fields. */
export type ToolCalled = { readonly tool: string; readonly [field: string]: unknown }

export type ToolAnswer = { readonly deny: string } | Readonly<Record<string, unknown>>

/** What prefixes every refusal the relay writes, so the owner and the model see whose it is. */
export const REFUSED_BY_THE_RELAY = 'Martha refused this'

const refusal = (why: string): string => `${REFUSED_BY_THE_RELAY}: ${why}${/[.!?]$/.test(why) ? '' : '.'}`

/**
 * The rest of the chain's answer to a session's start, with the launcher's line added to what that session takes in.
 * The host's module API reads `additionalContext` as one entry per hook, so an answer that already carries some keeps
 * them and the line goes last.
 */
function withTheLineHanded(passed: unknown, line: string): Readonly<Record<string, unknown>> {
  const rest = typeof passed === 'object' && passed !== null && !Array.isArray(passed) ? (passed as Record<string, unknown>) : {}
  const already = Array.isArray(rest['additionalContext']) ? (rest['additionalContext'] as unknown[]) : []
  return { ...rest, additionalContext: [...already, line] }
}

/** Posts one event to the launcher and hears its answer; never rejects. */
export async function relay(
  $: RelayEngine,
  event: RelayEvent,
  body: Readonly<Record<string, unknown>>,
  hear: (status: number, text: string) => Heard,
): Promise<Heard> {
  try {
    // The host takes only a literal name here (it lists the variables a module reads before running it) and
    // refuses the whole module for a constant (#104). The name is RELAY_SOCKET_VARIABLE's; the relay's tests
    // fail when the two differ.
    const socketPath = await $.env.get('MARTHA_RELAY_SOCKET')
    if (socketPath === undefined || socketPath === '') {
      return { yes: false, why: 'this member was not started by its launcher, so nothing answers for it' }
    }
    const answer = $.http.fetch(`${RELAY_ORIGIN}${RELAY_PATHS[event]}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      socketPath,
    })
    let timer: { cancel(): void } | undefined
    const late = new Promise<'late'>((resolve) => {
      timer = $.clock.after(RELAY_DEADLINE_MS, () => resolve('late'))
    })
    const heard = await Promise.race([answer, late])
    timer?.cancel()
    if (heard === 'late') return { yes: false, why: `the launcher did not answer within ${RELAY_DEADLINE_MS} ms` }
    return hear(heard.status, heard.text)
  } catch (error) {
    return { yes: false, why: `the launcher could not be reached (${error instanceof Error ? error.message : String(error)})` }
  }
}

/** The process group this host runs in: field 5 of its own /proc stat line. */
export function processGroupOf(stat: string): number | undefined {
  // The command name (field 2) is in parentheses and may hold spaces or `)`;
  // the fields after the last `)` are plain numbers.
  const after = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/)
  const group = Number(after[2])
  return Number.isSafeInteger(group) && group > 1 ? group : undefined
}

/** How long one hold of the hook lasts before the next one starts; the host's limit is ten minutes. */
const HOLD_SECONDS = 540
const HOLD_TIMEOUT_MS = 570_000

/**
 * Stops this member when the launcher cannot be heard after a tool ran: SIGKILL
 * to its own process group, the host and its tool servers. Then the hook is
 * held, with a host call in flight so its budget stands still, until the kill
 * lands. Never resolves.
 */
export async function stopThisMember($: RelayEngine, why: string): Promise<never> {
  try {
    void $.ui.toast(refusal(`the member is being stopped, because ${why}`))
    const group = processGroupOf(await $.fs.read('/proc/self/stat'))
    if (group !== undefined) await $.process.run(['kill', '-s', 'KILL', '--', `-${group}`])
  } catch {
    // Nothing to do but hold: the hook must not return.
  }
  for (;;) {
    try {
      await $.process.run(['sleep', String(HOLD_SECONDS)], { timeoutMs: HOLD_TIMEOUT_MS })
    } catch {
      // A hold that ended early is followed by another.
    }
  }
}


/**
 * A dialog the host raises for the owner (martha#313): what it says reaches the launcher, and the host's own dialog
 * still reaches the owner. Nothing here is gated and nothing is dropped — the relay answers for a member's gates, never
 * for the person the host is asking — so the answer is the rest of the chain, whatever the launcher said.
 */
async function heardDialog($: RelayEngine, hook: string, e: ClassicDialog, next: RelayNext<ClassicDialog, unknown>): Promise<unknown> {
  await relay($, 'owner_dialog', dialogBody(await $.session.id(), hook, e), heardTaken)
  return next(e)
}

/** The relay's hooks. */
export const register = (on: RelayOn): void => {
  on<ClassicSessionStart, unknown>('classic.SessionStart', async ($, e, next) => {
    const heard = await relay($, 'session_started', e, heardStart)
    const passed = await next(e)
    // The launcher may hand this session one line as it starts (martha#254 test 10): the acts of the package the
    // member holds that were sent with no outcome recorded. It goes in this hook's own answer, which is what the host
    // puts into the session before its first prompt; the host's module API takes one entry per hook, so it is a list.
    if (heard.yes && heard.handed !== undefined) return withTheLineHanded(passed, heard.handed)
    return passed
  }).catch(async (_$, e, next) => next(e))

  on<PromptSubmitted, PromptAnswer>('prompt.submit', async ($, e, next) => {
    const session_id = await $.session.id()
    const marks = { ...(e.command === undefined ? {} : { command: e.command }), ...(e.isMeta === undefined ? {} : { isMeta: e.isMeta }) }
    const heard = await relay($, 'prompt_submitted', { session_id, text: e.text, origin: e.origin, ...marks }, heardTaken)
    return heard.yes ? next(e) : { drop: refusal(heard.why) }
  }).catch(async (_$, e, next) => (next.called ? next(e) : { drop: refusal('its relay failed before the launcher answered') }))

  // An agent the host starts under this session, and its stop (martha#170). The stop is the only report of a
  // background agent's answer: the host delivers that text into the member's turn with no tool result to place it on.
  // A relay that cannot be heard lets the event through here, as the session start does: the launcher then holds an
  // agent it never saw start, and refuses the shell rather than passing the agent's text.
  //
  // The two are spelled out, not looped: the host's own plugin validator reads this file and refuses a relay whose
  // `on(...)` names its event by anything but a string literal, so `for (const event of …)` would not load at all.
  on<ClassicSubagent, unknown>('classic.SubagentStart', async ($, e, next) => {
    const session_id = await $.session.id()
    const heard = await relay($, 'subagent_started', subagentBody(session_id, e), heardTaken)
    return heard.yes ? next(e) : { drop: refusal(heard.why) }
  }).catch(async (_$, e, next) => next(e))

  on<ClassicSubagent, unknown>('classic.SubagentStop', async ($, e, next) => {
    const session_id = await $.session.id()
    const heard = await relay($, 'subagent_stopped', subagentBody(session_id, e), heardTaken)
    return heard.yes ? next(e) : { drop: refusal(heard.why) }
  }).catch(async (_$, e, next) => next(e))


  // What the host is asking the owner (martha#313): the four dialogs it raises in its own terminal. They are heard and
  // never gated: the owner's answer is the host's, and a relay that cannot be heard must not stand between the two.
  //
  // The five are spelled out, not looped, for the same reason as the two above: the host's plugin validator reads this
  // file and refuses a relay whose `on(...)` names its event by anything but a string literal.
  on<ClassicDialog, unknown>('classic.PermissionRequest', async ($, e, next) => heardDialog($, 'classic.PermissionRequest', e, next)).catch(async (_$, e, next) => next(e))

  on<ClassicDialog, unknown>('classic.Elicitation', async ($, e, next) => heardDialog($, 'classic.Elicitation', e, next)).catch(async (_$, e, next) => next(e))

  on<ClassicDialog, unknown>('classic.ElicitationResult', async ($, e, next) => heardDialog($, 'classic.ElicitationResult', e, next)).catch(async (_$, e, next) => next(e))

  on<ClassicDialog, unknown>('classic.Notification', async ($, e, next) => heardDialog($, 'classic.Notification', e, next)).catch(async (_$, e, next) => next(e))

  // The host checks a call before it may ask the owner about it, and that check is the only place a permission's call
  // has an id: the question itself carries none (martha#313). Its answer is the engine's own decision and is handed
  // back untouched — a `tool.check` that answered anything else would decide a call Martha never saw.
  on<ToolChecked, unknown>('tool.check', async ($, e, next) => {
    await relay($, 'tool_checked', checkedBody(await $.session.id(), e), heardTaken)
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on<ToolCalled, ToolAnswer>('tool.call', async ($, e, next) => {
    const session_id = await $.session.id()
    const verdict = await relay($, 'tool_called', { session_id, call: e }, heardVerdict)
    if (!verdict.yes) return { deny: refusal(verdict.why) }
    const result = await next(e)
    // The answer goes with the call (martha#129): the launcher keeps the shell only when the result it reads here is
    // exactly the one a signed run's receipt builds. A result too big to send is left out, and records A13.
    const after = await relay($, 'tool_answered', answeredBody(session_id, e, result), heardTaken)
    if (!after.yes) return stopThisMember($, after.why)
    // The end of the running turn rides on the yes to the last call in flight (martha#311 ruling D): carried after it.
    if (after.end_turn !== undefined) await $.turn.abort({ turnId: after.end_turn }).catch(() => undefined)
    return result
  }).catch(async ($, _e, next) =>
    next.called ? stopThisMember($, 'its relay failed after the tool ran') : { deny: refusal('its relay failed before the launcher answered') },
  )
}
