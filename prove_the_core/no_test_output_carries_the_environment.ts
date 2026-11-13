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
// summary (RUN_SUMMARY_LABELS, in order), followed by nothing but blank lines; a
// command that exited non-zero may instead end with the failing tests node lists
// right after the summary (it lists them only on a failed run). A command that
// cannot start fails the run by name too. The summary must be the END, not merely
// present: a test's own console.log reaches the run's stdout as it is, so a
// summary-shaped line can appear anywhere before it.
//
// The command writes into files, never into pipes (martha#325). A pipe from
// spawn is a socket, written asynchronously: with --test-force-exit, node --test
// ends through process.exit with what it still had queued for a reader that fell
// behind (a CI log does), and that tail, the summary with it, is lost while the
// run ends 0. node --test loads no --import into itself, only into each file's
// process, so it cannot be held the way fail_a_test_file_that_leaves_something_running.ts
// holds a file's. A file is written synchronously: nothing is queued at the exit.
// The runner reads each file as it grows, so the output still passes through as
// it comes, and removes them when the run ends.

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { StringDecoder } from 'node:string_decoder'
import { setTimeout as after } from 'node:timers/promises'
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
 * Follows a stream that arrives in chunks and says, given the command's exit
 * code, whether it ended with the summary: the last RUN_SUMMARY_LABELS.length
 * lines that are not blank are the summary in order. node --test lists failing
 * tests after the summary only when the run failed, so only a command that
 * exited non-zero may end with that list instead, and only when its heading
 * came right after the summary (a test can print the heading too).
 */
export function runEndCounter(): {
  readonly scan: (chunk: string) => void
  readonly endsWithTheSummary: (code: number | null) => boolean
} {
  let partial = ''
  let lastLines: string[] = []
  let failuresFollowedTheSummary = false
  const take = (raw: string) => {
    const line = stripVTControlCharacters(raw).trim()
    if (line === '') return
    if (line === FAILING_TESTS_HEADING && isTheSummary(lastLines)) failuresFollowedTheSummary = true
    lastLines = [...lastLines, line].slice(-RUN_SUMMARY_LABELS.length)
  }
  return {
    scan: (chunk) => {
      const lines = (partial + chunk).split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines) take(line)
    },
    endsWithTheSummary: (code) => {
      take(partial)
      partial = ''
      return isTheSummary(lastLines) || (code !== 0 && failuresFollowedTheSummary)
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

/** What the run says when the command could not be started at all. */
export function cannotStartReportOf(program: string, reason: string): string {
  return (
    `a run ends with its summary (martha#325): the command could not start (${program}: ${reason}), so no test ran. ` +
    'Check that the program the test script names is installed and on PATH.'
  )
}

/** How long the runner waits before it reads a file the command writes into again, once it has read to its end. */
const READ_AGAIN_MS = 50
/** How much of a file the runner reads at once. */
const READ_BYTES = 64 * 1024

type Ended = { readonly code: number | null; readonly signal: NodeJS.Signals | null; readonly cannotStart?: string }

/**
 * Hands `take` what is written into the file at `path`, decoded as it comes (a
 * character split across two reads arrives whole), until `ended` says the
 * writer is done and the file is read to its end.
 */
async function readAsItGrows(path: string, take: (text: string) => void, ended: () => boolean): Promise<void> {
  const file = await open(path, 'r')
  const decoder = new StringDecoder('utf8')
  const buffer = Buffer.alloc(READ_BYTES)
  // Whether the writer had ended is asked BEFORE each read: a read that then
  // finds nothing has seen everything it wrote.
  const readOnce = async (): Promise<boolean> => {
    const done = ended()
    const { bytesRead } = await file.read(buffer, 0, READ_BYTES, null)
    if (bytesRead > 0) take(decoder.write(buffer.subarray(0, bytesRead)))
    else if (!done) await after(READ_AGAIN_MS)
    return bytesRead === 0 && done
  }
  try {
    while (!(await readOnce()));
    take(decoder.end())
  } finally {
    await file.close()
  }
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
  const counters = { stdout: plantedValueCounter(value), stderr: plantedValueCounter(value) }
  const runEnd = runEndCounter()
  const passThrough = (stream: StreamName) => (text: string) => {
    counters[stream].scan(text)
    if (stream === 'stdout') runEnd.scan(text)
    process[stream].write(text)
  }
  const ended = await runIntoFiles(program, args, { ...env, [PLANTED_VARIABLE]: value }, passThrough)
  if (ended.cannotStart !== undefined) {
    process.stderr.write(`\n${cannotStartReportOf(program, ended.cannotStart)}\n`)
    return 1
  }
  const complete = runEnd.endsWithTheSummary(ended.code)
  if (!complete) process.stderr.write(`\n${cutRunReportOf(ended)}\n`)
  const counts = { stdout: counters.stdout.count(), stderr: counters.stderr.count() }
  const own = ended.code ?? 1
  if (counts.stdout + counts.stderr === 0) return complete || own !== 0 ? own : 1
  process.stderr.write(`\n${environmentLeakReportOf(counts)}\n`)
  return 1
}

/**
 * Runs `program` with its stdout and stderr in two files of a folder of its own,
 * hands what it writes to `passThrough` as it comes, forwards SIGINT and SIGTERM,
 * and resolves to how it ended once both files are read; the folder is removed.
 */
async function runIntoFiles(
  program: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  passThrough: (stream: StreamName) => (text: string) => void,
): Promise<Ended> {
  const folder = mkdtempSync(join(tmpdir(), 'martha-test-run-'))
  try {
    const paths = { stdout: join(folder, 'stdout'), stderr: join(folder, 'stderr') }
    const fds = { stdout: openSync(paths.stdout, 'w', 0o600), stderr: openSync(paths.stderr, 'w', 0o600) }
    const child = spawn(program, args, { env, stdio: ['inherit', fds.stdout, fds.stderr] })
    closeSync(fds.stdout)
    closeSync(fds.stderr)
    const forward = (signal: NodeJS.Signals) => () => void child.kill(signal)
    process.on('SIGINT', forward('SIGINT'))
    process.on('SIGTERM', forward('SIGTERM'))
    // A command that cannot start emits 'error' and never 'exit'; the first of
    // the two to come is how the command ended, and it lets the readers stop.
    let ended: Ended | undefined
    const exited = new Promise<Ended>((resolve) => {
      const end = (how: Ended) => {
        ended ??= how
        resolve(ended)
      }
      child.once('exit', (code, signal) => end({ code, signal }))
      child.on('error', (error) => end({ code: null, signal: null, cannotStart: error.message }))
    })
    const isEnded = () => ended !== undefined
    await Promise.all([
      readAsItGrows(paths.stdout, passThrough('stdout'), isEnded),
      readAsItGrows(paths.stderr, passThrough('stderr'), isEnded),
    ])
    return await exited
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

if (import.meta.main) process.exitCode = await runWithAPlantedSecret(process.argv.slice(2), process.env)
