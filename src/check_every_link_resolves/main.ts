// Run the links check: node src/check_every_link_resolves/main.ts ['**/*.md' ...]
//
// Environment: LYCHEE_OPTIONS (the options the workflow pins, split on spaces), MARTHA_LYCHEE (the binary; `lychee`
// from PATH by default).
//
// Exit 0 every link resolves; 1 a link is broken (one line each, file:line:column url | status); 2 the check could
// not be made. It never passes because it could not look.

import { checkEveryLinkResolves, type Failure, type Verdict } from './check_every_link_resolves.ts'
import { runLychee, type Checker } from './run_lychee.ts'

const DEFAULT_INPUTS = ['**/*.md']

const wordsOf = (value: string | undefined): string[] => (value ?? '').split(/\s+/).filter((word) => word !== '')

const checkerFrom = (inputs: readonly string[]): Checker => ({
  command: process.env['MARTHA_LYCHEE'] ?? 'lychee',
  options: wordsOf(process.env['LYCHEE_OPTIONS']),
  inputs: inputs.length === 0 ? DEFAULT_INPUTS : inputs,
})

/** Where a link sits and what was said of it: file:line:column url | status. */
const placeOf = (failure: Failure): string => `${failure.file}:${failure.line}:${failure.column} ${failure.url} | ${failure.status}`

const announce = (verdict: Verdict): number => {
  if (verdict.verdict === 'resolved') {
    console.log('check_every_link_resolves: every link resolves')
    return 0
  }
  if (verdict.verdict === 'unknown') {
    console.error(`check_every_link_resolves: the check could not be made: ${verdict.reason}`)
    return 2
  }
  for (const failure of verdict.failures) console.error(placeOf(failure))
  console.error(`check_every_link_resolves: ${verdict.failures.length} link(s) unresolved`)
  return 1
}

const main = async (): Promise<number> => announce(await checkEveryLinkResolves(async () => runLychee(checkerFrom(process.argv.slice(2)))))

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`check_every_link_resolves: the check could not be made: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  },
)
