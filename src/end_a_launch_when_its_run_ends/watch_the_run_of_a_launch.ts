// The lifeline wiring of one launch (#472): what the launcher asks of its run's pipe, what it hands the member, and what
// it records for the hold that decides whether a member may run at all.
//
// This exists so the launcher keeps only the calls. A launch declared the lifeline with four functions of its own, which
// took the launch directory past its ceiling for a capability that is the run's end's, not the launch's: the pipe, the
// `theGroupIsKnown` answer and the environment that names no descriptor are all read here (review r=3, DECIDED
// 2026-11-14 "Launcher may rise until split" — the split landed, so what follows it is to fit by moving code).
//
// Nothing here decides anything: the killer is `stop` and the clean-up is `takeTheLaunchOffTheDisk`, both the launcher's
// own, and a launch with no lifeline is watched by nothing — an owner's own start is untouched.

import { recordMemberStopped } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { ClaudeCodeMemberLaunch, LaunchMade } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { launchRecordsDirectory } from '../linux_process_identity/launch_records_directory.ts'
import { takeTheLaunchOffTheDisk, THE_RUN_IS_GONE, theRunsLifeline, type TheRunsLifeline } from './the_run_lifeline.ts'

/** What a launch records of its run, for the hold that decides whether a member may run at all (#472). */
export interface WhatTheRunWatches {
  /**
   * Whether the run that asked for this launch has gone (#472), read by the hold before a member is admitted: a launch
   * given no lifeline is never told, which is every launch an owner's own terminal starts.
   */
  readonly theRunIsGone?: () => boolean
}

/**
 * The launch a run asks for, and what that launch has of its run: the same launch with the lifeline's variable dropped
 * from its member's environment, and the lifeline itself — nothing when no variable names one, a refusal when the
 * variable names no pipe this launcher can read, and the pipe otherwise. Nothing is made here.
 */
export function theLaunchItsRunAsks(
  asking: ClaudeCodeMemberLaunch,
  notStarted: string,
): { readonly launch: ClaudeCodeMemberLaunch; readonly lifeline: TheRunsLifeline } {
  const lifeline = theRunsLifeline(asking.inherited, notStarted)
  return { launch: underItsRun(asking, lifeline), lifeline }
}

/**
 * The run's end over this launch (#472): the moment its pipe says the run has gone, the member's group is killed with
 * no grace, then the relay directory and the snapshot go, then its launch record — what a launch does when a signal
 * ends it, in the order that keeps the member from running while the directories are removed. A run that goes before
 * the member's group is known is answered by `theGroupIsKnown`, which kills it as soon as the pid is in hand.
 *
 * A launch with no lifeline is watched by nothing, and its two calls say so by doing nothing.
 */
export function watchItsRun(
  lifeline: TheRunsLifeline,
  launch: ClaudeCodeMemberLaunch,
  made: LaunchMade,
  theGroup: () => number | undefined,
  stop: (why: string) => void,
): { theGroupIsKnown(): void; forgetTheRun(): void } {
  if (lifeline.kind !== 'watched') return { theGroupIsKnown: () => undefined, forgetTheRun: () => undefined }
  const theRunWent = (): void => {
    const group = theGroup()
    if (group === undefined) return
    stop(THE_RUN_IS_GONE)
    takeTheLaunchOffTheDisk(made, () => recordMemberStopped(launchRecordsDirectory(launch.places.launch_records), launch.member_name))
  }
  lifeline.whenTheRunEnds(theRunWent)
  return {
    // The end may have come while no group was known, so `whenTheRunEnds` found nothing to kill: the group is in hand
    // now, and a run that has gone is answered here and a run that has not waits for its own end.
    theGroupIsKnown: () => {
      if (lifeline.theRunIsGone()) theRunWent()
    },
    forgetTheRun: () => lifeline.forget(),
  }
}

/**
 * What this launch is asked with, once its run's lifeline is taken in: the same launch, and its member's environment
 * without the variable that named the pipe (#472) — a member, a tool server or a nested `martha start` then finds no
 * variable naming a descriptor that is not there.
 */
export function underItsRun(asking: ClaudeCodeMemberLaunch, lifeline: TheRunsLifeline): ClaudeCodeMemberLaunch {
  return lifeline.kind === 'watched' ? { ...asking, inherited: lifeline.inherited } : asking
}

/** What this launch records of its run, from the lifeline it took in. */
export function whatTheRunWatches(lifeline: TheRunsLifeline): WhatTheRunWatches {
  return lifeline.kind === 'watched' ? { theRunIsGone: lifeline.theRunIsGone } : {}
}

/** The refusal, told to the owner as well as answered, so a line of it reaches their terminal. */
export function told(launch: ClaudeCodeMemberLaunch, refusal: string): string {
  launch.tellOwner(refusal)
  return refusal
}
