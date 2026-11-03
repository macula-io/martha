// What a host's tool.call hook returns.
//
// A host that can refuse a tool before running it asks this, on every tool call,
// and refuses the call when the answer is a denial. The denial text is written for
// the model that called the tool, because it is the model that has to stop.
//
// This is the whole wiring on the host side: one question per tool call. Which
// host asks it is an adapter detail — the answer is the core's.

import {
  refuseExecutionAfterUngatedText,
  type Policy,
  type Session,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'

/** A host refusal, or nothing to say. */
export type ToolCallAnswer = { readonly deny: string } | undefined

export interface ToolCall {
  readonly tool: string
  readonly session: Session
  readonly policy: Policy
}

/** Refuse the tool call, or let it run. */
export function answerToolCall({ tool, session, policy }: ToolCall): ToolCallAnswer {
  const decision = refuseExecutionAfterUngatedText({ tool, session, policy })
  return decision.allow ? undefined : { deny: decision.refusal }
}
