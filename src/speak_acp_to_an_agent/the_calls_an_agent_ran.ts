// The calls an ACP agent ran, heard from its updates, and the rule on a call it ran without asking (#541 package A,
// design r=7 "The gate on an unasked call", rule (a), PASS issuecomment-7010033523).
//
// The engine reports each call it is about to run as a `tool_call` update with status `pending`, then asks the client
// (`session/request_permission`), then runs it and reports `in_progress`, `completed` or `failed`. In the mode that asks
// the client, the engine still runs two kinds of call unasked (the recorded `approve_mode_unasked`): one a saved rule
// allows, and one whose tool was never advertised to the model. So the client's own record of what it was asked is
// the gate:
//   - when a call's result arrives (`completed` or `failed`), or any update says it is `in_progress`, and no permission
//     request for that id came before it, the member is stopped, and the stop names the call;
//   - a `pending` update, or one with no status, is never judged: the engine sends it before it asks.
// The launch takes no exemption from `approve_mode_unasked`: no tool is typed here as one that may go unasked.
//
// Each call's updates are merged by its id, inside a turn or not (design R4), so a result that arrives after its turn
// ended is still heard once, with the arguments and the engine's naming its first update carried. A second final
// update of the same call is not heard again.

import { toolCallFields, TOOL_CALL_STATUS, UPDATE, type AToolCall } from './the_acp_client.ts'

/** What one update says the launch must do: nothing, stop the member and why, or record the call's result. */
export type WhatAnUpdateSays = { readonly nothing: 1 } | { readonly stop: string } | { readonly result: AToolCall }

const NOTHING: WhatAnUpdateSays = { nothing: 1 }

/** The statuses a call has run under, so the call is judged on them: running, or ended either way. */
const RAN: readonly string[] = [TOOL_CALL_STATUS.inProgress, TOOL_CALL_STATUS.completed, TOOL_CALL_STATUS.failed]
/** The statuses a call's result arrives under. */
const ENDED: readonly string[] = [TOOL_CALL_STATUS.completed, TOOL_CALL_STATUS.failed]

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The calls one launch's agent ran: what it was asked about, and each call as its updates told it. */
export interface TheCallsAnAgentRan {
  /** A permission request for this call arrived: from now on the call ran asked. */
  asked(session_id: string, tool_call_id: string): void
  /** One `session/update`, judged: a call run unasked stops the member; an asked call's first result is recorded. */
  heard(session_id: string, update: unknown): WhatAnUpdateSays
}

/** The calls an agent ran, judged by rule (a); `nameOf` names a call in a stop, as the caller's host names it. */
export function theCallsAnAgentRan(nameOf: (call: AToolCall) => string): TheCallsAnAgentRan {
  const asked = new Set<string>()
  const ended = new Set<string>()
  const calls = new Map<string, AToolCall>()
  const keyOf = (session_id: string, tool_call_id: string): string => JSON.stringify([session_id, tool_call_id])
  return {
    asked: (session_id, tool_call_id) => void asked.add(keyOf(session_id, tool_call_id)),
    heard: (session_id, update) => {
      if (!isObject(update)) return NOTHING
      const kind = update['sessionUpdate']
      const id = update['toolCallId']
      if ((kind !== UPDATE.toolCall && kind !== UPDATE.toolCallUpdate) || typeof id !== 'string' || id === '') return NOTHING
      const key = keyOf(session_id, id)
      const call: AToolCall = { ...calls.get(key), ...toolCallFields(update), toolCallId: id }
      calls.set(key, call)
      const status = typeof update['status'] === 'string' ? update['status'] : undefined
      if (status === undefined || !RAN.includes(status)) return NOTHING
      if (!asked.has(key)) {
        return { stop: `the engine ran call ${id} (${nameOf(call)}) without asking this launch first: its update said ${status} and no permission request for it came before, so the member is stopped (#541 package A, rule (a))` }
      }
      if (!ENDED.includes(status) || ended.has(key)) return NOTHING
      ended.add(key)
      return { result: call }
    },
  }
}
