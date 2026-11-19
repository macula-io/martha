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

import { digestStartsFinder } from './public_digest.ts'
import { HEX_DIGIT, ID_HEX_DIGITS, PUBLIC_TEXT_PATTERNS } from './public_text.ts'

export interface Rules {
  // Email domains this repository may name.
  readonly publicEmails: readonly string[]
  // Exact identifiers that are shaped like an email address and are not one,
  // such as a protocol's algorithm name. Only that string passes, never its domain.
  readonly publicAddresses: readonly string[]
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
  home_dir: String.raw`^/(home|Users)/synthetic$`,
  private_address: String.raw`^192\.168\.255\.[0-9]{1,3}$`,
  email: String.raw`^[A-Za-z0-9._%+-]+@synthetic\.invalid$`,
  hex_id: `^(${HEX_DIGIT})\\1{${ID_HEX_DIGITS - 1}}$`,
  repo_owner: String.raw`^synthetic-[a-z0-9-]+$`,
}

// Paths on github.com that are not an owner: a link there is not a repository.
const GITHUB_ROUTES = new Set([
  'about', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'explore', 'features',
  'login', 'marketplace', 'new', 'notifications', 'orgs', 'pricing', 'readme', 'security', 'settings',
  'site', 'sponsors', 'topics', 'trending', 'users',
])

const whole = (pattern: string) => new RegExp(pattern)
// A match and where it starts in the line: a class may decide by its context.
interface Found {
  readonly value: string
  readonly at: number
}
const each = (pattern: string, text: string, flags = 'g'): Found[] =>
  [...text.matchAll(new RegExp(pattern, flags))].map((found) => ({ value: found[0], at: found.index }))
// A host name has no case: the lab hostname class matches it however it is
// written. The pattern stays the shared definition's; the flag is this reader's.
const anyCase = 'gi'

// One class: its matches in a line, minus what the class accepts.
interface TextClass {
  readonly what: string
  readonly matches: (text: string) => readonly Found[]
  // The value, where it starts, and its line, for a class that reads its context.
  readonly accepts: (value: string, at: number, text: string) => boolean
}

const textClasses = (rules: Rules): readonly TextClass[] => {
  const synthetic = (pattern: string, flags = '') => (value: string) => rules.allowSynthetic && new RegExp(pattern, flags).test(value)
  const digestStarts = digestStartsFinder(PUBLIC_TEXT_PATTERNS.hex_id)
  // The whole hex run an id sits in: what is refused, and what a form must hold.
  const hexRun = `${HEX_DIGIT}*${PUBLIC_TEXT_PATTERNS.hex_id}${HEX_DIGIT}*`
  const oneId = whole(`^${PUBLIC_TEXT_PATTERNS.hex_id}$`)
  // A domain has no case: an allowed address passes however its domain is written.
  const allowEmail = new RegExp(
    `^(${PUBLIC_TEXT_PATTERNS.allow_email}${rules.publicEmails.map((domain) => `|[A-Za-z0-9._%+-]+@${domain.replace(/[.]/g, '\\.')}`).join('')}${rules.publicAddresses.map((address) => `|${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('')})$`,
    'i',
  )
  return [
    {
      what: 'a lab hostname',
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.lab_fqdn, text, anyCase),
      accepts: synthetic(SYNTHETIC.lab_fqdn, 'i'),
    },
    {
      what: 'a home directory',
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.home_dir, text),
      accepts: (value) => whole(PUBLIC_TEXT_PATTERNS.allow_home).test(value) || synthetic(SYNTHETIC.home_dir)(value),
    },
    {
      what: 'a private address',
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.private_address, text),
      accepts: synthetic(SYNTHETIC.private_address),
    },
    {
      what: 'an email address',
      matches: (text) => each(PUBLIC_TEXT_PATTERNS.email, text),
      accepts: (value) =>
        allowEmail.test(value) || synthetic(SYNTHETIC.email)(value) || synthetic(SYNTHETIC.lab_fqdn)(value.slice(value.indexOf('@') + 1)),
    },
    {
      what: `a ${ID_HEX_DIGITS}-hex id`,
      matches: (text) => each(hexRun, text),
      // A public digest is accepted only where a declared form holds it
      // (public_digest.ts), and only as a run of exactly one id's length: a longer
      // run (two ids, a key with more after it, a sha512) is refused whole. A bare
      // id is a node id or a key until shown otherwise.
      accepts: (value, at, text) =>
        synthetic(SYNTHETIC.hex_id)(value) || (oneId.test(value) && digestStarts(text).has(at)),
    },
  ]
}

const LAB_HOST = '<lab host>'

// Any text this check prints, with each lab hostname in it replaced, in any case: a
// hit's location, a repository name, an error a lookup or git threw.
export const withoutLabNames = (text: string) => text.replace(new RegExp(PUBLIC_TEXT_PATTERNS.lab_fqdn, anyCase), LAB_HOST)

// A value one class refuses in a line, as the scan found it. It is never printed: a hit
// carries only the class (martha#855).
export interface Refused {
  readonly what: string
  readonly value: string
}

const refusedOf = (text: string, classes: readonly TextClass[]): Refused[] =>
  classes.flatMap((one) =>
    one.matches(text)
      .filter((found) => !one.accepts(found.value, found.at, text))
      .map((found) => ({ what: one.what, value: found.value })),
  )

// What each class refuses in one line of text, value and all, for the tests that pin
// which value a class refuses. The check's own output goes through privateHitsIn,
// which withholds every value.
export const refusedValuesIn = (text: string, rules: Rules): Refused[] => refusedOf(text, textClasses(rules))

// Nothing printed carries a private value. A class's value is withheld whole, whatever
// its class, and so is the name a repository hit or a shorthand hit found: a CI log of
// a public repository is public (martha#846, martha#855). The path a hit is found at,
// which is printed, has each lab hostname in it replaced.
const WITHHELD = '(value withheld)'
const printing = () => {
  const clean = withoutLabNames
  const shown = (refused: Refused) => `${refused.what} ${WITHHELD}`
  return { clean, shown }
}
type Printing = ReturnType<typeof printing>

const textHitsOf = (line: Line, classes: readonly TextClass[], print: Printing): Hit[] =>
  refusedOf(line.text, classes).map((refused) => ({ where: print.clean(line.where), what: print.shown(refused) }))

export interface RepoReference {
  readonly where: string
  readonly owner: string
  readonly repo: string
}

const URL_REFERENCE = String.raw`(?:api\.)?github\.com[:/]+(?:repos/)?([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)`
const RAW_REFERENCE = String.raw`raw\.githubusercontent\.com/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)`
const ISSUE_REFERENCE = String.raw`(?<![A-Za-z0-9._/-])([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)#[0-9]+\b`
// A repository's own name never ends in a hyphen, so a hyphen before the `#`
// separates prose from the reference: "the pre-#189 original" and "the post-#12
// cleanup" name no repository, and reading `pre-` as one spent the daily run's
// whole signal on a sentence that was correct (martha#287). A trailing dot or
// underscore stays allowed: a repository may end in one, and missing a
// reference is worse than reading one.
const SHORTHAND_REFERENCE = String.raw`(?<![A-Za-z0-9._/-])([A-Za-z](?:[A-Za-z0-9._-]*[A-Za-z0-9._])?)#[0-9]+\b`

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
      what: `a shorthand reference to another repository ${WITHHELD}: write owner/repo#n so it can be checked`,
    }))

// A lookup that throws stops the check, and its message is printed: whatever it
// says about the repository it was asked has its lab names replaced first.
const resolvedOrCleanError = async (resolve: Resolve, reference: RepoReference) => {
  try {
    return await resolve(reference.owner, reference.repo)
  } catch (error) {
    throw new Error(withoutLabNames(error instanceof Error ? error.message : String(error)))
  }
}

// Every hit in the sources. Each distinct repository is resolved once.
export const privateHitsIn = async (sources: readonly Source[], rules: Rules, resolve: Resolve): Promise<Hit[]> => {
  const classes = textClasses(rules)
  const print = printing()
  const lines = sources.flatMap((source) => source.lines)
  const references = lines.flatMap((line) => repoReferencesIn(line, rules))
  const visibility = new Map<string, Visibility>()
  for (const reference of references) {
    const key = `${reference.owner}/${reference.repo}`.toLowerCase()
    if (!visibility.has(key)) visibility.set(key, await resolvedOrCleanError(resolve, reference))
  }
  const repoHits = references
    .filter((reference) => visibility.get(`${reference.owner}/${reference.repo}`.toLowerCase()) !== 'public')
    .map((reference) => ({
      where: print.clean(reference.where),
      what: `a repository that is not public ${WITHHELD}`,
    }))
  return [
    ...lines.flatMap((line) => [...textHitsOf(line, classes, print), ...shorthandHitsOf(line, rules, print)]),
    ...repoHits,
  ]
}
