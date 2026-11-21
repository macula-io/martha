// Run the check: node src/check_every_job_has_a_timeout/main.ts [--root <dir>] [--self-test]
//
// Every job of every workflow under .github/workflows/ that runs on a runner names a `timeout-minutes` (martha#992).
// A job a runner never finishes — a step waiting on a container, a socket, or a network read that never returns —
// otherwise holds that landing and its branch until GitHub's six-hour default, and holds a concurrency slot on the
// way. A timeout makes such a job fail by name in minutes instead.
//
// A job that calls a reusable workflow (`uses:`) is the one shape GitHub refuses a `timeout-minutes` on, so it is
// asked for none; its time is held by the called workflow's own jobs, which this check reads where they are written.
// One that names a timeout anyway fails here, since GitHub would refuse the file rather than run it.
//
// The workflows are read by the same reader the every-check-runs-in-a-job check uses, so a job is a job here as it is
// there, and a workflow written in a form that reader cannot see fails this run rather than passing it.
//
// Exit 0 every job that runs on a runner names one; 1 one line per finding, then the count; 2 the check could not be
// made: no workflow was found, or one could not be read. It never passes because it could not look.
//
// `--self-test` plants a workflow with one job that names a timeout and one that does not, judges it by the same path,
// and requires the second named and the first not; the tree is removed whatever the verdict.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { WORKFLOW } from '../../prove_the_core/the_release_is_proven/the_installer_jobs_steps.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { readAWorkflow, type Workflow } from '../check_every_check_runs_in_a_job/read_a_workflow.ts'
import { GITHUB_LONGEST_MINUTES } from './the_longest_github_gives_a_job.ts'

const NAME = 'check_every_job_has_a_timeout'

/** The workflows' folder, from the repository's top. */
const WORKFLOWS = dirname(WORKFLOW)
const A_WORKFLOW = /\.ya?ml$/

/** How long GitHub itself gives a job: named once in ./the_longest_github_gives_a_job.ts, never spelled here again. */

/** The value given after `name`, or undefined when `name` is not given. Throws when it is given with no value. */
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  if (at === -1) return undefined
  const value = process.argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} names no directory`)
  return value
}

/** The workflows under `root`, read. Throws when there are none, or when one cannot be read. */
function theWorkflows(root: string): Workflow[] {
  const files = readdirSync(join(root, WORKFLOWS)).filter((name) => A_WORKFLOW.test(name)).sort()
  if (files.length === 0) throw new Error(`${WORKFLOWS}: it holds no workflow`)
  return files.map((name) => readAWorkflow(join(WORKFLOWS, name), readFileSync(join(root, WORKFLOWS, name), 'utf8')))
}

/** What a job's `timeout-minutes` is worth as written: a whole number of minutes, or why it is not one. */
function theCountProblem(written: string): string | undefined {
  if (!/^[0-9]+$/.test(written)) return `${JSON.stringify(written)} is not a whole number of minutes`
  if (Number(written) === 0) return 'zero is not a number of minutes'
  if (Number(written) > GITHUB_LONGEST_MINUTES) return `it is longer than the ${GITHUB_LONGEST_MINUTES} minutes GitHub gives a job with none`
  return undefined
}

/** One line per job that names no usable timeout, in the order the workflows and their jobs were read. */
export function theFindings(workflows: readonly Workflow[]): string[] {
  return workflows.flatMap((workflow) =>
    workflow.jobs.flatMap((job) => {
      // A job that calls a reusable workflow is the one shape GitHub refuses a timeout on, so it is asked for none:
      // the time is held by the called workflow's own jobs, which this check reads in their own files.
      if (job.callsAWorkflow) {
        return job.timeoutMinutes === undefined
          ? []
          : [`${workflow.file}: job ${job.id} calls a reusable workflow, which GitHub refuses a timeout-minutes on`]
      }
      if (job.timeoutMinutes === undefined) return [`${workflow.file}: job ${job.id} names no timeout-minutes`]
      const problem = theCountProblem(job.timeoutMinutes)
      return problem === undefined ? [] : [`${workflow.file}: job ${job.id} names timeout-minutes ${job.timeoutMinutes}: ${problem}`]
    }),
  )
}

/** The verdict, in the words a red run prints. */
function verdict(root: string): number {
  const workflows = theWorkflows(root)
  const findings = theFindings(workflows)
  for (const finding of findings) console.error(`${NAME}: ${finding}`)
  if (findings.length > 0) {
    console.error(`${NAME}: ${findings.length} finding(s)`)
    return 1
  }
  const jobs = workflows.reduce((count, workflow) => count + workflow.jobs.length, 0)
  const callers = workflows.reduce((count, workflow) => count + workflow.jobs.filter((job) => job.callsAWorkflow).length, 0)
  console.log(`${NAME}: ${jobs} job(s) in ${workflows.length} workflow(s), every one that runs on a runner names a timeout-minutes, ${callers} calling a reusable workflow and asked for none`)
  return 0
}

/** A workflow whose first job names a timeout and whose second does not. */
const PLANTED = 'on:\n  pull_request:\njobs:\n  timed:\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n    steps:\n      - run: npm test\n  untimed:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n'
const PLANTED_JOB = 'untimed'

/** The self-test: the planted untimed job must be the one finding, by name, and the timed one must not. */
function selfTest(): number {
  const root = mkdtempSync(join(tmpdir(), 'martha-992-self-test-'))
  try {
    mkdirSync(join(root, WORKFLOWS), { recursive: true })
    writeFileSync(join(root, WORKFLOWS, 'ci.yml'), PLANTED)
    const findings = theFindings(theWorkflows(root))
    const bites = findings.length === 1 && findings[0]?.includes(`job ${PLANTED_JOB} names no timeout-minutes`) === true
    console.log(bites ? `${NAME}: the check bites, ${PLANTED_JOB} named` : `${NAME}: self-test failed: ${JSON.stringify(findings)}`)
    return bites ? 0 : 1
  } finally {
    removeTheTree(root)
  }
}

try {
  process.exitCode = process.argv.includes('--self-test') ? selfTest() : verdict(option('--root') ?? join(import.meta.dirname, '..', '..'))
} catch (failure) {
  console.error(`${NAME}: the check could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exitCode = 2
}
