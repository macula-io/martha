// The yes a landing stands on (martha#605).
//
// This exists so a default branch moves only on a yes Martha recorded, never on a member's word that it heard one. The
// declaration's table says who may approve a landing (APPROVE_LANDING, read as every act is read: an act the table leaves
// out is the owner's alone). When it grants the act to the caller's role, the caller's own call is the yes. When it grants
// it to the owner, the yes is an ask the owner said yes to in the owner's ask queue (../queue_the_owners_asks).
// Otherwise nobody the call can name may approve, and it is refused.
//
// An owner's yes counts only for the landing it was asked about: the ask's question must be, exactly, the question this
// slice builds for the landing (the repository, its default branch, the full tip and every package). `verify_range`
// hands the member that question to queue word for word, so the owner reads in the menu what the yes is checked
// against. A yes to another tip, to fewer or more packages, or to a question that only mentions the tip is no yes to this
// landing. A yes used again for the same tip lands nothing new: the tip is on the default branch already, and the
// fast-forward refuses a branch that moved.
//
// The question binds a yes to one landing only when every part of it names one thing. The tip is a full commit id, not a
// ref: a yes to "at feature-branch" would land whatever the branch points to when the push runs. A package name carries
// no joiner: one package whose name is two names joined would ask the question those two packages ask, and the landing's
// ledger rows would name packages that did not land. Both are refused before the yes is looked for (theLandingNamesOneThingEach).
//
// What a queue's yes stands on is the host's own answer to the menu, not a member's account of it (martha#608): a settle
// is refused unless a menu closed in the session after the batch was taken and its answer was kept, and every id it names
// is one the owner picked, as that answer reports the picks. That closes the settle tool, not a write that goes around it
// (T5 in martha#605): members run as the owner's own OS user, so a process of theirs can still append to the queue's
// stream itself. martha#619 keeps a member's file tools out of the state root, and that is not a process of its own. Only
// an OS wall would stop it, and the owner closed that road (martha#258): it is a speed bump that makes a faked yes awkward
// and visible, not a boundary (docs/agent-control-loop.md).

import { APPROVE_LANDING, OWNER, whoTheTableGrants } from '../declare_crew/declare_crew.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { A_COMMIT } from '../wait_for_ci/wait_for_ci.ts'
import { MAX_ASK, OWNER_YES, QUEUE_ASK, theAsksSaidYesToWithTheirWords, theQuestion } from '../queue_the_owners_asks/queue_the_owners_asks.ts'

/** The argument the fast-forward names the owner's yes in, the id of the ask they said yes to, as the queue names one. */
export { OWNER_YES }

/** The ref an origin's default branch has in a clone, before it is the branch's own name. */
const THE_ORIGIN_PREFIX = 'origin/'

/** A branch's own name, with the origin's ref taken off: `origin/main` is `main`. */
export const branchOf = (default_branch: string): string =>
  default_branch.startsWith(THE_ORIGIN_PREFIX) ? default_branch.slice(THE_ORIGIN_PREFIX.length) : default_branch

/** The landing a yes is asked about: the repository, its default branch, the tip it moves to, and the packages. */
export interface ALandingAskedAbout {
  readonly repo: string
  readonly default_branch: string
  readonly tip: string
  readonly packages: readonly string[]
}

/**
 * The question the owner says yes to for this landing, as the ask queue keeps a question. The packages are sorted, so
 * the same landing named in another order asks the same question.
 */
export const theLandingQuestion = (landing: ALandingAskedAbout): string => theQuestion(theWholeQuestion(landing))

/** What the landing question puts between two package names. */
export const THE_PACKAGES_JOINER = ', '

/**
 * Why a landing's tip or packages do not each name one thing, or undefined when they do: the tip must be a full commit
 * id, and no package name may carry the joiner the question puts between packages.
 */
export function theLandingNamesOneThingEach(landing: Pick<ALandingAskedAbout, 'tip' | 'packages'>): string | undefined {
  if (!A_COMMIT.test(landing.tip)) return `a landing names its tip as a full commit id, forty hex digits, so a yes is to one commit and not to a ref that can move; read ${JSON.stringify(landing.tip)}.`
  const joined = landing.packages.find((one) => one.includes(THE_PACKAGES_JOINER))
  return joined === undefined ? undefined : `a package name may not carry ${JSON.stringify(THE_PACKAGES_JOINER)}, which the landing question puts between packages; read ${JSON.stringify(joined)}.`
}

/** The question before the queue's rule is applied to it: what is measured against the length an ask keeps. */
function theWholeQuestion(landing: ALandingAskedAbout): string {
  const packages = [...landing.packages].sort().join(THE_PACKAGES_JOINER)
  return `Land ${packages} on ${landing.repo} ${branchOf(landing.default_branch)} at ${landing.tip}?`
}

/** Why this landing's question cannot be asked whole, or undefined when it can: an ask longer than the queue keeps is cut. */
export function aQuestionTooLong(landing: ALandingAskedAbout): string | undefined {
  const not_one_thing = theLandingNamesOneThingEach(landing)
  if (not_one_thing !== undefined) return not_one_thing
  const whole = theWholeQuestion(landing)
  if (whole.length <= MAX_ASK) return undefined
  return `the owner's question for this landing is ${String(whole.length)} characters, and an ask keeps ${String(MAX_ASK)}: land fewer packages at once.`
}

/** The part of a declaration this slice is decided by: the members' roles, and the table of who may do what. */
export interface TheApprovingDeclaration {
  readonly members: readonly { readonly name: string; readonly role: string }[]
  readonly mode: { readonly may: Readonly<Partial<Record<string, readonly string[]>>> }
}

/**
 * What a landing's yes is checked with: who calls, the declaration, the ask it names, and how to read the landing itself.
 * The landing is read only when the owner's yes is looked for, so a yes the caller's role gives reads no clone.
 */
export interface TheYesAsked {
  readonly member: string
  readonly declaration: TheApprovingDeclaration
  readonly owner_yes: number | undefined
  readonly landing: () => Promise<{ readonly ok: ALandingAskedAbout } | { readonly refused: string }>
}

/** What the yes came to: what the landing stands on, as its ledger rows say it; or why there is none. */
export type TheYes = { readonly stood_on: string } | { readonly refused: string }

/** What a landing on the owner's yes to ask `ask` says it stood on: its ledger note ends with these words (martha#639). */
export const theOwnersYesTo = (ask: number): string => `the owner's yes to ask ${String(ask)}`

/**
 * The yes this landing stands on, or why it has none. Reads the owner's asks only when the table grants the act to the
 * owner and not to the caller's role; writes nothing.
 */
export async function theYesALandingStandsOn(host: LedgerHost, asked: TheYesAsked): Promise<TheYes> {
  const granted = whoTheTableGrants(asked.declaration.mode.may[APPROVE_LANDING])
  const role = asked.declaration.members.find((one) => one.name === asked.member)?.role
  if (role !== undefined && granted.includes(role)) {
    return { stood_on: `${asked.member}'s own yes, as a ${role}: the declaration grants ${APPROVE_LANDING} to that role` }
  }
  if (granted.includes(OWNER)) return theOwnersYes(host, asked)
  return { refused: `${asked.member} may not land: the declaration grants ${APPROVE_LANDING} to ${granted.join(', ') || 'nobody'}, and ${asked.member}'s role is ${role ?? 'none on this crew'}. Nothing was pushed.` }
}

/** The owner's yes to this landing's question, found in the ask queue by the id the call names, or why it is not there. */
async function theOwnersYes(host: LedgerHost, asked: TheYesAsked): Promise<TheYes> {
  const landing = await asked.landing()
  if ('refused' in landing) return { refused: `${landing.refused} Nothing was pushed.` }
  const question = theLandingQuestion(landing.ok)
  if (asked.owner_yes === undefined) {
    return { refused: `a landing needs the owner's yes, because the declaration grants ${APPROVE_LANDING} to the owner: queue ${JSON.stringify(question)} with ${QUEUE_ASK}, word for word, have it offered and settled, then name that ask's id as ${OWNER_YES}. Nothing was pushed.` }
  }
  let said_yes: Awaited<ReturnType<typeof theAsksSaidYesToWithTheirWords>>
  try {
    said_yes = await theAsksSaidYesToWithTheirWords(host)
  } catch (error) {
    return { refused: `the owner's asks could not be read, so no yes can be found: ${error instanceof Error ? error.message : String(error)}. Nothing was pushed.` }
  }
  const answered = said_yes.find((ask) => ask.id === asked.owner_yes)
  if (answered === undefined) return { refused: `the owner has not said yes to ask ${String(asked.owner_yes)}, and only the owner's yes lands on this crew. Nothing was pushed.` }
  if (answered.question !== question) {
    return { refused: `the owner said yes to ask ${String(asked.owner_yes)}, which asked ${JSON.stringify(answered.question)}; this landing asks ${JSON.stringify(question)}, and a yes counts only for the landing it was asked about. Nothing was pushed.` }
  }
  return { stood_on: theOwnersYesTo(asked.owner_yes) }
}
