// No test output carries the environment (martha#92).
//
// This exists so a person who runs the suite with secrets in their environment
// never finds them in their terminal, a pasted log or a CI log.
//
// npm test runs node --test through this module. It plants a secret-looking
// value, fresh each run, under PLANTED_VARIABLE in the environment every test
// file and every child they start inherits, passes the run's output through as
// it comes, and fails the run when the planted value appears anywhere in it. A
// test that prints its process's environment, or lets a child that does print
// into the run (execFileSync copies a child's stderr to its own), prints the
// planted value with the rest, and the run fails naming this check.
//
// The report names the stream and how often, never the line: the line is the
// environment.
//
// A run ends with its summary (martha#325). This exists so a run that was cut
// short never reads as a pass: one cut by a tool's time limit has been seen to
// end 0 with half the tests printed and no summary. The runner keeps the last
// lines of stdout and fails the run, by name, unless they are node --test's own
// summary (RUN_SUMMARY_LABELS, in order), followed by nothing but blank lines or
// the failing tests node lists after it. The summary must be the END, not merely
// present: a test's own console.log reaches the run's stdout as it is, so a
// summary-shaped line can appear anywhere before it.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { stripVTControlCharacters } from 'node:util'

/** The module npm test runs node --test through, as the test script names it. */
export const RUNNER = './prove_the_core/no_test_output_carries_the_environment.ts'
/** The variable the planted value is given under. */
export const PLANTED_VARIABLE = 'MARTHA_PLANTED_SECRET'
/** How many random bytes the planted value carries: never in any output by chance. */
const PLANTED_BYTES = 24

/** A fresh value shaped like a token: a person would not want it in a log. */
export const plantedValue = (): string => `martha_planted_${randomBytes(PLANTED_BYTES).toString('hex')}`

export type StreamName = 'stdout' | 'stderr'

/**
 * Counts `value` in a stream that arrives in chunks, a match split across two
 * chunks included: the scanner keeps the last value.length - 1 characters.
 */
export function plantedValueCounter(value: string): { readonly scan: (chunk: string) => void; readonly count: () => number } {
  let carried = ''
  let found = 0
  return {
    scan: (chunk) => {
      const text = carried + chunk
      for (let at = text.indexOf(value); at !== -1; at = text.indexOf(value, at + value.length)) found += 1
      const lastMatchEnd = text.lastIndexOf(value) === -1 ? 0 : text.lastIndexOf(value) + value.length
      carried = text.slice(Math.max(lastMatchEnd, text.length - (value.length - 1)))
    },
    count: () => found,
  }
}

/** What the run says when the planted value was printed: the streams and counts, never the line. */
export function environmentLeakReportOf(counts: Readonly<Record<StreamName, number>>): string {
  const where = (Object.entries(counts) as [StreamName, number][])
    .filter(([, n]) => n > 0)
    .map(([stream, n]) => `${n} time(s) on ${stream}`)
    .join(', ')
  return (
    `no test output carries the environment (martha#92): the value planted in ${PLANTED_VARIABLE} appeared ${where}. ` +
    'A test printed its environment, or let a child that prints one write into the run. ' +
    "Capture the child's output (stdio: 'pipe' and assert on it) and never put a whole environment in an assertion message."
  )
}

/** The mark node --test's reporter starts each summary line with (Node 26.10). */
export const RUN_SUMMARY_MARK = 'ℹ'
/** The lines node --test ends a complete run with, in order, each `<mark> <label> <number>`. */
export const RUN_SUMMARY_LABELS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'] as const
/** The line node --test starts the list of failing tests with, after the summary. */
export const FAILING_TESTS_HEADING = '✖ failing tests:'

const isSummaryLine = (line: string, label: string): boolean => {
  const [mark, named, count, ...rest] = line.split(' ')
  return mark === RUN_SUMMARY_MARK && named === label && rest.length === 0 && count !== undefined && /^\d+(\.\d+)?$/.test(count)
}

/** Whether `lines` are the summary, every label in order and nothing else. */
const isTheSummary = (lines: readonly string[]): boolean =>
  lines.length === RUN_SUMMARY_LABELS.length && RUN_SUMMARY_LABELS.every((label, i) => isSummaryLine(lines[i] ?? '', label))

/**
 * Follows a stream that arrives in chunks and says whether it ended with the
 * summary: the last RUN_SUMMARY_LABELS.length lines that are not blank, and not
 * part of the failing tests listed after the summary, are the summary in order.
 */
export function runEndCounter(): { readonly scan: (chunk: string) => void; readonly endsWithTheSummary: () => boolean } {
  let partial = ''
  let lastLines: string[] = []
  let listingFailures = false
  const take = (raw: string) => {
    const line = stripVTControlCharacters(raw).trim()
    if (line === '' || listingFailures) return
    if (isTheSummary(lastLines) && line === FAILING_TESTS_HEADING) listingFailures = true
    else lastLines = [...lastLines, line].slice(-RUN_SUMMARY_LABELS.length)
  }
  return {
    scan: (chunk) => {
      const lines = (partial + chunk).split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines) take(line)
    },
    endsWithTheSummary: () => {
      take(partial)
      partial = ''
      return listingFailures || isTheSummary(lastLines)
    },
  }
}

/** What the run says when the command's output did not end with the summary, and how the command ended. */
export function cutRunReportOf(ended: { readonly code: number | null; readonly signal: NodeJS.Signals | null }): string {
  const how = ended.signal === null ? `exited ${ended.code}` : `ended by ${ended.signal}`
  return (
    "a run ends with its summary (martha#325): the command's output did not end with node --test's summary " +
    `(${RUN_SUMMARY_LABELS.map((label) => `${RUN_SUMMARY_MARK} ${label}`).join(', ')}), so the run was cut short or never ran, ` +
    `and the command ${how}: its exit code says nothing about the tests that did not run. Run the suite again in the foreground and read its summary.`
  )
}

/**
 * Runs `command` with the planted value in its environment, its output passed
 * through as it comes, and resolves to the exit code the run should end with:
 * the command's own, or 1 when the planted value appeared in its output, or
 * when its stdout did not end with the summary and its own code was 0.
 */
export async function runWithAPlantedSecret(command: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [program, ...args] = command
  if (program === undefined) throw new Error(`${RUNNER} was given no command to run`)
  const value = plantedValue()
  const child = spawn(program, args, { env: { ...env, [PLANTED_VARIABLE]: value }, stdio: ['inherit', 'pipe', 'pipe'] })
  const counters = { stdout: plantedValueCounter(value), stderr: plantedValueCounter(value) }
  const runEnd = runEndCounter()
  // Decoded per stream, not per chunk: a character split across two chunks
  // reaches the output whole, and the reporter's marks stay readable.
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  const passThrough = (stream: StreamName) => (text: string) => {
    counters[stream].scan(text)
    process[stream].write(text)
  }
  child.stdout.on('data', passThrough('stdout'))
  child.stdout.on('data', runEnd.scan)
  child.stderr.on('data', passThrough('stderr'))
  const forward = (signal: NodeJS.Signals) => () => void child.kill(signal)
  process.on('SIGINT', forward('SIGINT'))
  process.on('SIGTERM', forward('SIGTERM'))
  const ended = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.on('close', (code, signal) => resolve({ code, signal })),
  )
  const complete = runEnd.endsWithTheSummary()
  if (!complete) process.stderr.write(`\n${cutRunReportOf(ended)}\n`)
  const counts = { stdout: counters.stdout.count(), stderr: counters.stderr.count() }
  const own = ended.code ?? 1
  if (counts.stdout + counts.stderr === 0) return complete || own !== 0 ? own : 1
  process.stderr.write(`\n${environmentLeakReportOf(counts)}\n`)
  return 1
}

if (import.meta.main) process.exitCode = await runWithAPlantedSecret(process.argv.slice(2), process.env)
