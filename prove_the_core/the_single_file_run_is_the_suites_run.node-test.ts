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
//
// One case plants a throwaway repository whose own test script states bounds this repository never states, and two names
// to unset: the run must take both from there. Without it, a runner that wrote the bounds down by hand would pass, since
// what it wrote equals what this repository's script says. Another plants a reader that cannot answer, which the run must
// refuse rather than go on without what it says.
//
// The plant the first case runs goes in prove_the_core/, the only place the suite's globs pick, under a name of its own
// per run. Three checks read that folder while it is there: the ceiling check, which counts a test file for nothing; the
// dropped-test check, which reads commits rather than the working tree; and the restated-values check, which judges
// literals against exported constants — the plant's words restate none, and it exists only while one run of it does.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import ts from 'typescript'

import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { FORCE_EXIT_FLAG, GUARD_FLAG, TIMEOUT_FLAG, testRunFlagsOf, withoutTheTestContext } from './every_test_run_ends.ts'
import { manifestOf } from './declared_in_package_json.ts'

const NAME = 'the_single_file_run_is_the_suites_run'

/** The repository this check reads and runs, where the entry point runs from. */
const repository = join(import.meta.dirname, '..')

/** The file the plant goes in: the folder the suite's globs pick, under a name no second run can want. */
const PLANTED = join(import.meta.dirname, `planted_for_the_single_file_run_${process.pid}_${randomBytes(4).toString('hex')}.node-test.ts`)

/** The case the pattern picks, in the planted file. */
const PICKED = 'the case the pattern picks'

/** The variable the planted case writes the runner's arguments to. */
const THE_ARGUMENTS_GO_TO = 'PLANTED_ARGUMENTS_GO_TO'

/** The variable a planted case writes the environment it ran with to. */
const THE_ENVIRONMENT_GOES_TO = 'PLANTED_ENVIRONMENT_GOES_TO'

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

/** The entry point as an owner or a member uses it here: through the npm script, with the arguments after its own `--`. */
function theSingleFileRun(args: readonly string[], env: NodeJS.ProcessEnv): Ran {
  return theRunIn(repository, args, env)
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

/** Whether a word is one of the three that bound every run (martha#56), in the form the test script states them. */
const isABound = (word: string): boolean =>
  word === FORCE_EXIT_FLAG || word === GUARD_FLAG || word.startsWith(`${TIMEOUT_FLAG}=`)

/**
 * The run's arguments are the test script's own, word for word: what `testRunFlagsOf` reads out of package.json is what
 * node received, and nothing else that bounds a run came through with it.
 */
function theArgumentsAreTheSuite(written: string): void {
  const words = theArgumentsNodeGot(written)
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

/** The entry point, at the path both repositories keep it. */
const THE_RUNNER = 'prove_the_relay_loads/run_the_tests_of_one_file.sh'

/** The bounds a throwaway repository's test script states: the test's own number, never this repository's. */
const THE_BOUNDS_THE_TEST_STATES = 61234

/** Two names a throwaway repository's test script unsets. Two, because `env -u A B` takes B for the command. */
const A_PLANTED_NAME_TO_UNSET = 'A_PLANTED_NAME_TO_UNSET'
const ANOTHER_PLANTED_NAME_TO_UNSET = 'ANOTHER_PLANTED_NAME_TO_UNSET'

/** Where the run asks for the test script's words, and where a throwaway's reader that fails is planted instead. */
const THE_READER_PATH = 'prove_the_core/the_words_one_run_gets.ts'

/** The reader's own answers, kept beside a failing one so the one a throwaway plants still says the command. */
const THE_ANSWERING_READER = 'prove_the_core/the_words_one_run_gets_that_answers.ts'

/** The glob the throwaway repository's own test script runs. */
const THE_THROWAWAY_GLOB = 'prove_the_core/**/*.node-test.ts'

/** The throwaway repository's planted file: the one case its glob picks, recording its arguments and its environment. */
const THE_THROWAWAY_PLANTED = `prove_the_core/planted_for_the_throwaway_${randomBytes(4).toString('hex')}.node-test.ts`

/** The case the throwaway repository runs, written with this test's own bounds and names, never the repository's. */
const THE_THROWAWAY_FILE = `import { readFileSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'

test('the one case a throwaway script selects', () => {
  writeFileSync(process.env['${THE_ENVIRONMENT_GOES_TO}'], JSON.stringify({
    '${A_PLANTED_NAME_TO_UNSET}': process.env['${A_PLANTED_NAME_TO_UNSET}'] ?? null,
    '${ANOTHER_PLANTED_NAME_TO_UNSET}': process.env['${ANOTHER_PLANTED_NAME_TO_UNSET}'] ?? null,
  }))
  writeFileSync(process.env['${THE_ARGUMENTS_GO_TO}'], readFileSync('/proc/' + process.ppid + '/cmdline'))
})
`

/** Every file the single-file run reads, at the path it reads it from, so a copy of it runs anywhere. */
const THE_FILES_THE_RUN_READS = [
  THE_RUNNER,
  THE_READER_PATH,
  'prove_the_core/declared_in_package_json.ts',
  'prove_the_core/every_test_run_ends.ts',
  'prove_the_core/fail_a_test_file_that_leaves_something_running.ts',
  'prove_the_core/every_test_file_cleans_up.ts',
  // The guard gives each file its own directories, and what it needs for that is the machine's own temporary directory
  // and the removal that opens a read-only folder first (martha#724).
  'src/host_contract/host_contract.ts',
  'src/serve_the_relay_to_a_launch/relay_copy.ts',
] as const

/**
 * A test script of a throwaway repository: its bounds and its two unsets stated there, once, as a repository's are. The
 * unsets are two `env -u <name>` pairs, which is the shape `testCommandsOf` reads as two names; a script that spelled
 * them `env -u A -u B` would leave the second pair in the command's own words, where the run would pass it on.
 */
const theThrowawayTestScript = (): string =>
  `env -u ${A_PLANTED_NAME_TO_UNSET} env -u ${ANOTHER_PLANTED_NAME_TO_UNSET} node --test ` +
  `${TIMEOUT_FLAG}=${THE_BOUNDS_THE_TEST_STATES} ${FORCE_EXIT_FLAG} ${GUARD_FLAG} '${THE_THROWAWAY_GLOB}'`

/** A reader that answers `stage` from the one beside it and fails to say the names the test script unsets. */
const THE_READER_THAT_FAILS_ON_THE_UNSETS = `import { spawnSync } from 'node:child_process'
import process from 'node:process'

const THE_ANSWERING_READER = './${THE_ANSWERING_READER}'

if (process.argv[2] === 'unsets') {
  console.error('a reader that cannot say the names the test script unsets')
  process.exitCode = 1
} else {
  process.exitCode = spawnSync(process.execPath, [THE_ANSWERING_READER, ...process.argv.slice(2)], { stdio: 'inherit' }).status ?? 1
}
`

/** How a throwaway repository is planted: its test script, and whether its reader fails the names it is asked for. */
interface Throwaway {
  readonly testScript: string
  readonly readerFailsOnTheUnsets?: true
}

/**
 * A repository of its own under `where`: the single-file run's files at the paths it expects, a test script that states
 * bounds and two unsets this repository never states, and one case its glob picks. Answers the planted file's path as a
 * member spells it, from the repository's top — never the temporary directory's own spelling, which CI reaches through
 * a link (the runner reads a path against the repository it runs in).
 */
function theThrowawayRepository(where: string, planted: Throwaway): string {
  const manifest = { name: 'a-run-of-one-file', private: true, type: 'module', scripts: { test: planted.testScript, 'test:file': THE_RUNNER } }
  writeFileSync(join(where, 'package.json'), JSON.stringify(manifest, null, 2))
  for (const file of THE_FILES_THE_RUN_READS) {
    const there = join(where, file)
    mkdirSync(dirname(there), { recursive: true })
    copyFileSync(join(repository, file), there)
  }
  chmodSync(join(where, THE_RUNNER), 0o755)
  if (planted.readerFailsOnTheUnsets === true) {
    copyFileSync(join(where, THE_READER_PATH), join(where, THE_ANSWERING_READER))
    writeFileSync(join(where, THE_READER_PATH), THE_READER_THAT_FAILS_ON_THE_UNSETS)
  }
  writeFileSync(join(where, THE_THROWAWAY_PLANTED), THE_THROWAWAY_FILE)
  const made = spawnSync('git', ['init', '--quiet', where], { encoding: 'utf8' })
  assert.equal(made.status, 0, `${NAME}: a throwaway repository could not be made: ${made.stderr}`)
  return THE_THROWAWAY_PLANTED
}

/** The single-file run in a repository of its own, with the caller's arguments after the npm script's own `--`. */
function theRunIn(where: string, args: readonly string[], env: NodeJS.ProcessEnv): Ran {
  const ran = spawnSync('npm', ['run', '--silent', 'test:file', '--', ...args], {
    cwd: where,
    encoding: 'utf8',
    env: withoutTheTestContext(env),
    timeout: THE_RUNS_BOUND_MS,
  })
  return { status: ran.status, output: `${ran.stdout ?? ''}${ran.stderr ?? ''}` }
}

test('#723: the run takes its bounds and its unsets from the test script it runs, never from this repository (mutant: the bounds written as literals)', (t) => {
  const where = mkdtempSync(join(tmpdir(), 'martha-single-file-throwaway-'))
  t.after(() => removeTheTree(where))
  const planted = theThrowawayRepository(where, { testScript: theThrowawayTestScript() })
  const written = join(where, 'the-arguments')
  const seen = join(where, 'the-environment')
  const plantedInTheEnvironment = {
    [THE_ARGUMENTS_GO_TO]: written,
    [THE_ENVIRONMENT_GOES_TO]: seen,
    [A_PLANTED_NAME_TO_UNSET]: 'planted here, so a run that keeps it is seen to keep it',
    [ANOTHER_PLANTED_NAME_TO_UNSET]: 'planted here too',
  }
  const ran = theRunIn(where, [planted], { ...process.env, ...plantedInTheEnvironment })
  assert.equal(ran.status, 0, `${NAME}: the throwaway repository's single-file run failed:\n${ran.output}`)
  assert.match(ran.output, /^ℹ fail 0$/m, `${NAME}: the throwaway repository's run failed a case:\n${ran.output}`)

  const expected = testRunFlagsOf(manifestOf(where))
  assert.ok(
    expected.includes(`${TIMEOUT_FLAG}=${THE_BOUNDS_THE_TEST_STATES}`),
    `${NAME}: the throwaway test script states no ${TIMEOUT_FLAG}=${THE_BOUNDS_THE_TEST_STATES}, so this check would prove nothing`,
  )
  const received = theArgumentsNodeGot(written).filter(isABound)
  assert.deepEqual(
    received,
    expected,
    `${NAME}: the run did not take its bounds from the test script it ran. Node received ${received.join(' ') || 'none'}; that script states ${expected.join(' ')}`,
  )

  const kept = JSON.parse(readFileSync(seen, 'utf8')) as Record<string, string | null>
  assert.deepEqual(
    kept,
    { [A_PLANTED_NAME_TO_UNSET]: null, [ANOTHER_PLANTED_NAME_TO_UNSET]: null },
    `${NAME}: the run did not unset every name its test script unsets; the file it ran saw ${JSON.stringify(kept)}`,
  )
})

test('#723: a reader that cannot say what the test script unsets refuses the run, it does not run without them (mutant: the read fails open)', (t) => {
  const where = mkdtempSync(join(tmpdir(), 'martha-single-file-unreadable-'))
  t.after(() => removeTheTree(where))
  const planted = theThrowawayRepository(where, { testScript: theThrowawayTestScript(), readerFailsOnTheUnsets: true })
  const written = join(where, 'the-arguments')
  const ran = theRunIn(where, [planted], { ...process.env, [THE_ARGUMENTS_GO_TO]: written })
  assert.equal(ran.status, 2, `${NAME}: a run whose names could not be read was not refused:\n${ran.output}`)
  assert.match(ran.output, /could not be asked for the names the tests run without/, `${NAME}: the refusal did not name the read that failed:\n${ran.output}`)
  assert.equal(existsSync(written), false, `${NAME}: the run went on without the names its test script unsets`)
})

test('#723: a test script whose command cannot be read is refused by name, never run (mutant: the read fails open)', (t) => {
  const where = mkdtempSync(join(tmpdir(), 'martha-single-file-no-command-'))
  t.after(() => removeTheTree(where))
  const planted = theThrowawayRepository(where, { testScript: 'node ./prove_the_core/every_test_file_cleans_up.ts' })
  const ran = theRunIn(where, [planted], process.env)
  assert.equal(ran.status, 2, `${NAME}: a test script with no command to read was not refused:\n${ran.output}`)
  assert.match(ran.output, /the test script runs no command with --test/, `${NAME}: the refusal did not say why the read failed:\n${ran.output}`)
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

test('#753: every module the single-file run copies imports only node\'s own modules and the files copied with it', () => {
  // The copy has no node_modules: a module that imports a package fails there, as typescript once did here (martha#753).
  const modules = THE_FILES_THE_RUN_READS.filter((file) => file.endsWith('.ts'))
  const beyond = modules.flatMap((file) =>
    ts.preProcessFile(readFileSync(join(repository, file), 'utf8'), true, true).importedFiles
      .map((imported) => imported.fileName)
      .filter((name) => !name.startsWith('node:') && !(THE_FILES_THE_RUN_READS as readonly string[]).includes(join(dirname(file), name)))
      .map((name) => `${file} imports ${name}`))
  assert.deepEqual(beyond, [], 'a module the single-file run copies imports what the copy does not hold')
})
