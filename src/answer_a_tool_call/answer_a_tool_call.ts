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
// recheck, the reach rule and the mesh read above stand whatever it says. An
// audited member runs on these two exactly as on the taint rule, and each leaves
// its line before it runs (../audit_the_gate_for_a_member, martha#321 r=2).
//
// This is the whole wiring on the host side: one question per tool call. Which
// host asks it is an adapter detail — the answer is the core's.

import {
  WHAT_CLEARS_IT,
  refuseExecutionAfterUngatedText,
  type Policy,
} from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import type { ToolNames } from '../host_contract/host_contract.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { isRawMeshRead } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { WHO_DECIDES_REACH, widensMemberReach } from '../refuse_widening_a_member_reach/refuse_widening_a_member_reach.ts'
import { recheckLaunchPassingOwnWrites } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import { keepAWouldRefusal, type AWouldRefusal, type GateAuditPlace } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import type { GateMode } from '../read_the_gate_mode/read_the_gate_mode.ts'
import type { ApprovedLaunch, LaunchHost } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { refuseACallPastTheBudget, type ASpendInForce } from '../hold_a_package_to_its_budget/refuse_a_call_past_the_budget.ts'
import {
  refuseACallOutsideTheContract,
  type TheContractHanded,
} from '../refuse_calls_outside_the_package_contract/refuse_a_call_outside_the_contract.ts'

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
  /**
   * Where this member's audit lines are kept; required for an audited member, and refused without when it is audited.
   * A caller with no audit folder says so rather than leaving the field out, so a launcher reads one line here.
   */
  readonly audit?: GateAuditPlace | undefined
  /**
   * What the package this member holds has spent of its budget (martha#513, slice 3), read by the caller: the units its
   * contract names and what was spent of each. Absent, undefined, or a package with count left refuses nothing.
   *
   * It is asked after the gate and before the contract's acts (slice 2), and that order is the whole of the rule: a call
   * refused for tainted text keeps the gate's reason, and a member at its wall is told it is spent rather than told to
   * ask the owner for a new contract version — which would invite it to try something else and hit the wall anyway.
   */
  readonly spend?: ASpendInForce | undefined
  /**
   * What the package this member holds says about this call (martha#513 slice 2, martha#597), or none. Read by the
   * caller from the package's own ledger (../a_crews_tools), never guessed here: the gate stays a function of what it is
   * handed.
   *
   * A package with no contract version at all arrives as "none recorded", and that refuses every call but five: the four
   * that end a package, and the tool that records one (martha#597). Absent therefore means one of four things: the
   * member holds no package, the call is no act and the version in force reads none, the crew keeps no contracts at
   * all, or the ledger could not answer and the call is no act — the caller answers "unreadable" only for a call that is
   * an act, so the acts it cannot judge are refused and nothing else. Each of those refuses nothing. A contract the
   * ledger could not read back, for an act, arrives as that and refuses the act.
   */
  readonly contract?: TheContractHanded
}

/** The refusal an audited member's call gets when its own line cannot be kept: the gate's words, then why it stopped. */
const refusedBecauseTheAuditCouldNotBeKept = (refusal: string, why: string): ToolCallAnswer => ({
  deny: `${refusal} (this member is audited, and its audit line could not be kept: ${why}, so the call is refused.)`,
})

/** Refuse the tool call, or let it run. */
export function answerToolCall(asked: ToolCall): ToolCallAnswer {
  const refusedBeforeTheGate = theRefusalBeforeTheGate(asked)
  if (refusedBeforeTheGate !== undefined) return refusedBeforeTheGate

  const refusedByTheGate = theGatesAnswer({ tool: asked.tool, session: asked.session, policy: asked.policy, gate: asked.gate ?? 'enforced', audit: asked.audit })
  if (refusedByTheGate !== undefined) return refusedByTheGate

  // What the package has spent of its budget, after the gate and before the contract's acts (martha#513, slice 3): it
  // can only turn a yes into a no, and a member at its wall is told it is spent rather than told to ask the owner for a
  // new contract version — which would invite it to try something else and hit the wall anyway. The four calls that end
  // a package run whatever the package has spent.
  const refusedPastTheBudget = refuseACallPastTheBudget({ tool: asked.tool }, asked.spend, asked.names.ownNameOf)
  if (refusedPastTheBudget !== undefined) return { deny: refusedPastTheBudget }

  // The package's own contract, last of all (martha#513 slice 2): it narrows what the gate has already allowed and never
  // widens it, and a call refused above keeps saying the more serious reason.
  const refusedByTheContract = refuseACallOutsideTheContract({ tool: asked.tool, input: asked.input }, asked.contract, asked.names.ownNameOf)
  return refusedByTheContract === undefined ? undefined : { deny: refusedByTheContract }
}

/**
 * The refusals that come before the gate, each of which stands on the call, the launch or the session: the launch
 * rechecked, the reach rule, the raw mesh read, and the two that stand on text the session took in.
 */
function theRefusalBeforeTheGate({ tool, session, input, launch, names, host, agents_running = [], gate = 'enforced', audit }: ToolCall): ToolCallAnswer {
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

  // The refusals that stand on the session rather than on the call: a record that cannot be read, and an agent the host
  // started that has not stopped. An audited member's call runs on them too, and each leaves its line (martha#321 r=2);
  // the owner's switch turns them off with the taint rule and nothing else.
  const offTheRecord = refusedOffTheRecord(session, tool, agents_running)
  if (offTheRecord === undefined || gate === 'off') return undefined
  return gate === 'enforced'
    ? { deny: offTheRecord.refusal }
    : auditedOrRefused(audit, { tool, arrival: { path: null, from_node_id: null, why: offTheRecord.why }, refusal: offTheRecord.refusal })
}

/**
 * The line an audited member's call leaves before it runs, or the refusal when that line cannot be kept: an audit that
 * can lose its evidence is worse than none (martha#321). Undefined answers the call, which then runs.
 */
function auditedOrRefused(audit: GateAuditPlace | undefined, wouldRefusal: AWouldRefusal): ToolCallAnswer {
  if (audit === undefined) return refusedBecauseTheAuditCouldNotBeKept(wouldRefusal.refusal, 'no place to write it was given to this launcher')
  const unkept = keepAWouldRefusal(audit, wouldRefusal)
  return unkept === undefined ? undefined : refusedBecauseTheAuditCouldNotBeKept(wouldRefusal.refusal, unkept.refusal)
}

/** What the gate answers this call, in the member's mode: refuse, run, or run with the refusal written down first. */
function theGatesAnswer(asked: Pick<ToolCall, 'tool' | 'session' | 'policy'> & { readonly gate: GateMode; readonly audit: GateAuditPlace | undefined }): ToolCallAnswer {
  const { tool, session, policy, gate, audit } = asked
  const decision = refuseExecutionAfterUngatedText({ tool, session: session.gate, policy, strict_gate: gate !== 'off' })
  if (decision.allow) return undefined
  return gate === 'audited' ? auditedOrRefused(audit, { tool, arrival: decision.arrival, refusal: decision.refusal }) : { deny: decision.refusal }
}

/** A refusal the gate would give that stands on the session, its own words, and the part that says what it stands on. */
interface ARefusalOffTheRecord {
  readonly refusal: string
  readonly why: string
}

/**
 * The refusals that stand on text the session took in rather than on the call: a record that cannot be read, and an
 * agent the host started that has not stopped (martha#170). Both are part of the owner's strict gate (martha#259). They
 * stand on no arrival, so the line an audited member's call leaves names none: its path and sender are null and `why`
 * says which agent, or that the record cannot be read (martha#321 r=2).
 */
function refusedOffTheRecord(session: HostSession, tool: string, agents_running: readonly string[]): ARefusalOffTheRecord | undefined {
  if (session.record_missing) {
    return isShellTool(tool)
      ? {
          refusal:
            'Nothing executes in this session: its record of what it has taken in cannot be read, so it is treated as ' +
            `having taken in everything. ${WHAT_CLEARS_IT}`,
          why: 'the record of what this session took in cannot be read',
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
function theAgentItWaitsOn(agents_running: readonly string[], tool: string): ARefusalOffTheRecord | undefined {
  if (agents_running.length === 0 || !isShellTool(tool)) return undefined
  const named = agents_running.join(', ')
  return {
    refusal:
      `Nothing executes in this session: an agent this host started (${named}) has not stopped, ` +
      'and a background agent hands its answer into the turn with no call to place it on. The shell comes back when ' +
      'it stops.',
    why: `an agent this host started (${named}) has not stopped`,
  }
}

/**
 * What the crew refuses of this call after the gate has allowed it, or undefined when it refuses nothing.
 *
 * The crew's reviewer-model rule stands beside the gate and never inside it (martha#315): a call a reviewer's role may
 * not make is refused after the gate has allowed it, and never in place of the gate's own answer. The workspace guard's
 * first seam is asked in the same place (martha#562), over the shell line the call carries, and a held end of the turn
 * (martha#311 ruling D) is asked last of all, so it only turns a yes into a no.
 */
export async function whatTheCrewRefusesOfACall(
  crew: CrewTools | undefined,
  call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> },
  session_id: string,
): Promise<string | undefined> {
  return (await crew?.refusesTheSubagent({ tool: call.tool, input: call.input }))
    ?? (await crew?.refusesTheGitIn({ tool: call.tool, input: call.input }))
    ?? crew?.ends.deniesACall(session_id)
}
