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
const each = (pattern: string, text: string) => [...text.matchAll(new RegExp(pattern, 'g'))].map((found) => found[0])
const families = (rules: Rules) => {
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
  const synthetic = (pattern: string) => (value: string) => rules.allowSynthetic && whole(pattern).test(value)
  const machine = rules.labHosts.length === 0 ? '' : families(rules)
  const allowEmail = whole(
    `^(${PUBLIC_TEXT_PATTERNS.allow_email}${rules.publicEmails.map((domain) => `|[A-Za-z0-9._%+-]+@${domain.replace(/[.]/g, '\\.')}`).join('')})$`,
  )
  return [
    {
      what: 'a lab hostname',
      shows: false,
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.lab_fqdn, text),
      accepts: synthetic(SYNTHETIC.lab_fqdn),
    },
    {
      what: 'a lab machine name',
      shows: false,
      matches: (text) => (machine === '' ? [] : each(PUBLIC_TEXT_PATTERNS.lab_machine.replace('%s', machine), text)),
      accepts: synthetic(SYNTHETIC.lab_machine.replace('%s', machine)),
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

// A value is printed only when it names no lab host: an email at a lab host, or
// a home under a machine's name, would otherwise print the host by another class.
const printable = (rules: Rules) => {
  const lab = rules.labHosts.length === 0
    ? new RegExp(PUBLIC_TEXT_PATTERNS.lab_fqdn)
    : new RegExp(`${PUBLIC_TEXT_PATTERNS.lab_fqdn}|${PUBLIC_TEXT_PATTERNS.lab_machine.replace('%s', families(rules))}`)
  return (one: TextClass, value: string) => (one.shows && !lab.test(value) ? `${one.what} (${value})` : `${one.what} (value withheld)`)
}

const textHitsOf = (line: Line, classes: readonly TextClass[], shown: ReturnType<typeof printable>): Hit[] =>
  classes.flatMap((one) =>
    one.matches(line.text)
      .filter((value) => !one.accepts(value))
      .map((value) => ({ where: line.where, what: shown(one, value) })),
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

// A repository name as written: a remote's `.git` and a sentence's full stop are not part of it.
const repoName = (written: string) => written.replace(/\.git$/, '').replace(/[.]+$/, '')

const referencesBy = (pattern: string, line: Line): RepoReference[] =>
  [...line.text.matchAll(new RegExp(pattern, 'g'))].map((found) => ({
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
    ...referencesBy(URL_REFERENCE, line),
    ...referencesBy(RAW_REFERENCE, line),
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
const shorthandHitsOf = (line: Line, rules: Rules): Hit[] =>
  [...line.text.matchAll(new RegExp(SHORTHAND_REFERENCE, 'g'))]
    .map((found) => found[1] ?? '')
    .filter((name) => name.toLowerCase() !== rules.ownRepo.toLowerCase())
    .filter((name) => !(rules.allowSynthetic && whole(SYNTHETIC.repo_owner).test(name)))
    .map((name) => ({
      where: line.where,
      what: `a shorthand reference to another repository (${name}#...): write owner/repo#n so it can be checked`,
    }))

// Every hit in the sources. Each distinct repository is resolved once.
export const privateHitsIn = async (sources: readonly Source[], rules: Rules, resolve: Resolve): Promise<Hit[]> => {
  const classes = textClasses(rules)
  const shown = printable(rules)
  const lines = sources.flatMap((source) => source.lines)
  const references = lines.flatMap((line) => repoReferencesIn(line, rules))
  const visibility = new Map<string, Visibility>()
  for (const reference of references) {
    const key = `${reference.owner}/${reference.repo}`.toLowerCase()
    if (!visibility.has(key)) visibility.set(key, await resolve(reference.owner, reference.repo))
  }
  const repoHits = references
    .filter((reference) => visibility.get(`${reference.owner}/${reference.repo}`.toLowerCase()) !== 'public')
    .map((reference) => ({
      where: reference.where,
      what: `a repository that is not public (${reference.owner}/${reference.repo})`,
    }))
  return [
    ...lines.flatMap((line) => [...textHitsOf(line, classes, shown), ...shorthandHitsOf(line, rules)]),
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
