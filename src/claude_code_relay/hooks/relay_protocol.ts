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

/** The environment variable naming the launcher's socket. The relay reads it by this literal. */
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
} as const

export type RelayEvent = keyof typeof RELAY_PATHS

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
