// Run the check: node src/check_nothing_private_gets_in/main.ts [--range <base>..<head>] [--self-test]
//
// Environment: MARTHA_LAB_HOSTS (a JSON array of the lab's machine families; a
// secret in CI), MARTHA_FORK_PR=1 on a pull request from a fork, GITHUB_TOKEN
// for the repository lookups.
//
// Exit 0 clean, 1 hits (one line each, `where: what`), 2 the check could not be
// made. It never passes because it could not look.

import {
  familiesFrom,
  privateHitsIn,
  type Families,
  type Hit,
  type Resolve,
  type Rules,
  type Source,
  type Visibility,
} from './check_nothing_private_gets_in.ts'
import { DECLARED } from './declared.ts'
import { commitSources, commitsOf, treeSources } from './read_sources.ts'

// Asks GitHub whether a repository is public. The answer is the repository's own
// visibility, not whether this caller can see it: a token that reads private
// repositories still gets `private: true` back, and that is refused.
export const resolveOnGitHub = (token: string | undefined): Resolve => async (owner, repo) => {
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'martha-check-nothing-private',
      ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
  })
  if (response.status === 404) return 'not_public'
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${owner}/${repo}`)
  const body = (await response.json()) as { private?: unknown; visibility?: unknown }
  return body.private === false && body.visibility === 'public' ? 'public' : 'not_public'
}

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const rulesOf = (families: Families, allowSynthetic: boolean): Rules => ({
  ...DECLARED,
  labHosts: families.kind === 'declared' ? families.labHosts : [],
  allowSynthetic,
})

const sourcesOf = (root: string, range: string | undefined): Source[] => [
  ...treeSources(root),
  ...(range === undefined ? [] : commitsOf(root, range).flatMap((sha) => commitSources(root, sha))),
]

// Live proof that the check bites where CI runs it: the real lookup refuses a
// repository that is not public and passes this one, and each declared family
// is refused. Nothing it plants is printed.
const selfTest = async (families: Families, resolve: Resolve): Promise<string[]> => {
  const failures: string[] = []
  const expect = async (what: string, got: Promise<Visibility>, want: Visibility) => {
    if ((await got) !== want) failures.push(what)
  }
  await expect('this repository resolves public', resolve('macula-io', DECLARED.ownRepo), 'public')
  await expect('a repository nobody can see resolves not public', resolve('synthetic-owner-martha-316', 'nowhere'), 'not_public')
  if (families.kind === 'declared') {
    const rules = rulesOf(families, true)
    for (const [index, family] of families.labHosts.entries()) {
      // In text, in a path, and as a shorthand name: refused each time, printed never.
      const planted: Source = {
        name: 'planted',
        lines: [
          { where: `family ${index + 1}`, text: `ran on ${family}07` },
          { where: `path docs/${family}07-notes.md`, text: `docs/${family}07-notes.md` },
          { where: `family ${index + 1} shorthand`, text: `see ${family}07#3` },
        ],
      }
      const hits = await privateHitsIn([planted], rules, resolve)
      const refused = hits.filter((hit) => hit.what === 'a lab machine name (value withheld)').length
      if (refused < 3) failures.push(`family ${index + 1} is not refused in text, a path and a shorthand`)
      // The planted name, not the bare family: a family may be an everyday word.
      if (hits.some((hit) => `${hit.where} ${hit.what}`.includes(`${family}07`))) failures.push(`family ${index + 1} is printed`)
    }
  }
  return failures
}

const report = (hits: readonly Hit[]) => {
  for (const hit of hits) console.log(`${hit.where}: ${hit.what}`)
}

const main = async (): Promise<number> => {
  const families = familiesFrom(process.env['MARTHA_LAB_HOSTS'], process.env['MARTHA_FORK_PR'] === '1')
  if (families.kind === 'skipped') console.log(`lab machine families not checked: ${families.why}`)
  const resolve = resolveOnGitHub(process.env['GITHUB_TOKEN'])
  if (process.argv.includes('--self-test')) {
    const failures = await selfTest(families, resolve)
    for (const failure of failures) console.log(`does not bite: ${failure}`)
    console.log(failures.length === 0 ? 'check_nothing_private_gets_in: the check bites' : 'check_nothing_private_gets_in: self-test failed')
    return failures.length === 0 ? 0 : 1
  }
  const root = option('--root') ?? process.cwd()
  const hits = await privateHitsIn(sourcesOf(root, option('--range')), rulesOf(families, true), resolve)
  report(hits)
  if (hits.length > 0) {
    console.error(`check_nothing_private_gets_in: ${hits.length} hit(s). Keep the reasoning, drop the link: docs/nothing-private-gets-in.md`)
    return 1
  }
  console.log('check_nothing_private_gets_in: nothing private')
  return 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`check_nothing_private_gets_in: the check could not be made: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  },
)
