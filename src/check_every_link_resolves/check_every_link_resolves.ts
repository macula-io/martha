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

export type Verdict =
  | { verdict: 'resolved'; failures: []; scans: number }
  | { verdict: 'unresolved'; failures: Failure[]; scans: number }
  | { verdict: 'unknown'; reason: string }

export type Options = {
  /** How many runs the checker gets in all, the first one included. */
  scans: number
  /** The wait before each run after the first, in milliseconds. */
  waits_ms: readonly number[]
  sleep: (ms: number) => Promise<void>
}

/** A status a host is telling us to come back for, rather than a missing link. */
const RETRYABLE_STATUSES = new Set([408, 429])

export const retryable = (failure: Failure): boolean =>
  failure.timeout || (failure.code !== undefined && (RETRYABLE_STATUSES.has(failure.code) || (failure.code >= 500 && failure.code <= 599)))

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
    if (exitCode === 0) return { verdict: 'resolved', failures: [], scans: attempt }
    const failures = failuresIn(report)
    if (failures === undefined) return { verdict: 'unknown', reason: 'the checker left no report this check could read' }
    if (failures.length === 0) return { verdict: 'unknown', reason: `the checker exited ${exitCode} and named no link` }
    named = failures
    if (stuckAmong(failures).length > 0) break
    if (attempt < options.scans) await options.sleep(options.waits_ms[attempt - 1] ?? 0)
  }
  return { verdict: 'unresolved', failures: named, scans: attempt }
}
