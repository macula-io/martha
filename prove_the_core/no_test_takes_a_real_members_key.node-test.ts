// Nothing a test starts may take a real member's key (martha#683).
//
// The rule is no_test_takes_a_real_members_key.ts. Two things prove it: no source the suite runs names the crew's home,
// and a file run through the suite's own flags holds no session record — neither open nor handed to it in its
// environment. Each is proved to bite: a planted source that names the home is named by line, and a planted process
// that is handed a record is named by the record.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

import { FORCE_EXIT_FLAG, GUARD_FLAG, TIMEOUT_FLAG, withoutTheTestContext } from './every_test_run_ends.ts'
import {
  isASessionRecord,
  linesNamingTheCrewsHome,
  sessionRecordsHeld,
  THE_CREWS_HOME,
  type WhatAProcessHeld,
} from './no_test_takes_a_real_members_key.ts'

/** The repository this check reads, which is where the test script runs its files and holds the guard's path. */
const repository = join(import.meta.dirname, '..')

/** The folders whose sources the suite runs: the tests and everything they import. */
const THE_SUITE_RUNS = ['src', 'prove_the_core', 'architecture', 'carry_marthas_own_node', 'rehearse_a_release'] as const

/** The variable that tells the planted file where to write what it held. */
const WRITE_WHAT_YOU_HELD = 'MARTHA_683_WHAT_I_HELD'

/** A file that writes every descriptor it holds and its whole environment where the variable names, and passes. */
const A_FILE_THAT_WRITES_WHAT_IT_HELD = `
import { readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import process from 'node:process'

test('writes what it held', () => {
  const descriptors = readdirSync('/proc/self/fd').flatMap((one) => {
    try {
      return [readlinkSync('/proc/self/fd/' + one)]
    } catch {
      return []
    }
  })
  writeFileSync(process.env['${WRITE_WHAT_YOU_HELD}'], JSON.stringify({ descriptors, environment: process.env }))
})
`

/** A path from the crew's home a process may be handed as if it were a session record. */
const A_RECORD = join(THE_CREWS_HOME, '00000000-0000-4000-8000-000000000000.json')

/** Every tracked source of the folders the suite runs, with its path. */
function theSuiteSources(): Array<{ readonly path: string; readonly text: string }> {
  const listed = spawnSync('git', ['-C', repository, 'ls-files', ...THE_SUITE_RUNS], { encoding: 'utf8' })
  assert.equal(listed.status, 0, `git ls-files failed: ${listed.stderr}`)
  return listed.stdout
    .split('\n')
    .filter((path) => path.endsWith('.ts') || path.endsWith('.mjs') || path.endsWith('.js'))
    .map((path) => ({ path, text: readFileSync(join(repository, path), 'utf8') }))
}

test("no source the suite runs names the crew's home, so no test can reach a member's session record (martha#683)", () => {
  const named = theSuiteSources().flatMap((source) =>
    linesNamingTheCrewsHome(source.text).map((line) => `${source.path}:${line} names ${THE_CREWS_HOME}`),
  )
  assert.deepEqual(named, [], "a source the tests run names the crew's home: a test must build its own paths, under tmpdir() or a home it made")
})

test('a source that names the home is named by file and line, so the check above bites (martha#683)', () => {
  const planted = `const where = '${THE_CREWS_HOME}/a.json'\nconst fine = 'a path of its own'\n`
  assert.deepEqual(linesNamingTheCrewsHome(planted), [1])
  assert.deepEqual(linesNamingTheCrewsHome('const fine = "a path of its own"\n'), [])
})

test("a record is a JSON file directly in the crew's home and nothing deeper or looser (martha#683)", () => {
  assert.equal(isASessionRecord(A_RECORD), true)
  assert.equal(isASessionRecord(join(THE_CREWS_HOME, 'a-folder', 'a.json')), false, 'a file deeper than the home is no record')
  assert.equal(isASessionRecord(join(THE_CREWS_HOME, 'a-folder')), false, 'a directory in the home is no record')
  assert.equal(isASessionRecord(join(THE_CREWS_HOME, 'notes.txt')), false, 'only a JSON file is a record')
})

test("a file run through the suite's flags holds no member's session record, open or handed to it (martha#683)", (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'martha-683-what-it-held-'))
  t.after(() => removeTheTree(folder))
  const file = join(folder, 'what_it_held.node-test.mjs')
  const held = join(folder, 'held.json')
  writeFileSync(file, A_FILE_THAT_WRITES_WHAT_IT_HELD)
  const ran = spawnSync(
    process.execPath,
    ['--test', `${TIMEOUT_FLAG}=60000`, FORCE_EXIT_FLAG, GUARD_FLAG, file],
    { cwd: repository, env: { ...withoutTheTestContext(process.env), [WRITE_WHAT_YOU_HELD]: held }, encoding: 'utf8' },
  )
  assert.equal(ran.status, 0, `the planted file did not pass: ${ran.stdout}\n${ran.stderr}`)
  const what: WhatAProcessHeld = JSON.parse(readFileSync(held, 'utf8')) as WhatAProcessHeld
  assert.deepEqual(
    sessionRecordsHeld(what),
    [],
    "a test's process held a member's crew session record: it was open, or handed over in the environment",
  )
})

test("a process handed a record is named by it, so the check above bites (martha#683)", () => {
  assert.deepEqual(sessionRecordsHeld({ descriptors: [A_RECORD], environment: {} }), [A_RECORD])
  assert.deepEqual(sessionRecordsHeld({ descriptors: [], environment: { A_KEY: A_RECORD } }), [A_RECORD])
  assert.deepEqual(sessionRecordsHeld({ descriptors: ['/etc/hosts', '/dev/null'], environment: { HOME: '/home/synthetic/member' } }), [])
})
