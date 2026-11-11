// Run the dropped-test check (martha#274), over a repository and a range:
//
//   node src/check_no_test_the_base_passed_goes_missing/main.ts --base <sha> --head <sha> [--repository <path>]
//
// It compares the merge base of the two commits with the head, file by file: every test title the base's copy of
// a `*.node-test.ts` (or whatever else a test script names) declares must still be at the head's copy. A title
// may be dropped only by a commit in `<merge base>..<head>` that carries the drop trailer, which is named in
// check_no_test_the_base_passed_goes_missing.ts and nowhere else.
//
// Exit 0 every title kept, 1 titles missing or claims that excuse nothing, 2 the check could not be made. It
// never passes because it could not look.

import { scan } from './read_the_repository.ts'
import type { Comparison } from './check_no_test_the_base_passed_goes_missing.ts'

const NAME = 'check_no_test_the_base_passed_goes_missing'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const report = (comparison: Comparison): number => {
  for (const test of comparison.missing) {
    console.error(`${test.file}: the test the base passed is not at the tip: '${test.title}'`)
  }
  for (const claim of comparison.staleClaims) {
    const named = claim.title === undefined ? '' : `: '${claim.title}'`
    console.error(`${claim.file}: the commit drops a test that is still there${named}`)
  }
  console.error(
    `${NAME}: ${comparison.missing.length} test(s) the base passed are not at the tip, ` +
      `${comparison.staleClaims.length} claim(s) that excuse nothing`,
  )
  return 1
}

const main = (): number => {
  const base = option('--base')
  const head = option('--head')
  const repository = option('--repository') ?? '.'
  if (base === undefined || head === undefined) {
    console.error(`${NAME}: --base <sha> and --head <sha> are required`)
    return 2
  }
  const result = scan(repository, base, head)
  if (result.verdict === 'unreadable') {
    console.error(`${NAME}: the check could not be made: ${result.reason}`)
    return 2
  }
  for (const folder of result.skipped) {
    console.error(`${NAME}: ${folder}/package.json is not at the merge base, so that package's tests are not read`)
  }
  if (result.comparison.missing.length > 0 || result.comparison.staleClaims.length > 0) return report(result.comparison)
  console.log(`${NAME}: ${result.comparison.comparedFiles} test file(s) compared, every title the base passed is at the tip`)
  return 0
}

process.exitCode = main()
