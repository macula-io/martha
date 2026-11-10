// Run the links check: node src/check_every_link_resolves/main.ts ['**/*.md' ...]
//
// Environment: LYCHEE_OPTIONS (the options the workflow pins, split on spaces),
// MARTHA_LYCHEE (the binary; `lychee` from PATH by default), MARTHA_LINK_SCANS
// (3) and MARTHA_LINK_WAIT_MS (5000: the wait before the second scan, doubled
// before each scan after it).
//
// Exit 0 every link resolves, 1 a link is broken or a slow host never answered
// (one line each, file:line:column url | status), 2 the check could not be made.
// It never passes because it could not look.

import { checkEveryLinkResolves, type Verdict } from './check_every_link_resolves.ts'
import { runLychee, type Checker } from './run_lychee.ts'

const DEFAULT_INPUTS = ['**/*.md']
const DEFAULT_SCANS = 3
const DEFAULT_WAIT_MS = 5_000

const wordsOf = (value: string | undefined): string[] => (value ?? '').split(/\s+/).filter((word) => word !== '')

const numberFrom = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

const checkerFrom = (inputs: readonly string[]): Checker => ({
  command: process.env['MARTHA_LYCHEE'] ?? 'lychee',
  options: wordsOf(process.env['LYCHEE_OPTIONS']),
  inputs: inputs.length === 0 ? DEFAULT_INPUTS : inputs,
})

/** The wait before scan `index` (1-based): the base, doubled each time. */
const waitsFor = (scans: number, baseMs: number): number[] =>
  Array.from({ length: scans }, (_step, index) => baseMs * 2 ** index)

const announce = (verdict: Verdict): number => {
  if (verdict.verdict === 'resolved') {
    console.log(`check_every_link_resolves: every link resolves (${verdict.scans} scan(s))`)
    return 0
  }
  if (verdict.verdict === 'unknown') {
    console.error(`check_every_link_resolves: the check could not be made: ${verdict.reason}`)
    return 2
  }
  for (const failure of verdict.failures) {
    console.error(`${failure.file}:${failure.line}:${failure.column} ${failure.url} | ${failure.status}`)
  }
  console.error(`check_every_link_resolves: ${verdict.failures.length} link(s) unresolved after ${verdict.scans} scan(s)`)
  return 1
}

const main = async (): Promise<number> => {
  const scans = numberFrom(process.env['MARTHA_LINK_SCANS'], DEFAULT_SCANS)
  const baseMs = numberFrom(process.env['MARTHA_LINK_WAIT_MS'], DEFAULT_WAIT_MS)
  const checker = checkerFrom(process.argv.slice(2))
  const verdict = await checkEveryLinkResolves(async () => runLychee(checker), {
    scans,
    waits_ms: waitsFor(scans, baseMs),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  })
  return announce(verdict)
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`check_every_link_resolves: the check could not be made: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  },
)
