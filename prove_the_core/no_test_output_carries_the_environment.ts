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

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import process from 'node:process'

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

/**
 * Runs `command` with the planted value in its environment, its output passed
 * through as it comes, and resolves to the exit code the run should end with:
 * the command's own, or 1 when the planted value appeared in its output.
 */
export async function runWithAPlantedSecret(command: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [program, ...args] = command
  if (program === undefined) throw new Error(`${RUNNER} was given no command to run`)
  const value = plantedValue()
  const child = spawn(program, args, { env: { ...env, [PLANTED_VARIABLE]: value }, stdio: ['inherit', 'pipe', 'pipe'] })
  const counters = { stdout: plantedValueCounter(value), stderr: plantedValueCounter(value) }
  // Decoded per stream, not per chunk: a character split across two chunks
  // reaches the output whole, and the reporter's marks stay readable.
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  const passThrough = (stream: StreamName) => (text: string) => {
    counters[stream].scan(text)
    process[stream].write(text)
  }
  child.stdout.on('data', passThrough('stdout'))
  child.stderr.on('data', passThrough('stderr'))
  const forward = (signal: NodeJS.Signals) => () => void child.kill(signal)
  process.on('SIGINT', forward('SIGINT'))
  process.on('SIGTERM', forward('SIGTERM'))
  const ended = await new Promise<number>((resolve) => child.on('close', (code) => resolve(code ?? 1)))
  const counts = { stdout: counters.stdout.count(), stderr: counters.stderr.count() }
  if (counts.stdout + counts.stderr === 0) return ended
  process.stderr.write(`\n${environmentLeakReportOf(counts)}\n`)
  return 1
}

if (import.meta.main) process.exitCode = await runWithAPlantedSecret(process.argv.slice(2), process.env)
