// A run's record, and where it lives (martha#802).
//
// `npm run test:mine` writes one record per run, and `npm run stop:my-run` reads it to know which process group to stop
// and nothing else. This holds the three things both commands depend on, each failing by name: the root follows the
// per-user runtime directory and falls back to the system's own temporary directory, never TMPDIR (which differs between
// the processes of a test, and would leave the stopper looking where no run is); a token's directory is the owner's own
// and so is the record inside it; and the two commands that ask for the root answer the same place, from two processes
// whose TMPDIRs differ.
//
// Every case plants its own runtime directory under the temp directory and removes it, so no record outlives the test.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { SYSTEM_TEMPORARY_DIRECTORY } from '../src/drive_the_recorded_host/short_relay_root.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

import {
  A_RECORDS_MODE,
  A_TOKEN_DIRECTORYS_MODE,
  RECORDS_DIRECTORY,
  RECORD_FILE,
  aNewToken,
  everyRecord,
  readTheRecord,
  recordTheRun,
  removeTheRecord,
  theRecordPathOf,
  theRunsRoot,
  theTokensRecorded,
  writeTheRecord,
} from './the_record_of_a_test_run.ts'

const NAME = 'the_record_of_a_test_run'

/** The command a member runs, at the path it lives at. */
const THE_CLI = join(import.meta.dirname, 'the_record_of_a_test_run.ts')

/** A scratch directory under the temp directory, removed once the test has run. */
function aScratch(t: TestContext, name: string): string {
  const at = mkdtempSync(join(tmpdir(), `martha-802-record-${name}-`))
  t.after(() => removeTheTree(at))
  return at
}

/** Puts back every variable a test touches once it has run, whatever the test did to it. */
function restoredAfter(t: TestContext, names: readonly string[]): void {
  const was = names.map((name) => [name, process.env[name]] as const)
  t.after(() => {
    for (const [name, value] of was) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}

/** The environment this process has, without the names a test plants itself. */
const theEnvironmentWithout = (names: readonly string[]): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !names.includes(name)))

/** The command, run as a member runs it. */
function theCli(args: readonly string[], planted: Record<string, string>): { status: number | null; output: string } {
  const ran = spawnSync(process.execPath, [THE_CLI, ...args], {
    encoding: 'utf8',
    env: { ...theEnvironmentWithout(['XDG_RUNTIME_DIR', 'TMPDIR']), ...planted },
    timeout: 60_000,
  })
  return { status: ran.status, output: `${ran.stdout ?? ''}${ran.stderr ?? ''}` }
}

/** A record planted for `pid`, its directory removed when the test ends. */
function aPlantedRecord(t: TestContext, pid: number, worktree: string, identity: string): string {
  const record = { token: aNewToken(), pid, identity, worktree, started_at: new Date().toISOString() }
  writeTheRecord(record)
  t.after(() => removeTheRecord(record.token))
  return record.token
}

test('#802: the records live under the per-user runtime directory', (t) => {
  const runtime = aScratch(t, 'runtime')
  restoredAfter(t, ['XDG_RUNTIME_DIR'])
  process.env.XDG_RUNTIME_DIR = runtime
  assert.equal(theRunsRoot(), join(runtime, RECORDS_DIRECTORY), `${NAME}: the root did not follow an absolute XDG_RUNTIME_DIR`)
})

test('#802: the fallback is the system\'s temporary directory, and never TMPDIR (mutant: the fallback reads TMPDIR)', (t) => {
  const elsewhere = aScratch(t, 'elsewhere')
  restoredAfter(t, ['XDG_RUNTIME_DIR', 'TMPDIR'])
  for (const without of [undefined, 'a/relative/path']) {
    if (without === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = without
    process.env.TMPDIR = elsewhere
    assert.equal(
      theRunsRoot(),
      join(SYSTEM_TEMPORARY_DIRECTORY, RECORDS_DIRECTORY),
      `${NAME}: XDG_RUNTIME_DIR ${without ?? 'unset'} did not fall back to the system's own temporary directory`,
    )
  }
})

test('#802: a token\'s directory is the owner\'s own, and so is the record inside it (mutant: the mode dropped)', (t) => {
  const runtime = aScratch(t, 'modes')
  restoredAfter(t, ['XDG_RUNTIME_DIR'])
  process.env.XDG_RUNTIME_DIR = runtime
  const record = recordTheRun(process.pid, realpathSync(runtime))
  t.after(() => removeTheRecord(record.token))
  const directory_mode = statSync(join(runtime, RECORDS_DIRECTORY, record.token)).mode & 0o777
  assert.equal(directory_mode, A_TOKEN_DIRECTORYS_MODE, `${NAME}: the token's directory is ${directory_mode.toString(8)}, not 0700`)
  const record_mode = statSync(theRecordPathOf(record.token)).mode & 0o777
  assert.equal(record_mode, A_RECORDS_MODE, `${NAME}: the record is ${record_mode.toString(8)}, not 0600`)
})

test('#802: a record names the run\'s leader, the identity it held, and the checkout that started it', (t) => {
  const runtime = aScratch(t, 'round-trip')
  const worktree = aScratch(t, 'round-trip-checkout')
  restoredAfter(t, ['XDG_RUNTIME_DIR'])
  process.env.XDG_RUNTIME_DIR = runtime
  const record = recordTheRun(process.pid, realpathSync(worktree))
  t.after(() => removeTheRecord(record.token))
  assert.deepEqual(readTheRecord(record.token), record, `${NAME}: the record read back is not the record written`)
  assert.equal(record.pid, process.pid, `${NAME}: the record does not name the process it was written for`)
  assert.ok(record.identity !== '', `${NAME}: the record holds no identity, so a reused pid could not be refused`)
})

test('#802: no record, no token, and no record under a token, each answered by name', (t) => {
  const runtime = aScratch(t, 'absent')
  restoredAfter(t, ['XDG_RUNTIME_DIR'])
  process.env.XDG_RUNTIME_DIR = runtime
  assert.equal(readTheRecord('0000000000000000'), undefined, `${NAME}: a token with no record was read as one`)
  assert.deepEqual(theTokensRecorded(), [], `${NAME}: an empty root listed a token`)
  assert.deepEqual(everyRecord(), [], `${NAME}: an empty root listed a record`)
})

test('#802: two commands that saw different TMPDIRs find the same record (mutant: the root restated in the stopper)', (t) => {
  const first = aScratch(t, 'tmpdir-one')
  const second = aScratch(t, 'tmpdir-two')
  const worktree = realpathSync(aScratch(t, 'tmpdir-checkout'))
  const written = theCli(['record', String(process.pid), worktree], { TMPDIR: first })
  assert.equal(written.status, 0, `${NAME}: the record command failed:\n${written.output}`)
  const token = written.output.trim()
  t.after(() => removeTheTree(join(theRunsRoot(), token)))
  const asked = theCli(['path'], { TMPDIR: second })
  assert.equal(asked.status, 0, `${NAME}: the path command failed:\n${asked.output}`)
  const root = asked.output.trim()
  assert.equal(root, join(SYSTEM_TEMPORARY_DIRECTORY, RECORDS_DIRECTORY), `${NAME}: the path command answered ${root}`)
  assert.ok(existsSync(join(root, token, RECORD_FILE)), `${NAME}: a record written under one TMPDIR was not found by a call under another`)
})

test('#802: the path and the list answer every record the root holds', (t) => {
  const runtime = aScratch(t, 'listed')
  restoredAfter(t, ['XDG_RUNTIME_DIR'])
  process.env.XDG_RUNTIME_DIR = runtime
  const first = aPlantedRecord(t, process.pid, '/one', 'an-identity')
  mkdirSync(join(runtime, RECORDS_DIRECTORY, 'a-token-with-no-record'), { recursive: true })
  const listed = theCli(['list'], { XDG_RUNTIME_DIR: runtime })
  assert.equal(listed.status, 0, `${NAME}: the list command failed:\n${listed.output}`)
  assert.match(listed.output, new RegExp(`^${first} ${process.pid} /one$`, 'm'), `${NAME}: the list did not name the record it holds:\n${listed.output}`)
  assert.doesNotMatch(listed.output, /a-token-with-no-record/, `${NAME}: the list named a token with no record`)
  assert.equal(readFileSync(theRecordPathOf(first), 'utf8').includes(first), true, `${NAME}: the record's own file does not hold its token`)
})
