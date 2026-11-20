// What a launch end reads of this machine (#693): the group the kernel held, the boot's own moment, and a start in
// ticks. These run against a planted /proc, never against this machine: the promise is that a kill about to be sent to a
// group can be told what it ends, and that a list the kernel will not give is unreadable rather than empty.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import type { LaunchMade } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { bootTimeMsUnder, cleanUpIfTheLauncherEnds, processesInGroupUnder, startedAtMs } from './what_a_launch_end_reads.ts'

/** A synthetic start, never a real one: this repository is public. */
const STARTED = '900100'

const scratch = (t: TestContext): string => {
  const dir = mkdtempSync(join(tmpdir(), 'martha-an-end-'))
  t.after(() => removeTheTree(dir))
  return dir
}

/** A /proc of our own where each process names its group and its command line (#693). */
function aProcOfGroups(t: TestContext, processes: readonly { pid: number; group: number; line?: string }[]): string {
  const root = scratch(t)
  for (const one of processes) {
    const fields_after_command = Array.from({ length: 20 }, (_, index) => `${index + 3}`)
    fields_after_command[2] = String(one.group)
    fields_after_command[19] = STARTED
    mkdirSync(join(root, String(one.pid)))
    writeFileSync(join(root, String(one.pid), 'stat'), `${one.pid} (a shell) ${fields_after_command.join(' ')}\n`)
    if (one.line !== undefined) writeFileSync(join(root, String(one.pid), 'cmdline'), `${one.line.split(' ').join('\u0000')}\u0000`)
  }
  writeFileSync(join(root, 'stat'), `cpu 1 2 3\nbtime ${String(BOOT_SECONDS)}\n`)
  return root
}

/** The boot's own moment, in seconds, as /proc/stat writes it. */
const BOOT_SECONDS = 1_794_000_000

test('#693: a group is the processes whose group id is its own, with the line the machine held, and no kernel thread', (t) => {
  const root = aProcOfGroups(t, [
    { pid: 501, group: 500, line: 'node --test a_runner.mjs src/' },
    { pid: 502, group: 500, line: 'sh -c sleep 600' },
    { pid: 503, group: 501, line: 'git status' },
    { pid: 504, group: 500 },
  ])
  const read = processesInGroupUnder(root, 500)
  assert.ok('commands' in read)
  assert.deepEqual(read.commands.map((one) => one.pid).sort(), [501, 502])
  assert.equal(read.commands.find((one) => one.pid === 501)?.command_line, 'node --test a_runner.mjs src/')
  assert.equal(read.commands.find((one) => one.pid === 502)?.start_ticks, STARTED)
})

test('#693: a group on a kernel that will not list its processes is unreadable, never "nothing was running"', () => {
  const read = processesInGroupUnder(join(tmpdir(), 'no-proc-at-all-of-ours'), 500)
  assert.ok('unreadable' in read)
})

test('#693: the boot moment and a start in ticks make a moment on the machine clock, at this machine\'s own tick', (t) => {
  const root = aProcOfGroups(t, [])
  assert.equal(bootTimeMsUnder(root), BOOT_SECONDS * 1000)
  const ticks_per_second = 100
  assert.equal(startedAtMs(String(ticks_per_second), BOOT_SECONDS * 1000, ticks_per_second), (BOOT_SECONDS + 1) * 1000)
  assert.equal(bootTimeMsUnder(join(tmpdir(), 'no-proc-at-all-of-ours')), null)
})

test('a launcher that exits first keeps the member\'s transcripts after the relay and before the snapshot (martha#646, D1)', () => {
  const order: string[] = []
  const made = {
    relayDirectory: { remove: (): void => void order.push('relay-directory') },
    keepTranscripts: (): void => void order.push('keep-transcripts'),
    removeSnapshot: (): void => void order.push('snapshot'),
  } as unknown as LaunchMade
  // The group kill is handed in: a reaped pid's group can belong to another process by the time this runs, and killing
  // it would signal a group that is nobody's here (martha#646 r=1, nit 2).
  const before = new Set(process.listeners('exit'))
  const off = cleanUpIfTheLauncherEnds(4242, made, (killed) => void order.push(`killed ${String(killed)}`))
  const added = process.listeners('exit').filter((one) => !before.has(one))
  try {
    assert.equal(added.length, 1, 'the launcher\'s end registered no exit handler, or more than one')
    added[0]!(0)
    assert.deepEqual(order, ['killed 4242', 'relay-directory', 'keep-transcripts', 'snapshot'],
      'the keep does not sit between the relay and the snapshot, so the snapshot goes with what the host wrote still in it')
  } finally {
    off()
  }
  assert.deepEqual(process.listeners('exit').filter((one) => !before.has(one)), [], 'the handler was left registered')
})
