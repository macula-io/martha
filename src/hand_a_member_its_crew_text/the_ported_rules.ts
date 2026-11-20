// The crew-code prompt text Martha did not hand yet (martha#971, gap 19 of martha#957).
//
// This exists so a member learns the crew's rules from its start text, not from the first refusal. Each part is
// crew-code's own text (macula-sponsors 6f353d51, `crew-code/hooks/register.tsx` prompt.compose), said in Martha's tool
// names, and each line says only what Martha does: a guard Martha does not have is not named, and a part whose rule
// the declaration does not switch on is left out. No new rule is made here.
//
// Left out on purpose (the Supervisor's rulings on martha#971): the held-note, which waits for held messages (gap 15),
// and where briefs live, which waits for the refresh controls (gap 7).

import { LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { SETTLE_ASKS, TAKE_ASKS, LIST_ASKS, THE_WINDOW } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { SWITCH_YOUR_MODEL, RETURN_TO_YOUR_OWN_MODEL } from '../switch_a_members_model/the_switch_tools.ts'
import { UNHELD_WORK } from '../find_the_unheld_work/unheld_work_tool.ts'
import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { WHO_IS_FREE } from '../see_who_is_free/who_is_free_tool.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'

/** What the ported parts are given, all of it read from the declaration by the composer's caller. */
export interface WhatThePortedRulesRead {
  readonly owner: string
  /**
   * The crew's clones and worktrees as the git guard reads them (theWorkspaceTheCrewDeclared); null when the guard is
   * off, so the workspace part is handed exactly when the guard it describes holds (martha#971 review r=1).
   */
  readonly layout: { readonly clones: string; readonly worktrees: string } | null
  /** The crew's review model, when `house_rules.review_model` names one. */
  readonly review_model: string | null
  /** Whether this member's role is granted `assign_work`: it hands out the crew's work. */
  readonly assigns_work: boolean
  /** Whether this member's role is granted `offer_owner_asks`: it offers the owner the queued asks. */
  readonly offers_owner_asks: boolean
}

/** The ported parts this member is handed, each a section of its own, in crew-code's order. */
export function thePortedRules(reads: WhatThePortedRulesRead): readonly string[] {
  return [
    theProgressPart(reads.owner),
    reads.assigns_work ? theBriefsPart() : null,
    reads.assigns_work ? theRhythmPart(reads.owner) : null,
    theWorkspacePart(reads.layout),
    reads.offers_owner_asks ? theAskQueuePart(reads.owner) : null,
    reads.review_model === null ? null : theReviewsPart(reads.review_model),
    reads.assigns_work ? theModelsPart() : null,
  ].filter((part): part is string => part !== null)
}

/** crew-code's `crew:progress` (register.tsx:3772-3780). */
export function theProgressPart(owner: string): string {
  return [
    `## Progress\n\n${owner} watches every session on a dashboard with a progress bar.`,
    `Call ${REPORT_WHERE_THE_WORK_STANDS} when you start an assigned task (step 0 with your best estimate of steps),`,
    'after each meaningful step, and once when it is done (step equal to of).',
    'Keep `task` short and name the outcome, not the process. It answers nothing; carry on after it.',
    "When you stop for something, pass `waiting_on`: `ci` for a CI run, or the person you wait on (`owner`, `supervisor`, or a member's name),",
    'and, for a person, `waiting_for`: what you wait for (a HANDOFF, a verdict, a menu, a yes).',
    'Your row then shows who holds you up and for how long. Your next report without it ends the wait.',
  ].join(' ')
}

/** crew-code's `crew:briefs` (register.tsx:3115), its package rule only: where briefs live waits for gap 7. */
export function theBriefsPart(): string {
  return (
    '## Briefs\n\nName every package a member holds as org/repo#n in its brief; ' +
    "a reference to another member's issue or a dependency is not that member's package."
  )
}

/** crew-code's `crew:rhythm` (core/crew_rhythm.ts:16-65), each rule in Martha's tools. */
export function theRhythmPart(owner: string): string {
  const rules = [
    `Check before the menu. Run ${VERIFY_RANGE} on the range and put its one line in the menu, with what ${owner} sees once it lands and how it is rolled back. A range that fails the check is not offered.`,
    `Land a batch, not a queue. PRs on one repository that passed review land together: one member runs ${LAND_BATCH} in a fresh worktree with the passed PRs in order, each at the head its VERDICT passed, and opens one PR from it, so CI runs once on the batch's tip. Check that range with ${VERIFY_RANGE} and its packages.`,
    `Relay filter. Only a live release, an ask, a human act or a failed review reaches ${owner}. Members' intermediate reports and review chatter stay in the crew; small news waits for the next message ${owner} gets anyway. An analysis ${owner} asked for (an xref, a review result, a design comparison) comes in full, with file:line evidence, and is saved as a file.`,
    'A human act is one exact link or command. It is given after the script it runs has been read, with what success looks like.',
    `Decide what a rule settles. A choice a rule already settles is decided, not asked: say it was decided, and by which rule, so ${owner} can still overrule it.`,
    `Give work from the roster. Run ${WHO_IS_FREE} and assign from the row that fits: its model, its context, and whether it is parked. Ask it about the member you have in mind first; a no names why and the members that fit now, so give the work to one of those. For what to give, run ${UNHELD_WORK}: the open work-package and backlog issues nobody holds, with what last mentioned each, so work already merged is not assigned again.`,
    `A menu never stands on an IDEA. An item ${owner} only floated is never an option's precondition, and never rides in one option with a DECIDED change.`,
  ]
  return `## Rhythm\n\nSo a day stays comfortable for ${owner}: ${rules.map((rule, at) => `(${at + 1}) ${rule}`).join(' ')}`
}

/**
 * crew-code's workspace rules (core/workspace_hygiene.ts:545-566), as Martha holds them: its guard refuses a call on
 * another member's worktree or branch and prints one line for a clone taken off its default branch or a worktree made
 * inside a clone (../guard_workspace); the rest are the crew's rules, which nothing refuses.
 */
export function theWorkspacePart(layout: WhatThePortedRulesRead['layout']): string | null {
  if (layout === null) return null
  const rules = [
    `A clone in ${layout.clones}/<org>/<repo> stays on its default branch, clean and fast-forwarded; no feature branch is ever checked out there. Martha prints one line when a call takes a clone off it.`,
    `Branch work happens in a worktree at ${layout.worktrees}/<repo>-<slug> (flat), made with ${WORKTREE_OPEN} and removed with ${WORKTREE_FINISH}, together with its local branch, when the package closes.`,
    'One clone per repo: no second copy under another organisation directory or under another name.',
    `A worktree or branch whose name starts with another member's is theirs: only they remove it, through ${WORKTREE_FINISH}. Martha refuses a call that removes or moves it.`,
  ]
  return `## Workspace rules\n\n${rules.map((rule, at) => `(${at + 1}) ${rule}`).join(' ')}`
}

/** crew-code's `crew:ask-queue` (register.tsx:3110), in Martha's ask tools. */
export function theAskQueuePart(owner: string): string {
  return (
    `## The ask queue\n\nAt a natural pause, when no other menu is open, call ${TAKE_ASKS} and offer what it returns to ${owner} as ONE ` +
    'multi-select menu, each ask its own option, posted exactly as the answer gives it (ticked is yes, left is no; never a separate no option), then act on, or relay, each answer, ' +
    `and call ${SETTLE_ASKS} with its batch and the ids ${owner} ticked. ${LIST_ASKS} only looks. A batch not settled in ${THE_WINDOW} is queued again; settle it once answered, however late.`
  )
}

/** crew-code's `crew:reviews` (register.tsx:2911): the rule Martha's review model holds a spawned review to. */
export function theReviewsPart(review_model: string): string {
  return (
    `## Reviews\n\nReviews run on ${review_model}. When you spawn a subagent to review or attack work, pass model: '${review_model}' ` +
    'and name it as a review in its type or description; Martha refuses a review on another model.'
  )
}

/** crew-code's `crew:models`, the Supervisor half (register.tsx:2902-2905), in Martha's switch tools. */
export function theModelsPart(): string {
  return (
    "## Models\n\nWhen a package should run on another model (one the declaration names for that member: its own, or the crew's review_model), name it in the brief; the member switches with " +
    `${SWITCH_YOUR_MODEL} and back with ${RETURN_TO_YOUR_OWN_MODEL} or when it parks or reports progress on another package. ` +
    'A switch happens only because an assignment asks for it, never because of usage limits.'
  )
}
