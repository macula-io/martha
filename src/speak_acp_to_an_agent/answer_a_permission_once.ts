// The one answer Martha gives an ACP agent's permission request: allow this call once, or refuse it once, and never
// an answer that saves a rule (macula-io/martha#541, shape 4).
//
// An agent offers its answers as options, each with an id and a kind. The Goose engine reads only the id it is sent
// back, and an id it does not know is a cancel (crates/goose/src/acp/server.rs, outcome_to_confirmation). So an option
// is taken only when its id and its kind are both the once-answer wanted. When no such option is offered, the answer is
// a cancel, which ACP defines as "the call does not run". There is no fallback to another option: the first option
// the engine offers is allow_always (martha#677).

/** The two answers Martha may give, as ACP names their kinds. Any other kind saves a rule past the client. */
export const ALLOW_ONCE = 'allow_once'
export const REJECT_ONCE = 'reject_once'

/** What the gate decided for one call, before it is put in the agent's words. */
export type ADecision = 'allow' | 'reject'

/** One option as an agent offers it in `session/request_permission`. */
export interface AnOfferedOption {
  readonly optionId?: unknown
  readonly kind?: unknown
}

/** The outcome sent back to the agent: one of the options it offered, or a cancel. */
export type TheOutcome = { readonly outcome: 'selected'; readonly optionId: string } | { readonly outcome: 'cancelled' }

/** The once-answer that carries a decision. */
export const theOnceAnswerFor = (decision: ADecision): string => (decision === 'allow' ? ALLOW_ONCE : REJECT_ONCE)

/** The option offered whose id and kind are both the once-answer for the decision, or a cancel when none is. */
export function answerOnce(offered: readonly AnOfferedOption[], decision: ADecision): TheOutcome {
  const wanted = theOnceAnswerFor(decision)
  const found = offered.some((option) => option.optionId === wanted && option.kind === wanted)
  return found ? { outcome: 'selected', optionId: wanted } : { outcome: 'cancelled' }
}
