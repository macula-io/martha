// What a host's tool.call hook returns.
//
// A host that can refuse a tool before running it asks this, on every tool call,
// and refuses the call when the answer is a denial. The denial text is written for
// the model that called the tool, because it is the model that has to stop.
//
// A raw mesh read is refused before anything else, tainted or not
// (../read_a_room_through_its_gate): the room is read through its gate instead.
//
// This is the whole wiring on the host side: one question per tool call. Which
// host asks it is an adapter detail — the answer is the core's.

import {
  refuseExecutionAfterUngatedText,
  type Policy,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { isRawMeshRead } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'

/** A host refusal, or nothing to say. */
export type ToolCallAnswer = { readonly deny: string } | undefined

export interface ToolCall {
  readonly tool: string
  readonly session: HostSession
  readonly policy: Policy
  /** The call's arguments, where the host has them: some tools read only when told to wait. */
  readonly input?: Readonly<Record<string, unknown>>
}

/** Refuse the tool call, or let it run. */
export function answerToolCall({ tool, session, policy, input }: ToolCall): ToolCallAnswer {
  if (isRawMeshRead(tool, input)) {
    return {
      deny:
        `${tool} hands this session other agents' text that no gate has seen, so it is not called at all. ` +
        'Read a room through its gate instead: it returns only what the room admits.',
    }
  }

  if (session.record_missing) {
    return isShellTool(tool)
      ? {
          deny:
            'Nothing executes in this session: its record of what it has taken in cannot be read, so it is treated as ' +
            'having taken in everything. Start a fresh session (/clear on the Claude Code host) to clear it.',
        }
      : undefined
  }

  const decision = refuseExecutionAfterUngatedText({ tool, session: session.gate, policy })
  return decision.allow ? undefined : { deny: decision.refusal }
}
