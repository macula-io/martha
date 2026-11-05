// The check that code moved into this public repository carries nothing private:
// no link to a private issue, no internal host name, no private remote, and none
// of the crew's other private-text classes. See docs/nothing-private-gets-in.md
// for the threat model; this file is the decision, with no I/O of its own.
//
// A source is text with a name: a file of the tree, the added lines of a commit,
// a commit message. Each line is read for every class, and each hit says where
// and what. A repository reference is not decided by a list: it is handed to a
// resolver that asks whether that repository is public, so a private repository
// is refused without this public tree having to name it.

import { PUBLIC_TEXT_PATTERNS } from './public_text.ts'

export interface Rules {
  // The families of the lab's machine names. Private: CI reads them from a secret.
  readonly labHosts: readonly string[]
  // Email domains this repository may name.
  readonly publicEmails: readonly string[]
  // Owners whose bare `owner/repo` slugs are resolved even without a URL.
  readonly owners: readonly string[]
  // This repository's own name: `martha#n` is the one shorthand reference allowed.
  readonly ownRepo: string
  // Whether each class's synthetic form passes. On for a real scan, so the tests
  // that state a refused value can live in the tree; off where a test proves the
  // class itself refuses.
  readonly allowSynthetic: boolean
}

export interface Line {
  readonly where: string
  readonly text: string
}

export interface Source {
  readonly name: string
  readonly lines: readonly Line[]
}

export interface Hit {
  readonly where: string
  readonly what: string
}

export type Visibility = 'public' | 'not_public'
// Throws when it cannot tell: the check then cannot be made, and never passes.
export type Resolve = (owner: string, repo: string) => Promise<Visibility>

// The scan's own synthetic forms, one per class. Each is a whole-value match.
export const SYNTHETIC = {
  lab_fqdn: String.raw`^[a-z0-9-]+-synthetic\.lab$`,
  lab_machine: String.raw`^(%s)9[0-9]$`,
  home_dir: String.raw`^/(home|Users)/synthetic$`,
  private_address: String.raw`^192\.168\.255\.[0-9]{1,3}$`,
  email: String.raw`^[A-Za-z0-9._%+-]+@synthetic\.invalid$`,
  hex_id: String.raw`^([0-9a-f])\1{63}$`,
  repo_owner: String.raw`^synthetic-[a-z0-9-]+$`,
}

const FAMILY = /^[a-z][a-z0-9-]*$/

// Paths on github.com that are not an owner: a link there is not a repository.
const GITHUB_ROUTES = new Set([
  'about', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'explore', 'features',
  'login', 'marketplace', 'new', 'notifications', 'orgs', 'pricing', 'readme', 'security', 'settings',
  'site', 'sponsors', 'topics', 'trending', 'users',
])

const whole = (pattern: string) => new RegExp(pattern)
const each = (pattern: string, text: string, flags = 'g') => [...text.matchAll(new RegExp(pattern, flags))].map((found) => found[0])
// A host name has no case: the lab classes match it however it is written. The
// patterns stay the shared definition's; the flag is this reader's.
const anyCase = 'gi'
const families = (rules: Pick<Rules, 'labHosts'>) => {
  const bad = rules.labHosts.find((family) => !FAMILY.test(family))
  if (bad !== undefined) throw new Error('a lab host family is not a plain lowercase name')
  return rules.labHosts.join('|')
}

// One class: its matches in a line, minus what the class accepts.
interface TextClass {
  readonly what: string
  // The value is printed only where printing it leaks nothing new.
  readonly shows: boolean
  readonly matches: (text: string) => readonly string[]
  readonly accepts: (value: string) => boolean
}

const textClasses = (rules: Rules): readonly TextClass[] => {
  const synthetic = (pattern: string, flags = '') => (value: string) => rules.allowSynthetic && new RegExp(pattern, flags).test(value)
  const machine = rules.labHosts.length === 0 ? '' : families(rules)
  // A domain has no case: an allowed address passes however its domain is written.
  const allowEmail = new RegExp(
    `^(${PUBLIC_TEXT_PATTERNS.allow_email}${rules.publicEmails.map((domain) => `|[A-Za-z0-9._%+-]+@${domain.replace(/[.]/g, '\\.')}`).join('')})$`,
    'i',
  )
  return [
    {
      what: 'a lab hostname',
      shows: false,
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.lab_fqdn, text, anyCase),
      accepts: synthetic(SYNTHETIC.lab_fqdn, 'i'),
    },
    {
      what: 'a lab machine name',
      shows: false,
      matches: (text) => (machine === '' ? [] : each(PUBLIC_TEXT_PATTERNS.lab_machine.replace('%s', machine), text, anyCase)),
      accepts: synthetic(SYNTHETIC.lab_machine.replace('%s', machine), 'i'),
    },
    {
      what: 'a home directory',
      shows: true,
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.home_dir, text),
      accepts: (value) => whole(PUBLIC_TEXT_PATTERNS.allow_home).test(value) || synthetic(SYNTHETIC.home_dir)(value),
    },
    {
      what: 'a private address',
      shows: true,
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.private_address, text),
      accepts: synthetic(SYNTHETIC.private_address),
    },
    {
      what: 'an email address',
      shows: true,
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.email, text),
      accepts: (value) =>
        allowEmail.test(value) || synthetic(SYNTHETIC.email)(value) || synthetic(SYNTHETIC.lab_fqdn)(value.slice(value.indexOf('@') + 1)),
    },
    {
      what: 'a 64-hex id',
      shows: true,
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.hex_id, text),
      accepts: synthetic(SYNTHETIC.hex_id),
    },
  ]
}

// The lab's host names, generic and declared, as one pattern.
const labPatternOf = (rules: Pick<Rules, 'labHosts'>) =>
  rules.labHosts.length === 0
    ? PUBLIC_TEXT_PATTERNS.lab_fqdn
    : `${PUBLIC_TEXT_PATTERNS.lab_fqdn}|${PUBLIC_TEXT_PATTERNS.lab_machine.replace('%s', families(rules))}`

// Any text this check prints, with each lab name in it replaced, in any case: a
// hit's location, a repository name, an error a lookup or git threw.
export const withoutLabNames = (text: string, labHosts: readonly string[]) =>
  text.replace(new RegExp(labPatternOf({ labHosts }), 'gi'), '<lab host>')

// Nothing printed names a lab host: not a class's value (an email at a lab host),
// not a repository or shorthand name, not the path a hit is found at. A value of a
// class is withheld whole; anything else has each lab name in it replaced.
const printing = (rules: Rules) => {
  const lab = labPatternOf(rules)
  const clean = (text: string) => withoutLabNames(text, rules.labHosts)
  const shown = (one: TextClass, value: string) =>
    one.shows && !new RegExp(lab, 'i').test(value) ? `${one.what} (${value})` : `${one.what} (value withheld)`
  return { clean, shown }
}
type Printing = ReturnType<typeof printing>

const textHitsOf = (line: Line, classes: readonly TextClass[], print: Printing): Hit[] =>
  classes.flatMap((one) =>
    one.matches(line.text)
      .filter((value) => !one.accepts(value))
      .map((value) => ({ where: print.clean(line.where), what: print.shown(one, value) })),
  )

export interface RepoReference {
  readonly where: string
  readonly owner: string
  readonly repo: string
}

const URL_REFERENCE = String.raw`(?:api\.)?github\.com[:/]+(?:repos/)?([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)`
const RAW_REFERENCE = String.raw`raw\.githubusercontent\.com/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)`
const ISSUE_REFERENCE = String.raw`(?<![A-Za-z0-9._/-])([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)#[0-9]+\b`
const SHORTHAND_REFERENCE = String.raw`(?<![A-Za-z0-9._/-])([A-Za-z][A-Za-z0-9._-]*)#[0-9]+\b`

// The host is matched in any case (GitHub.com, GITHUB.COM); owner and repo are
// kept as written.
// A repository name as written: a remote's `.git` and a sentence's full stop are not part of it.
const repoName = (written: string) => written.replace(/\.git$/, '').replace(/[.]+$/, '')

const referencesBy = (pattern: string, line: Line, flags = 'g'): RepoReference[] =>
  [...line.text.matchAll(new RegExp(pattern, flags))].map((found) => ({
    where: line.where,
    owner: found[1] ?? '',
    repo: repoName(found[2] ?? ''),
  }))

const slugPattern = (owners: readonly string[]) =>
  String.raw`(?<![@A-Za-z0-9._/-])(${owners.map((owner) => owner.replace(/[.]/g, '\\.')).join('|')})/([A-Za-z0-9._-]+)`

// Every owner/repo a line names: in a URL or remote, as owner/repo#n, or as a bare
// slug under a declared owner. A synthetic owner and a github.com route are not
// repositories to resolve.
export const repoReferencesIn = (line: Line, rules: Rules): RepoReference[] => {
  const found = [
    ...referencesBy(URL_REFERENCE, line, 'gi'),
    ...referencesBy(RAW_REFERENCE, line, 'gi'),
    ...referencesBy(ISSUE_REFERENCE, line),
    ...(rules.owners.length === 0 ? [] : referencesBy(slugPattern(rules.owners), line)),
  ]
  const owned = (reference: RepoReference) =>
    reference.repo !== '' && !GITHUB_ROUTES.has(reference.owner.toLowerCase()) &&
    !(rules.allowSynthetic && whole(SYNTHETIC.repo_owner).test(reference.owner))
  const unique = new Map(found.filter(owned).map((reference) => [`${reference.owner}/${reference.repo}`.toLowerCase(), reference]))
  return [...unique.values()]
}

// A shorthand `name#n` names a repository without its owner. Only this
// repository's own is allowed: anything else cannot be told public or private.
const shorthandHitsOf = (line: Line, rules: Rules, print: Printing): Hit[] =>
  [...line.text.matchAll(new RegExp(SHORTHAND_REFERENCE, 'g'))]
    .map((found) => found[1] ?? '')
    .filter((name) => name.toLowerCase() !== rules.ownRepo.toLowerCase())
    .filter((name) => !(rules.allowSynthetic && whole(SYNTHETIC.repo_owner).test(name)))
    .map((name) => ({
      where: print.clean(line.where),
      what: `a shorthand reference to another repository (${print.clean(name)}#...): write owner/repo#n so it can be checked`,
    }))

// A lookup that throws stops the check, and its message is printed: whatever it
// says about the repository it was asked has its lab names replaced first.
const resolvedOrCleanError = async (resolve: Resolve, reference: RepoReference, rules: Rules) => {
  try {
    return await resolve(reference.owner, reference.repo)
  } catch (error) {
    throw new Error(withoutLabNames(error instanceof Error ? error.message : String(error), rules.labHosts))
  }
}

// Every hit in the sources. Each distinct repository is resolved once.
export const privateHitsIn = async (sources: readonly Source[], rules: Rules, resolve: Resolve): Promise<Hit[]> => {
  const classes = textClasses(rules)
  const print = printing(rules)
  const lines = sources.flatMap((source) => source.lines)
  const references = lines.flatMap((line) => repoReferencesIn(line, rules))
  const visibility = new Map<string, Visibility>()
  for (const reference of references) {
    const key = `${reference.owner}/${reference.repo}`.toLowerCase()
    if (!visibility.has(key)) visibility.set(key, await resolvedOrCleanError(resolve, reference, rules))
  }
  const repoHits = references
    .filter((reference) => visibility.get(`${reference.owner}/${reference.repo}`.toLowerCase()) !== 'public')
    .map((reference) => ({
      where: print.clean(reference.where),
      what: `a repository that is not public (${print.clean(`${reference.owner}/${reference.repo}`)})`,
    }))
  return [
    ...lines.flatMap((line) => [...textHitsOf(line, classes, print), ...shorthandHitsOf(line, rules, print)]),
    ...repoHits,
  ]
}

// The lab's families, from the environment. Missing outside a fork stops the
// check; a fork's pull request gets no secrets, so there it is skipped and said.
export type Families =
  | { readonly kind: 'declared'; readonly labHosts: readonly string[] }
  | { readonly kind: 'skipped'; readonly why: string }

export const familiesFrom = (raw: string | undefined, forkPullRequest: boolean): Families => {
  if (raw === undefined || raw.trim() === '') {
    if (forkPullRequest) return { kind: 'skipped', why: 'a pull request from a fork gets no secrets' }
    throw new Error('MARTHA_LAB_HOSTS is not set: the lab machine families cannot be checked')
  }
  const parsed: unknown = JSON.parse(raw)
  const valid = Array.isArray(parsed) && parsed.every((family) => typeof family === 'string' && FAMILY.test(family))
  if (!valid) throw new Error('MARTHA_LAB_HOSTS must be a JSON array of plain lowercase names')
  return { kind: 'declared', labHosts: parsed as string[] }
}
