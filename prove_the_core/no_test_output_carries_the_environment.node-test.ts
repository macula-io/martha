// npm test fails when a test prints the environment into the run (martha#92):
// a value planted in every test's environment must never reach the output.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { manifestOf, PACKAGES } from './declared_in_package_json.ts'
import { TEST_SCRIPT, testRunFlagsOf } from './every_test_run_ends.ts'
import {
  environmentLeakReportOf,
  FAILING_TESTS_HEADING,
  PLANTED_VARIABLE,
  plantedValue,
  plantedValueCounter,
  RUN_SUMMARY_LABELS,
  RUN_SUMMARY_MARK,
  runEndCounter,
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
  // Decoded per stream, not per chunk: a character split across two chunks arrives whole.
  runner.stdout.setEncoding('utf8')
  runner.stderr.setEncoding('utf8')
  runner.stdout.on('data', (chunk: string) => void (output += chunk))
  runner.stderr.on('data', (chunk: string) => void (output += chunk))
  const code = await new Promise<Run['code']>((resolve) => {
    const deadline = setTimeout(() => resolve('hung'), RUN_DEADLINE_MS)
    runner.on('close', (ended) => {
      clearTimeout(deadline)
      resolve(ended)
    })
  })
  return { code, output }
}

/** The summary node --test ends a complete run with, each count 1, built from the runner's own labels. */
const aRunSummary = RUN_SUMMARY_LABELS.map((label) => `${RUN_SUMMARY_MARK} ${label} 1\n`).join('')
/** A node -e program that writes `text` on stdout and exits with `code`. */
const writesThenExits = (text: string, code: number): string[] => [process.execPath, '-e', `process.stdout.write(${JSON.stringify(text)}); process.exit(${code})`]
/** What the runner says when the command's output did not end with the summary. */
const CUT_RUN_REPORT = /a run ends with its summary \(martha#325\): the command's output did not end with node --test's summary/

/** node --test with the test script's own flags, on the planted `file`. */
const nodeTestOn = (file: string): string[] => [process.execPath, '--test', ...testRunFlagsOf(manifestOf(repository)), plantedPath(file)]

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

test("the runner ends with the command's own exit code when nothing was planted and the output ends with the summary", async (t) => {
  const run = await throughTheRunner(t, writesThenExits(`ok\n${aRunSummary}`, 3))
  assert.deepEqual(run, { code: 3, output: `ok\n${aRunSummary}` })
})

test('a command that exits 0 without printing the summary fails the run, naming the check', async (t) => {
  const run = await throughTheRunner(t, writesThenExits('✔ the first of many tests\n', 0))
  assert.equal(run.code, 1, run.output)
  assert.match(run.output, CUT_RUN_REPORT)
  assert.match(run.output, /exited 0/)
})

test('a summary line a test printed mid-run does not stand for the summary', async (t) => {
  const run = await throughTheRunner(t, writesThenExits(`${aRunSummary}✔ a test after the printed summary\n`, 0))
  assert.equal(run.code, 1, run.output)
  assert.match(run.output, CUT_RUN_REPORT)
})

test('a run that failed keeps its own exit code and still names the missing summary', async (t) => {
  const run = await throughTheRunner(t, writesThenExits('✖ a test\n', 4))
  assert.equal(run.code, 4, run.output)
  assert.match(run.output, CUT_RUN_REPORT)
  assert.match(run.output, /exited 4/)
})

test('a run cut by a signal fails, naming the check', async (t) => {
  const run = await throughTheRunner(t, [process.execPath, '-e', 'process.stdout.write("✔ one\\n"); process.kill(process.pid, "SIGTERM")'])
  assert.equal(run.code, 1, run.output)
  assert.match(run.output, CUT_RUN_REPORT)
  assert.match(run.output, /ended by SIGTERM/)
})

test("the failing tests node --test lists after its summary leave the summary the run's end", async (t) => {
  const failures = `\n${FAILING_TESTS_HEADING}\n\ntest at a.ts:1:1\n✖ a\n  Error: boom\n`
  const run = await throughTheRunner(t, writesThenExits(`✖ a\n${aRunSummary}${failures}`, 1))
  assert.equal(run.code, 1, run.output)
  assert.doesNotMatch(run.output, /martha#325/)
})

test('a real node --test run on a failing file keeps its own report and is not called cut', async (t) => {
  const run = await throughTheRunner(t, nodeTestOn('a_test_file_that_fails.ts'))
  assert.equal(run.code, 1, run.output)
  assert.match(run.output, new RegExp(`${RUN_SUMMARY_MARK} fail 1`))
  assert.doesNotMatch(run.output, /martha#325/)
})

test('the summary is found at the end of stdout wherever the stream splits it, colours and blank lines included', () => {
  const ends = (chunks: readonly string[]): boolean => {
    const counter = runEndCounter()
    for (const chunk of chunks) counter.scan(chunk)
    return counter.endsWithTheSummary()
  }
  const text = `✔ a\n${aRunSummary}\n\n`
  assert.equal(ends([text]), true)
  assert.equal(ends([...text]), true, 'one character at a time')
  assert.equal(ends([`✔ a\n${aRunSummary.trimEnd()}`]), true, 'no newline after the last line')
  assert.equal(ends([aRunSummary.replaceAll(RUN_SUMMARY_MARK, `\u001b[34m${RUN_SUMMARY_MARK}`).replaceAll('\n', '\u001b[39m\n')]), true, 'coloured')
  assert.equal(ends([aRunSummary.replaceAll('\n', '\r\n')]), true, 'CRLF')
  assert.equal(ends(['']), false, 'nothing printed')
  assert.equal(ends([aRunSummary.split('\n').slice(1).join('\n')]), false, 'the first line missing')
  assert.equal(ends([aRunSummary.split('\n').slice(0, -2).join('\n')]), false, 'the last line missing')
  assert.equal(ends([`${aRunSummary}more\n`]), false, 'output after it')
  assert.equal(ends([aRunSummary.replace(' 1', ' many')]), false, 'a count that is not a number')
  assert.equal(ends([`${aRunSummary}\n${FAILING_TESTS_HEADING}\n✖ a\n`]), true, 'the failing tests after it')
})

test('a character the command writes in two pieces reaches the output whole', async (t) => {
  const tick = Buffer.from('✔')
  const writer = [
    `const tick = Buffer.from(${JSON.stringify([...tick])})`,
    'process.stdout.write(tick.subarray(0, 1))',
    'setTimeout(() => process.stdout.write(tick.subarray(1)), 50)',
  ].join('; ')
  const run = await throughTheRunner(t, [process.execPath, '-e', `${writer}; setTimeout(() => process.stdout.write(${JSON.stringify(`\n${aRunSummary}`)}), 100)`])
  assert.deepEqual(run, { code: 0, output: `✔\n${aRunSummary}` })
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
