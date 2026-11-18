// One place asks GitHub (martha#320, package B).
//
// This exists so the crew's GitHub allowance is spent by one buyer. The budget slice counts every call, waits between
// two of them when GitHub is being leaned on, and keeps the answer it got, and none of that holds if a second slice
// polls on its own: the crew's own history has a 20 second poll that cost the whole crew 18 minutes of refusals, and a
// read nobody counted cannot be backed off.
//
// The rule is narrow on purpose. It names a POLL — `gh run list` and `gh run watch`, written as an argv array or as a
// shell string — outside src/spend_the_github_budget, and nothing else: a one-shot `gh api` read, such as the range
// check's runs and jobs or the owner's list's two checks, is a read, not a poll, and rerouting those is a change to
// their own slices. It reads every script file under src/ that is not a test, so a poll moved into a helper is still
// named where it stands.

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { isTestFile } from './declared_in_package_json.ts'

/** The one directory a GitHub read of package B is made from: the slice that spends the crew's budget. */
export const THE_ONE_PLACE = 'spend_the_github_budget'

/** One place that polls GitHub, and the words it polls with. */
export interface APoll {
  readonly path: string
  readonly line: number
  readonly what: string
}

/** A poll written as the argv of a process call: `'run', 'list'` / `"run", "watch"`. */
const IN_AN_ARGV = /['"]run['"]\s*,\s*['"](list|watch)['"]/

/** A poll written as a shell line: `gh run list`, `gh run watch`. */
const IN_A_SHELL_LINE = /\bgh\s+run\s+(list|watch)\b/

/** Whether a line polls GitHub, and with which verb. */
function thePollOn(line: string): string | undefined {
  const argv = IN_AN_ARGV.exec(line)
  if (argv !== null) return argv[1]
  const shell = IN_A_SHELL_LINE.exec(line)
  return shell === null ? undefined : shell[1]
}

/** What a scan is told: which files the test script runs, and which directory the one place is. */
export interface TheScan {
  /** The suffixes the test script runs, read from package.json so a new one is never missed here. */
  readonly test_suffixes: readonly string[]
  /** The one directory a poll may stand in. */
  readonly one_place?: string
}

/**
 * Every place outside the budget that polls GitHub, by file and line. A test file is skipped: naming a poll in a
 * planted case is how this rule is proved, not a read anyone makes.
 */
export function thePollsIn(sources: readonly CoreSource[], scan: TheScan): readonly APoll[] {
  const one_place = scan.one_place ?? THE_ONE_PLACE
  return sources
    .filter((source) => !isTestFile(scan.test_suffixes, source.path) && !source.path.startsWith(`${one_place}/`))
    .flatMap((source) =>
      source.text.split('\n').flatMap((line, index) => {
        const verb = thePollOn(line)
        return verb === undefined ? [] : [{ path: source.path, line: index + 1, what: `gh run ${verb}` }]
      }),
    )
}

/** What one poll is told: where it stands, and that the crew's budget is the one place that may ask. */
export const thePollTold = (poll: APoll): string =>
  `${poll.path}:${String(poll.line)}: \`${poll.what}\` polls GitHub outside ${THE_ONE_PLACE}, so the crew's allowance is spent by a buyer nobody counts. Spend it through the budget slice, or ask for the read there.`
