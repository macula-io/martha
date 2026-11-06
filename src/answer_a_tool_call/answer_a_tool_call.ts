// What a host's tool.call hook returns.
//
// A host that can refuse a tool before running it asks this, on every tool call,
// and refuses the call when the answer is a denial. The denial text is written for
// the model that called the tool, because it is the model that has to stop.
//
// The launch is checked again first, on every call (../refuse_launch_of_unapproved_config).
// The hooks and servers the owner approved run scripts from the live checkout,
// so one call that changes the tree (a `gh pr checkout`, a pull) makes every
// hook after it run the new author's script. Once the checkout no longer
// matches what the owner approved, no tool runs; the launcher stops the member,
// because a host fires hooks on its own events even when every call is refused.
// What is left: the hooks of the one call that changed the tree.
//
// A raw mesh read is refused next, tainted or not
// (../read_a_room_through_its_gate): the room is read through its gate instead.
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
import { isRawMeshRead } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import {
  decideLaunch,
  readLaunchState,
  type LaunchPlace,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** A host refusal, or nothing to say. */
export type ToolCallAnswer = { readonly deny: string } | undefined

/** Where the member was started and what the owner approved there, as `prepareLaunch` was given it. */
export interface ApprovedLaunch extends LaunchPlace {
  readonly approved_fingerprints: readonly string[]
}

export interface ToolCall {
  readonly tool: string
  readonly session: HostSession
  readonly policy: Policy
  /** The call's arguments, where the host has them: some tools read only when told to wait. */
  readonly input?: Readonly<Record<string, unknown>>
  /** The member's launch, checked again before this call runs. */
  readonly launch: ApprovedLaunch
}

/** Refuse the tool call, or let it run. */
export function answerToolCall({ tool, session, policy, input, launch }: ToolCall): ToolCallAnswer {
  const launched = decideLaunch({ ...readLaunchState(launch), host: launch.host, approved_fingerprints: launch.approved_fingerprints })
  if (!launched.allow) {
    return {
      deny:
        'No tool runs in this session: the checkout it was started in no longer matches what the owner approved, ' +
        `and its hooks run the checkout's scripts as they are now. ${launched.refusal}`,
    }
  }

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
            `having taken in everything. ${WHAT_CLEARS_IT}`,
        }
      : undefined
  }

  const decision = refuseExecutionAfterUngatedText({ tool, session: session.gate, policy })
  return decision.allow ? undefined : { deny: decision.refusal }
}
