// What the check answers over a planted tree (martha#992): the entry is spawned with `--root` over a
// .github/workflows/ the test plants, and every case holds the exit code AND the exact lines, never the status alone:
// node itself exits 1 on a missing entry.
//
// The mutants, each with the case that kills it:
//   - a job's own timeout not read at all: 1;  every job read as timed: 2, 1;
//   - a value read as any text rather than a count: 3, 4, 5;
//   - a step's timeout read as the job's: 6;
//   - only the first workflow read: 7;  zero workflows read as a pass: 8;  --root with no value read as the checkout: 9;
//   - the self-test planting nothing: 10;  a reusable-workflow job asked for a timeout: 11;
//   - a reusable-workflow job's own timeout accepted: 12.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { WORKFLOW } from '../../prove_the_core/the_release_is_proven/the_installer_jobs_steps.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { GITHUB_LONGEST_MINUTES } from './the_longest_github_gives_a_job.ts'

const ENTRY = join(import.meta.dirname, 'main.ts')
const SAID = 'check_every_job_has_a_timeout: '
const WORKFLOWS = dirname(WORKFLOW)
const inWorkflows = (name: string): string => join(WORKFLOWS, name)

/** One job, `id`, whose keys after `runs-on` are `keys`, one line each. */
const aJob = (id: string, ...keys: string[]): string => `  ${id}:\n    runs-on: ubuntu-latest\n${keys.map((key) => `    ${key}\n`).join('')}    steps:\n      - run: npm test\n`
/** One job, `id`, that calls a reusable workflow, with `keys` written beside its `uses:`. */
const aCaller = (id: string, ...keys: string[]): string => `  ${id}:\n    uses: ./.github/workflows/called.yml\n${keys.map((key) => `    ${key}\n`).join('')}`
/** A workflow: its `on:` and its jobs. */
const aWorkflow = (...jobs: string[]): string => `on:\n  pull_request:\njobs:\n${jobs.join('')}`

/** A tree the test owns, removed when it ends. */
function plantedTree(t: TestContext, workflows: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'martha-992-timeouts-'))
  t.after(() => removeTheTree(root))
  mkdirSync(join(root, WORKFLOWS), { recursive: true })
  for (const [name, text] of Object.entries(workflows)) writeFileSync(join(root, WORKFLOWS, name), text)
  return root
}

/** The command's verdict on `args`: its exit code, and its lines, each without the check's prefix. */
function theCommand(...args: string[]): { readonly status: number | null; readonly out: string[]; readonly err: string[] } {
  const ran = spawnSync(process.execPath, [ENTRY, ...args], { encoding: 'utf8' })
  const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '').map((line) => line.replace(SAID, ''))
  return { status: ran.status, out: lines(ran.stdout), err: lines(ran.stderr) }
}

const CI = inWorkflows('ci.yml')
const untimed = (id: string, file = CI): string => `${file}: job ${id} names no timeout-minutes`
const findings = (...lines: string[]): string[] => [...lines, `${lines.length} finding(s)`]
const passed = (jobs: number, workflows = 1, callers = 0): string =>
  `${jobs} job(s) in ${workflows} workflow(s), every one that runs on a runner names a timeout-minutes, ${callers} calling a reusable workflow and asked for none`

test('1: a job with no timeout-minutes fails by name, beside a job that has one', (t) => {
  const root = plantedTree(t, { 'ci.yml': aWorkflow(aJob('timed', 'timeout-minutes: 5'), aJob('untimed')) })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(untimed('untimed')) })
})

test('2: every job naming one is a pass, and nothing is said on stderr', (t) => {
  const root = plantedTree(t, { 'ci.yml': aWorkflow(aJob('one', 'timeout-minutes: 5'), aJob('two', 'timeout-minutes: 40')) })
  assert.deepEqual(theCommand('--root', root), { status: 0, out: [passed(2)], err: [] })
})

test('3: a value that is not a number fails by name, with what was written', (t) => {
  const root = plantedTree(t, { 'ci.yml': aWorkflow(aJob('odd', 'timeout-minutes: ten')) })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(`${CI}: job odd names timeout-minutes ten: "ten" is not a whole number of minutes`) })
})

test('4: zero minutes fails by name', (t) => {
  const root = plantedTree(t, { 'ci.yml': aWorkflow(aJob('none', 'timeout-minutes: 0')) })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(`${CI}: job none names timeout-minutes 0: zero is not a number of minutes`) })
})

test('5: a timeout longer than the one GitHub gives a job with none fails by name', (t) => {
  const root = plantedTree(t, { 'ci.yml': aWorkflow(aJob('long', `timeout-minutes: ${GITHUB_LONGEST_MINUTES + 1}`)) })
  assert.deepEqual(theCommand('--root', root), {
    status: 1,
    out: [],
    err: findings(`${CI}: job long names timeout-minutes ${GITHUB_LONGEST_MINUTES + 1}: it is longer than the ${GITHUB_LONGEST_MINUTES} minutes GitHub gives a job with none`),
  })
})

test('6: a timeout on a step is not the job\'s own, so the job still fails by name', (t) => {
  const root = plantedTree(t, { 'ci.yml': aWorkflow(aJob('stepped')) .replace('      - run: npm test\n', '      - run: npm test\n        timeout-minutes: 5\n') })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(untimed('stepped')) })
})

test('7: a job of any workflow is read, not only the first workflow\'s', (t) => {
  const root = plantedTree(t, {
    'ci.yml': aWorkflow(aJob('one', 'timeout-minutes: 5')),
    'release.yml': aWorkflow(aJob('release')),
  })
  assert.deepEqual(theCommand('--root', root), { status: 1, out: [], err: findings(untimed('release', inWorkflows('release.yml'))) })
})

test('8: a folder holding no workflow is a run that could not look, never a pass', (t) => {
  const root = plantedTree(t, {})
  assert.deepEqual(theCommand('--root', root), { status: 2, out: [], err: [`the check could not be made: ${WORKFLOWS}: it holds no workflow`] })
})

test('9: --root with no value is a run that could not look, and never the checkout', () => {
  assert.deepEqual(theCommand('--root'), { status: 2, out: [], err: ['the check could not be made: --root names no directory'] })
})

test('10: the self-test plants an untimed job and requires it named', () => {
  const ran = theCommand('--self-test')
  assert.equal(ran.status, 0)
  assert.deepEqual(ran.out, ['the check bites, untimed named'])
  assert.deepEqual(ran.err, [])
})

test('11: a job that calls a reusable workflow is asked for no timeout, and the count says how many', (t) => {
  const root = plantedTree(t, { 'ci.yml': aWorkflow(aJob('one', 'timeout-minutes: 5'), aCaller('shared')) })
  assert.deepEqual(theCommand('--root', root), { status: 0, out: [passed(2, 1, 1)], err: [] })
})

test('12: a job that calls a reusable workflow and names a timeout anyway fails, as GitHub would refuse the file', (t) => {
  const root = plantedTree(t, { 'ci.yml': aWorkflow(aCaller('shared', 'timeout-minutes: 5')) })
  assert.deepEqual(theCommand('--root', root), {
    status: 1,
    out: [],
    err: findings(`${CI}: job shared calls a reusable workflow, which GitHub refuses a timeout-minutes on`),
  })
})
