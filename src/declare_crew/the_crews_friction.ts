// The repositories a crew's friction notes land in, and the email domains its notes may name (martha#318, ported from
// crew-code's `friction_repos` and `public_emails`).
//
// Both are the crew's own facts, declared rather than coded: the note check is one every crew runs, and a repository
// nothing declares is a repository nobody's token publishes free text into. The parse lives beside declare_crew, which
// hands it the declaration and its own refusal, as the thresholds are read (./the_crews_thresholds.ts).
//
// There is no `lab_hosts`. DECIDED 2026-11-18 "who the fuck cares if our lab machine names leak??? they are behind a
// NAT / Yes, stop scanning them (Recommended)": Martha does not check lab machine names, so a crew has none to declare
// and this file has no field for them.

/** The repositories a note may be filed in, as the declaration names them. */
export const FRICTION_REPOS = 'friction_repos'

/** The email domains a note may name besides the ones every note may. */
export const PUBLIC_EMAILS = 'public_emails'

/** A repository a note may land in: `owner/name`, as GitHub spells each. */
export const A_FRICTION_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

/** An email domain a crew's own notes may name: a domain, never an address and never a pattern. */
export const A_PUBLIC_EMAIL_DOMAIN = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/

/** How a field of this block is refused: the field, and why. */
export type RefuseAFrictionField = (field: string, why: string) => never

/** The crew's own friction configuration: where a note may land, and which domains it may name. */
export interface TheCrewsFriction {
  /** The repositories a note may be filed in, in one order, so a refusal names them the same way every time. */
  readonly repos: readonly string[]
  /** The domains a note may name, in one order. */
  readonly public_emails: readonly string[]
}

/** A crew that declares neither field files no note and names no domain of its own. */
export const NO_FRICTION_WHEN_UNNAMED: TheCrewsFriction = { repos: [], public_emails: [] }

/**
 * The two lists as the declaration names them, each entry checked and each named once. A field that is left out reads
 * as no entry at all: the tool then refuses every note, which is what a crew that declared no repository wants.
 */
export function theFrictionNotesOf(declaration: Readonly<Record<string, unknown>>, refuse: RefuseAFrictionField): TheCrewsFriction {
  return {
    repos: aListOf(declaration[FRICTION_REPOS], FRICTION_REPOS, A_FRICTION_REPO, 'a repository, "<org>/<repo>"', refuse),
    public_emails: aListOf(declaration[PUBLIC_EMAILS], PUBLIC_EMAILS, A_PUBLIC_EMAIL_DOMAIN, 'an email domain, such as "acme.example"', refuse),
  }
}

/** A list of entries that each match `is` and is named once; absent is an empty list, and a value of the wrong shape is refused. */
function aListOf(value: unknown, at: string, is: RegExp, what: string, refuse: RefuseAFrictionField): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) refuse(at, `is not a list of entries, each ${what}`)
  value.forEach((entry: unknown, i) => {
    if (typeof entry !== 'string' || !is.test(entry)) refuse(`${at}[${i}]`, `is not ${what}`)
  })
  const twice = value.find((entry: unknown, i: number) => value.indexOf(entry) !== i)
  if (twice !== undefined) refuse(at, `names '${String(twice)}' twice`)
  return [...(value as string[])].sort((a, b) => a.localeCompare(b))
}
