// Every test case that drives the recorded host is one ci.yml's relay job runs, and is counted there (martha#385).
//
// Such a case skips wherever MARTHA_RECORDED_HOST is not set, which is everywhere but the relay job, so a green run
// says nothing about it unless the relay job ran it. The relay job runs what prove_the_relay_loads/
// recorded_host_runs.json lists, and holds each run to exactly its listed number of passes with none skipped. This
// holds that list to the tree: each file's listed cases must equal the cases in it that skip on RECORDED_HOST_SKIP,
// counted case by case, so a case a name pattern filters out of the run is a count that differs, by name. It reads the
// list and the test files, never the bash that runs them.

import { RECORDED_HOST_RUNS } from './recorded_host_skip.ts'

/** The marker a case that drives the recorded host carries, as a test file spells it. */
export const MARKER = 'RECORDED_HOST_SKIP'

/** The variable's own name, as the constant that holds it is spelled in a test file. */
const VARIABLE_CONSTANT = 'RECORDED_HOST_VARIABLE'

/** One run the relay job makes: a file, the pattern that narrows it if any, and how many cases must pass. */
export interface RecordedHostRun {
  readonly file: string
  readonly name_pattern?: string
  readonly cases: number
  readonly proves: string
}

/** A test file, by its path from the repository and its text. */
export interface TestFile {
  readonly path: string
  readonly text: string
}

export type Finding =
  | { readonly kind: 'unlisted'; readonly file: string; readonly markers: number }
  | { readonly kind: 'counted_otherwise'; readonly file: string; readonly listed: number; readonly markers: number }
  | { readonly kind: 'no_such_file'; readonly file: string }
  | { readonly kind: 'no_case'; readonly file: string }
  | { readonly kind: 'reads_the_variable'; readonly file: string }
  | { readonly kind: 'promises_a_job'; readonly file: string; readonly line: number }

const MARKED_CASE = new RegExp(String.raw`\bskip:\s*${MARKER}\b`, 'g')
const DIRECT_READ = new RegExp(String.raw`process\.env\s*\[\s*${VARIABLE_CONSTANT}\s*\]`)
const A_JOB_PROMISED = /\bskip:\s*[`'"][^`'"]*\bCI job\b/

/** How many cases in a test file skip on the marker. */
export const markersIn = (text: string): number => text.match(MARKED_CASE)?.length ?? 0

/** The 1-based lines whose skip text names a CI job in words of its own rather than through the marker. */
const linesPromisingAJob = (text: string): number[] =>
  text.split('\n').flatMap((line, at) => (A_JOB_PROMISED.test(line) ? [at + 1] : []))

/** What a file says on its own: a direct read of the variable, and a skip text that names a job. */
const findingsInAFile = ({ path, text }: TestFile): Finding[] => [
  ...(DIRECT_READ.test(text) ? [{ kind: 'reads_the_variable', file: path } as const] : []),
  ...linesPromisingAJob(text).map((line) => ({ kind: 'promises_a_job', file: path, line }) as const),
]

/** Each listed file with the cases its entries add up to. A file may be listed once per name pattern. */
const listedCases = (runs: readonly RecordedHostRun[]): Map<string, number> => {
  const listed = new Map<string, number>()
  for (const run of runs) listed.set(run.file, (listed.get(run.file) ?? 0) + run.cases)
  return listed
}

/** A listed file held to the tree: it is there, and its listed cases are its marked ones. */
const findingsForAListedFile = (file: string, listed: number, files: ReadonlyMap<string, string>): Finding[] => {
  const text = files.get(file)
  if (text === undefined) return [{ kind: 'no_such_file', file }]
  const markers = markersIn(text)
  return markers === listed ? [] : [{ kind: 'counted_otherwise', file, listed, markers }]
}

/** The findings over the list and the test files; none means every marked case is run and counted. */
export function judgeTheRuns(runs: readonly RecordedHostRun[], testFiles: readonly TestFile[]): Finding[] {
  const files = new Map(testFiles.map(({ path, text }) => [path, text]))
  const listed = listedCases(runs)
  const noCase = runs.filter((run) => !Number.isInteger(run.cases) || run.cases < 1).map(({ file }) => ({ kind: 'no_case', file }) as const)
  const unlisted = testFiles
    .filter(({ path, text }) => !listed.has(path) && markersIn(text) > 0)
    .map(({ path, text }) => ({ kind: 'unlisted', file: path, markers: markersIn(text) }) as const)
  const counted = [...listed].flatMap(([file, cases]) => findingsForAListedFile(file, cases, files))
  return [...noCase, ...unlisted, ...counted, ...testFiles.flatMap(findingsInAFile)]
}

/** A finding in the words a red run prints. */
export function describe(finding: Finding): string {
  switch (finding.kind) {
    case 'unlisted':
      return `${finding.file}: ${finding.markers} case(s) skip on ${MARKER} and ${RECORDED_HOST_RUNS} does not list the file, so the relay job never runs them`
    case 'counted_otherwise':
      return `${finding.file}: ${finding.markers} case(s) skip on ${MARKER}, and ${RECORDED_HOST_RUNS} counts ${finding.listed}; a case the relay run does not count is never run`
    case 'no_such_file':
      return `${finding.file}: listed in ${RECORDED_HOST_RUNS}, and there is no such test file`
    case 'no_case':
      return `${finding.file}: listed in ${RECORDED_HOST_RUNS} with no case to run; an entry runs at least one`
    case 'reads_the_variable':
      return `${finding.file}: reads process.env[${VARIABLE_CONSTANT}] itself; a case skips on ${MARKER} and reads the binary through recordedHost(), so the check can count it`
    case 'promises_a_job':
      return `${finding.file}:${finding.line}: a skip text names a CI job in words of its own; only ${MARKER} may say where a case runs, because only it is checked`
  }
}
