// A Goose call answered by the entry (macula-io/martha#541, packages 7-8, part C4): the engine's permission request
// read into the contract's words (`ACalledTool`), handed to the entry's `aToolCalled`, and the entry's answer given back
// as the gate's verdict that package 9a's Decide takes (../hear_an_acp_agents_asks: the gate, then the owner's approved
// list, then the owner). Nothing here decides a call: the entry does, as it does for Claude Code's relay
// (../answer_the_relay/answer_the_relay.ts, toolCalled).
//
// Where the engine names the call. Goose's permission request carries a title made for people ("developer: shell ·
// ls"), with `_` turned into spaces and an argument appended, and no tool name. The engine's own name for the call is on
// the `tool_call` update it sends first for the same id, under the `_meta` path the recording holds (`tool_naming`, read
// from the engine's source and held by the drift check). A call whose name cannot be read there (no update came first,
// or it named nothing, as a subagent's call may) is never put to the entry under a guessed name, and the title is never
// read as a name.
//
// What does not run. A call with no name, a call whose arguments are not an object, and an entry's answer that is
// neither `{ allowed: 1 }` nor `{ denied }` each throw. A throw from the gate is the client's own rule (part B): a
// refusal, answered `reject_once`, and the call does not run.

import type { ACalledTool, TheAnswerToACall, ToolNames } from '../host_contract/host_contract.ts'
import { THE_EXTENSION_A_MEMBER_KEEPS } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import type { TheGate, WhatTheGateSaid } from '../hear_an_acp_agents_asks/hear_an_acp_agents_asks.ts'
import type { ToolNaming } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import type { APermissionRequest } from './the_acp_client.ts'

/** The own name of the shell tool of the one extension a member keeps. */
const THE_SHELLS_OWN_NAME = 'shell'

/** The Goose shell tool, by the engine's own name for it: the call the shell hold reads while an agent runs (martha#562). */
export const theGooseShellTool = (naming: ToolNaming): string => `${THE_EXTENSION_A_MEMBER_KEEPS}${naming.separator}${THE_SHELLS_OWN_NAME}`

/**
 * The Goose host's tool names. The engine names every extension's tool `<extension><separator><tool>` and splits a name
 * at the end the recording says, so with the first an own name may itself hold the separator. A name with no separator,
 * or with nothing after it, is its own name.
 */
export function gooseToolNames(naming: ToolNaming): ToolNames {
  return {
    ownNameOf: (called) => {
      const at = naming.split_at === 'first' ? called.indexOf(naming.separator) : called.lastIndexOf(naming.separator)
      if (at < 0) return called
      const own = called.slice(at + naming.separator.length)
      return own === '' ? called : own
    },
  }
}

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The engine's own name for a requested call, read where the recording says the engine puts it, or undefined. */
export function theEnginesNameOf(request: APermissionRequest, naming: ToolNaming): string | undefined {
  let at: unknown = request.heard?.meta
  for (const key of naming.meta_path) at = isObject(at) ? at[key] : undefined
  return typeof at === 'string' && at !== '' ? at : undefined
}

/** The request in the contract's words, or why it cannot be put to the entry. */
export function aCalledToolOf(request: APermissionRequest, naming: ToolNaming): ACalledTool | { readonly unasked: string } {
  const tool = theEnginesNameOf(request, naming)
  if (tool === undefined) return { unasked: `the engine named no tool for call ${request.toolCallId}, so it is not put to the gate under a guessed name` }
  if (!isObject(request.rawInput)) return { unasked: `the arguments of call ${request.toolCallId} are not an object, so the gate cannot read them` }
  return { session_id: request.sessionId, tool, input: request.rawInput, call_id: request.toolCallId }
}

/** The entry's answer as the gate's verdict: the one allow, the one deny, and a throw for anything else. */
export function theVerdictFor(answer: TheAnswerToACall | unknown, call: ACalledTool): WhatTheGateSaid {
  if (isObject(answer) && !('denied' in answer) && answer['allowed'] === 1) return { verdict: 'allow', tool: call.tool }
  if (isObject(answer) && !('allowed' in answer) && typeof answer['denied'] === 'string') return { verdict: 'deny', tool: call.tool }
  throw new Error(`the entry answered call ${call.call_id ?? ''} with neither an allow nor a deny: ${JSON.stringify(answer)}`)
}

/** The part of the entry a Goose call is answered by. */
export interface TheEntrysCallAnswer {
  aToolCalled(call: ACalledTool): Promise<TheAnswerToACall>
}

/** The gate of a Goose launch: every permission request put to the entry in its own words, or refused unasked. */
export function theGooseGate(entry: TheEntrysCallAnswer, naming: ToolNaming): TheGate {
  return async (request) => {
    const call = aCalledToolOf(request, naming)
    if ('unasked' in call) throw new Error(call.unasked)
    return theVerdictFor(await entry.aToolCalled(call), call)
  }
}
