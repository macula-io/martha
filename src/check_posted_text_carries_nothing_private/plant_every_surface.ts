// The self-test: every surface is read, and what it carries is refused, in
// memory. GitHub's answers are stood in for, so this needs no token and no
// network; what it proves is the reader and the crew's decision together, on
// every pull request (martha#265).

import { randomBytes } from 'node:crypto'

import { privateHitsIn, type Resolve, type Rules } from '../check_nothing_private_gets_in/check_nothing_private_gets_in.ts'
import { postedTextSources } from './posted_text.ts'
import { API, PER_PAGE, readPostedText, ROUTES, type Call } from './read_posted_text.ts'

// The stand-in repository. Its owner is a synthetic one, so the tree scan knows
// it is not a repository anyone has to look up.
const REPO = 'synthetic-owner-martha-265/nowhere'
const PULL = 263
const COMMIT = randomBytes(20).toString('hex')

/**
 * The key a stand-in answers one page under, built here from the route alone.
 *
 * It must not ask the reader for it. A stand-in keyed by the code under test agrees
 * with that code's own bug, which is how a malformed page URL reached a green run:
 * the reader asked GitHub for `.../issues/comments&per_page=100&page=1` and every
 * stand-in in this tree had that exact string in its map (martha#265 r=2). Built
 * from the route, a malformed request finds no answer and stops the check.
 */
export const standInPage = (route: string, page: number): string => {
  const url = new URL(route, API)
  url.searchParams.set('per_page', String(PER_PAGE))
  url.searchParams.set('page', String(page))
  return `${url.pathname}${url.search}`
}

// The form a public text may write, and must pass here: a placeholder the class
// cannot match. Every field without a plant carries it, so anything else the
// check refuses is refused for a reason the self-test did not plant.
const PLACEHOLDER = '/home/<user>'

// A cited path, drawn at run time: this file sits in the tree the tree scan
// reads, so it never carries a home path of its own.
const aCitedPath = (): string => ['', 'home', `u${randomBytes(6).toString('hex')}`].join('/')

// One plant per surface, in the shape GitHub answers each surface with.
const answering = (plant: string): Call => {
  const answers: Readonly<Record<string, unknown>> = {
    [standInPage(ROUTES.issues(REPO), 1)]: [{ number: 1, title: PLACEHOLDER, body: plant }],
    [standInPage(ROUTES.issueComments(REPO), 1)]: [
      { id: 6765201999, issue_url: `https://api.github.com/repos/${REPO}/issues/170`, body: plant },
    ],
    [standInPage(ROUTES.pulls(REPO), 1)]: [{ number: PULL, title: PLACEHOLDER, body: plant }],
    [standInPage(ROUTES.reviews(REPO, PULL), 1)]: [{ id: 4810, body: plant }],
    [standInPage(ROUTES.reviewComments(REPO), 1)]: [
      { id: 4812, pull_request_url: `https://api.github.com/repos/${REPO}/pulls/${PULL}`, body: plant },
    ],
    [standInPage(ROUTES.commitComments(REPO), 1)]: [{ id: 12, commit_id: COMMIT, body: plant }],
  }
  return async ({ path }) => {
    const answer = answers[path]
    if (answer === undefined) throw new Error(`the self-test planted nothing for ${path}`)
    return answer
  }
}

// No plant names a repository, so this answers without a request leaving the process.
const inMemory: Resolve = async () => 'public'

const wheresToBiteAt = (): readonly string[] => [
  'issue #1 body:1',
  'issue #170 comment 6765201999:1',
  `pull ${PULL} body:1`,
  `pull ${PULL} review 4810:1`,
  `pull ${PULL} review comment 4812:1`,
  `commit ${COMMIT.slice(0, 7)} comment 12:1`,
]

/** What the check fails to refuse, or refuses though the placeholder may be written. */
export const selfTest = async (rules: Rules): Promise<string[]> => {
  const sources = postedTextSources(await readPostedText(answering(aCitedPath()), REPO))
  const hits = await privateHitsIn(sources, rules, inMemory)
  const expected = wheresToBiteAt()
  const failures = expected.filter((where) => !hits.some((hit) => hit.where === where)).map((where) => `a cited path is not refused in ${where}`)
  if (hits.length !== expected.length) failures.push(`what the check refuses is not one plant per surface (${hits.length} hit(s))`)
  return failures
}
