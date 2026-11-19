// The `check:` scripts held against the jobs that run them, both ways (martha#741). One path through the judgment, for
// the run CI makes, for its self-test and for the tests that plant trees.
//
// 1. A script with no job: a `check:` script no job a pull request triggers runs fails by name, with where it does run.
// 2. A job with no script: a job that names `check:<name>` for a name `package.json` does not declare fails by name.
//
// A check is RUN only by a step written on one line, `run: npm run [--silent] check:<name>[ <args>]` or
// `run: node <its entry>[ <args>]`, whose args hold no `--self-test` and nothing that swallows its exit (`||`, a pipe
// `|`, a trailing `&`), in a workflow every pull request triggers: an `on:` with pull_request and no paths filter. A mention anywhere else (a line inside a `run: |` block, a self-test, a
// planted run in a check's own bite) counts for direction 2 only. It never makes a check run, because a planted line
// would keep a check "run" after its real step was deleted.
//
// Two jobs may run one check; the check asks whether a check is run, never how often. Stated limits, not read: a job's
// or step's `if:`, `continue-on-error`, and a check run from inside another script the job calls.

import { WORKFLOW } from '../../prove_the_core/the_release_is_proven/the_installer_jobs_steps.ts'
import type { PullRequestTrigger, Workflow } from './read_a_workflow.ts'
import type { ExcusedCheck } from './the_exceptions.ts'

/** The prefix by which a script of `package.json` declares itself a check. */
export const CHECK_PREFIX = 'check:'

const NAME = String.raw`check:[\w-]+(?::[\w-]+)*`
const NPM_RUN = new RegExp(String.raw`^npm run(?: --silent)? (${NAME})(?=\s|$)(.*)$`)
const MENTION = new RegExp(String.raw`npm run(?: --silent)? (${NAME})`, 'g')
const NODE_RUN = /^node (\S+)(.*)$/
const SELF_TEST = /(?:^|\s)--self-test(?:\s|$)/
/** Args after which the step's exit is no longer the check's: `||`, a pipe, or a trailing `&`. `&&` keeps it. */
const SWALLOWED = /\|\||(?<!\|)\|(?!\|)|(?<!&)&\s*$/

/** Where one check is run: a job of a workflow, and how that workflow reaches pull requests. */
interface Place {
  readonly file: string
  readonly job: string
  readonly trigger: PullRequestTrigger
}

/** The scripts and the workflows, judged. */
export interface Judged {
  /** One line per finding, in the words a red run prints. */
  readonly findings: readonly string[]
  /** How many `check:` scripts were read. */
  readonly checks: number
}

const withoutDotSlash = (path: string): string => path.replace(/^\.\//, '')

/** Each check's entry, the path its command runs with `node`, mapped to the check. */
function theEntries(scripts: Readonly<Record<string, string>>, checks: readonly string[]): Map<string, string> {
  return new Map(checks.flatMap((check) => {
    const entry = NODE_RUN.exec(scripts[check] ?? '')?.[1]
    return entry === undefined ? [] : [[withoutDotSlash(entry), check] as const]
  }))
}

/** The check a one-line step runs, or undefined: a step that runs none, only a check's self-test, or a check whose
 * exit the step swallows, since that step never fails when the check does. */
function theCheckRun(step: string, entries: ReadonlyMap<string, string>): string | undefined {
  const [check, args] = npmRun(step) ?? nodeRun(step, entries) ?? [undefined, '']
  return SELF_TEST.test(args) || SWALLOWED.test(args) ? undefined : check
}

/** The check and the args of a step `npm run [--silent] check:<name>[ <args>]`, or undefined for another step. */
function npmRun(step: string): readonly [string | undefined, string] | undefined {
  const run = NPM_RUN.exec(step)
  return run === null ? undefined : [run[1], run[2] ?? '']
}

/** The check whose entry a step `node <path>[ <args>]` runs, and its args, or undefined for another step. */
function nodeRun(step: string, entries: ReadonlyMap<string, string>): readonly [string | undefined, string] | undefined {
  const run = NODE_RUN.exec(step)
  return run === null ? undefined : [entries.get(withoutDotSlash(run[1] ?? '')), run[2] ?? '']
}

/** Every place each check is run, by check. */
function thePlaces(workflows: readonly Workflow[], entries: ReadonlyMap<string, string>): Map<string, Place[]> {
  const places = new Map<string, Place[]>()
  for (const { file, trigger, jobs } of workflows) {
    for (const { id, steps } of jobs) {
      const run = new Set(steps.flatMap((step) => theCheckRun(step, entries) ?? []))
      run.forEach((check) => places.set(check, [...(places.get(check) ?? []), { file, job: id, trigger }]))
    }
  }
  return places
}

/** One place, in the words of the "runs only in" clause. */
function where({ file, job, trigger }: Place): string {
  const how = trigger.kind === 'filtered' ? `whose pull_request trigger is filtered by ${trigger.by}` : 'which no pull request triggers'
  return `${file} (${job}), ${how}`
}

const reachesEveryPullRequest = (place: Place): boolean => place.trigger.kind === 'every'

/** Direction 1: the finding for `check` when no job a pull request triggers runs it, or undefined. */
function unrun(check: string, places: readonly Place[]): string | undefined {
  if (places.some(reachesEveryPullRequest)) return undefined
  const elsewhere = places.length === 0 ? '' : `; it runs only in ${places.map(where).join(' and ')}`
  return `${check} (package.json) is run by no job a pull request triggers${elsewhere}: add a job to ${WORKFLOW} that runs npm run --silent ${check}.`
}

/** The finding for an exception the tree no longer bears out, or undefined. */
function stale(excused: ExcusedCheck, checks: readonly string[], places: readonly Place[]): string | undefined {
  const said = `${excused.script} is excused (${excused.reason}), but`
  if (!checks.includes(excused.script)) return `${said} package.json does not declare it: drop its exception.`
  const run = places.find(reachesEveryPullRequest)
  return run === undefined ? undefined : `${said} ${run.file} (${run.job}) runs it on every pull request: drop its exception.`
}

/** Direction 2: every job line naming a `check:` script `package.json` does not declare, once per job and name. */
function undeclared(workflows: readonly Workflow[], checks: readonly string[]): string[] {
  return workflows.flatMap(({ file, jobs }) => jobs.flatMap(({ id, lines }) => {
    const named = new Set(lines.flatMap((line) => [...line.matchAll(MENTION)].map((mention) => mention[1] ?? '')))
    return [...named].filter((name) => !checks.includes(name)).map((name) => `${file} job ${id} runs ${name}, which package.json does not declare.`)
  }))
}

/** Every finding over `package.json`'s scripts and the workflows, with `exceptions` excused. */
export function judgeTheChecks(scripts: Readonly<Record<string, string>>, workflows: readonly Workflow[], exceptions: readonly ExcusedCheck[]): Judged {
  const checks = Object.keys(scripts).filter((script) => script.startsWith(CHECK_PREFIX))
  const places = thePlaces(workflows, theEntries(scripts, checks))
  const excused = new Set(exceptions.map((exception) => exception.script))
  const findings = [
    ...checks.filter((check) => !excused.has(check)).flatMap((check) => unrun(check, places.get(check) ?? []) ?? []),
    ...exceptions.flatMap((exception) => stale(exception, checks, places.get(exception.script) ?? []) ?? []),
    ...undeclared(workflows, checks),
  ]
  return { findings, checks: checks.length }
}
