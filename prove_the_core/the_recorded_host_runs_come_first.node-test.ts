// The recorded-host runs come first, one file at a time, and the parallel run never sees the host (martha#383).
//
// This exists so a recorded-host case that passes alone passes in `npm test` too: in the suite's parallel run it
// starves for a core on a loaded machine and runs out of time for nothing it tests. The test script runs
// run_the_recorded_host_runs.sh first, then the parallel run with RECORDED_HOST_VARIABLE unset, so every marked case
// skips there and none runs twice. Each condition below fails by name.

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'

import { RECORDED_HOST_VARIABLE } from '../src/launch_a_claude_code_member/drive_the_recorded_host.ts'
import { manifestOf, testCommandsOf, type Manifest } from './declared_in_package_json.ts'

const repository = join(import.meta.dirname, '..')
/** The runner of the recorded-host runs, as the test script names it. */
const RECORDED_HOST_RUNNER = 'prove_the_relay_loads/run_the_recorded_host_runs.sh'

/** What is wrong with the shape of a test script: each problem by name, none when the runner comes first and alone. */
function shapeProblemsOf(manifest: Manifest): string[] {
  const commands = testCommandsOf(manifest)
  const runs_the_runner = (words: readonly string[]): boolean => words.includes(RECORDED_HOST_RUNNER)
  const parallel = commands.at(-1)
  return [
    ...(runs_the_runner(commands[0]?.words ?? []) && commands.length > 1
      ? []
      : [`the test script's first command is not ${RECORDED_HOST_RUNNER}, so the recorded-host files would run inside the parallel run`]),
    ...(parallel?.unsets.includes(RECORDED_HOST_VARIABLE) === true
      ? []
      : [`the test script's parallel run does not unset ${RECORDED_HOST_VARIABLE}, so the recorded-host cases would run twice, once under the suite's contention`]),
    ...(commands.slice(1).some((command) => runs_the_runner(command.words))
      ? [`the test script runs ${RECORDED_HOST_RUNNER} after its first command, where a parallel run before it has already met the host`]
      : []),
  ]
}

test('the test script runs the recorded-host runs first and unsets the host for its parallel run', () => {
  assert.deepEqual(shapeProblemsOf(manifestOf(repository)), [])
})

const scripted = (test_script: string): Manifest => ({ scripts: { test: test_script } })
const PARALLEL = "node --test 'src/**/*.node-test.ts'"

test('a script without the runner first is named', () => {
  const [problem, ...rest] = shapeProblemsOf(scripted(`env -u ${RECORDED_HOST_VARIABLE} ${PARALLEL}`))
  assert.deepEqual(rest, [])
  assert.match(problem ?? '', /first command is not/)
})

test('a parallel run that leaves the host set is named', () => {
  const [problem, ...rest] = shapeProblemsOf(scripted(`${RECORDED_HOST_RUNNER} && ${PARALLEL}`))
  assert.deepEqual(rest, [])
  assert.match(problem ?? '', new RegExp(`does not unset ${RECORDED_HOST_VARIABLE}`))
})

test('the runner after the parallel run is named', () => {
  const problems = shapeProblemsOf(scripted(`env -u ${RECORDED_HOST_VARIABLE} ${PARALLEL} && ${RECORDED_HOST_RUNNER}`))
  assert.ok(problems.some((problem) => /runs .* after its first command/.test(problem)), problems.join('\n'))
})
