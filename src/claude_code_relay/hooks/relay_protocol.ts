// What the relay and its member's launcher say to each other (#41).
//
// This exists so the engine's own word about a session (its start, where each
// prompt came from, each tool call) reaches the core in the launcher unchanged,
// and so every answer the relay acts on is one of a few exact shapes.
//
// The relay is a hooks module, which may import only its own files: this file is
// one of them, and imports nothing. The launcher (../../launch_a_claude_code_member)
// imports it from here, so both sides read one protocol.
//
// Every answer is parsed strictly. Anything but the exact shape of a yes is a
// no: a socket error, a timeout, a status other than 200, text that is not JSON,
// an extra field, a missing field. The relay has no default to choose (martha#41,
// the Supervisor's condition 1 and Mars's point 3).

/** The environment variable naming the launcher's socket. The relay's register.ts spells it as a literal, as the host demands (#104). */
export const RELAY_SOCKET_VARIABLE = 'MARTHA_RELAY_SOCKET'

/**
 * How long the relay waits for the launcher before it refuses. Checking the
 * launch reads the checkout's tree, which takes seconds on a large checkout;
 * past this the launcher is taken to be gone.
 */
export const RELAY_DEADLINE_MS = 30_000

/** The host part of every request: the socket is the address, the URL only names the event. */
export const RELAY_ORIGIN = 'http://martha-launcher'

/** The events the relay forwards, and the path each is posted to. */
export const RELAY_PATHS = {
  session_started: '/session-started',
  prompt_submitted: '/prompt-submitted',
  tool_called: '/tool-called',
  tool_answered: '/tool-answered',
  // An agent the host started or stopped under this session (martha#170). The stop is the only place a background
  // agent's answer reaches us: the host delivers it into the member's turn with no tool result to place it on.
  subagent_started: '/subagent-started',
  subagent_stopped: '/subagent-stopped',
} as const

export type RelayEvent = keyof typeof RELAY_PATHS

/**
 * Where `martha run <name>` asks the launcher to run a shape the owner signed (martha#129). Not a hook event: the
 * member's shell posts it, and the launcher runs it only for the one `martha run <name>` call its relay saw.
 */
export const RUN_PATH = '/run-a-signed-shape'

/** A signed shape ran: its exit status, and its merged output, base64. */
export interface Ran {
  readonly ran: 1
  readonly status: number
  readonly output: string
}

/** The launcher took the event in. */
export interface Taken {
  readonly taken: 1
}

/** The launcher refused the event, and says why for the owner to read. */
export interface Refused {
  readonly refused: string
}

/** The launcher's verdict on a tool call. */
export type Verdict = { readonly allow: 1 } | { readonly deny: string }

export const TAKEN: Taken = { taken: 1 }
export const ALLOW: Verdict = { allow: 1 }

/** What the relay acts on: the launcher's yes, or why not. */
export type Heard = { readonly yes: true } | { readonly yes: false; readonly why: string }

const NO = (why: string): Heard => ({ yes: false, why })
const YES: Heard = { yes: true }

/** Why the relay refuses when the answer is not one it knows. */
export const MALFORMED = 'the launcher answered in a shape the relay does not know'

function jsonObjectOf(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

const isReason = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * The largest answer the relay sends the launcher for a tool call (martha#129, design step 4.3). The launcher compares
 * the whole answer with the one a signed run's receipt builds, so it needs the answer itself; past this the relay
 * sends the call without it, and the call records A13 rather than a body the launcher stops the member over
 * (LARGEST_RELAY_BODY, in ../../launch_a_claude_code_member/serve_the_relay.ts, is 32 MiB for the whole body).
 */
export const LARGEST_RELAYED_ANSWER = 8 * 1024 * 1024

/**
 * A `subagent_started`/`subagent_stopped` body (martha#170): the agent the host names, under the member's own
 * session. The host carries `agent_id` and `agent_type` on both, its own list of background tasks, and the agent's own
 * last words on the stop; nothing the relay adds, and nothing the host's text could rename.
 */
export function subagentBody(session_id: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const body: Record<string, unknown> = { session_id, agent_id: input['agent_id'], agent_type: input['agent_type'] }
  if (input['last_assistant_message'] !== undefined) body['last_assistant_message'] = input['last_assistant_message']
  if (input['background_tasks'] !== undefined) body['background_tasks'] = input['background_tasks']
  return body
}

/**
 * A `tool_answered` body: the call, and the answer the host showed for it when that answer can cross the socket. An
 * answer left out is one the launcher cannot compare, so nothing is exempt on it (martha#129): omitting it can only
 * take the exemption away, never give it.
 */
export function answeredBody(session_id: string, call: unknown, answer: unknown): Readonly<Record<string, unknown>> {
  const body: Record<string, unknown> = { session_id, call }
  if (answer === undefined) return body
  let text: string | undefined
  try {
    text = JSON.stringify(answer)
  } catch {
    // An answer that cannot be written down is one the launcher cannot compare either.
    text = undefined
  }
  if (text !== undefined && text.length <= LARGEST_RELAYED_ANSWER) body['answer'] = answer
  return body
}

/** A taken-or-refused answer, as the relay hears it: `{"taken":1}` is the only yes. */
export function heardTaken(status: number, text: string): Heard {
  if (status !== 200) return NO(`the launcher answered with status ${status}`)
  const value = jsonObjectOf(text)
  if (value === undefined) return NO(MALFORMED)
  if (exactKeys(value, ['taken']) && value.taken === 1) return YES
  if (exactKeys(value, ['refused']) && isReason(value.refused)) return NO(value.refused)
  return NO(MALFORMED)
}

/** A verdict, as the relay hears it: `{"allow":1}` is the only yes; a deny carries its reason. */
export function heardVerdict(status: number, text: string): Heard {
  if (status !== 200) return NO(`the launcher answered with status ${status}`)
  const value = jsonObjectOf(text)
  if (value === undefined) return NO(MALFORMED)
  if (exactKeys(value, ['allow']) && value.allow === 1) return YES
  if (exactKeys(value, ['deny']) && isReason(value.deny)) return NO(value.deny)
  return NO(MALFORMED)
}

/** What `martha run` acts on: the run's status and output, base64, or why there was none. */
export type HeardRun = { readonly ran: true; readonly status: number; readonly output: string } | { readonly ran: false; readonly why: string }

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const isRan = (value: Record<string, unknown>): value is Record<string, unknown> & Ran =>
  exactKeys(value, ['ran', 'status', 'output']) && value.ran === 1 && Number.isSafeInteger(value.status) && typeof value.output === 'string' && BASE64.test(value.output)

/** A run's answer, as `martha run` hears it: exactly a Ran, or a refusal with its reason. */
export function heardRan(status: number, text: string): HeardRun {
  if (status !== 200) return { ran: false, why: `the launcher answered with status ${status}` }
  const value = jsonObjectOf(text)
  if (value === undefined) return { ran: false, why: MALFORMED }
  if (isRan(value)) return { ran: true, status: value.status, output: value.output }
  if (exactKeys(value, ['refused']) && isReason(value.refused)) return { ran: false, why: value.refused }
  return { ran: false, why: MALFORMED }
}
