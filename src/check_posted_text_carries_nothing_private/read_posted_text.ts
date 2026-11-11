// The API: this repository's own posted text on GitHub, a page at a time. Every
// surface is a GET of a path ROUTES defines, asked with per_page=100 and followed
// to its last page. A request that cannot be answered throws, and the run exits
// 2: it never passes because it could not look (martha#265).

import type { PostedText } from './posted_text.ts'

/** One request the reader makes. Nothing here writes, so GET is the only method. */
export interface Request {
  readonly method: 'GET'
  readonly path: string
}

/** How the reader asks GitHub. main.ts answers it with fetch; a test with a map. */
export type Call = (request: Request) => Promise<unknown>

export const PER_PAGE = 100
// A ceiling on pages, so a list that never ends stops the run instead of hanging it.
const PAGE_LIMIT = 100
const SHORT_SHA_LENGTH = 7

const REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

// GitHub's answer root. A route is a path under it; one page of it is a path too.
export const API = 'https://api.github.com'

const checkedRepository = (repository: string): string => {
  if (!REPOSITORY.test(repository)) throw new Error(`not a repository: ${repository}`)
  return repository
}

/** The six surfaces, each as the path its first page is read from. */
export const ROUTES = {
  issues: (repo: string) => `/repos/${repo}/issues?state=all`,
  issueComments: (repo: string) => `/repos/${repo}/issues/comments`,
  pulls: (repo: string) => `/repos/${repo}/pulls?state=all`,
  reviews: (repo: string, number: number) => `/repos/${repo}/pulls/${number}/reviews`,
  reviewComments: (repo: string) => `/repos/${repo}/pulls/comments`,
  commitComments: (repo: string) => `/repos/${repo}/comments`,
} as const

/** The path of one page of a list. `state` is the surface's own; it is never added here.
 *
 * The query is built through URL and its search params rather than appended, so a
 * route that carries no `?` gets a well-formed one: only `issues` and `pulls` have a
 * query of their own, and the other four used to be asked as
 * `.../issues/comments&per_page=100&page=1`, which GitHub answers 404 (martha#265 r=2).
 */
export const pageOf = (path: string, page: number): string => {
  const url = new URL(path, API)
  url.searchParams.set('per_page', String(PER_PAGE))
  url.searchParams.set('page', String(page))
  return `${url.pathname}${url.search}`
}

const listOf = (answered: unknown, path: string): readonly unknown[] => {
  if (!Array.isArray(answered)) throw new Error(`GitHub answered no list for ${path}`)
  return answered
}

const pagesOf = async (call: Call, path: string): Promise<readonly unknown[]> => {
  const all: unknown[] = []
  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    const onPage = listOf(await call({ method: 'GET', path: pageOf(path, page) }), path)
    all.push(...onPage)
    if (onPage.length < PER_PAGE) return all
  }
  throw new Error(`GitHub answered more than ${PAGE_LIMIT} pages for ${path}`)
}

const recordOf = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`GitHub answered no object for ${path}`)
  return value as Record<string, unknown>
}

const textIn = (record: Record<string, unknown>, name: string, path: string): string => {
  const value = record[name]
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') throw new Error(`GitHub answered no ${name} for ${path}`)
  return value
}

const numberIn = (record: Record<string, unknown>, name: string, path: string): number => {
  const value = record[name]
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`GitHub answered no ${name} for ${path}`)
  return value
}

const NUMBER_AT_THE_END = /\/([0-9]+)$/

const numberInUrl = (record: Record<string, unknown>, name: string, path: string): number => {
  const found = NUMBER_AT_THE_END.exec(textIn(record, name, path))
  if (found === null || found[1] === undefined) throw new Error(`GitHub answered no number in ${name} for ${path}`)
  return Number(found[1])
}

// An issue or a pull request: its title, and its body.
const titledTexts = (where: string, record: Record<string, unknown>, path: string): PostedText[] => [
  { where: `${where} title`, text: textIn(record, 'title', path) },
  { where: `${where} body`, text: textIn(record, 'body', path) },
]

/** An issue, as written in the issues list. A pull request is read as a pull. */
export const issuesOf = async (call: Call, repo: string): Promise<PostedText[]> => {
  const path = ROUTES.issues(repo)
  const records = (await pagesOf(call, path)).map((one) => recordOf(one, path))
  return records
    .filter((record) => record['pull_request'] === undefined)
    .flatMap((record) => titledTexts(`issue #${numberIn(record, 'number', path)}`, record, path))
}

/** The conversation on an issue, and on a pull request, which is one list. */
export const issueCommentsOf = async (call: Call, repo: string): Promise<PostedText[]> => {
  const path = ROUTES.issueComments(repo)
  return (await pagesOf(call, path)).map((one) => recordOf(one, path)).map((record) => ({
    where: `issue #${numberInUrl(record, 'issue_url', path)} comment ${numberIn(record, 'id', path)}`,
    text: textIn(record, 'body', path),
  }))
}

const pullRecordsOf = async (call: Call, repo: string): Promise<readonly Record<string, unknown>[]> => {
  const path = ROUTES.pulls(repo)
  return (await pagesOf(call, path)).map((one) => recordOf(one, path))
}

/** A pull request's own title and body, and the numbers its reviews are read by. */
export interface Pulls {
  readonly texts: readonly PostedText[]
  readonly numbers: readonly number[]
}

export const pullsOf = async (call: Call, repo: string): Promise<Pulls> => {
  const path = ROUTES.pulls(repo)
  const records = await pullRecordsOf(call, repo)
  return {
    texts: records.flatMap((record) => titledTexts(`pull ${numberIn(record, 'number', path)}`, record, path)),
    numbers: records.map((record) => numberIn(record, 'number', path)),
  }
}

/** The body of each review of one pull request. */
export const reviewsOf = async (call: Call, repo: string, number: number): Promise<PostedText[]> => {
  const path = ROUTES.reviews(repo, number)
  return (await pagesOf(call, path)).map((one) => recordOf(one, path)).map((record) => ({
    where: `pull ${number} review ${numberIn(record, 'id', path)}`,
    text: textIn(record, 'body', path),
  }))
}

/** An inline review comment, wherever on the diff it was written. */
export const reviewCommentsOf = async (call: Call, repo: string): Promise<PostedText[]> => {
  const path = ROUTES.reviewComments(repo)
  return (await pagesOf(call, path)).map((one) => recordOf(one, path)).map((record) => ({
    where: `pull ${numberInUrl(record, 'pull_request_url', path)} review comment ${numberIn(record, 'id', path)}`,
    text: textIn(record, 'body', path),
  }))
}

/** A comment left on a commit. */
export const commitCommentsOf = async (call: Call, repo: string): Promise<PostedText[]> => {
  const path = ROUTES.commitComments(repo)
  return (await pagesOf(call, path)).map((one) => recordOf(one, path)).map((record) => {
    const commit = textIn(record, 'commit_id', path)
    if (commit.length < SHORT_SHA_LENGTH) throw new Error(`GitHub answered no commit_id for ${path}`)
    return { where: `commit ${commit.slice(0, SHORT_SHA_LENGTH)} comment ${numberIn(record, 'id', path)}`, text: textIn(record, 'body', path) }
  })
}

/**
 * Every surface, read whole. A pull request is read once: it appears in the issues
 * list too, and that copy is skipped.
 */
export const readPostedText = async (call: Call, repository: string): Promise<PostedText[]> => {
  const repo = checkedRepository(repository)
  const pulls = await pullsOf(call, repo)
  const reviews: PostedText[] = []
  for (const number of pulls.numbers) reviews.push(...(await reviewsOf(call, repo, number)))
  return [
    ...(await issuesOf(call, repo)),
    ...(await issueCommentsOf(call, repo)),
    ...pulls.texts,
    ...reviews,
    ...(await reviewCommentsOf(call, repo)),
    ...(await commitCommentsOf(call, repo)),
  ]
}
