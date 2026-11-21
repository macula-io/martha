// A crew tool's answer that orders a mesh call (martha#1016, design issuecomment-7054673284). The launcher cannot call
// the mesh as the member (one link per key, see ./call_the_mesh_as_the_member.ts), so a launcher tool that needs the
// mesh answers an order instead of words: `{"mesh_order":{procedure,args,realm?,timeout_ms,then,keep}}`. The relay makes
// the call as the member and asks the launcher's `then` tool with `{keep, answer}`; that tool's words are what the model
// is shown. Any answer that is not a well-formed order passes through untouched, so a tool's plain words never call.
//
// This module imports only its own files: it runs in the host, not in the launcher.

import { callTheMeshAsTheMember, type AMeshCall, type MeshCallEngine } from './call_the_mesh_as_the_member.ts'

/** A realm, as the mesh names one: 64 lowercase hex characters. */
const A_REALM = /^[0-9a-f]{64}$/

/** One order: the call to make, the launcher tool that reads its answer, and what that tool is handed back as it was. */
export interface AMeshOrder extends AMeshCall {
  readonly then: string
  readonly keep: unknown
}

/** Asks the launcher one of its tools, and resolves to the words that tool answered. */
export type AskTheLauncher = (tool: string, args: Readonly<Record<string, unknown>>) => Promise<string>

const isARecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

const isAName = (value: unknown): value is string => typeof value === 'string' && value !== ''

const parsed = (said: string): unknown => {
  try {
    return JSON.parse(said)
  } catch {
    return undefined
  }
}

const isAWait = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0

const isNoRealmOrARealm = (value: unknown): value is string | undefined => value === undefined || (typeof value === 'string' && A_REALM.test(value))

const orderOf = (answer: unknown): Record<string, unknown> | null => (isARecord(answer) && isARecord(answer['mesh_order']) ? answer['mesh_order'] : null)

/** The order an answer carries, or null when it carries none or a malformed one. */
export function meshOrderIn(said: string): AMeshOrder | null {
  const order = orderOf(parsed(said))
  if (order === null) return null
  const { procedure, args, realm, timeout_ms, then, keep } = order
  const wellFormed = isAName(procedure) && isAName(then) && isARecord(args) && isAWait(timeout_ms) && isNoRealmOrARealm(realm)
  if (!wellFormed) return null
  return { procedure, args, timeout_ms, ...(realm === undefined ? {} : { realm }), then, keep: keep ?? null }
}

/**
 * The most calls one tool call's orders make: a `then` tool may answer another order (crew mail opens a mailbox in
 * three sealed calls), and a chain that never ends is stopped here rather than calling without end.
 */
export const MOST_MESH_CALLS_PER_TOOL_CALL = 4

/** What the model is shown when a tool's orders went past MOST_MESH_CALLS_PER_TOOL_CALL: never the order itself. */
export const TOO_MANY_MESH_CALLS = `The mesh call was stopped: one tool call may make at most ${MOST_MESH_CALLS_PER_TOOL_CALL}, and its tool kept ordering more.`

/**
 * The words the model is shown for a tool's answer: the answer itself, or the last `then` tool's words. Each `then`
 * tool may order the next call, up to MOST_MESH_CALLS_PER_TOOL_CALL calls in all.
 */
export async function carryAMeshOrder($: MeshCallEngine, said: string, ask: AskTheLauncher): Promise<string> {
  let words = said
  for (let made = 0; made < MOST_MESH_CALLS_PER_TOOL_CALL; made++) {
    const order = meshOrderIn(words)
    if (order === null) return words
    const { then, keep, ...call } = order
    words = await ask(then, { keep, answer: await callTheMeshAsTheMember($, call) })
  }
  return meshOrderIn(words) === null ? words : TOO_MANY_MESH_CALLS
}
