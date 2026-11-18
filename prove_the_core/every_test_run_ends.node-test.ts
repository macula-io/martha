// npm test bounds every test, ends every test file's process, and fails a test
// file that leaves something running, by name (martha#56). Everything a test
// starts is stopped after it, failures included.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { escaped, manifestOf, PACKAGES, type Manifest } from './declared_in_package_json.ts'
import { leakReportOf, leftBehind, leftoverReportOf, leftRunning, NEVER_LEFT_IN_THE_TEMP_DIRECTORY } from './every_test_file_cleans_up.ts'
import {
  FORCE_EXIT_FLAG,
  GUARD_FLAG,
  guardFlagFrom,
  HUNG_TEST_NAME,
  TEST_SCRIPT,
  TIMEOUT_FLAG,
  testRunBoundOf,
  testRunFlagsOf,
  withoutTheTestContext,
} from './every_test_run_ends.ts'

const repository = join(import.meta.dirname, '..')

/** A manifest whose test script is `script`. */
const scripted = (script: string): Manifest => ({ scripts: { [TEST_SCRIPT]: script } })

for (const folder of PACKAGES) {
  test(`npm test in ${folder} fails a hung test by name, ends its file and fails a leaking file: ${TIMEOUT_FLAG}, ${FORCE_EXIT_FLAG}, ${guardFlagFrom(folder)}`, () => {
    const bound = testRunBoundOf(manifestOf(join(repository, folder)), folder)
    assert.deepEqual(bound.bounded ? [] : bound.problems, [], `what ${folder}'s test script lacks`)
  })
}

test('the guard is imported by its path from the package that runs it', () => {
  assert.equal(GUARD_FLAG, guardFlagFrom('.'))
  assert.equal(guardFlagFrom('.'), '--import=./prove_the_core/fail_a_test_file_that_leaves_something_running.ts')
  assert.equal(guardFlagFrom('installer'), '--import=../prove_the_core/fail_a_test_file_that_leaves_something_running.ts')
  const elsewhere = `node --test ${TIMEOUT_FLAG}=60000 ${FORCE_EXIT_FLAG} ${GUARD_FLAG} 'x'`
  const bound = testRunBoundOf(scripted(elsewhere), 'installer')
  assert.equal(bound.bounded, false, 'the root path does not load the guard from the installer')
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
  const guarded = `${FORCE_EXIT_FLAG} ${GUARD_FLAG}`
  one(`node --test ${guarded} 'src/**/*.node-test.ts'`, `no ${TIMEOUT_FLAG}`)
  one(`node --test ${TIMEOUT_FLAG}=60000 ${GUARD_FLAG} 'src/**/*.node-test.ts'`, `no ${FORCE_EXIT_FLAG}`)
  one(`node --test ${TIMEOUT_FLAG}=60000 ${FORCE_EXIT_FLAG} 'src/**/*.node-test.ts'`, `no ${GUARD_FLAG}`)
  one(`node --test ${TIMEOUT_FLAG}=60000 ${FORCE_EXIT_FLAG} --import=./elsewhere.ts 'src/**/*.node-test.ts'`, `no ${GUARD_FLAG}`)
  for (const value of ['0', '-1', 'Infinity', '1e3', '', '60s']) {
    one(`node --test ${TIMEOUT_FLAG}=${value} ${guarded}`, 'not --test-timeout=<a whole number')
  }
  one(`node --test ${TIMEOUT_FLAG} 60000 ${guarded}`, 'not --test-timeout=<a whole number')
  one(`node --test ${TIMEOUT_FLAG}=1 ${TIMEOUT_FLAG}=60000 ${guarded}`, 'times; it must say it once')
  assert.equal(named(`node --test 'src/**/*.node-test.ts'`).length, 3, 'all three are named when all three are missing')
  assert.deepEqual(testRunBoundOf({ scripts: {} }), { bounded: false, problems: [`package.json has no "${TEST_SCRIPT}" script`] })
  assert.deepEqual(testRunBoundOf(scripted(`node --test ${TIMEOUT_FLAG}=60000 ${guarded} 'x'`)), {
    bounded: true,
    timeout_ms: 60000,
    flags: [`${TIMEOUT_FLAG}=60000`, FORCE_EXIT_FLAG, GUARD_FLAG],
  })
})

/** How long the hung test may run here: short, so the check is quick. */
const SHORT_TIMEOUT_MS = 1000
/** How long the whole run may take before the check calls it hung and stops it. */
const RUN_DEADLINE_MS = 30_000

/** A planted file's path from `folder`, as the runner names it when run from there. */
const plantedPath = (file: string, folder: string): string => join(relative(join(repository, folder), import.meta.dirname), file)

type Run = { readonly ended: { code: number | null } | 'hung'; readonly output: string; readonly flags: readonly string[]; readonly group: number }

/**
 * Runs `files` as npm test in `folder` runs its files, from there, with that test
 * script's own flags (the timeout shortened so the check does not wait the full
 * bound), in a process group of its own that `t` kills after itself, whatever happens. With `temp`, the run's temp
 * directory is that one, so what its files leave there is the caller's alone to find and remove.
 */
async function runWithTheScriptsFlags(t: TestContext, folder: string, files: readonly string[], temp?: string): Promise<Run> {
  const flags = testRunFlagsOf(manifestOf(join(repository, folder))).map((flag) =>
    flag.startsWith(`${TIMEOUT_FLAG}=`) ? `${TIMEOUT_FLAG}=${SHORT_TIMEOUT_MS}` : flag,
  )
  const runner = spawn(process.execPath, ['--test', ...flags, ...files.map((file) => plantedPath(file, folder))], {
    cwd: join(repository, folder),
    // Without the variable node --test sets in each file's process: with it, a
    // nested node --test reports to this run instead of running as npm test does.
    env: { ...withoutTheTestContext(process.env), ...(temp === undefined ? {} : { TMPDIR: temp }) },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const group = runner.pid
  assert.ok(group !== undefined, 'the runner started')
  // Registered before any assert: the runner's whole process group goes, whatever happens.
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
  const ended = await new Promise<Run['ended']>((resolve) => {
    const deadline = setTimeout(() => resolve('hung'), RUN_DEADLINE_MS)
    runner.on('close', (code) => {
      clearTimeout(deadline)
      resolve({ code })
    })
  })
  return { ended, output, flags, group }
}

for (const folder of PACKAGES) {
  test(`with the test script's own flags in ${folder}, a file that hangs holding a socket fails by name and its processes end`, async (t) => {
    const { ended, output, flags, group } = await runWithTheScriptsFlags(t, folder, ['a_test_that_hangs_holding_a_socket.ts'])

    assert.notEqual(ended, 'hung', `the run did not end within ${RUN_DEADLINE_MS} ms with the flags ${JSON.stringify(flags)}`)
    if (ended === 'hung') return
    assert.notEqual(ended.code, 0, 'the run fails')
    assert.match(output, new RegExp(`✖ ${HUNG_TEST_NAME}`), 'the hung test is named as failed')
    assert.match(output, /timed out after/, 'because it timed out')
    assert.throws(() => process.kill(-group, 0), { code: 'ESRCH' }, 'no process of the run is left, the file\'s own child included')
  })
}

/** The planted files: two whose tests pass but leave something running, one that leaves a link behind, one that removes
 * the link it makes, and one that cleans up. */
const LEAKS_A_SERVER = 'a_test_file_that_leaks_a_listening_server.ts'
const LEAKS_AN_INTERVAL = 'a_test_file_that_leaks_an_interval.ts'
const LEAVES_A_LINK = 'a_test_file_that_leaves_a_link_in_the_temp_directory.ts'
const REMOVES_ITS_LINK = 'a_test_file_that_removes_its_link_from_the_temp_directory.ts'
const CLOSES_ITS_SERVER = 'a_test_file_that_closes_its_server.ts'

for (const folder of PACKAGES) {
  test(`with the test script's own flags in ${folder}, a file that leaves a server or an interval running fails by name, and one that cleans up passes`, async (t) => {
    const { ended, output, flags } = await runWithTheScriptsFlags(t, folder, [LEAKS_A_SERVER, LEAKS_AN_INTERVAL, CLOSES_ITS_SERVER])

    assert.notEqual(ended, 'hung', `the run did not end within ${RUN_DEADLINE_MS} ms with the flags ${JSON.stringify(flags)}`)
    if (ended === 'hung') return
    assert.notEqual(ended.code, 0, 'the run fails')
    assert.ok(
      output.includes(leakReportOf(plantedPath(LEAKS_A_SERVER, folder), ['TCPServerWrap'])),
      `the file that leaks a server is named with what it left:\n${output}`,
    )
    assert.ok(
      output.includes(leakReportOf(plantedPath(LEAKS_AN_INTERVAL, folder), ['Timeout'])),
      `the file that leaks an interval is named with what it left:\n${output}`,
    )
    assert.match(output, new RegExp(`✖ ${escaped(plantedPath(LEAKS_A_SERVER, folder))}`), 'the leaking server file is failed')
    assert.match(output, new RegExp(`✖ ${escaped(plantedPath(LEAKS_AN_INTERVAL, folder))}`), 'the leaking interval file is failed')
    assert.doesNotMatch(output, new RegExp(escaped(CLOSES_ITS_SERVER)), 'the file that closes its server is neither failed nor blamed')
    assert.match(output, /✔ a test that closes its server after itself/, 'and its test passes')
    assert.match(output, /ℹ fail 2\n/, 'two files fail, no more')
  })
}

for (const folder of PACKAGES) {
  test(`with the test script's own flags in ${folder}, a file that leaves a link in the temp directory fails by name, and the link goes`, async (t) => {
    // The planted run gets a temp directory of its own, removed whole after `t`: what it leaves is gone, and nothing in
    // the shared temp directory is touched. A link there of the same prefix may be another run's, live (martha#724).
    const temp = mkdtempSync(join(tmpdir(), 'martha-724-planted-run-'))
    t.after(() => removeTheTree(temp))
    const { ended, output, flags } = await runWithTheScriptsFlags(t, folder, [LEAVES_A_LINK, REMOVES_ITS_LINK], temp)

    assert.notEqual(ended, 'hung', `the run did not end within ${RUN_DEADLINE_MS} ms with the flags ${JSON.stringify(flags)}`)
    if (ended === 'hung') return
    assert.notEqual(ended.code, 0, 'the run fails')
    assert.match(output, /✔ a file that leaves a link in the temp directory behind/, 'its test passes, so only the guard can fail it')
    assert.match(output, /✔ a file that removes the link it made/, 'and a file that removes its own link passes')
    assert.match(
      output,
      new RegExp(`left behind in the temp directory after its tests: martha-472-link-\\d+\\. Remove it in t\\.after\\.`),
      `the file that leaves a link is named with what it left:\n${output}`,
    )
    assert.match(output, new RegExp(`✖ ${escaped(plantedPath(LEAVES_A_LINK, folder))}`), 'the file that leaves a link is failed')
    assert.doesNotMatch(output, new RegExp(escaped(REMOVES_ITS_LINK)), 'the file that removes its link is neither failed nor blamed')
    assert.match(output, /ℹ fail 1\n/, 'one file fails, no more')
    const [prefix] = NEVER_LEFT_IN_THE_TEMP_DIRECTORY
    assert.equal(
      readdirSync(temp).filter((name) => name.startsWith(prefix)).length,
      1,
      'the planted run made its links in its own temp directory, and the one it left is there',
    )
  })
}

test('what a file leaves behind is judged on its own pid\'s names only, and named with what it left', () => {
  assert.deepEqual(leftBehind(['a'], ['a', 'b']), ['b'])
  assert.deepEqual(leftBehind(['a', 'b'], ['b', 'a']), [], 'what was there before the file ran is not its leaving')
  assert.equal(
    leftoverReportOf('src/x.node-test.ts', ['martha-472-link-4242']),
    'src/x.node-test.ts left behind in the temp directory after its tests: martha-472-link-4242. Remove it in t.after.',
  )
})

test('what a file leaves running is what it holds beyond what its process held before it ran, each kind counted', () => {
  assert.deepEqual(leftRunning(['PipeWrap', 'PipeWrap'], ['PipeWrap', 'PipeWrap']), [])
  assert.deepEqual(leftRunning(['PipeWrap'], ['PipeWrap', 'TCPServerWrap', 'Timeout']), ['TCPServerWrap', 'Timeout'])
  assert.deepEqual(leftRunning(['Timeout'], ['Timeout', 'Timeout']), ['Timeout'], 'a second timer is one left')
  assert.deepEqual(leftRunning(['Timeout', 'PipeWrap'], ['PipeWrap']), [], 'what it stopped of what was there before is no leak')
  assert.equal(
    leakReportOf('src/x.node-test.ts', ['TCPServerWrap', 'SomethingNew']),
    'src/x.node-test.ts left running after its tests: a listening TCP server (TCPServerWrap), SomethingNew. Stop it in t.after.',
  )
})
