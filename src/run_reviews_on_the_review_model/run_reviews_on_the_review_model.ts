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
