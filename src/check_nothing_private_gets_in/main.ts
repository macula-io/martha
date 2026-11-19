// Run the check: node src/check_nothing_private_gets_in/main.ts [--range <base>..<head>] [--self-test]
//
// Environment: GITHUB_TOKEN for the repository lookups.
//
// Exit 0 clean, 1 hits (one line each, `where: what`), 2 the check could not be
// made. It never passes because it could not look.

import {
  withoutLabNames,
  privateHitsIn,
  type Hit,
  type Resolve,
  type Source,
  type Visibility,
} from './check_nothing_private_gets_in.ts'
import { DECLARED } from './declared.ts'
import { commitSources, commitsOf, treeSources } from './read_sources.ts'
import { resolveOnGitHub, rulesOf } from './scan_rules_and_visibility.ts'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const sourcesOf = (root: string, range: string | undefined): Source[] => [
  ...treeSources(root),
  ...(range === undefined ? [] : commitsOf(root, range).flatMap((sha) => commitSources(root, sha))),
]

// Live proof that the check bites where CI runs it: the real lookup refuses a
// repository that is not public and passes this one.
const selfTest = async (resolve: Resolve): Promise<string[]> => {
  const failures: string[] = []
  const expect = async (what: string, got: Promise<Visibility>, want: Visibility) => {
    if ((await got) !== want) failures.push(what)
  }
  await expect('this repository resolves public', resolve('macula-io', DECLARED.ownRepo), 'public')
  await expect('a repository nobody can see resolves not public', resolve('synthetic-owner-martha-316', 'nowhere'), 'not_public')
  return failures
}

const report = (hits: readonly Hit[]) => {
  for (const hit of hits) console.log(`${hit.where}: ${hit.what}`)
}

const main = async (): Promise<number> => {
  const resolve = resolveOnGitHub(process.env['GITHUB_TOKEN'])
  if (process.argv.includes('--self-test')) {
    const failures = await selfTest(resolve)
    for (const failure of failures) console.log(`does not bite: ${failure}`)
    console.log(failures.length === 0 ? 'check_nothing_private_gets_in: the check bites' : 'check_nothing_private_gets_in: self-test failed')
    return failures.length === 0 ? 0 : 1
  }
  const root = option('--root') ?? process.cwd()
  const hits = await privateHitsIn(sourcesOf(root, option('--range')), rulesOf(true), resolve)
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
    const said = withoutLabNames(error instanceof Error ? error.message : String(error))
    console.error(`check_nothing_private_gets_in: the check could not be made: ${said}`)
    process.exit(2)
  },
)
