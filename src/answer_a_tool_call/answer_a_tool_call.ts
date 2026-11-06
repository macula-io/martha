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
// matches what the owner approved, no tool runs. The host also asks
// `recheckLaunch` after every call, and on a refusal that hook does not return
// until the launcher has sent SIGKILL to the member's process group, because a
// host fires hooks on its own events (the end of a turn, its exit) even when
// every call is refused. What is left: the hooks of the one call that changed
// the tree, which run in parallel with Martha's own.
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
import type { ToolNames } from '../host_contract/host_contract.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { isRawMeshRead } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import {
  recheckLaunch,
  type ApprovedLaunch,
  type LaunchHost,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

export type { ApprovedLaunch, LaunchHost }

/** A host refusal, or nothing to say. */
export type ToolCallAnswer = { readonly deny: string } | undefined

export interface ToolCall {
  readonly tool: string
  readonly session: HostSession
  readonly policy: Policy
  /** The call's arguments, where the host has them: some tools read only when told to wait. */
  readonly input?: Readonly<Record<string, unknown>>
  /** How this host names a called tool: `host.tools`, never a split of the core's own. */
  readonly names: ToolNames
  /** The member's launch, checked again before this call runs. */
  readonly launch: ApprovedLaunch
  /** The host the launch is read again through: its files, scratch and git. */
  readonly host: LaunchHost
}

/** Refuse the tool call, or let it run. */
export function answerToolCall({ tool, session, policy, input, launch, names, host }: ToolCall): ToolCallAnswer {
  const launched = recheckLaunch(launch, host)
  if (!launched.allow) {
    return {
      deny:
        'No tool runs in this session: the checkout it was started in no longer matches what the owner approved, ' +
        `and its hooks run the checkout's scripts as they are now. ${launched.refusal}`,
    }
  }

  if (isRawMeshRead(tool, input, names)) {
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
