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

import {
  refusedOf,
  type Refused,
  type Rules,
  SYNTHETIC,
  type TextClass,
  textClasses,
  whole,
  withoutLabNames,
} from '../know_what_text_is_private/know_what_text_is_private.ts'

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


// Paths on github.com that are not an owner: a link there is not a repository.
const GITHUB_ROUTES = new Set([
  'about', 'apps', 'collections', 'contact', 'customer-stories', 'enterprise', 'explore', 'features',
  'login', 'marketplace', 'new', 'notifications', 'orgs', 'pricing', 'readme', 'security', 'settings',
  'site', 'sponsors', 'topics', 'trending', 'users',
])


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
    .map(() => ({
      where: print.clean(line.where),
      what: `a shorthand reference to another repository ${WITHHELD}: write owner/repo#n so it can be checked`,
    }))

// A lookup that throws stops the check, and its message is printed. The repository it
// was asked about is withheld there as in a hit (a rate limit or a 5xx says nothing
// about whether that name is public, martha#855), and the line that named it is said
// instead; any lab name left is replaced.
const resolvedOrCleanError = async (resolve: Resolve, reference: RepoReference) => {
  try {
    return await resolve(reference.owner, reference.repo)
  } catch (error) {
    const said = error instanceof Error ? error.message : String(error)
    const withheld = said.replaceAll(`${reference.owner}/${reference.repo}`, WITHHELD)
    throw new Error(withoutLabNames(`${withheld} (the repository named at ${reference.where})`))
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
