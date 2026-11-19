// Every link to a file or a heading of this repository resolves (martha#231; links to other sites are not
// checked, DECIDED 2026-11-19 "Links: internal only").
//
// lychee runs with --offline, so no request leaves the machine and nothing can be slow or refuse the checker: a
// failure is a file or a heading that is not there, and it fails the check at once and by name. One scan decides.
// A report this check cannot read, or a failed run that names no link, is never a pass: a check must not pass
// because it could not look.

export type Failure = {
  file: string
  url: string
  line: number
  column: number
  status: string
}

/** One run of the checker: what it exited with, and the report it left. */
export type Scan = { exitCode: number; report: string }

export type Verdict =
  | { verdict: 'resolved' }
  | { verdict: 'unresolved'; failures: Failure[] }
  | { verdict: 'unknown'; reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const textOf = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)

const countOf = (value: unknown): number => (typeof value === 'number' ? value : 0)

const failureOf = (file: string, entry: unknown): Failure | undefined => {
  if (!isRecord(entry) || typeof entry.url !== 'string') return undefined
  const status = isRecord(entry.status) ? entry.status : {}
  const span = isRecord(entry.span) ? entry.span : {}
  return { file, url: entry.url, line: countOf(span.line), column: countOf(span.column), status: textOf(status.text, 'no status recorded') }
}

const failuresUnder = (map: unknown): Failure[] => {
  if (!isRecord(map)) return []
  return Object.entries(map).flatMap(([file, entries]) => (Array.isArray(entries) ? entries : []).flatMap((entry) => failureOf(file, entry) ?? []))
}

/**
 * Every failure a lychee report names, or `undefined` when the text is not a report this check can read. An
 * unreadable report is never an empty one.
 */
export const failuresIn = (report: string): Failure[] | undefined => {
  let parsed: unknown
  try {
    parsed = JSON.parse(report)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || !('error_map' in parsed)) return undefined
  return failuresUnder(parsed.error_map)
}

/** Runs the checker once: every link resolves, the links it names fail, or the check could not be made. */
export const checkEveryLinkResolves = async (scan: () => Promise<Scan>): Promise<Verdict> => {
  const { exitCode, report } = await scan()
  if (exitCode === 0) return { verdict: 'resolved' }
  const failures = failuresIn(report)
  if (failures === undefined) return { verdict: 'unknown', reason: 'the checker left no report this check could read' }
  if (failures.length === 0) return { verdict: 'unknown', reason: `the checker exited ${exitCode} and named no link` }
  return { verdict: 'unresolved', failures }
}
