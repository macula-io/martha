// What a host's tool.call hook returns.
//
// A host that can refuse a tool before running it asks this, on every tool call,
// and refuses the call when the answer is a denial. The denial text is written for
// the model that called the tool, because it is the model that has to stop.
//
// This is the whole wiring on the host side: one question per tool call. Which
// host asks it is an adapter detail — the answer is the core's.

import {
  WHAT_CLEARS_IT,
  refuseExecutionAfterUngatedText,
  type Policy,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'

/** A host refusal, or nothing to say. */
export type ToolCallAnswer = { readonly deny: string } | undefined

export interface ToolCall {
  readonly tool: string
  readonly session: HostSession
  readonly policy: Policy
}

/** Refuse the tool call, or let it run. */
export function answerToolCall({ tool, session, policy }: ToolCall): ToolCallAnswer {
  if (session.record_missing) {
    return isShellTool(tool)
      ? {
          deny:
            'Nothing executes in this session: its record of what it has taken in cannot be read, so it is treated as ' +
            `having taken in everything. ${WHAT_CLEARS_IT}`,
        }
      : undefined
  }

  const decision = refuseExecutionAfterUngatedText({ tool, session: session.gate, policy })
  return decision.allow ? undefined : { deny: decision.refusal }
}
