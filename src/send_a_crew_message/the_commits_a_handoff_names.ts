// The commits a HANDOFF names exist, and its tip descends from its base (martha#980 package 3, a port of crew-code's
// core/handoff_commits.ts; threat model: martha#980 issuecomment-7049349078).
//
// This exists so a reviewer is not handed a range nobody can read: a sha typed from memory has a range's shape too.
// Before the message goes, each end of a HANDOFF line's range is asked of the crew's own clone of the package's
// repository, `<clones>/<org>/<repo>`: `git cat-file -e <sha>^{commit}`, after one `git fetch -q origin` when the
// clone lacks it, then `git merge-base --is-ancestor <base> <tip>`.
//
// What it comes to is a line, never a refusal (the Supervisor's ruling 4 under the owner's DECIDED 2026-11-20 "Yes,
// list then cut (Recommended)"): a sha that is no commit or a tip off its base is a notice saying exactly that, and
// what could not be checked is `range not verified (<why>): <base>..<tip>`, as crew-code marks it. Every word of a line
// is built here from fixed phrases, a sha and a repository the line's own shape already read; nothing git says is
// carried (T7).
//
// Every git run is bounded (T5): a local read LOCAL_MS, the fetch FETCH_MS, killed with its group on the bound. Each
// carries Martha's own git settings (T3), and GIT_CEILING_DIRECTORIES at the clone's own organisation folder, so a
// clone folder with no `.git` is no clone rather than the repository above it (T2b, the Supervisor's ruling 6). A crew
// with no clones root, or one that is not absolute, runs nothing (T2c).

import { isAbsolute, join } from 'node:path'

import type { ProcessOutcome, Processes } from '../host_contract/host_contract.ts'
import { SECOND_MS } from '../declare_crew/the_crews_thresholds.ts'
import { WORK_PACKAGE } from '../log_ledger/log_ledger.ts'
import type { CrewLineRead } from '../read_a_crew_line/read_a_crew_line.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** How long a local read of the clone may take, as crew-code bounds it. */
export const LOCAL_MS = 5 * SECOND_MS

/** How long the one fetch from origin may take, as crew-code bounds it. */
export const FETCH_MS = 20 * SECOND_MS

/** The variable that stops git's search for a repository above the folder it names (T2b). */
export const GIT_CEILING = 'GIT_CEILING_DIRECTORIES'

/** What the check reads with: the host's processes, and the folder the crew's clones sit in (null when none is declared). */
export interface TheCommitsAsked {
  readonly processes: Pick<Processes, 'run'>
  readonly clones: string | null
}

/** Why a range could not be checked: the words of a mark, each a fixed phrase. */
const NO_WORKSPACE = 'the crew declares no workspace'
const NO_CLONE = 'no clone'
const DID_NOT_ANSWER = `${GIT} did not answer`
const COULD_NOT_RUN = `${GIT} could not run`

/** The mark a range nobody could check carries. */
const notVerified = (why: string, base: string, tip: string): string => `range not verified (${why}): ${base}..${tip}`

/** Why a git run gave no yes or no: late, absent, or an exit that is neither. */
const whyOf = (outcome: ProcessOutcome, step: string): string => {
  if (outcome.timed_out === true) return DID_NOT_ANSWER
  return outcome.exit_code === null ? COULD_NOT_RUN : `${GIT} ${step} exited ${String(outcome.exit_code)}`
}

/** Whether git said yes or no: it ran, and ended within its bound. */
const answered = (outcome: ProcessOutcome): boolean => outcome.timed_out !== true && outcome.exit_code !== null

/** A HANDOFF line's range, and the repository its package names; undefined for any other line, or one on a design. */
interface TheRange {
  readonly package_name: string
  readonly repo: string
  readonly org: string
  readonly name: string
  readonly base: string
  readonly tip: string
}

function theRangeOf(line: CrewLineRead): TheRange | undefined {
  if (line.verb !== 'HANDOFF' || !WORK_PACKAGE.test(line.package)) return undefined
  const [base, tip] = line.words[1]?.split('..') ?? []
  if (base === undefined || tip === undefined) return undefined
  const repo = line.package.slice(0, line.package.indexOf('#'))
  const [org = '', name = ''] = repo.split('/')
  return { package_name: line.package, repo, org, name, base, tip }
}

/** The lines a HANDOFF line's range comes to: a notice for what failed, a mark for what could not be checked. */
export async function theCommitsAHandoffNames(asked: TheCommitsAsked, line: CrewLineRead): Promise<readonly string[]> {
  const range = theRangeOf(line)
  if (range === undefined) return []
  if (asked.clones === null || !isAbsolute(asked.clones)) return [notVerified(NO_WORKSPACE, range.base, range.tip)]
  return theRangeIn(gitOver(asked.processes, asked.clones, range), range)
}

/** One git run in the clone, at a bound. */
type Git = (bound: number, args: readonly string[]) => Promise<ProcessOutcome>

/**
 * git run on the clone, from the clones root with `-C <clone>`, so a clone that is not there is git's own no rather than
 * a process that could not start. Bounded, with Martha's own settings, and the ceiling at the clone's organisation
 * folder. A process the host could not start is git that could not run.
 */
const gitOver = (processes: Pick<Processes, 'run'>, clones: string, range: TheRange): Git => async (bound, args) =>
  processes
    .run({
      command: GIT,
      args: marthasOwnGitArgs(['-C', join(clones, range.org, range.name), ...args]),
      cwd: clones,
      environment: { drop_prefixes: [], set: { [GIT_CEILING]: join(clones, range.org) } },
      timeout_ms: bound,
    })
    .catch((): ProcessOutcome => ({ exit_code: null, stdout: '', stderr: '' }))

async function theRangeIn(git: Git, range: TheRange): Promise<readonly string[]> {
  const isClone = await git(LOCAL_MS, ['rev-parse', '--git-dir'])
  if (!answered(isClone)) return [notVerified(whyOf(isClone, 'rev-parse'), range.base, range.tip)]
  if (isClone.exit_code !== 0) return [notVerified(NO_CLONE, range.base, range.tip)]
  const held = await theCommitsHeld(git, range)
  return held ?? theDescent(git, range)
}

/** What the range's two ends come to when one is not a commit, after one fetch; undefined when both are commits. */
async function theCommitsHeld(git: Git, range: TheRange): Promise<readonly string[] | undefined> {
  const lacking = await theShasLacking(git, [range.base, range.tip])
  if (typeof lacking === 'string') return [notVerified(lacking, range.base, range.tip)]
  if (lacking.length === 0) return undefined
  const fetched = await git(FETCH_MS, ['fetch', '-q', 'origin'])
  const still = await theShasLacking(git, lacking)
  if (typeof still === 'string') return [notVerified(still, range.base, range.tip)]
  if (still.length === 0) return undefined
  const after = fetched.exit_code === 0 ? 'after a fetch' : 'and the fetch from origin failed or did not finish'
  return still.map((sha) => `HANDOFF ${range.package_name} names ${sha}, which is not a commit in ${range.repo} (${after}).`)
}

/** Whether the tip descends from the base: nothing when it does, a notice when git says no, a mark otherwise. */
async function theDescent(git: Git, range: TheRange): Promise<readonly string[]> {
  const descends = await git(LOCAL_MS, ['merge-base', '--is-ancestor', range.base, range.tip])
  if (descends.exit_code === 0 && answered(descends)) return []
  if (descends.exit_code === 1 && answered(descends)) {
    return [`HANDOFF ${range.package_name} names the range ${range.base}..${range.tip}, but ${range.tip} does not descend from ${range.base} in ${range.repo}.`]
  }
  return [notVerified(whyOf(descends, 'merge-base'), range.base, range.tip)]
}

/** The shas the clone does not hold as commits; or why git could not say. */
async function theShasLacking(git: Git, shas: readonly string[]): Promise<readonly string[] | string> {
  const lacking: string[] = []
  for (const sha of shas) {
    const asked = await git(LOCAL_MS, ['cat-file', '-e', `${sha}^{commit}`])
    if (!answered(asked)) return whyOf(asked, 'cat-file')
    if (asked.exit_code !== 0) lacking.push(sha)
  }
  return lacking
}
