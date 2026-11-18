// What the Claude Code host answers an Agent call with, as this build reads it (martha#390, martha#463).
//
// The answer's shape is the host's: a second host answers its own way, so the read lives here, in a host folder of its own
// (martha#463), and the slice that names a failed review (../name_a_review_the_host_reported_failed) is handed the model as
// a string. The fields read are declared once, so the core's check (prove_the_core/what_the_core_may_reach/no_host_bundle_read_in_the_core.ts)
// names a core slice that reads one of them itself.

import { keepTheModelAReviewResolvedTo, type TheReviewSpawns } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'

/** The field of an Agent call's result that names the model the agent really ran on. */
export const RESOLVED_MODEL = 'resolvedModel'

/** Every field of this host's answers that this build reads: a core slice spelling one is reading the host's shape. */
export const CLAUDE_CODE_ANSWER_FIELDS: readonly string[] = [RESOLVED_MODEL]

/**
 * The model the host answered an agent's call with, or undefined when the answer carries none (martha#390): the agent's
 * own model, never one read out of the host's prose.
 */
export function resolvedModelIn(answer: unknown): string | undefined {
  const result = (answer as { readonly result?: Readonly<Record<string, unknown>> } | null | undefined)?.result
  const resolved = result?.[RESOLVED_MODEL]
  return typeof resolved === 'string' && resolved !== '' ? resolved : undefined
}

/**
 * Keeps the model the host said a kept review call resolved to (martha#390): the call's answer carries the agent's own
 * model, and that — never a name out of the host's prose — is what a line about the review names it by. The rule is the
 * core's (`keepTheModelAReviewResolvedTo`), which the entry keeps a result's model by too (martha#541, PR 3).
 */
export function keepWhatTheReviewResolvedTo(reviews: TheReviewSpawns, call_id: string | undefined, answer: unknown): void {
  keepTheModelAReviewResolvedTo(reviews, call_id, resolvedModelIn(answer))
}
