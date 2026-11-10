// A run the probe could not wait for is stopped, whole (martha#179). `spawnSync` kills its direct
// child and nothing else, so the rows that start the host under `sh -c` left the host alive: it
// wrote its project folder, and its session, after the probe had taken both away.
//
// These runs are the shape that failed -- a shell that stays, with a process under it -- and they
// are cheap: no host, just `sleep`. What is held to account is that the wait's end leaves nothing
// of the group behind.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { runTheHost, stopTheProcessesLeftIn } from './stop_a_host_that_outlives_the_run.ts'

/** A scratch of the test's own, and the file the run's group is named in. */
function aScratch(): { readonly dir: string; readonly pid_file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'martha-probe-test-'))
  return { dir, pid_file: join(dir, 'host-group') }
}

/** Whether any process of the group the run led is still there. */
function theGroupIsThere(pid_file: string): boolean {
  try {
    process.kill(-Number(readFileSync(pid_file, 'utf8').trim()), 0)
    return true
  } catch {
    return false
  }
}

test('a host that outlives the wait is killed whole, with the process under its shell (#179)', (t) => {
  const scratch = aScratch()
  t.after(() => rmSync(scratch.dir, { recursive: true, force: true }))

  // The `sh` stays, so the process it starts is the one a kill of the direct child would leave.
  const run = runTheHost('sh', ['-c', 'sleep 30 & sleep 31'], {
    cwd: scratch.dir,
    env: { PATH: process.env.PATH ?? '' },
    timeout_ms: 300,
    pid_file: scratch.pid_file,
  })

  assert.equal(run.timedOut, true)
  assert.equal(run.status, null)
  assert.match(run.error ?? '', /ETIMEDOUT/)
  assert.equal(theGroupIsThere(scratch.pid_file), false, 'the group the run led is still alive')
})

test('a host that finishes on its own is waited for, and its group is not touched (#179)', (t) => {
  const scratch = aScratch()
  t.after(() => rmSync(scratch.dir, { recursive: true, force: true }))

  const run = runTheHost('sh', ['-c', 'printf ok'], {
    cwd: scratch.dir,
    env: { PATH: process.env.PATH ?? '' },
    timeout_ms: 30_000,
    pid_file: scratch.pid_file,
  })

  assert.equal(run.timedOut, false)
  assert.equal(run.status, 0)
  assert.equal(run.error, undefined)
  assert.equal(run.stdout?.toString('utf8'), 'ok')
  assert.equal(theGroupIsThere(scratch.pid_file), false)
})

test('a process the group kill cannot reach is reached by the scratch it works in (#179)', async (t) => {
  const scratch = aScratch()
  t.after(() => rmSync(scratch.dir, { recursive: true, force: true }))
  // A session of its own, as a row that starts the host under `setsid` does: a kill of any
  // group this probe leads would miss it, and it works in the run's scratch all the same.
  const left = spawn('setsid', ['sh', '-c', 'sleep 30'], { cwd: scratch.dir, stdio: 'ignore', detached: true })
  left.unref()
  t.after(() => {
    try {
      process.kill(-(left.pid ?? 0), 'SIGKILL')
    } catch {
      // Already gone.
    }
  })
  await new Promise((resolve) => setTimeout(resolve, 200))

  const killed = stopTheProcessesLeftIn(scratch.dir)

  assert.ok(killed.length > 0, 'nothing was killed, so the process was left behind')
  assert.throws(() => process.kill(left.pid ?? 0, 0), 'the process is still there after the sweep')
})
