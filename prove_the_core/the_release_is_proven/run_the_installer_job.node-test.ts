// npm test runs CI's installer job, step for step, and the runner bites (martha#496).
//
// The live run is the test script's own command; here its place in the script is held, the reading of the workflow
// is proved on planted text, and the runner is run on a planted repository whose job passes, fails, or cannot run,
// each exit by name.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

import { manifestOf, testCommandsOf } from './declared_in_package_json.ts'
import { FOLDER, isTheInstall, JOB, theJobsRunLines, WORKFLOW } from './the_installer_jobs_steps.ts'

const REPOSITORY = join(import.meta.dirname, '..')
const RUNNER = relative(REPOSITORY, join(import.meta.dirname, 'run_the_installer_job.ts'))

test('the test script runs the installer job before its parallel run, which comes last', () => {
  const commands = testCommandsOf(manifestOf(REPOSITORY)).map(({ words }) => words)
  const at = commands.findIndex((words) => words.includes(RUNNER))
  assert.ok(at !== -1, `the test script never runs ${RUNNER}, so a red installer job would not show in npm test`)
  assert.ok(at < commands.length - 1, `the test script runs ${RUNNER} last, after the parallel run rather than before it`)
})

test('the live workflow has the installer job, with its install and a step past it', () => {
  const steps = theJobsRunLines(readTheWorkflow())
  assert.ok(steps.some(isTheInstall), `${WORKFLOW} has no "${JOB}" job installing its dependencies: ${JSON.stringify(steps)}`)
  assert.ok(steps.some((step) => !isTheInstall(step)), `${WORKFLOW}'s "${JOB}" job runs nothing past its install`)
})

/** A workflow holding the installer job with `steps`, between two other jobs. */
const aWorkflow = (steps: readonly string[]): string =>
  ['jobs:', '  before:', '    steps:', '      - run: echo before', `  ${JOB}:`, '    steps:',
    ...steps.flatMap((step, at) => (at % 2 === 0 ? [`      - run: ${step}`] : ['      - name: a named step', `        run: ${step}`])),
    '  after:', '    steps:', '      - run: echo after', ''].join('\n')

test('the job\'s run lines are read in order, its own only, a named step and a bare one alike', () => {
  assert.deepEqual(theJobsRunLines(aWorkflow(['npm ci --ignore-scripts', 'npx tsc', 'npm test'])), ['npm ci --ignore-scripts', 'npx tsc', 'npm test'])
  assert.deepEqual(theJobsRunLines('jobs:\n  elsewhere:\n    steps:\n      - run: npm test\n'), [])
})

function readTheWorkflow(): string {
  return readFileSync(join(REPOSITORY, WORKFLOW), 'utf8')
}

/** Runs the runner on a planted repository holding `steps` as its installer job, installed or not. */
function runOnAPlant(steps: readonly string[], installed: boolean): { status: number | null; output: string } {
  const plant = mkdtempSync(join(tmpdir(), 'martha-496-job-'))
  try {
    mkdirSync(dirname(join(plant, WORKFLOW)), { recursive: true })
    writeFileSync(join(plant, WORKFLOW), aWorkflow(steps))
    mkdirSync(join(plant, FOLDER, installed ? 'node_modules' : ''), { recursive: true })
    const run = spawnSync(process.execPath, [join(REPOSITORY, RUNNER), '--repository', plant], { encoding: 'utf8' })
    return { status: run.status, output: `${run.stdout}${run.stderr}` }
  } finally {
    removeTheTree(plant)
  }
}

test('a job whose every step passes passes, and the install is not run', () => {
  const { status, output } = runOnAPlant(['npm ci --ignore-scripts', 'true', 'test -d node_modules'], true)
  assert.equal(status, 0, output)
  assert.match(output, new RegExp(`every step of CI's ${JOB} job past its install passed`))
})

test('a step that fails is named, and the steps after it are not run', () => {
  const { status, output } = runOnAPlant(['npm ci --ignore-scripts', 'true', 'exit 3', 'echo never'], true)
  assert.equal(status, 1, output)
  assert.match(output, new RegExp(`CI's ${JOB} job step "exit 3" fails in ${FOLDER}/ \\(exit 3\\)`))
  assert.doesNotMatch(output, /never/)
})

test('missing dependencies, no job or nothing past the install cannot run, each named, never a pass', () => {
  const missing = runOnAPlant(['npm ci --ignore-scripts', 'true'], false)
  assert.equal(missing.status, 2, missing.output)
  assert.match(missing.output, new RegExp(`not installed, so its job cannot run here: run "npm ci --ignore-scripts" in ${FOLDER}/`))
  const noInstall = runOnAPlant(['true'], true)
  assert.equal(noInstall.status, 2, noInstall.output)
  assert.match(noInstall.output, new RegExp(`has no "${JOB}" job installing its dependencies`))
  const nothing = runOnAPlant(['npm ci'], true)
  assert.equal(nothing.status, 2, nothing.output)
  assert.match(nothing.output, /runs nothing past its install/)
})
