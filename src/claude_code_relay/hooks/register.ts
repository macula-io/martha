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
  RELAY_DEADLINE_MS,
  RELAY_ORIGIN,
  RELAY_PATHS,
  heardTaken,
  heardVerdict,
  type Heard,
  type RelayEvent,
} from './relay_protocol.ts'

/** The calls on the engine's `$` this module makes. */
export interface RelayEngine {
  readonly env: { get(name: string): Promise<string | undefined> }
  readonly http: {
    fetch(
      url: string,
      init: { readonly method: string; readonly headers: Record<string, string>; readonly body: string; readonly socketPath: string },
    ): Promise<{ readonly status: number; readonly text: string }>
  }
  readonly session: { id(): Promise<string> }
  readonly clock: { after(ms: number, fn: () => void): { cancel(): void } }
  readonly fs: { read(path: string): Promise<string> }
  readonly process: {
    run(argv: readonly string[], init?: { readonly timeoutMs?: number }): Promise<{ readonly exitCode: number }>
  }
  readonly ui: { toast(text: string): unknown }
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

/** A prompt as the engine submits it: its text and the origin it stamped, among other fields. */
export interface PromptSubmitted {
  readonly text: string
  readonly origin: Readonly<Record<string, unknown>>
  readonly [field: string]: unknown
}

export type PromptAnswer = { readonly drop: string } | Readonly<Record<string, unknown>>

/** A tool call as the engine raises it: the tool's name and its input fields. */
export interface ToolCalled {
  readonly tool: string
  readonly [field: string]: unknown
}

export type ToolAnswer = { readonly deny: string } | Readonly<Record<string, unknown>>

/** What prefixes every refusal the relay writes, so the owner and the model see whose it is. */
export const REFUSED_BY_THE_RELAY = 'Martha refused this'

const refusal = (why: string): string => `${REFUSED_BY_THE_RELAY}: ${why}${/[.!?]$/.test(why) ? '' : '.'}`

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

/** The relay's hooks. */
export const register = (on: RelayOn): void => {
  on<ClassicSessionStart, unknown>('classic.SessionStart', async ($, e, next) => {
    await relay($, 'session_started', e, heardTaken)
    return next(e)
  }).catch(async (_$, e, next) => next(e))

  on<PromptSubmitted, PromptAnswer>('prompt.submit', async ($, e, next) => {
    const session_id = await $.session.id()
    const heard = await relay($, 'prompt_submitted', { session_id, text: e.text, origin: e.origin }, heardTaken)
    return heard.yes ? next(e) : { drop: refusal(heard.why) }
  }).catch(async (_$, e, next) => (next.called ? next(e) : { drop: refusal('its relay failed before the launcher answered') }))

  on<ToolCalled, ToolAnswer>('tool.call', async ($, e, next) => {
    const session_id = await $.session.id()
    const verdict = await relay($, 'tool_called', { session_id, call: e }, heardVerdict)
    if (!verdict.yes) return { deny: refusal(verdict.why) }
    const result = await next(e)
    const after = await relay($, 'tool_answered', { session_id, call: e }, heardTaken)
    return after.yes ? result : stopThisMember($, after.why)
  }).catch(async ($, _e, next) =>
    next.called ? stopThisMember($, 'its relay failed after the tool ran') : { deny: refusal('its relay failed before the launcher answered') },
  )
}
