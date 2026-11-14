// The crew's reviewer model, held to (martha#315).
//
// This exists so every review a member spawns runs on the model the crew declared for reviews, or not at all. The
// declaration already names one (`house_rules.review_model`, ../declare_crew); nothing read it until here.
//
// It is a house rule, not a security boundary: a member that calls a review something else defeats it, exactly as it
// does in the tool this ports. What it protects is the review count and the reviewer model's quality, and the owner's
// doc page says so plainly rather than implying a guard.
//
// The call is judged as the member made it, and a refused call is the member's to make again with the model named:
// nothing here rewrites a call, because a host that judges what it was handed would be judging its own rewrite
// (martha#315's design, "The review rule").
//
// Which tool spawns a subagent, and which of its arguments carry the type, the description and the model, are the
// adapter's to say; the core compares the names the adapter has resolved and never splits a model id itself.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'

// Which tool spawns a subagent, and which of its arguments carry the type, the description and the model, are the
// adapter's to say. The two names are compared as they are written: the host publishes no mapping from an alias to a
// full model id, so the alias IS the name the host takes in that field, and Martha invents no second spelling for it.

/** The tool a host spawns a subagent with, and the argument fields that say what it is and which model runs it. */
export interface ASpawnedAgent {
  /** The tool names that spawn a subagent, as the host spells them (`Agent`, and `Task` on older hosts). */
  readonly tools: readonly string[]
  /** The argument carrying the agent's type. */
  readonly type_field: string
  /** The argument carrying the short description of the task. */
  readonly description_field: string
  /** The argument carrying the model override, if the member names one. */
  readonly model_field: string
}

/**
 * The part of a name that makes a spawn a review: a word that starts with one of these, compared ignoring case, in
 * the agent's type or in its description. `reviewer`, `reviews` and `adversarial` are each one, and so is the
 * false positive the design accepts: an agent described as "review the logs" is a review for this rule.
 */
export const REVIEW_WORD_STEMS = ['review', 'adversar'] as const

/** What the rule is decided over: the host's spawn data and the crew's reviewer model. */
export interface TheReviewModelRule {
  readonly spawn: ASpawnedAgent
  /**
   * The crew's `house_rules.review_model`, or null when the declaration names none. Null means this rule is off: a
   * crew that declared no reviewer model has no model to hold a review to, and nothing is refused. A name the host
   * does not run never reaches here: the declaration refuses it when it is read (../declare_crew).
   */
  readonly review_model: string | null
}

/** A subagent call: the tool the member called, and its arguments as the host handed them over. */
export interface ASubagentCall {
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
}

/**
 * Why a subagent call is not run: it spawns a review and does not name the crew's reviewer model. Undefined when the
 * call is not a review, when the crew declared no reviewer model, or when the call names it.
 *
 * The refusal says exactly what to do, because the member is the one that has to do it: the same call again, with the
 * reviewer model named and the same prompt.
 */
export function reviewModelRefusal(call: ASubagentCall, rule: TheReviewModelRule): string | undefined {
  const review_model = rule.review_model
  if (review_model === null) return undefined
  if (!rule.spawn.tools.includes(call.tool)) return undefined
  if (!isAReview(call.input, rule.spawn)) return undefined
  const named = textOf(call.input[rule.spawn.model_field])
  if (named === review_model) return undefined
  return (
    `Not run: crew reviews run on ${review_model}. ` +
    `Call it again with model: '${review_model}' and the same prompt.`
  )
}

/** Whether a spawn is a review: its type or its description carries a review word. */
export function isAReview(input: Readonly<Record<string, unknown>>, spawn: ASpawnedAgent): boolean {
  return [spawn.type_field, spawn.description_field].some((field) => carriesAReviewWord(textOf(input[field])))
}

/** Whether a piece of text a member wrote says review, in any of its words. */
export function carriesAReviewWord(text: string): boolean {
  return wordsOf(text).some((word) => REVIEW_WORD_STEMS.some((stem) => word.startsWith(stem)))
}

/** The words of a text, lowercased, cut at anything that is not a letter. */
function wordsOf(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word !== '')
}

/** A field of a call as text, trimmed; '' when the member named none. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** What the crew's declaration said, or why it could not be read: what the rule is decided over here. */
export type TheCrewsDeclaration = { readonly settings: CrewSettings } | { readonly refused: string }

/** What a launch hands the rule: the declaration as it is read, and the host's own shape for a spawn. */
export interface WhatTheReviewRuleReads {
  readonly declared: () => Promise<TheCrewsDeclaration>
  readonly spawn: ASpawnedAgent | undefined
}

/**
 * The three questions the launcher asks about a crew's reviews: whether a subagent call is refused (martha#315), and
 * which allowed call is one of the crew's reviews on its reviewer model and what that model is (martha#390).
 */
export interface TheReviewRule {
  /** Why a subagent call this member made is not run: it spawns a review and does not name the reviewer model. */
  refusesTheSubagent(call: ASubagentCall): Promise<string | undefined>
  /** The crew's reviewer model when this call is one of its reviews on it, or null for any other call. */
  theReviewModelOfTheCall(call: ASubagentCall): Promise<string | null>
  /** The crew's reviewer model as the declaration names it, or null when it names none or cannot be read. */
  theReviewModel(): Promise<string | null>
}

/**
 * The rule, over one launch's places (martha#390 r=4): all three questions are the same rule read three ways, so they
 * are answered here from one reading of the declaration, and the adapter only says where the declaration and the host's
 * spawn shape are. A launch that cannot say what a spawn looks like refuses a review rather than letting it run unheld
 * (martha#315): the rule is the crew's, and a launcher that cannot judge it is not one that may pass it.
 */
export function theReviewRuleOver(reads: WhatTheReviewRuleReads): TheReviewRule {
  return {
    refusesTheSubagent: async (call) => refusesTheSubagentIn(call, await reads.declared(), reads.spawn),
    theReviewModelOfTheCall: async (call) => theReviewModelOfTheCallIn(call, await reads.declared(), reads.spawn),
    theReviewModel: async () => theReviewModelIn(await reads.declared()),
  }
}

/** Why a subagent call is not run, or undefined when nothing refuses it (martha#315). */
function refusesTheSubagentIn(call: ASubagentCall, declared: TheCrewsDeclaration, spawn: ASpawnedAgent | undefined): string | undefined {
  if ('refused' in declared) return undefined
  const review_model = declared.settings.house_rules.review_model
  if (review_model === null) return undefined
  if (spawn === undefined) {
    return `${call.tool} is not run: this crew holds reviews to ${review_model}, and this launch cannot say which tool spawns a subagent, so no review may run.`
  }
  return reviewModelRefusal(call, { spawn, review_model })
}

/**
 * The crew's reviewer model when this call spawns one of its reviews on it (martha#390), or null. It is the same rule
 * `reviewModelRefusal` applies, read the other way round: the call is a review by the words the rule itself matches, and
 * the model it names is the crew's reviewer model as the declaration spells it.
 */
function theReviewModelOfTheCallIn(call: ASubagentCall, declared: TheCrewsDeclaration, spawn: ASpawnedAgent | undefined): string | null {
  if ('refused' in declared) return null
  const review_model = declared.settings.house_rules.review_model
  if (review_model === null || spawn === undefined) return null
  if (!spawn.tools.includes(call.tool) || !isAReview(call.input, spawn)) return null
  return textOf(call.input[spawn.model_field]) === review_model ? review_model : null
}

/** The crew's reviewer model as the declaration names it, or null when it names none or cannot be read (martha#390). */
function theReviewModelIn(declared: TheCrewsDeclaration): string | null {
  return 'refused' in declared ? null : declared.settings.house_rules.review_model
}
