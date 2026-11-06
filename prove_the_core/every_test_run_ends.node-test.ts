// npm test bounds every test and ends every test file's process (martha#56).
// Everything a test starts is stopped after it, failures included.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { manifestOf, type Manifest } from './declared_in_package_json.ts'
import {
  FORCE_EXIT_FLAG,
  HUNG_TEST_NAME,
  TEST_SCRIPT,
  TIMEOUT_FLAG,
  testRunBoundOf,
  testRunFlagsOf,
} from './every_test_run_ends.ts'

const repository = join(import.meta.dirname, '..')

/** A manifest whose test script is `script`. */
const scripted = (script: string): Manifest => ({ scripts: { [TEST_SCRIPT]: script } })

test(`npm test fails a hung test by name and ends its file: ${TIMEOUT_FLAG} and ${FORCE_EXIT_FLAG}`, () => {
  const bound = testRunBoundOf(manifestOf(repository))
  assert.deepEqual(bound.bounded ? [] : bound.problems, [], 'what the test script lacks')
})

test('a test script that does not bound its run is named, each way it falls short', () => {
  const named = (script: string): readonly string[] => {
    const bound = testRunBoundOf(scripted(script))
    return bound.bounded ? [] : bound.problems
  }
  const one = (script: string, mentions: string): void => {
    const problems = named(script)
    assert.equal(problems.length, 1, `${script}: ${problems.join('; ')}`)
    assert.match(problems[0] ?? '', new RegExp(mentions), script)
  }
  one(`node --test ${FORCE_EXIT_FLAG} 'src/**/*.node-test.ts'`, `no ${TIMEOUT_FLAG}`)
  one(`node --test ${TIMEOUT_FLAG}=60000 'src/**/*.node-test.ts'`, `no ${FORCE_EXIT_FLAG}`)
  for (const value of ['0', '-1', 'Infinity', '1e3', '', '60s']) {
    one(`node --test ${TIMEOUT_FLAG}=${value} ${FORCE_EXIT_FLAG}`, 'not --test-timeout=<a whole number')
  }
  one(`node --test ${TIMEOUT_FLAG} 60000 ${FORCE_EXIT_FLAG}`, 'not --test-timeout=<a whole number')
  one(`node --test ${TIMEOUT_FLAG}=1 ${TIMEOUT_FLAG}=60000 ${FORCE_EXIT_FLAG}`, 'times; it must say it once')
  assert.equal(named(`node --test 'src/**/*.node-test.ts'`).length, 2, 'both are named when both are missing')
  assert.deepEqual(testRunBoundOf({ scripts: {} }), { bounded: false, problems: [`package.json has no "${TEST_SCRIPT}" script`] })
  assert.deepEqual(testRunBoundOf(scripted(`node --test ${TIMEOUT_FLAG}=60000 ${FORCE_EXIT_FLAG} 'x'`)), {
    bounded: true,
    timeout_ms: 60000,
    flags: [`${TIMEOUT_FLAG}=60000`, FORCE_EXIT_FLAG],
  })
})

/** The variable node --test sets in each test file's process. */
const TEST_CONTEXT_VARIABLE = 'NODE_TEST_CONTEXT'
/** How long the hung test may run here: short, so the check is quick. */
const SHORT_TIMEOUT_MS = 1000
/** How long the whole run may take before the check calls it hung and stops it. */
const RUN_DEADLINE_MS = 30_000

test("with the test script's own flags, a file that hangs holding a socket fails by name and its processes end", async (t) => {
  // The script's flags, with the timeout shortened so the check does not wait the full bound.
  const flags = testRunFlagsOf(manifestOf(repository)).map((flag) =>
    flag.startsWith(`${TIMEOUT_FLAG}=`) ? `${TIMEOUT_FLAG}=${SHORT_TIMEOUT_MS}` : flag,
  )
  const runner = spawn(process.execPath, ['--test', ...flags, join(import.meta.dirname, 'a_test_that_hangs_holding_a_socket.ts')], {
    cwd: repository,
    // Without the variable node --test sets in each file's process: with it, a
    // nested node --test reports to this run instead of running as npm test does.
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== TEST_CONTEXT_VARIABLE)),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const group = runner.pid
  assert.ok(group !== undefined, 'the runner started')
  // Registered before any assert: the runner's whole process group goes, whatever happens.
  const stopGroup = (): void => {
    try {
      process.kill(-group, 'SIGKILL')
    } catch {
      // Nothing left in the group: what the test wants.
    }
  }
  t.after(stopGroup)

  let output = ''
  runner.stdout.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
  runner.stderr.on('data', (chunk: Buffer) => void (output += chunk.toString('utf8')))
  const ended = await new Promise<{ code: number | null } | 'hung'>((resolve) => {
    const deadline = setTimeout(() => resolve('hung'), RUN_DEADLINE_MS)
    runner.on('close', (code) => {
      clearTimeout(deadline)
      resolve({ code })
    })
  })

  assert.notEqual(ended, 'hung', `the run did not end within ${RUN_DEADLINE_MS} ms with the flags ${JSON.stringify(flags)}`)
  if (ended === 'hung') return
  assert.notEqual(ended.code, 0, 'the run fails')
  assert.match(output, new RegExp(`✖ ${HUNG_TEST_NAME}`), 'the hung test is named as failed')
  assert.match(output, /timed out after/, 'because it timed out')
  assert.throws(() => process.kill(-group, 0), { code: 'ESRCH' }, 'no process of the run is left, the file\'s own child included')
})
