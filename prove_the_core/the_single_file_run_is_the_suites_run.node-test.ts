// The single-file run is the suite's own run, one file at a time (martha#723).
//
// `npm test` cannot run one file: the arguments after `npm test --` reach only its last command and land after that
// command's globs. So a member copies stage 3 out of package.json by hand and swaps its globs for a file — a copy that
// drifts the moment either changes (martha#669), with the hand-typed run's shape that martha#683 exists to stop.
//
// The entry point is `npm run test:file -- <files> [--test-name-pattern=…]`. This holds it to the suite in the ways that
// matter, each failing under its own name: it runs exactly the case the pattern picks; the arguments node receives are
// the test script's own, word for word, read from /proc rather than from a printout; neither the recorded-host stage nor
// the installer stage runs behind it; and every refusal it can make is made, with its own words.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { FORCE_EXIT_FLAG, GUARD_FLAG, TIMEOUT_FLAG, testRunFlagsOf, withoutTheTestContext } from './every_test_run_ends.ts'
import { manifestOf } from './declared_in_package_json.ts'

const NAME = 'the_single_file_run_is_the_suites_run'

/** The repository this check reads and runs, where the entry point runs from. */
const repository = join(import.meta.dirname, '..')

/** Where the planted file goes: inside a folder the suite's globs pick, which is the only place it may go. */
const PLANTED = join(import.meta.dirname, 'planted_for_the_single_file_run.node-test.ts')

/** The case the pattern picks, in the planted file. */
const PICKED = 'the case the pattern picks'

/** The variable the planted case writes the runner's arguments to. */
const THE_ARGUMENTS_GO_TO = 'PLANTED_ARGUMENTS_GO_TO'

/** One run gets this long before it is the run's own fault, well over what two tests take. */
const THE_RUNS_BOUND_MS = 120_000

/** The caller's own word, the one argument a run may add to the test script's: node's name pattern. */
const THE_NAME_PATTERN = '--test-name-pattern'

/** The runner's own word, which starts a run and is not one of the flags that bound it. */
const THE_RUNNER_WORD = '--test'

/** The planted file: one case the pattern picks, which records its runner's own arguments, and one it must not reach. */
const THE_PLANTED_FILE = `import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'

test('${PICKED}', () => {
  const out = process.env['${THE_ARGUMENTS_GO_TO}']
  if (out !== undefined) writeFileSync(out, readFileSync('/proc/' + process.ppid + '/cmdline'))
})

test('the case the pattern leaves out', () => {
  throw new Error('the single-file run ran a case its pattern did not pick')
})
`

interface Ran {
  readonly status: number | null
  readonly output: string
}

/** The entry point as an owner or a member uses it: through the npm script, with the arguments after its own `--`. */
function theSingleFileRun(args: readonly string[], env: NodeJS.ProcessEnv): Ran {
  const ran = spawnSync('npm', ['run', '--silent', 'test:file', '--', ...args], {
    cwd: repository,
    encoding: 'utf8',
    env: withoutTheTestContext(env),
    timeout: THE_RUNS_BOUND_MS,
  })
  return { status: ran.status, output: `${ran.stdout ?? ''}${ran.stderr ?? ''}` }
}

/** The summary says exactly one test ran and it passed: a pattern that picked none or several is not this run. */
function theOneTestRan(ran: Ran): void {
  const tests = /^ℹ tests (\d+)$/m.exec(ran.output)?.[1]
  assert.equal(tests, '1', `${NAME}: the run says ℹ tests ${tests ?? 'nothing'}, not the one case its pattern picks:\n${ran.output}`)
  assert.equal(ran.status, 0, `${NAME}: the single-file run failed:\n${ran.output}`)
  assert.match(ran.output, /^ℹ fail 0$/m, `${NAME}: the run failed a case:\n${ran.output}`)
}

/** The arguments node received, as the kernel holds them for the runner the planted case sits under. */
function theArgumentsNodeGot(written: string): string[] {
  assert.ok(existsSync(written), `${NAME}: ${PICKED} never ran, so the run's arguments were never recorded`)
  return readFileSync(written, 'utf8').split('\0').filter((word) => word !== '')
}

/**
 * The run's arguments are the test script's own, word for word: what `testRunFlagsOf` reads out of package.json is what
 * node received, and nothing else that bounds a run came through with it.
 */
function theArgumentsAreTheSuite(written: string): void {
  const words = theArgumentsNodeGot(written)
  const isABound = (word: string): boolean =>
    word === FORCE_EXIT_FLAG || word === GUARD_FLAG || word.startsWith(`${TIMEOUT_FLAG}=`)
  const expected = testRunFlagsOf(manifestOf(repository))
  const received = words.filter(isABound)
  assert.deepEqual(received, expected, `${NAME}: the run's arguments are not the test script's, word for word. Node received ${received.join(' ') || 'none'}; the test script states ${expected.join(' ')}`)
  const stray = words.filter(
    (word) =>
      (word.startsWith('--test') || word.startsWith('--import=')) &&
      word !== THE_RUNNER_WORD &&
      !isABound(word) &&
      !word.startsWith(THE_NAME_PATTERN),
  )
  assert.deepEqual(stray, [], `${NAME}: the run carried arguments of its own beyond the test script's and the caller's name pattern: ${stray.join(' ')}`)
}

/** The name a stage prints its own lines under, read from the file that declares it, never written here. */
function theDeclaredName(file: string, declaration: RegExp): string {
  const name = declaration.exec(readFileSync(join(repository, file), 'utf8'))?.[1]
  assert.ok(name !== undefined && name !== '', `${NAME}: ${file} declares no name, so this check could not see whether that stage ran`)
  return name as string
}

/** Neither stage ran: each announces every line it prints with its own name, and neither name is in this run's output. */
function neitherStageRan(output: string): void {
  const stages = [
    theDeclaredName('prove_the_relay_loads/run_the_recorded_host_runs.sh', /^NAME="([^"]+)"/m),
    theDeclaredName('prove_the_core/run_the_installer_job.ts', /^const NAME = '([^']+)'/m),
  ]
  for (const stage of stages) {
    assert.doesNotMatch(output, new RegExp(`^${stage}:`, 'm'), `${NAME}: ${stage} ran inside a single-file run:\n${output}`)
  }
}

test('#723: one file through the suite\'s own entry point is the suite\'s run, one file at a time', async (t) => {
  const where = mkdtempSync(join(tmpdir(), 'martha-single-file-'))
  const written = join(where, 'the-arguments')
  writeFileSync(PLANTED, THE_PLANTED_FILE)
  t.after(() => {
    rmSync(PLANTED, { force: true })
    removeTheTree(where)
  })
  const ran = theSingleFileRun([`--test-name-pattern=${PICKED}`, PLANTED], { ...process.env, [THE_ARGUMENTS_GO_TO]: written })
  await t.test('the summary says exactly one test ran, and it passed', () => theOneTestRan(ran))
  await t.test('the arguments node received are the test script\'s own, word for word', () => theArgumentsAreTheSuite(written))
  await t.test('neither the recorded-host stage nor the installer stage ran behind it', () => neitherStageRan(ran.output))
})

test('#723: every refusal the single-file run can make is made, with its own words (mutant: a flag or a path passed through)', () => {
  const refusals = [
    { args: [] as readonly string[], says: /name at least one test file; npm test is the whole suite/ },
    { args: ['CONTRIBUTING.md'], says: /the suite runs no CONTRIBUTING\.md; its globs are .*src\/\*\*\/\*\.node-test\.ts/ },
    { args: [`${TIMEOUT_FLAG}=1000`, 'prove_the_core/parse_a_source.node-test.ts'], says: /is not this runner's to pass/ },
    { args: ['no-such-file-or-flag'], says: /is not a file/ },
  ]
  for (const one of refusals) {
    const ran = theSingleFileRun(one.args, process.env)
    const called = one.args.join(' ') === '' ? 'no arguments' : one.args.join(' ')
    assert.equal(ran.status, 2, `${NAME}: ${called} was not refused:\n${ran.output}`)
    assert.match(ran.output, one.says, `${NAME}: ${called} was refused, but not with its own words:\n${ran.output}`)
  }
})
