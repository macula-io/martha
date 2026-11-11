// A member on the owner's terminal is held until the launcher has recorded it
// (martha#94).
//
// The launcher learns the member's pid from the job-control shell, through its
// event loop. Before #94 the member ran at once, so on a busy machine it could
// do its work and exit before the launcher read who held that pid, and the
// launcher refused a member it had started as "no process is running" (seen:
// the member had read its line and exited 3 ms before /proc/<pid> was read,
// which answered ENOENT). A member that exits at once makes that certain, so
// these tests need no clock.
//
// Run off a terminal: the shell's fg then has no terminal to hand over, which
// changes nothing about when the member runs.

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { linuxProcessIdentities } from '../linux_process_identity/process_identity_from_proc.ts'
// One namespace, so a test of a name the module lacks fails by its own name.
import * as onTheTerminal from './member_on_the_owners_terminal.ts'
import { removeTheTree } from './relay_copy.ts'

/** A member that leaves a mark and exits at once: it is gone as soon as it may run. */
function markThenExit(t: TestContext): { readonly command: string; readonly args: readonly string[]; readonly mark: string } {
  const dir = mkdtempSync(join(tmpdir(), 'martha-94-job-'))
  t.after(() => removeTheTree(dir))
  const mark = join(dir, 'ran')
  return { command: '/bin/sh', args: ['-c', `: > '${mark}'`], mark }
}

const ENV = { PATH: process.env.PATH }

test('a member that exits at once is still its pid\'s process when the launcher reads who holds that pid (#94)', async (t) => {
  const member = markThenExit(t)
  let identity: string | null | undefined
  let ranFirst: boolean | undefined
  const job = onTheTerminal.startForegroundJob(member.command, member.args, { cwd: tmpdir(), env: ENV }, (pid) => {
    identity = linuxProcessIdentities.identityOf(pid)
    ranFirst = existsSync(member.mark)
    return { admitted: true }
  })
  const shellEnded = new Promise<number | null>((resolve) => job.shell.once('exit', (code) => resolve(code)))
  const start = await job.member
  assert.ok('pid' in start, 'the shell said the member\'s pid')
  assert.equal(await shellEnded, 0, 'the admitted member ran and ended by itself')
  // Before #94 nothing was read while the member was held, and the launcher read
  // the pid here, once it had it: the member had already exited.
  const read = identity ?? linuxProcessIdentities.identityOf(start.pid)
  assert.notEqual(read, null, 'the kernel answered for the member\'s pid when the launcher read it')
  assert.equal(ranFirst, false, 'the member had not run before the launcher read its pid')
  assert.ok(existsSync(member.mark), 'once admitted, the member ran')
})

test('a member the launcher does not admit never runs, and the shell ends saying so (#94)', async (t) => {
  const member = markThenExit(t)
  let asked = 0
  const job = onTheTerminal.startForegroundJob(member.command, member.args, { cwd: tmpdir(), env: ENV }, () => {
    asked += 1
    return { admitted: false }
  })
  const shellEnded = new Promise<number | null>((resolve) => job.shell.once('exit', (code) => resolve(code)))
  const start = await job.member
  assert.ok('pid' in start)
  assert.deepEqual(start.admission, { admitted: false })
  assert.equal(await shellEnded, onTheTerminal.NOT_ADMITTED)
  assert.equal(asked, 1, 'the launcher is asked once, with the member\'s pid')
  assert.equal(existsSync(member.mark), false, 'the member never ran')
})

test('a launcher that throws while the member is held does not admit it (#94)', async (t) => {
  const member = markThenExit(t)
  const job = onTheTerminal.startForegroundJob(member.command, member.args, { cwd: tmpdir(), env: ENV }, () => {
    throw new Error('the record could not be written')
  })
  const shellEnded = new Promise<number | null>((resolve) => job.shell.once('exit', (code) => resolve(code)))
  const start = await job.member
  assert.ok('refusal' in start)
  assert.match(start.refusal, /the record could not be written/)
  assert.equal(await shellEnded, onTheTerminal.NOT_ADMITTED)
  assert.equal(existsSync(member.mark), false, 'the member never ran')
})
