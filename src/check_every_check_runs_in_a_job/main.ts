// Run the check: node src/check_every_check_runs_in_a_job/main.ts [--root <dir>] [--self-test]
//
// Every `check:` script of package.json is run by a job a pull request triggers, and every job that names a `check:`
// script names one package.json declares (martha#741). A check nothing runs passes forever, so its own tests prove a
// rule no change is held to; this is the check that a check is held.
//
// Exit 0 every check is run; 1 one line per finding, then the count; 2 the check could not be made: package.json or a
// workflow could not be read, or a workflow's `on:` or `jobs:` is in a form the reader does not read. It never passes
// because it could not look. What counts as a run, and what is not read, is said in ./judge_the_checks.ts.
//
// `--self-test` plants a tree under the temp directory whose one check no job runs, judges it by the same path, and
// requires that check named; the tree is removed whatever the verdict.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { WORKFLOW } from '../../prove_the_core/the_installer_jobs_steps.ts'
import { MANIFEST } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { CHECK_PREFIX, judgeTheChecks, type Judged } from './judge_the_checks.ts'
import { readAWorkflow } from './read_a_workflow.ts'
import { EXCEPTIONS, type ExcusedCheck } from './the_exceptions.ts'

const NAME = 'check_every_check_runs_in_a_job'

/** The workflows' folder, from the repository's top. */
const WORKFLOWS = dirname(WORKFLOW)
const A_WORKFLOW = /\.ya?ml$/

/** The value given after `name`, or undefined when `name` is not given. Throws when it is given with no value. */
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  if (at === -1) return undefined
  const value = process.argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} names no directory`)
  return value
}

/** package.json's scripts under `root`. Throws when it cannot be read or holds no scripts. */
function theScripts(root: string): Record<string, string> {
  const scripts: unknown = (JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')) as { scripts?: unknown }).scripts
  if (typeof scripts !== 'object' || scripts === null) throw new Error(`${MANIFEST}: it holds no scripts`)
  return scripts as Record<string, string>
}

/** The tree under `root`, judged with `exceptions` excused. Throws when a file cannot be read. */
function judgeTree(root: string, exceptions: readonly ExcusedCheck[] = EXCEPTIONS): Judged {
  const scripts = theScripts(root)
  const files = readdirSync(join(root, WORKFLOWS)).filter((name) => A_WORKFLOW.test(name)).sort()
  if (files.length === 0) throw new Error(`${WORKFLOWS}: it holds no workflow`)
  const workflows = files.map((name) => readAWorkflow(join(WORKFLOWS, name), readFileSync(join(root, WORKFLOWS, name), 'utf8')))
  return judgeTheChecks(scripts, workflows, exceptions)
}

/** The verdict, in the words a red run prints. */
function verdict(judged: Judged): number {
  for (const finding of judged.findings) console.error(`${NAME}: ${finding}`)
  if (judged.findings.length > 0) {
    console.error(`${NAME}: ${judged.findings.length} finding(s)`)
    return 1
  }
  console.log(`${NAME}: ${judged.checks} ${CHECK_PREFIX} script(s) read, each run by a job a pull request triggers or excused`)
  return 0
}

/** The planted check the self-test requires named: declared, and run by no job. */
const PLANTED = `${CHECK_PREFIX}planted`

/** The self-test: a planted check no job runs must be the one finding, by name. */
function selfTest(): number {
  const root = mkdtempSync(join(tmpdir(), 'martha-741-self-test-'))
  try {
    mkdirSync(join(root, WORKFLOWS), { recursive: true })
    writeFileSync(join(root, MANIFEST), JSON.stringify({ scripts: { [PLANTED]: 'node planted.ts' } }))
    writeFileSync(join(root, WORKFLOW), 'on:\n  pull_request:\njobs:\n  gate:\n    steps:\n      - run: npm test\n')
    const { findings } = judgeTree(root, [])
    const bites = findings.length === 1 && findings[0]?.startsWith(`${PLANTED} (${MANIFEST}) is run by no job`) === true
    console.log(bites ? `${NAME}: the check bites, ${PLANTED} named` : `${NAME}: self-test failed: ${JSON.stringify(findings)}`)
    return bites ? 0 : 1
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

try {
  process.exitCode = process.argv.includes('--self-test') ? selfTest() : verdict(judgeTree(option('--root') ?? join(import.meta.dirname, '..', '..')))
} catch (failure) {
  console.error(`${NAME}: the check could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exitCode = 2
}
