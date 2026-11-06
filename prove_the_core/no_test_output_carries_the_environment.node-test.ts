// npm test fails when a test prints the environment into the run (martha#92):
// a value planted in every test's environment must never reach the output.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { manifestOf } from './declared_in_package_json.ts'
import { TEST_SCRIPT, testRunFlagsOf } from './every_test_run_ends.ts'
import {
  environmentLeakReportOf,
  PLANTED_VARIABLE,
  plantedValue,
  plantedValueCounter,
  RUNNER,
} from './no_test_output_carries_the_environment.ts'

const repository = join(import.meta.dirname, '..')
/** How long a nested run may take before the check calls it hung and stops it. */
const RUN_DEADLINE_MS = 30_000

/** A planted file's path from the repository, as the runner names it when run from there. */
const plantedPath = (file: string): string => join(relative(repository, import.meta.dirname), file)

type Run = { readonly code: number | null | 'hung'; readonly output: string }

/**
 * Runs `command` through the runner as npm test does, in a process group of its
 * own that `t` kills after itself. The environment is PATH alone: this run's own
 * planted value, and whatever else this process holds, never reach the nested run.
 */
async function throughTheRunner(t: TestContext, command: readonly string[]): Promise<Run> {
  const runner = spawn(process.execPath, [RUNNER, ...command], {
    cwd: repository,
    env: { PATH: process.env.PATH },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const group = runner.pid
  assert.ok(group !== undefined, 'the runner started')
  t.after(() => {
    try {
      process.kill(-group, 'SIGKILL')
    } catch {
      // Nothing left in the group: what the test wants.
    }
  })
  let output = ''
  runner.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
  runner.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
  const code = await new Promise<Run['code']>((resolve) => {
    const deadline = setTimeout(() => resolve('hung'), RUN_DEADLINE_MS)
    runner.on('close', (ended) => {
      clearTimeout(deadline)
      resolve(ended)
    })
  })
  return { code, output }
}

/** node --test with the test script's own flags, on the planted `file`. */
const nodeTestOn = (file: string): string[] => [process.execPath, '--test', ...testRunFlagsOf(manifestOf(repository)), plantedPath(file)]

/** Every package in martha whose tests npm test runs: the repository's and the installer's. */
const PACKAGES = ['.', 'installer']

for (const folder of PACKAGES) {
  test(`npm test in ${folder} runs node --test through ${RUNNER}`, () => {
    const at = join(repository, folder)
    const [program, runner, ...rest] = (manifestOf(at).scripts[TEST_SCRIPT] ?? '').split(/\s+/)
    assert.equal(program, 'node')
    assert.equal(resolve(at, runner ?? ''), resolve(repository, RUNNER), `${folder}'s test script starts with ${runner}`)
    assert.deepEqual(rest.slice(0, 2), ['node', '--test'])
  })
}

test('a test file that lets a child print its environment into the run fails the run, naming the check and never the line', async (t) => {
  const run = await throughTheRunner(t, nodeTestOn('a_test_file_that_prints_its_environment.ts'))
  assert.notEqual(run.code, 'hung', `the run did not end within ${RUN_DEADLINE_MS} ms`)
  assert.equal(run.code, 1, 'the run fails although its test passed')
  assert.match(run.output, /✔ a test whose child prints its environment/, 'the test itself passed')
  assert.match(run.output, new RegExp(`no test output carries the environment \\(martha#92\\): the value planted in ${PLANTED_VARIABLE} appeared 1 time\\(s\\) on (stdout|stderr)`))
})

test('a test file that captures what its child prints passes the run', async (t) => {
  const run = await throughTheRunner(t, nodeTestOn('a_test_file_that_captures_its_childs_environment.ts'))
  assert.equal(run.code, 0, run.output)
  assert.doesNotMatch(run.output, /martha#92/)
})

test("the runner ends with the command's own exit code when nothing was planted in the output", async (t) => {
  const run = await throughTheRunner(t, [process.execPath, '-e', 'process.stdout.write("ok"); process.exit(3)'])
  assert.deepEqual(run, { code: 3, output: 'ok' })
})

test('the planted value is counted wherever the stream splits it, and a fresh one is planted each run', () => {
  const value = plantedValue()
  assert.notEqual(value, plantedValue())
  const count = (chunks: readonly string[]): number => {
    const counter = plantedValueCounter(value)
    for (const chunk of chunks) counter.scan(chunk)
    return counter.count()
  }
  assert.equal(count(['nothing here', 'nor here']), 0)
  assert.equal(count([`a ${value} b`]), 1)
  assert.equal(count([`${value}${value}`]), 2)
  for (let cut = 1; cut < value.length; cut += 1) {
    assert.equal(count([`x${value.slice(0, cut)}`, `${value.slice(cut)}y`]), 1, `split at ${cut}`)
  }
  assert.equal(count([value.slice(0, 5), value.slice(5, 9), value.slice(9)]), 1, 'split three ways')
  assert.equal(count([value, value.slice(0, 5), value.slice(5)]), 2, 'a match after a match')
})

test('the report names the streams and counts, never a value', () => {
  assert.equal(
    environmentLeakReportOf({ stdout: 0, stderr: 2 }).split(': the value')[1]?.split('.')[0],
    ` planted in ${PLANTED_VARIABLE} appeared 2 time(s) on stderr`,
  )
  assert.match(environmentLeakReportOf({ stdout: 1, stderr: 1 }), /1 time\(s\) on stdout, 1 time\(s\) on stderr/)
})
