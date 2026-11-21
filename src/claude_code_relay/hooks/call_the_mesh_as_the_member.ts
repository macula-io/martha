// One mesh procedure, called as the member, through the member's own mesh server (martha#1016, Jupiter's design read
// r=1 on issuecomment-7052833775). A port of crew-code's meshCallOf and meshReplyOf (crew-code/hooks/register.tsx).
//
// This exists so a crew tool that needs the mesh (crew mail, crew memory: built on this, not in this file) can call it
// signed as the member, without a second connection on the member's key. The station keeps one link per node id, and a
// second server on one key drops the first (`replaced_by_newer_handshake`: crew mail unreachable
// for a day). So the call is not made by the launcher: it is made here, in the member's session, with the host's own
// `$.mcp.call`, which calls a connected server "with the engine's own connection and credentials". That is the one
// server the launch pinned the member's key into (../../install_the_recorded_mesh_server). One process, one link, one key.
//
// Every call is sealed end to end, as crew-code's crew mail is (the owner's ruling of 2026-11-05 on
// macula-services/mcl-mail#14): it asks `confidential: 'required'`, and an answer that came back unsealed is refused, not
// used (T7 of the design). So is a provider's own error, an answer that is not the reply shape, the host's own failure,
// and no answer within the time the caller allows: each is a refusal in words, never a result.
//
// A server is connected only after the session has started: a call at `session.start` finds no tool yet. A caller calls
// on a member's tool call, as crew-code's slices do.
//
// This module imports only its own files and decides nothing beyond the seal: it runs in the host, not in the launcher.

/** The mesh server's name in the member's server config: its tools are `mcp__macula__*`. */
const MESH_SERVER = 'macula'
/** The mesh server's tool that calls one procedure on the mesh. */
const MESH_CALL_TOOL = 'mesh_call'
/** What every call asks of the exchange: sealed, or not sent at all. */
const SEALED_ONLY = 'required'
/** The reply's seal, as the mesh server writes it: 1 when the exchange went sealed. */
const SEALED = 1

/** The calls on the engine's `$` this module makes. */
export interface MeshCallEngine {
  readonly mcp: { call(server: string, tool: string, args?: Record<string, unknown>): Promise<{ readonly content?: readonly { readonly type: string; readonly text?: string }[]; readonly isError?: boolean }> }
  readonly clock: { after(ms: number, fn: () => void): { cancel(): void } }
}

/** One procedure's call: on which realm, and how long the caller waits for its answer. */
export interface AMeshCall {
  readonly procedure: string
  readonly args: Record<string, unknown>
  readonly timeout_ms: number
  readonly realm?: string
}

/** The provider's result from a sealed exchange, or why there is none, in words. */
export type AMeshAnswer = { readonly result: Record<string, unknown> } | { readonly refusal: string }

const textOf = (content: readonly { readonly type: string; readonly text?: string }[] | undefined): string =>
  (content ?? []).map((block) => block.text ?? '').join('\n').trim()

/** The reply's result when it went sealed; a provider's error, an unsealed reply or another shape is a refusal. */
export function meshReplyOf(procedure: string, text: string): AMeshAnswer {
  let reply: { result?: Record<string, unknown>; seal?: { sealed?: unknown } }
  try {
    reply = JSON.parse(text) as typeof reply
  } catch {
    return { refusal: `${procedure}: the mesh server's answer is not a reply: ${text.slice(0, 120)}` }
  }
  if (reply === null || typeof reply !== 'object') return { refusal: `${procedure}: the mesh server's answer is not a reply: ${text.slice(0, 120)}` }
  const failed = reply.result?.['error']
  if (failed !== undefined) return { refusal: `${procedure}: ${JSON.stringify(failed)}` }
  if (reply.seal?.sealed !== SEALED) return { refusal: `${procedure}: the answer came back unsealed, so it is not used` }
  return { result: reply.result ?? {} }
}

/** One procedure called as the member through its own mesh server, sealed, as the header says; never rejects. */
export async function callTheMeshAsTheMember($: MeshCallEngine, call: AMeshCall): Promise<AMeshAnswer> {
  const asked = { procedure: call.procedure, args: call.args, confidential: SEALED_ONLY, timeout_ms: call.timeout_ms, ...(call.realm === undefined ? {} : { realm: call.realm }) }
  let timer: { cancel(): void } | undefined
  const late = new Promise<AMeshAnswer>((resolve) => {
    timer = $.clock.after(call.timeout_ms, () => resolve({ refusal: `${call.procedure}: no answer within ${call.timeout_ms} ms` }))
  })
  const answered = $.mcp.call(MESH_SERVER, MESH_CALL_TOOL, asked).then(
    (answer): AMeshAnswer => (answer.isError === true ? { refusal: `${call.procedure}: ${textOf(answer.content) || 'the mesh call failed'}` } : meshReplyOf(call.procedure, textOf(answer.content))),
    (error: unknown): AMeshAnswer => ({ refusal: `${call.procedure}: ${String(error)}` }),
  )
  try {
    return await Promise.race([answered, late])
  } finally {
    timer?.cancel()
  }
}
