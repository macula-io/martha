// A run on a pseudo-terminal that is stopped ends whole (martha#724).
//
// `script` runs its command in a session of its own, so killing `script`'s process group left the command's session
// running: a launcher in it made its folders again in a runtime its run had just removed. Here a command leaves a
// process in its session that outlives the terminal's hang-up, the way a launcher being torn down does, and the run is
// stopped while it runs: nothing may be left in that session, and the run's directory must be gone.

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { PROC_ROOT, processesInSessionsUnder, sessionIn } from '../linux_process_identity/process_identity_from_proc.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { spawnOnAPtyHoldingALifeline, THE_COMMANDS_SESSION_ENDS_MS } from './keep_the_lifeline_in.ts'

/** The program that puts a command on a pseudo-terminal, as the recorded-host driver runs it. */
const PTY_RUNNER = 'script'

/** How often the case looks for the process its command leaves. */
const LOOK_MS = 20

/** SIGKILL to a process the case started, which the case requires gone already. */
function killIfThere(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Gone already, as the case requires.
  }
}

test("a stopped run on a pseudo-terminal leaves no process in its command's session, and its directory goes (martha#724)", async (t) => {
  const runtime = mkdtempSync(join(tmpdir(), 'martha-pty-run-'))
  const stray_file = join(runtime, 'stray')
  // Outlives every wait the run's end makes, so only a kill can end it.
  const outlives_the_end = (3 * THE_COMMANDS_SESSION_ENDS_MS) / 1000
  const command = `trap '' HUP; sleep ${outlives_the_end} & echo $! > '${stray_file}'; wait`
  const { terminal, end } = spawnOnAPtyHoldingALifeline(PTY_RUNNER, command, { cwd: runtime, env: process.env }, runtime)
  let stray: number | undefined
  t.after(() => {
    for (const pid of [stray, terminal.pid]) if (pid !== undefined) killIfThere(pid)
    if (existsSync(runtime)) removeTheTree(runtime)
  })
  const until = Date.now() + THE_COMMANDS_SESSION_ENDS_MS
  while (!existsSync(stray_file) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, LOOK_MS))
  stray = Number(readFileSync(stray_file, 'utf8').trim())
  const session = sessionIn(readFileSync(join(PROC_ROOT, String(stray), 'stat'), 'utf8'))
  assert.ok(session !== null && session !== terminal.pid, `the command's process is in a session of its own, not script's: ${session}`)
  assert.deepEqual(processesInSessionsUnder(PROC_ROOT, [session]).includes(stray), true, 'the stray process runs in the command session before the run ends')

  await end()

  assert.deepEqual(processesInSessionsUnder(PROC_ROOT, [session]), [], `the command's session ${session} still runs after its run ended`)
  assert.equal(existsSync(runtime), false, "the run's directory is still there")
})
