// Run the check: node src/check_posted_text_carries_nothing_private/main.ts [--text <file>] [--self-test]
//
// Environment: GITHUB_REPOSITORY (owner/repo: whose posted text is read, set by
// Actions), GITHUB_TOKEN (read-only, for the repository lookups), MARTHA_LAB_HOSTS
// (the lab's machine families; a secret in CI), MARTHA_FORK_PR=1 on a pull
// request from a fork.
//
// Exit 0 clean, 1 hits (one line each, `where: what`), 2 the check could not be
// made. It never passes because it could not look.

import { readFileSync } from 'node:fs'

import {
  familiesFrom,
  withoutLabNames,
  privateHitsIn,
  type Hit,
  type Rules,
  type Source,
} from '../check_nothing_private_gets_in/check_nothing_private_gets_in.ts'
import { declaredOrNone, resolveOnGitHub, rulesOf } from '../check_nothing_private_gets_in/scan_rules_and_visibility.ts'
import { selfTest } from './plant_every_surface.ts'
import { postedTextSources } from './posted_text.ts'
import { readPostedText, API, type Call } from './read_posted_text.ts'

const NAME = 'check_posted_text_carries_nothing_private'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

// GitHub, as it answers a GET. Anything but an answer stops the check rather than
// being read as an empty surface.
const callGitHub = (token: string | undefined): Call => async ({ method, path }) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'martha-check-posted-text',
      ...(token === undefined || token === '' ? {} : { authorization: `Bearer ${token}` }),
    },
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`)
  return response.json()
}

const repositoryFrom = (): string => {
  const named = process.env['GITHUB_REPOSITORY'] ?? ''
  if (named === '') throw new Error('GITHUB_REPOSITORY is not set: there is no repository whose posted text to read')
  return named
}

const draftSources = (path: string): Source[] => postedTextSources([{ where: `draft ${path}`, text: readFileSync(path, 'utf8') }])

// What a run reads: a draft handed to it, or the text this repository has posted.
const sourcesOf = async (call: Call): Promise<readonly Source[]> => {
  const draft = option('--text')
  if (draft !== undefined) return draftSources(draft)
  return postedTextSources(await readPostedText(call, repositoryFrom()))
}

const report = (hits: readonly Hit[]) => {
  for (const hit of hits) console.log(`${hit.where}: ${hit.what}`)
}

const selfTested = async (rules: Rules): Promise<number> => {
  const failures = await selfTest(rules)
  for (const failure of failures) console.log(`does not bite: ${failure}`)
  console.log(failures.length === 0 ? `${NAME}: the check bites` : `${NAME}: self-test failed`)
  return failures.length === 0 ? 0 : 1
}

const main = async (): Promise<number> => {
  const families = familiesFrom(process.env['MARTHA_LAB_HOSTS'], process.env['MARTHA_FORK_PR'] === '1')
  if (families.kind === 'skipped') console.log(`lab machine families not checked: ${families.why}`)
  const rules = rulesOf(families, true)
  if (process.argv.includes('--self-test')) return selfTested(rules)
  const token = process.env['GITHUB_TOKEN']
  const hits = await privateHitsIn(await sourcesOf(callGitHub(token)), rules, resolveOnGitHub(token))
  report(hits)
  if (hits.length > 0) {
    console.error(`${NAME}: ${hits.length} hit(s). Keep the reasoning, drop the link: docs/nothing-private-gets-in.md`)
    return 1
  }
  console.log(`${NAME}: nothing private`)
  return 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    const said = withoutLabNames(error instanceof Error ? error.message : String(error), declaredOrNone())
    console.error(`${NAME}: the check could not be made: ${said}`)
    process.exit(2)
  },
)
