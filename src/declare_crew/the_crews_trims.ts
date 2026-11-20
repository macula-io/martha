// The four trims a crew holds itself to (martha#1010): two numbers it caps, and two switches that are on unless the
// owner says otherwise. They are house rules like any other, so an owner finds them in one block of the declaration,
// and a declaration that names none reads the crew as it runs today.
//
// A number here has one meaning wherever it is written, which is Terra's note on r=1 (martha#1010): a whole number is a
// fixed line, 0 is "no fixed line", and `false` is the separate word that turns that number's notices off. So 0 and
// false are not the same value, and a reader can tell an owner who set no line from one who asked not to be told.
//
// Nothing here refuses anything: a crossing is a notice to the owner, never a stop (DECIDED 2026-11-20 "Yes, all
// four"). What this file owns is the names, the defaults, and what a declaration must look like to hold them.

/** The most review rounds a package may take; the round after it goes to the owner as a scope question. */
export const REVIEW_ROUNDS_MOST = 'review_rounds_most'

/** The most lines a HANDOFF or a VERDICT may be. */
export const CREW_LINE_LINES_MOST = 'crew_line_lines_most'

/** Whether a reviewer FAILs only for harm a user or the owner would hit. Read by the role cards alone. */
export const FAIL_ONLY_ON_HARM = 'fail_only_on_harm'

/** Whether mutants and planted bugs go on guard and security code alone. Read by the role cards alone. */
export const MUTANTS_ON_GUARDS_ONLY = 'mutants_on_guards_only'

/** The trims that are a number: each a fixed line, 0 for none, or `false` for its notices off. */
export const HOUSE_RULE_MOSTS = [REVIEW_ROUNDS_MOST, CREW_LINE_LINES_MOST] as const
export type HouseRuleMost = (typeof HOUSE_RULE_MOSTS)[number]

/** The trims that are a switch: on unless the declaration says false. */
export const HOUSE_RULE_TRIM_SWITCHES = [FAIL_ONLY_ON_HARM, MUTANTS_ON_GUARDS_ONLY] as const
export type HouseRuleTrimSwitch = (typeof HOUSE_RULE_TRIM_SWITCHES)[number]

/**
 * The repo's three numbers (martha#1010's addendum): open issues, open issues untouched for the crew's days, and the
 * share of pull requests closed without merging. Each is a fixed line an owner may set, with 0 for no fixed line: a repo
 * number's notices are otherwise its rise against the same number seven days earlier.
 */
export const OPEN_ISSUES_MOST = 'open_issues_most'
export const UNTOUCHED_ISSUES_MOST = 'untouched_issues_most'
export const ABANDONED_PR_PERCENT_MOST = 'abandoned_pr_percent_most'
export const HOUSE_RULE_REPO_MOSTS = [OPEN_ISSUES_MOST, UNTOUCHED_ISSUES_MOST, ABANDONED_PR_PERCENT_MOST] as const
export type HouseRuleRepoMost = (typeof HOUSE_RULE_REPO_MOSTS)[number]

/** How many days an issue may go without an update before it is one of the untouched, a whole number of days. */
export const ISSUE_UNTOUCHED_DAYS = 'issue_untouched_days'

/** Every house rule the trims are written as, in the order the declaration page names them. */
export const HOUSE_RULE_TRIMS = [...HOUSE_RULE_MOSTS, ...HOUSE_RULE_TRIM_SWITCHES, ...HOUSE_RULE_REPO_MOSTS, ISSUE_UNTOUCHED_DAYS] as const

/** The crew's most review rounds when the declaration names none: the crew's own practice (DECIDED 2026-11-20). */
export const REVIEW_ROUNDS_MOST_WHEN_UNNAMED = 2

/** The longest HANDOFF or VERDICT when the declaration names none: the crew's own practice (DECIDED 2026-11-20). */
export const CREW_LINE_LINES_MOST_WHEN_UNNAMED = 10

/** Whether a trim's switch is on when the declaration names it nowhere: a trim is a bar, so it stands unless turned off. */
export const A_TRIM_SWITCH_WHEN_UNNAMED = true

/** How many days an issue may go without an update when the declaration names none: three, as Raf named it. */
export const ISSUE_UNTOUCHED_DAYS_WHEN_UNNAMED = 3

/** A percentage's whole: the abandoned pull requests are counted as a share of all of them, out of this. */
export const A_PERCENT = 100

/** What a repo number reads as when the declaration names none: no fixed line, so its notices are the trend alone. */
export const A_REPO_MOST_WHEN_UNNAMED = 0

/** What the declaration's two numbers read as: a whole number of items, or `false` for notices off. */
export type AMost = number | false

/** The crew's trims, as a declaration names them or as the defaults above read them. */
export type TheCrewsTrims = Readonly<Record<HouseRuleMost, AMost>> &
  Readonly<Record<HouseRuleTrimSwitch, boolean>> &
  Readonly<Record<HouseRuleRepoMost, AMost>> & { readonly issue_untouched_days: number }

/** A declaration field this file refuses: the key under `house_rules`, and why it is not one of the trims. */
export interface ATrimRefusal {
  readonly field: string
  readonly why: string
}

/**
 * Why a declaration cannot hold these trims, or null when it can: a number that is not a whole number, zero or more,
 * or false; a switch that is not true or false. A field named against its own name, so the owner sees which one.
 */
export function theTrimsRefused(value: Readonly<Record<string, unknown>>): ATrimRefusal | null {
  for (const most of HOUSE_RULE_MOSTS) {
    const why = aMostRefused(value[most])
    if (why !== undefined) return { field: most, why }
  }
  for (const most of HOUSE_RULE_REPO_MOSTS) {
    const why = aMostRefused(value[most]) ?? aPercentRefused(most, value[most])
    if (why !== undefined) return { field: most, why }
  }
  const days = value[ISSUE_UNTOUCHED_DAYS]
  if (days !== undefined && !(typeof days === 'number' && Number.isInteger(days) && days >= 1)) {
    return { field: ISSUE_UNTOUCHED_DAYS, why: 'is not a whole number of days, one or more' }
  }
  for (const trim of HOUSE_RULE_TRIM_SWITCHES) {
    const why = aSwitchRefused(value[trim])
    if (why !== undefined) return { field: trim, why }
  }
  return null
}

/** Why a share of pull requests is not one, or undefined when it is: a share is out of a hundred. */
const aPercentRefused = (most: HouseRuleRepoMost, named: unknown): string | undefined =>
  most !== ABANDONED_PR_PERCENT_MOST || typeof named !== 'number' || named <= A_PERCENT
    ? undefined
    : `is a percentage, so it is a whole number from 0 to ${String(A_PERCENT)}`

/** Why a number's value is not one of the numbers this file keeps, or undefined when it is. */
const aMostRefused = (named: unknown): string | undefined =>
  named === undefined || named === false || (typeof named === 'number' && Number.isInteger(named) && named >= 0)
    ? undefined
    : 'is not a whole number, zero or more, or false'

/** Why a switch's value is not one, or undefined when it is. */
const aSwitchRefused = (named: unknown): string | undefined =>
  named === undefined || typeof named === 'boolean' ? undefined : 'is not true or false'

/** The trims a declaration reads as: what it names, and the defaults for what it leaves out. */
export function trimsFrom(value: Readonly<Record<string, unknown>>): TheCrewsTrims {
  const mosts = Object.fromEntries(HOUSE_RULE_MOSTS.map((most) => [most, mostOf(most, value[most])]))
  const repo_mosts = Object.fromEntries(HOUSE_RULE_REPO_MOSTS.map((most) => [most, repoMostOf(value[most])]))
  const switches = Object.fromEntries(HOUSE_RULE_TRIM_SWITCHES.map((trim) => [trim, trimOf(value[trim])]))
  return {
    ...(mosts as Record<HouseRuleMost, AMost>),
    ...(repo_mosts as Record<HouseRuleRepoMost, AMost>),
    ...(switches as Record<HouseRuleTrimSwitch, boolean>),
    issue_untouched_days: typeof value[ISSUE_UNTOUCHED_DAYS] === 'number' ? (value[ISSUE_UNTOUCHED_DAYS] as number) : ISSUE_UNTOUCHED_DAYS_WHEN_UNNAMED,
  }
}

/** The crew's own defaults, for the roles a crew text can be composed without a declaration's own values. */
export const TRIMS_WHEN_UNNAMED: TheCrewsTrims = trimsFrom({})

/** A number's value as it is kept: what the declaration names, or the crew's own when it names none. */
function mostOf(most: HouseRuleMost, named: unknown): AMost {
  if (typeof named === 'number') return named
  if (named === false) return false
  return most === REVIEW_ROUNDS_MOST ? REVIEW_ROUNDS_MOST_WHEN_UNNAMED : CREW_LINE_LINES_MOST_WHEN_UNNAMED
}

/** A switch's value as it is kept: what the declaration says, or the crew's own when it names none. */
function trimOf(named: unknown): boolean {
  return typeof named === 'boolean' ? named : A_TRIM_SWITCH_WHEN_UNNAMED
}

/** A repo number's value as it is kept: what the declaration names, or no fixed line when it names none. */
function repoMostOf(named: unknown): AMost {
  if (typeof named === 'number') return named
  return named === false ? false : A_REPO_MOST_WHEN_UNNAMED
}

/**
 * Whether a number is a fixed line at all: a whole number above zero is one, and 0 and false are the two ways of
 * having none. Everything that would raise a notice asks this first, so 0 and false behave the same without being
 * written as the same value.
 */
export const aMostIsSet = (most: AMost): most is number => typeof most === 'number' && most > 0
