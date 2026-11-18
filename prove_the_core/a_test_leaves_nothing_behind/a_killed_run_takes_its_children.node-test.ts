// A killed run takes its children with it (martha#683).
//
// node --test runs every test file in a child process of its own. Nothing ties that child's life to the runner's: when
// the runner is killed from outside — a tool's command timeout, a session ending, a bare `kill` — the child is
// reparented to the user's systemd and runs on, holding every descriptor it inherited. On 2026-11-18 five such children
// were found on a member's machine, one of them holding that member's crew session key, so that member could not be
// relaunched until they were stopped by hand.
//
// What ends them is endWithTheRun (every_test_run_ends.ts), which the suite's guard loads into every test file's
// process. Two tests pin the mechanism: a process started with the guard ends once the process that started it is
// gone, and the same process without the guard does not — so the first pins the guard and not the plant. A third holds
// the shape of the incident itself: a planted run's file process does not outlive the runner, with ONLY the runner
// killed.
//
// The plants are deliberately unbounded (no --test-timeout): a timeout would end a file for the wrong reason.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { test, type TestContext } from 'node:test'

import { PROC_ROOT } from '../../src/linux_process_identity/process_identity_from_proc.ts'
import { removeTheTree } from '../../src/serve_the_relay_to_a_launch/relay_copy.ts'

import { GUARD_FLAG, withoutTheTestContext } from '../a_test_run_ends/every_test_run_ends.ts'
import { parentIn } from './the_launchers_a_run_left.ts'

/** The repository this check reads, which is where the test script runs its files and holds the guard's path. */
const repository = join(import.meta.dirname, '../..')

/** The guard's path from the repository, as the flag that loads it states it. */
const GUARD_PATH = GUARD_FLAG.slice('--import='.length)

/** A test file whose one test never settles: the file's process runs until something ends it. */
const A_FILE_THAT_WAITS = "import { test } from 'node:test'\ntest('waits forever', () => new Promise(() => {}))\n"

/**
 * A process that waits forever holding an interval, saying `up` on its first line: it ends only when something ends it,
 * and the parent that starts it leaves only once that line has come, so the child is never orphaned before it starts.
 */
const A_PROCESS_THAT_WAITS = "process.stdout.write('up'); setInterval(() => undefined, 1 << 30)"

/**
 * A parent that starts one node process with `args`, waits for its first line, prints the pid of what it started, and
 * ends at once — the way a run ends when nothing is left to hold it. The child is left behind with its parent gone.
 */
const A_PARENT_THAT_LEAVES = (args: readonly string[]): string =>
  [
    "import { spawn } from 'node:child_process'",
    "import process from 'node:process'",
    `const child = spawn(process.execPath, ${JSON.stringify(args)}, { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })`,
    "child.stdout.once('data', () => process.stdout.write(String(child.pid), () => process.exit(0)))",
    '',
  ].join('\n')

/** How long a plant gets to start, and how long a process it started then gets to notice it is an orphan. */
const A_PROCESS_APPEARS_WITHIN_MS = 20_000
const A_PROCESS_ENDS_WITHIN_MS = 5_000
/** How long the control process is watched before it is called outliving its parent. */
const A_PROCESS_OUTLIVES_MS = 1_500
const POLL_MS = 50

/** A process's own stat line, or nothing when the kernel has no such process any more. */
function statOf(pid: string): string | undefined {
  try {
    return readFileSync(join(PROC_ROOT, pid, 'stat'), 'utf8')
  } catch {
    return undefined
  }
}

/** A process's command line, its arguments separated by spaces, or nothing when the kernel will not say. */
function commandLineOf(pid: string): string {
  try {
    return readFileSync(join(PROC_ROOT, pid, 'cmdline'), 'utf8').trim().split('\0').join(' ')
  } catch {
    return '(gone)'
  }
}

/** The pids this kernel lists as children of `pid`, by the parent field of each stat line. */
function childrenOf(pid: number): string[] {
  const children: string[] = []
  for (const entry of readdirSync(PROC_ROOT)) {
    if (!/^\d+$/.test(entry)) continue
    const stat = statOf(entry)
    if (stat !== undefined && parentIn(stat) === pid) children.push(entry)
  }
  return children
}

/**
 * Whether the kernel still lists `pid` as a running process. A process that has ended but not been reaped — a zombie,
 * which is what an orphan whose parent was killed becomes where nothing collects it — is gone for this check: it holds
 * nothing and can do nothing. Its state is the first field after the parenthesised command.
 */
function isRunning(pid: string): boolean {
  const stat = statOf(pid)
  if (stat === undefined) return false
  const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
  return state !== 'Z' && state !== 'X'
}

/** Waits until `seen` answers true, or the deadline passes. */
async function untilSeen(seen: () => boolean, within_ms: number): Promise<boolean> {
  const deadline = Date.now() + within_ms
  while (Date.now() < deadline) {
    if (seen()) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return seen()
}

/**
 * A node process started by a parent that ends at once, found by the pid that parent printed. A parent that ends and a
 * runner killed outright leave the same child behind: one whose parent is gone.
 */
async function aProcessLeftByItsParent(t: TestContext, args: readonly string[]): Promise<string> {
  const parent = spawn(process.execPath, ['--input-type=module', '-e', A_PARENT_THAT_LEAVES(args)], {
    cwd: repository,
    env: withoutTheTestContext(process.env),
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let said = ''
  parent.stdout.on('data', (chunk: Buffer) => void (said += chunk.toString('utf8')))
  const ended = await untilSeen(() => parent.exitCode !== null, A_PROCESS_APPEARS_WITHIN_MS)
  assert.ok(ended, 'the parent that starts the plant did not end')
  const child = said.trim()
  assert.ok(/^[1-9][0-9]*$/.test(child), `the parent that starts the plant named no child pid: ${JSON.stringify(said)}`)
  // Whatever the plant did, nothing it started outlives this test.
  t.after(() => {
    if (isRunning(child)) process.kill(Number(child), 'SIGKILL')
  })
  return child
}

test('a process started with the suite guard ends by itself once the process that started it is gone (martha#683)', async (t) => {
  const child = await aProcessLeftByItsParent(t, [`--import=./${GUARD_PATH}`, '-e', A_PROCESS_THAT_WAITS])
  const ended = await untilSeen(() => !isRunning(child), A_PROCESS_ENDS_WITHIN_MS)
  assert.ok(
    ended,
    `process ${child} (${commandLineOf(child)}) outlived its parent by more than ${A_PROCESS_ENDS_WITHIN_MS} ms with the guard loaded (endWithTheRun): a stopped run would leave it reparented to systemd --user, holding what it had open`,
  )
})

test('without the guard the same process does outlive its parent, so the check above pins the guard (martha#683)', async (t) => {
  const child = await aProcessLeftByItsParent(t, ['-e', A_PROCESS_THAT_WAITS])
  const outlived = !(await untilSeen(() => !isRunning(child), A_PROCESS_OUTLIVES_MS))
  assert.ok(outlived, `process ${child} ended without the guard, so the guarded case proves nothing about the guard`)
})

test("a planted run's file process does not outlive the runner when only the runner is killed (martha#683)", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'martha-683-a-run-'))
  t.after(() => removeTheTree(folder))
  const file = join(folder, 'a_file_that_waits.node-test.mjs')
  writeFileSync(file, A_FILE_THAT_WAITS)
  const runner = spawn(process.execPath, ['--test', '--test-isolation=process', GUARD_FLAG, file], {
    cwd: repository,
    detached: true,
    // Without what marks this process as a test file's own: with it, the planted run refuses to run its files.
    env: withoutTheTestContext(process.env),
    stdio: 'ignore',
  })
  const runner_pid = runner.pid
  assert.ok(runner_pid !== undefined, 'the planted runner started')
  t.after(() => {
    try {
      process.kill(-runner_pid, 'SIGKILL')
    } catch {
      // Nothing left in the group: what this test wants.
    }
  })
  let child = ''
  const appeared = await untilSeen(() => {
    child = childrenOf(runner_pid).find((one) => commandLineOf(one).includes(file)) ?? ''
    return child !== ''
  }, A_PROCESS_APPEARS_WITHIN_MS)
  assert.ok(appeared, `the planted run started no process for ${file} within ${A_PROCESS_APPEARS_WITHIN_MS} ms`)
  process.kill(runner_pid, 'SIGKILL')
  const ended = await untilSeen(() => !isRunning(child), A_PROCESS_ENDS_WITHIN_MS)
  assert.ok(
    ended,
    `the file's process ${child} (${commandLineOf(child)}) outlived its runner by more than ${A_PROCESS_ENDS_WITHIN_MS} ms: it would be reparented to systemd --user and run on, as five did on 2026-11-18`,
  )
})
