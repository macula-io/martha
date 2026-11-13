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
// matches what the owner approved, plus the member's own file writes
// (martha#132), no tool runs. The host also asks the same recheck after every call, and on a refusal that hook does not return
// until the launcher has sent SIGKILL to the member's process group, because a
// host fires hooks on its own events (the end of a turn, its exit) even when
// every call is refused. What is left: the hooks of the one call that changed
// the tree, which run in parallel with Martha's own.
//
// A raw mesh read is refused next, tainted or not
// (../read_a_room_through_its_gate): the room is read through its gate instead.
//
// Two of the refusals below stand on text the session took in rather than on
// the call itself: a record that cannot be read, and an agent the host started
// that has not stopped. The owner's switch (`house_rules.strict_gate`, martha#259)
// turns those off as well as the taint rule, and turns nothing else off: the
// recheck, the reach rule and the mesh read above stand whatever it says.
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
import { WHO_DECIDES_REACH, widensMemberReach } from '../refuse_widening_a_member_reach/refuse_widening_a_member_reach.ts'
import { recheckLaunchPassingOwnWrites } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import { keepAWouldRefusal, type GateAuditPlace } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import type { GateMode } from '../read_the_gate_mode/read_the_gate_mode.ts'
import type { ApprovedLaunch, LaunchHost } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

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
  /**
   * The agents this host started under this session that have not stopped (martha#170), by id. Defaults to none: a
   * caller that knows of no agent is the case before the host has one.
   */
  readonly agents_running?: readonly string[]
  /**
   * What the gate does to this member (martha#321), read from the declaration through the launcher
   * (../read_the_gate_mode). Absent means enforced, so a caller that has not heard of the setting keeps the guard.
   *
   * Off: nothing here refuses on what the session took in. Audited: the call runs, and the refusal the gate would have
   * given is written down before it runs (../audit_the_gate_for_a_member) — and the call is refused when that line
   * cannot be kept, because an audit that can lose its evidence is worse than none.
   */
  readonly gate?: GateMode
  /** Where this member's audit lines are kept; required for an audited member, and refused without when it is audited. */
  readonly audit?: GateAuditPlace
}

/** The refusal an audited member's call gets when its own line cannot be kept: the gate's words, then why it stopped. */
const refusedBecauseTheAuditCouldNotBeKept = (refusal: string, why: string): ToolCallAnswer => ({
  deny: `${refusal} (this member is audited, and its audit line could not be kept: ${why}, so the call is refused.)`,
})

/** Refuse the tool call, or let it run. */
export function answerToolCall({ tool, session, policy, input, launch, names, host, agents_running = [], gate = 'enforced', audit }: ToolCall): ToolCallAnswer {
  const launched = recheckLaunchPassingOwnWrites(launch, host)
  if (!launched.allow) {
    return {
      deny:
        'No tool runs in this session: the checkout it was started in no longer matches what the owner approved, ' +
        `and its hooks run the checkout's scripts as they are now. ${launched.refusal}`,
    }
  }

  if (widensMemberReach(tool, names)) {
    return { deny: `${tool} is not called in a member's session: ${WHO_DECIDES_REACH}.` }
  }

  if (isRawMeshRead(tool, input, names)) {
    return {
      deny:
        `${tool} hands this session other agents' text that no gate has seen, so it is not called at all. ` +
        'Read a room through its gate instead: it returns only what the room admits.',
    }
  }

  // An audited member's call runs whatever its record holds: the refusals that stand on the text are exactly what the
  // audit writes down below, and a refusal that names no arrival (an agent still running) leaves no line to write.
  const onTheRecord = refusedOnWhatItTookIn(session, tool, agents_running, gate === 'enforced')
  if (onTheRecord !== undefined) return onTheRecord

  return theGatesAnswer({ tool, session, policy, gate, audit })
}

/** What the gate answers this call, in the member's mode: refuse, run, or run with the refusal written down first. */
function theGatesAnswer(asked: Pick<ToolCall, 'tool' | 'session' | 'policy'> & { readonly gate: GateMode; readonly audit: GateAuditPlace | undefined }): ToolCallAnswer {
  const { tool, session, policy, gate, audit } = asked
  const decision = refuseExecutionAfterUngatedText({ tool, session: session.gate, policy, strict_gate: gate !== 'off' })
  if (decision.allow) return undefined
  if (gate !== 'audited') return { deny: decision.refusal }
  if (audit === undefined) return refusedBecauseTheAuditCouldNotBeKept(decision.refusal, 'no place to write it was given to this launcher')
  const unkept = keepAWouldRefusal(audit, { tool, arrival: decision.arrival, refusal: decision.refusal })
  return unkept === undefined ? undefined : refusedBecauseTheAuditCouldNotBeKept(decision.refusal, unkept.refusal)
}

/**
 * The refusals that stand on text the session took in rather than on the call: a record that cannot be read, and an
 * agent the host started that has not stopped (martha#170). Both are part of the owner's strict gate (martha#259), and
 * with it off they allow the call; what the session took in is still recorded either way.
 */
function refusedOnWhatItTookIn(
  session: HostSession,
  tool: string,
  agents_running: readonly string[],
  strict_gate: boolean,
): ToolCallAnswer {
  if (!strict_gate) return undefined
  if (session.record_missing) {
    return isShellTool(tool)
      ? {
          deny:
            'Nothing executes in this session: its record of what it has taken in cannot be read, so it is treated as ' +
            `having taken in everything. ${WHAT_CLEARS_IT}`,
        }
      : undefined
  }
  return theAgentItWaitsOn(agents_running, tool)
}

/**
 * The refusal a shell call gets while an agent the host started under this session has not stopped (martha#170): its
 * answer reaches the turn with no tool result to place it on, so nothing executes on text whose row has not been
 * decided yet. The agent's stop is what decides it.
 */
function theAgentItWaitsOn(agents_running: readonly string[], tool: string): ToolCallAnswer {
  if (agents_running.length === 0 || !isShellTool(tool)) return undefined
  return {
    deny:
      `Nothing executes in this session: an agent this host started (${agents_running.join(', ')}) has not stopped, ` +
      'and a background agent hands its answer into the turn with no call to place it on. The shell comes back when ' +
      'it stops.',
  }
}
