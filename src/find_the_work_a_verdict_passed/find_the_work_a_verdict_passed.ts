// Finding the work a verdict passed (martha#256, slice 2's read-back).
//
// This exists so what lands is what was reviewed: before anything merges, a package is turned into the one head its
// reviewer passed and the open pull request standing at that head. It reads; it writes nothing, merges nothing,
// pushes nothing and registers no tool. The package that adds the merges calls this first.
//
// The passed head is not asked for: it is the tip of the range the reviewer's VERDICT line named, kept on the
// package's ledger as the row a line adds (../read_a_crew_line). The latest VERDICT decides — a FAIL after a PASS
// leaves no PASS row, and an older PASS is never the answer. The pull request is found from GitHub, the one open pull
// request whose head is exactly that sha (#256's design: the head the reviewer passed, not the one the branch has
// now), and a pull request's number is never taken for its package's issue number.
//
// Four answers are refused by name, and each says which: no PASS row; a package of another repository than the one
// being landed; no open pull request at the passed head; more than one. A row written before this package kept the
// range, and a verdict on a design (doc=, no range), name no head and are refused in their own words rather than
// crashing.

import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import { readLedger, WORK_PACKAGE, type LedgerHost, type LedgerRow } from '../log_ledger/log_ledger.ts'
import { readACrewLine, type CrewLineRead } from '../read_a_crew_line/read_a_crew_line.ts'
import { GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** A package to look up, as the landing knows it: the package, the repository being landed, and where gh runs. */
export interface TheLookUp {
  readonly package: string
  readonly repo: string
  readonly cwd: string
}

/** What a verdict passed: the pull request and the exact head, or why there is nothing to land. */
export type PassedWork = { readonly pr: number; readonly head: string } | { readonly refused: string }

/** The work one package's verdict passed, named as the batch that asked for it named the package. */
export interface LandedWork {
  readonly package: string
  readonly pr: number
  readonly head: string
}

/**
 * The work a batch of packages' verdicts passed, in the order the batch names them, or the first answer that refuses.
 * A batch is what lands as one act (martha#256's landing), so its packages are read one after another and the first
 * one that cannot be landed answers for the whole batch, before anything is merged.
 */
export async function findTheWorkTheseVerdictsPassed(
  host: LookUpHost,
  look: { readonly packages: readonly string[]; readonly repo: string; readonly cwd: string },
): Promise<{ readonly work: readonly LandedWork[] } | { readonly refused: string }> {
  const work: LandedWork[] = []
  for (const work_package of look.packages) {
    const found = await findTheWorkAVerdictPassed(host, { package: work_package, repo: look.repo, cwd: look.cwd })
    if ('refused' in found) return found
    work.push({ package: work_package, pr: found.pr, head: found.head })
  }
  return { work }
}

/** What this needs of a host: the package's ledger, and the process runner gh goes through. */
export type LookUpHost = LedgerHost & Pick<HostContract, 'processes'>

/** One pull request as this slice reads GitHub's answer: only the fields a landing decides on. */
interface PullRequest {
  readonly number: number
  readonly state: string
  readonly head: { readonly sha: string }
}

const refused = (why: string): PassedWork => ({ refused: why })

/** The repository a package belongs to: `owner/repo` of `owner/repo#n`. */
const repoOf = (work_package: string): string => work_package.slice(0, work_package.indexOf('#'))

export async function findTheWorkAVerdictPassed(host: LookUpHost, look: TheLookUp): Promise<PassedWork> {
  const wrong = lookUpProblem(look)
  if (wrong !== undefined) return refused(wrong)
  const note = latestVerdictNote(await readLedger(host, look.package), look.package)
  if (note === undefined) return refused(`no PASS row for ${look.package}.`)
  const verdict = readableVerdict(note, look.package)
  if ('refused' in verdict) return verdict
  const head = headOf(verdict.line)
  if (head === undefined) {
    return refused(`the PASS row of ${look.package} carries no range, so it names no head to land.`)
  }
  const outcome = await host.processes.run({
    command: GITHUB_CLI,
    args: ['api', `repos/${look.repo}/commits/${head}/pulls`],
    cwd: look.cwd,
  })
  return theOneOpenPullRequestAt(outcome, look, head)
}

/** Why this package cannot be looked up in this repository, or nothing when it can. */
function lookUpProblem(look: TheLookUp): string | undefined {
  if (!WORK_PACKAGE.test(look.package)) {
    return `${JSON.stringify(look.package)} is not a work package (owner/repo#n).`
  }
  const package_repo = repoOf(look.package)
  if (package_repo !== look.repo) {
    return `${look.package} is a package of ${package_repo}, and this landing is for ${look.repo}.`
  }
  return undefined
}

/**
 * The note of the latest row a VERDICT added to this package's ledger, read back or not. A row written before the
 * range was kept still counts as the latest verdict, so an older PASS is never answered after it.
 */
function latestVerdictNote(rows: readonly LedgerRow[], work_package: string): string | undefined {
  const notes = rows.flatMap((row) => (row.kind === 'review_round_closed' && startsAsAVerdictOn(row.note, work_package) ? [row.note] : []))
  return notes.at(-1)
}

/** Whether a row's note begins as a VERDICT on this package: the row was kept by a verdict line, whatever it says. */
function startsAsAVerdictOn(note: string, work_package: string): boolean {
  const [verb, named] = note.trim().split(/\s+/)
  return verb === 'VERDICT' && named === work_package
}

/** The latest verdict's line when it reads and is a PASS, or the refusal that answers for it. */
function readableVerdict(note: string, work_package: string): { readonly line: CrewLineRead } | { readonly refused: string } {
  const reading = readACrewLine(note)
  if (!('line' in reading) || reading.line === null) {
    const why = 'refused' in reading ? reading.refused : 'it does not read as a VERDICT line'
    return { refused: `the latest VERDICT row of ${work_package} names no head to land: ${why}` }
  }
  const line = reading.line
  if (line.verdict !== 'PASS') {
    return { refused: `no PASS row for ${work_package}: its latest VERDICT is ${line.verdict ?? 'no verdict'}.` }
  }
  return { line }
}

/**
 * The tip of the range a VERDICT named, or undefined when it named none: a row written before the range was kept, or
 * a verdict on a design, whose URL stands where the range would be.
 */
function headOf(verdict: CrewLineRead): string | undefined {
  const range = verdict.words[2]
  if (range === undefined) return undefined
  return range.split('..')[1] ?? undefined
}

/** The one open pull request at the passed head; nothing else is a pull request to land. */
function theOneOpenPullRequestAt(outcome: ProcessOutcome, look: TheLookUp, head: string): PassedWork {
  if (outcome.exit_code !== 0) {
    return refused(`gh could not answer for ${head} in ${look.repo}: ${whatGhSaid(outcome)}.`)
  }
  const pull_requests = pullRequestsIn(outcome.stdout)
  if (pull_requests === undefined) {
    return refused(`gh answered for ${head} with something that is not a list of pull requests.`)
  }
  const open = pull_requests.filter((pr) => pr.state === 'open' && pr.head.sha === head)
  if (open.length === 0) return refused(`no open pull request at ${head} for ${look.package}.`)
  if (open.length > 1) {
    return refused(`more than one open pull request at ${head} for ${look.package}: ${open.map((pr) => `#${pr.number}`).join(', ')}.`)
  }
  const one = open[0]
  return one === undefined ? refused(`no open pull request at ${head} for ${look.package}.`) : { pr: one.number, head }
}

/** What gh said it could not do, as one line: its own words, or the status it ended with when it said none. */
function whatGhSaid(outcome: ProcessOutcome): string {
  const words = outcome.stderr.trim() === '' ? outcome.stdout.trim() : outcome.stderr.trim()
  return words === '' ? `gh ended with ${String(outcome.exit_code)}` : (words.split('\n')[0] ?? words)
}

/** GitHub's answer as the pull requests it holds, or undefined when the text is not a list of them. */
function pullRequestsIn(text: string): readonly PullRequest[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  return parsed.filter(isPullRequest)
}

/** Whether one entry of GitHub's answer carries the three fields a landing reads, in the shape GitHub gives them. */
function isPullRequest(value: unknown): value is PullRequest {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  const head = entry['head']
  return (
    typeof entry['number'] === 'number' &&
    typeof entry['state'] === 'string' &&
    typeof head === 'object' &&
    head !== null &&
    typeof (head as Record<string, unknown>)['sha'] === 'string'
  )
}
