// What the Claude Code host is asking its owner, read from the hook events it raises (martha#313).
//
// This exists so the host's own field names stay in one place, beside the module that hears them, and so the core reads
// what the host said in the crew's words: a permission's tool and input, an elicitation's server, question and id, a
// notification's type and words, and the call the host checked before it asked about one.
//
// The relay (../claude_code_relay) posts each hook's input exactly as the host raised it and decides nothing: it is a
// relay, and what a hook's fields mean is this adapter's business. What the core does with them is
// ../say_what_the_host_is_asking's.
//
// The two shapes below are the host's own, read on 2.1.323 and recorded in its schemas
// (../claude_code_host/recorded_claude_code_host.json holds what it offers a module; the fields of each hook are its
// schema, and a hook the host renames fails the relay's own load rather than being misread here).

import type { ACallTheHostMade, WhatTheHostSaid } from '../say_what_the_host_is_asking/say_what_the_host_is_asking.ts'

/** The host's own name for the hook that asks the owner to allow a call. */
export const PERMISSION_REQUEST = 'classic.PermissionRequest'

/** The host's own name for the hook that asks the owner something an MCP server wanted. */
export const ELICITATION = 'classic.Elicitation'

/** The host's own name for the hook that says how the owner answered an elicitation. */
export const ELICITATION_RESULT = 'classic.ElicitationResult'

/** The host's own name for the hook that carries a notification meant for the owner. */
export const NOTIFICATION = 'classic.Notification'

/** The host's own name for the hook it runs about a call before it may ask the owner about one. */
export const TOOL_CHECK = 'tool.check'

/** A field of the host's event as text, or undefined when it is not one: nothing is coerced into a word here. */
const textOrUndefined = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** A field of the host's event as an object, or an empty one: a call with no arguments is a call all the same. */
const objectOrEmpty = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** The call the host names in a body, or undefined when the body names none. */
export function theCallIn(call: unknown): ACallTheHostMade | undefined {
  if (typeof call !== 'object' || call === null) return undefined
  const held = call as Readonly<Record<string, unknown>>
  if (typeof held['tool'] !== 'string') return undefined
  // A call's input is everything the host put on it beside the fields it stamped itself, exactly as the launcher reads
  // it for its gates (../launch_a_claude_code_member/answer_the_relay's own callOf).
  const { tool: _tool, tool_use_id: _use, agent_id: _agent, agentId: _agentId, ...input } = held
  const id = textOrUndefined(held['tool_use_id']) ?? textOrUndefined(held['id'])
  const agent = textOrUndefined(held['agent_id']) ?? textOrUndefined(held['agentId'])
  return { tool: held['tool'], input, ...(id === undefined ? {} : { id }), ...(agent === undefined ? {} : { agent }) }
}

/**
 * What one of the host's dialogs said, in the crew's words, or undefined when the hook is not one this build reads.
 * The hook's own name is what says which of the four happened, and each carries only the fields the core reads.
 */
export function whatTheHostSaidOf(hook: string, e: Readonly<Record<string, unknown>>): WhatTheHostSaid | undefined {
  if (hook === PERMISSION_REQUEST) {
    const agent = textOrUndefined(e['agent_id'])
    return { said: 'permission', call: { tool: textOrUndefined(e['tool_name']) ?? '', input: objectOrEmpty(e['tool_input']), ...(agent === undefined ? {} : { agent }) } }
  }
  if (hook === NOTIFICATION) {
    return { said: 'notification', type: textOrUndefined(e['notification_type']) ?? '', message: textOrUndefined(e['message']) ?? '' }
  }
  if (hook === ELICITATION || hook === ELICITATION_RESULT) return theElicitationSaid(hook, e)
  if (hook === TOOL_CHECK) {
    const call = theCallIn({ tool: textOrUndefined(e['tool']) ?? '', tool_use_id: textOrUndefined(e['tool_use_id']), agentId: textOrUndefined(e['agentId']), input: objectOrEmpty(e['input']) })
    return call === undefined ? undefined : { said: 'checked', call }
  }
  return undefined
}

/**
 * An elicitation, asked or answered: the host names it by id only when it named one when it asked, so an answer with
 * no id is the answer to the oldest question that server still has open (the dialogs slice's own rule).
 */
function theElicitationSaid(hook: string, e: Readonly<Record<string, unknown>>): WhatTheHostSaid | undefined {
  const server = textOrUndefined(e['mcp_server_name'])
  if (server === undefined) return undefined
  const id = textOrUndefined(e['elicitation_id'])
  if (hook === ELICITATION_RESULT) return { said: 'elicitation-answered', server, ...(id === undefined ? {} : { id }) }
  return { said: 'elicitation', server, question: textOrUndefined(e['message']) ?? '', ...(id === undefined ? {} : { id }) }
}
