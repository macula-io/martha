// Run the check: node src/check_every_recorded_host_test_is_run/main.ts [--repository <path>]
//
// Every test case that skips on RECORDED_HOST_SKIP is one ci.yml's relay job runs, and is counted there (martha#385):
// the list prove_the_relay_loads.sh runs names its file, with exactly as many cases as the file carries markers.
//
// Exit 0 every marked case is listed and counted, 1 a finding, each printed by name, 2 the check could not be made. It
// never passes because it could not look.

import { describe, judgeTheRuns } from './check_every_recorded_host_test_is_run.ts'
import { readTheRuns, readTheTestFiles } from './read_the_runs_and_the_tests.ts'

const NAME = 'check_every_recorded_host_test_is_run'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

function main(): number {
  const repository = option('--repository') ?? '.'
  const runs = readTheRuns(repository)
  const findings = judgeTheRuns(runs, readTheTestFiles(repository))
  for (const finding of findings) console.error(describe(finding))
  if (findings.length > 0) {
    console.error(`${NAME}: ${findings.length} finding(s)`)
    return 1
  }
  console.log(`${NAME}: ${runs.length} run(s) list every recorded-host case, each counted`)
  return 0
}

try {
  process.exitCode = main()
} catch (failure: unknown) {
  console.error(`${NAME}: the check could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exitCode = 2
}
