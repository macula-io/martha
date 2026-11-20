// Nothing a test starts may take a real member's key (martha#683).
//
// The rule is no_test_takes_a_real_members_key.ts. Three things prove it:
//
//   - no source the suite runs names the crew's home, whether it writes the path out or builds it the way sources do;
//   - a file run through the suite's own flags holds no session record, neither open nor handed to it in its
//     environment;
//   - a launched member's environment, read back from the kernel's /proc/<pid>/environ, carries neither the crew state a
//     test planted in its own environment nor a session id the crew recorded.
//
// Each is proved to bite: a planted source is named by line, a planted process is named by the record it was handed, and
// a planted environment is named for each of the two things it may carry.

import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'
import { STATE_HOME_VARIABLE } from '../../src/refuse_launch_of_unapproved_config/the_crews_state_a_member_is_kept_out_of.ts'
import { theEnvironmentAMemberIsGiven } from '../../src/launch_a_claude_code_member/the_environment_a_member_is_given.ts'
import { CLAUDE_CODE } from '../../src/know_claude_codes_own_facts/claude_code_facts.ts'
import { BILLED_BY_SUBSCRIPTION } from '../../src/declare_crew/declare_crew.ts'
import { STATE_ROOT_NAME, CREWS_PLACE } from '../../src/keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { streamDirectoryNameOf } from '../../src/row_streams_directory/row_streams_directory.ts'
import { sessionRecordStreamOf } from '../../src/session_records_in_rows/session_records_in_rows.ts'

import { FORCE_EXIT_FLAG, GUARD_FLAG, TIMEOUT_FLAG, withoutTheTestContext } from '../a_test_run_ends/every_test_run_ends.ts'
import {
  isASessionRecord,
  linesNamingTheCrewsHome,
  plantedCrewStateHeld,
  sessionRecordsHeld,
  THE_CREWS_HOME,
  type WhatAProcessHeld,
} from './no_test_takes_a_real_members_key.ts'

/** The repository this check reads, which is where the test script runs its files and holds the guard's path. */
const repository = join(import.meta.dirname, '../..')

/** The folders whose sources the suite runs: the tests and everything they import. */
const THE_SUITE_RUNS = ['src', 'prove_the_core', 'architecture', 'carry_marthas_own_node', 'rehearse_a_release'] as const

/** The variable that tells the planted file where to write what it held. */
const WRITE_WHAT_YOU_HELD = 'MARTHA_683_WHAT_I_HELD'

/** The variable a launched process is handed, so the kernel's record of its environment can be told from its parent's. */
const WHAT_I_WAS_GIVEN = 'MARTHA_683_WHAT_I_WAS_GIVEN'

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

/** The environment the kernel records for `pid`, or undefined while it has none for that process yet. */
function theEnvironmentIn(pid: number): Record<string, string> | undefined {
  try {
    const entries = readFileSync(`/proc/${pid}/environ`, 'utf8')
      .split('\0')
      .filter((entry) => entry.includes('='))
      .map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)] as const)
    return Object.fromEntries(entries)
  } catch {
    return undefined
  }
}

/** The environment a process really was started with, read from the kernel, once the marker it was handed shows. */
async function theEnvironmentOf(pid: number, marker: string): Promise<Record<string, string>> {
  for (let tries = 0; tries < 500; tries += 1) {
    const held = theEnvironmentIn(pid)
    if (held !== undefined && held[marker] !== undefined) return held
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`/proc/${pid}/environ never showed ${marker}`)
}

test("no source the suite runs names the crew's home, so no test can reach a member's session record (martha#683)", () => {
  const named = theSuiteSources().flatMap((source) =>
    linesNamingTheCrewsHome(source.text).map((line) => `${source.path}:${line} names ${THE_CREWS_HOME}`),
  )
  assert.deepEqual(named, [], "a source the tests run names the crew's home: a test must build its own paths, under tmpdir() or a home it made")
})

test('a source that names the home is named by file and line, however it writes it, so the check above bites (martha#683)', () => {
  // The parts are spelled here and joined below, so the check's own source does not hold the strings it scans for.
  const A_REAL_HOME_CALL = 'homedir()'
  const THE_CREWS_FOLDER = "'crew'"
  const A_STATE_ROOTS_CALL = 'stateRootOf'
  const planted = [
    'const fine = "a path of its own"',
    `const expanded = '${THE_CREWS_HOME}/a.json'`,
    `const built = join(${A_REAL_HOME_CALL}, '.claude', ${THE_CREWS_FOLDER})`,
    `const asked = ${A_STATE_ROOTS_CALL}(${A_REAL_HOME_CALL}, undefined)`,
    `const mine = join(tmpdir(), 'a-home-i-made', '.claude', ${THE_CREWS_FOLDER})`,
  ].join('\n')
  assert.deepEqual(linesNamingTheCrewsHome(planted), [2, 3, 4], 'a source that builds the home, or asks a real state root, was not named')
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

test("a launched member is handed neither the crew state a test planted in its own environment nor a session id the crew recorded (martha#683)", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'martha-683-launch-home-'))
  t.after(() => removeTheTree(home))
  // What the test process itself holds: a state home of its own, and the stream a session of its is recorded in.
  const planted = join(home, 'a-state-home-the-test-planted')
  const plantedRecord = join(planted, STATE_ROOT_NAME, CREWS_PLACE, 'a-crew', 'rows', streamDirectoryNameOf(sessionRecordStreamOf(randomUUID())))
  // Where the launch keeps its own crew state, and the session it has recorded there: one stream per session, under the
  // names the row store really gives them.
  const crewStateRoot = join(home, 'the-crews-state', STATE_ROOT_NAME)
  const rows = join(crewStateRoot, CREWS_PLACE, 'a-crew', 'rows')
  const sessionId = randomUUID()
  mkdirSync(join(rows, streamDirectoryNameOf(sessionRecordStreamOf(sessionId))), { recursive: true })

  const inherited: Record<string, string> = {
    HOME: home,
    [STATE_HOME_VARIABLE]: planted,
    MARTHA_683_PLANTED_RECORD: plantedRecord,
    MARTHA_683_PLANTED_SESSION: sessionId,
    [WHAT_I_WAS_GIVEN]: 'given',
  }
  // The member's environment is built by the one function a launch builds it with, and nothing is filtered out of it
  // here: what the kernel records below is exactly what a member is handed.
  const given = theEnvironmentAMemberIsGiven({
    inherited,
    switches: { args: [], env: {}, env_dropped: [] },
    crew: { state_root: crewStateRoot, rows },
    member_config: join(home, 'a-member-config-folder'),
    host: CLAUDE_CODE,
    billing: BILLED_BY_SUBSCRIPTION,
  })
  const member = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { env: given, stdio: 'ignore' })
  t.after(() => {
    member.kill('SIGKILL')
  })
  assert.ok(member.pid !== undefined, 'the planted process did not start')

  const held = await theEnvironmentOf(member.pid, WHAT_I_WAS_GIVEN)
  assert.deepEqual(
    plantedCrewStateHeld({ descriptors: [], environment: held }, { state_home: planted, session_id: sessionId }),
    [],
    "a launched member was handed the crew's state root or a session id the crew recorded",
  )
  assert.equal(
    held[STATE_HOME_VARIABLE],
    dirname(crewStateRoot),
    "the member is handed the launcher's own state home, never one it inherited",
  )
})

test('a launched process handed either of the two is named by it, so the check above bites (martha#683)', () => {
  const planted = { state_home: '/a-state-home-the-test-planted', session_id: '00000000-0000-4000-8000-000000000000' }
  const root = join(planted.state_home, STATE_ROOT_NAME)
  assert.deepEqual(plantedCrewStateHeld({ descriptors: [], environment: { [STATE_HOME_VARIABLE]: planted.state_home } }, planted), [
    planted.state_home,
  ])
  assert.deepEqual(plantedCrewStateHeld({ descriptors: [], environment: { A_KEY: join(root, CREWS_PLACE, 'c', 'rows', 'a.json') } }, planted), [
    join(root, CREWS_PLACE, 'c', 'rows', 'a.json'),
  ])
  assert.deepEqual(plantedCrewStateHeld({ descriptors: [], environment: { A_KEY: planted.session_id } }, planted), [planted.session_id])
  assert.deepEqual(plantedCrewStateHeld({ descriptors: [], environment: { HOME: '/home/synthetic/member' } }, planted), [])
})
