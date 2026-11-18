// A link check that asks a slow host again before calling its link broken
// (martha#231, the class martha#40 named).
//
// `lychee --max-retries` retries a request that TIMED OUT. It does not retry a
// host that answers a "not now" status: once a response is a RejectedStatusCode,
// lychee 0.24.2 retries 429 alone (lychee-lib/src/retry.rs, `ErrorKind`), while
// its `StatusCode` rule -- which does carry 408 -- is only reached for a bare
// reqwest error. That is why shields.io's 408 failed the links job on 2026-11-10
// in 10.7 s: five tries with 3+6+12+24 s between them cannot finish that fast,
// so no retry was made.
//
// So a run that failed is repeated while EVERY link it names is one a host can
// recover from: 408, 429, any 5xx, or a timeout. One failure that cannot
// recover -- a 404, a file that is not there -- fails the check at once and by
// name, so this can never become "accept everything".
//
// A site that REFUSES the checker (403, or a 429 that never clears) is asked
// again like a slow host, but when the scans are spent it does not fail the
// check: it is reported by name and the check passes (martha#714). Such a site
// refused a bot; it did not say the page is gone, and a PR that never touched
// the link cannot fix it. A missing file, a 404 or any other status still fails.

export type Failure = {
  file: string
  url: string
  line: number
  column: number
  status: string
  code: number | undefined
  timeout: boolean
}

/** One run of the checker: what it exited with, and the report it left. */
export type Scan = { exitCode: number; report: string }

/** `refused`: the links a site refused the checker for, reported but never failing the check (martha#714). */
export type Verdict =
  | { verdict: 'resolved'; failures: []; refused: Failure[]; scans: number }
  | { verdict: 'unresolved'; failures: Failure[]; refused: Failure[]; scans: number }
  | { verdict: 'unknown'; reason: string }

export type Options = {
  /** How many runs the checker gets in all, the first one included. */
  scans: number
  /** The wait before each run after the first, in milliseconds. */
  waits_ms: readonly number[]
  sleep: (ms: number) => Promise<void>
}

/** The HTTP statuses this check names, each defined once. */
export const HTTP_STATUS = {
  /** The site refused the request: for a link checker, most often a bot rule. */
  forbidden: 403,
  /** The site gave up waiting for the request. */
  request_timeout: 408,
  /** The site asks the checker to slow down. */
  too_many_requests: 429,
  /** The first and last of the server errors. */
  first_server_error: 500,
  last_server_error: 599,
} as const

/** A status a host is telling us to come back for, rather than a missing link. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([HTTP_STATUS.request_timeout, HTTP_STATUS.too_many_requests])

/** A status by which a site refuses the checker rather than says the page is gone (martha#714). */
const REFUSING_STATUSES: ReadonlySet<number> = new Set([HTTP_STATUS.forbidden, HTTP_STATUS.too_many_requests])

const serverError = (code: number): boolean => code >= HTTP_STATUS.first_server_error && code <= HTTP_STATUS.last_server_error

/** A link a site refused the checker for: reported, never failing the check. */
export const refused = (failure: Failure): boolean => failure.code !== undefined && REFUSING_STATUSES.has(failure.code)

export const retryable = (failure: Failure): boolean =>
  failure.timeout || refused(failure) || (failure.code !== undefined && (RETRYABLE_STATUSES.has(failure.code) || serverError(failure.code)))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOf = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)

const countOf = (value: unknown): number => (typeof value === 'number' ? value : 0)

const failureOf = (file: string, entry: unknown, timeout: boolean): Failure | undefined => {
  if (!isRecord(entry) || typeof entry.url !== 'string') return undefined
  const status = isRecord(entry.status) ? entry.status : {}
  const span = isRecord(entry.span) ? entry.span : {}
  return {
    file,
    url: entry.url,
    line: countOf(span.line),
    column: countOf(span.column),
    status: textOf(status.text, 'no status recorded'),
    code: typeof status.code === 'number' ? status.code : undefined,
    timeout,
  }
}

const failuresUnder = (map: unknown, timeout: boolean): Failure[] => {
  if (!isRecord(map)) return []
  return Object.entries(map).flatMap(([file, entries]) =>
    (Array.isArray(entries) ? entries : []).flatMap((entry) => failureOf(file, entry, timeout) ?? []),
  )
}

/**
 * Every failure a lychee report names, or `undefined` when the text is not a
 * report this check can read. An unreadable report is never an empty one: a
 * check must not pass because it could not look.
 */
export const failuresIn = (report: string): Failure[] | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(report)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  if (!('error_map' in parsed) && !('timeout_map' in parsed)) return undefined
  return [...failuresUnder(parsed.error_map, false), ...failuresUnder(parsed.timeout_map, true)]
}

/** The links a scan named that a host cannot recover from. */
export const stuckAmong = (failures: readonly Failure[]): Failure[] => failures.filter((failure) => !retryable(failure))

/** What the last scan named, split into what fails the check and what a site refused. */
const verdictOf = (named: readonly Failure[], scans: number): Verdict => {
  const failures = named.filter((failure) => !refused(failure))
  const refusedLinks = named.filter(refused)
  if (failures.length === 0) return { verdict: 'resolved', failures: [], refused: refusedLinks, scans }
  return { verdict: 'unresolved', failures, refused: refusedLinks, scans }
}

/**
 * Run the checker until every link resolves, a failure that cannot recover
 * appears, or the scans are spent. A run that named only "not now" failures is
 * asked again after the given wait.
 */
export const checkEveryLinkResolves = async (scan: () => Promise<Scan>, options: Options): Promise<Verdict> => {
  let named: Failure[] = []
  let attempt = 0
  while (attempt < options.scans) {
    attempt += 1
    const { exitCode, report } = await scan()
    if (exitCode === 0) return { verdict: 'resolved', failures: [], refused: [], scans: attempt }
    const failures = failuresIn(report)
    if (failures === undefined) return { verdict: 'unknown', reason: 'the checker left no report this check could read' }
    if (failures.length === 0) return { verdict: 'unknown', reason: `the checker exited ${exitCode} and named no link` }
    named = failures
    if (stuckAmong(failures).length > 0) break
    if (attempt < options.scans) await options.sleep(options.waits_ms[attempt - 1] ?? 0)
  }
  return verdictOf(named, attempt)
}
