// Every recorded-host case is run by the relay job and counted there (martha#385), and the check bites.
//
// The plants are test files as text, judged by the same function the tree is: each finding is made to happen once, by
// name. The spellings a plant needs are built from the check's own constants, so this file carries none of them
// itself and the tree test below never counts it.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

import { DEFAULT_CONFIG_DIR } from '../claude_code_host/settings_env_reaching_servers.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'

import { describe, judgeTheRuns, MARKER, type RecordedHostRun, type TestFile } from './check_every_recorded_host_test_is_run.ts'
import { readTheRuns, readTheTestFiles, runsFrom } from './read_the_runs_and_the_tests.ts'
import { recordedHost, whyNoRunUnder } from './recorded_host_skip.ts'

const REPOSITORY = join(import.meta.dirname, '..', '..')

/** A test case that drives the recorded host, as a test file writes it. */
const aMarkedCase = (name: string): string => `test('${name}', { skip: ${MARKER} }, async () => {})\n`

/** A test case that drives nothing. */
const anOrdinaryCase = (name: string): string => `test('${name}', async () => {})\n`

const FILE = 'src/a_slice/a_slice.node-test.ts'
const aRun = (cases: number, file = FILE): RecordedHostRun => ({ file, cases, proves: 'a slice holds on the recorded host' })
const aFile = (text: string, path = FILE): TestFile => ({ path, text })

const said = (runs: readonly RecordedHostRun[], files: readonly TestFile[]): string[] => judgeTheRuns(runs, files).map(describe)

test('a file whose marked cases the list counts exactly passes, beside files that drive nothing', () => {
  const files = [aFile(aMarkedCase('one') + aMarkedCase('two') + anOrdinaryCase('three')), aFile(anOrdinaryCase('x'), 'src/b/b.node-test.ts')]
  assert.deepEqual(said([aRun(2)], files), [])
})

test('a file with a marked case and no entry in the list is named, with its count', () => {
  const [finding] = said([aRun(1)], [aFile(aMarkedCase('one')), aFile(aMarkedCase('new'), 'src/b/b.node-test.ts')])
  assert.match(finding ?? '', /^src\/b\/b\.node-test\.ts: 1 case\(s\) skip on RECORDED_HOST_SKIP and .* does not list the file/)
})

test('a second marked case in a file the list counts once is named, with both numbers', () => {
  assert.deepEqual(said([aRun(1)], [aFile(aMarkedCase('one') + aMarkedCase('a second'))]).length, 1)
  assert.match(said([aRun(1)], [aFile(aMarkedCase('one') + aMarkedCase('a second'))])[0] ?? '', new RegExp(`^${FILE}: 2 case\\(s\\) skip .* counts 1;`))
})

test('a file split over two name patterns is counted as the sum of its entries', () => {
  const runs = [{ ...aRun(1), name_pattern: 'one' }, { ...aRun(1), name_pattern: 'two' }]
  assert.deepEqual(said(runs, [aFile(aMarkedCase('one') + aMarkedCase('two'))]), [])
})

test('an entry for a file that is not there, or that has no marked case, is named', () => {
  assert.match(said([aRun(1, 'src/gone/gone.node-test.ts')], [])[0] ?? '', /^src\/gone\/gone\.node-test\.ts: listed in .* no such test file$/)
  assert.match(said([aRun(1)], [aFile(anOrdinaryCase('one'))])[0] ?? '', new RegExp(`^${FILE}: 0 case\\(s\\) skip .* counts 1;`))
})

test('an entry with no case to run is named, whatever the file holds', () => {
  assert.match(said([aRun(0)], [aFile(anOrdinaryCase('one'))])[0] ?? '', new RegExp(`^${FILE}: listed in .* with no case to run`))
  assert.match(said([aRun(1.5)], [aFile(aMarkedCase('one'))])[0] ?? '', /with no case to run/)
})

test('a test file reading the variable itself is named, since its cases would not carry the marker', () => {
  const direct = `const host = process.env[${'RECORDED_HOST_VARIABLE'}]\n`
  assert.match(said([], [aFile(direct)])[0] ?? '', new RegExp(`^${FILE}: reads process\\.env`))
})

test('a skip text that names a CI job in its own words is named by file and line', () => {
  const promise = `${anOrdinaryCase('one')}test('two', { skip: ${"'needs the host, which the host CI job sets'"} }, async () => {})\n`
  assert.deepEqual(said([], [aFile(promise)]), [
    `${FILE}:2: a skip text names a CI job in words of its own; only ${MARKER} may say where a case runs, because only it is checked`,
  ])
})

test('a list that is not a list of runs cannot be read, rather than reading as no runs', () => {
  assert.throws(() => runsFrom({}), /is not a list of runs/)
  assert.throws(() => runsFrom([]), /is not a list of runs/)
  assert.throws(() => runsFrom([{ file: FILE, cases: '1', proves: 'x' }]), /entry 0 is not/)
  assert.throws(() => runsFrom([aRun(1), { file: FILE, cases: 1 }]), /entry 1 is not/)
  assert.throws(() => runsFrom([{ ...aRun(1), name_pattern: 3 }]), /entry 0 is not/)
  assert.deepEqual(runsFrom([aRun(1)]), [aRun(1)])
})

test('every test case that drives the recorded host is one the relay job runs, and is counted there', () => {
  const findings = judgeTheRuns(readTheRuns(REPOSITORY), readTheTestFiles(REPOSITORY)).map(describe)
  assert.deepEqual(findings, [], findings.join('\n'))
})

// --- a run under a folder the host asks about (martha#383) --------------------------------------------------------

test('a checkout folder with the host config segment is refused, naming the folder and TMPDIR; a look-alike is not', () => {
  const folder = join(sep, 'home', 'someone', DEFAULT_CONFIG_DIR, 'sessions', 'tmp')
  const why = whyNoRunUnder(folder) ?? ''
  assert.ok(why.includes(folder), why)
  assert.match(why, /Set TMPDIR to a folder outside/)
  assert.equal(whyNoRunUnder(join(sep, 'tmp', `${DEFAULT_CONFIG_DIR}-not`, `not${DEFAULT_CONFIG_DIR}`)), undefined)
})

test('the recorded host is refused before any host starts when TMPDIR sits under the host config segment', (t) => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'martha-383-')))
  const inside = join(outside, DEFAULT_CONFIG_DIR, 'tmp')
  mkdirSync(inside, { recursive: true })
  const before = process.env['TMPDIR']
  t.after(() => {
    if (before === undefined) delete process.env['TMPDIR']
    else process.env['TMPDIR'] = before
    removeTheTree(outside)
  })
  process.env['TMPDIR'] = inside
  assert.throws(() => recordedHost(), (error: Error) => error.message === whyNoRunUnder(inside))
  process.env['TMPDIR'] = outside
  assert.doesNotThrow(() => recordedHost())
})
