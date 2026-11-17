// The gate's own answers (martha#472): what it exits with when it cannot look, and what it says over a kernel it is
// handed.
//
// A runner holds no members, so the gate's quiet answer proves nothing on its own: that it BITES on a member a run left
// behind is find_a_member_a_run_left_behind's (over readings handed in) and read_a_kernel_and_a_home's (over this
// machine's own kernel, with a real child, a real record and this gate's own entry point). What is pinned here is the
// gate's wiring: that it reads the kernel it is given — every answer from that one tree — reports every line of it, and
// answers 0, 1 or 2.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'

const GATE = join(import.meta.dirname, 'main.ts')

/** A boot id, as the kernel under a tree writes one. */
const BOOT = '3f2a1b4c-0000-4000-8000-000000000000'

/** The pid namespace both the tree's reader and its one process are in. */
const NAMESPACE = 'pid:[4026531836]'

/** The gate over one kernel, as it ran: its status and both streams. */
const ranOver = (proc_root: string) => {
  const run = spawnSync(process.execPath, [GATE, '--proc', proc_root], { encoding: 'utf8' })
  return { status: run.status, out: run.stdout, err: run.stderr }
}

/** A directory this test takes away with everything it made. */
function scratch(): { readonly path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'martha-472-gate-'))
  return { path, remove: () => removeTheTree(path) }
}

/** What a process's `stat` line holds, with `ticks` where field 22 is: when the kernel says it started. */
const statLineOf = (pid: number, ticks: number): string => `${pid} (martha-472) R ${['1', '1', '1', '0', '-1'].join(' ')} ${Array.from({ length: 14 }, () => '0').join(' ')} ${ticks}\n`

/** A kernel under `root` that holds exactly one process of this user: this test, with an environment it cannot have. */
function aKernelHoldingThisTest(root: string): void {
  mkdirSync(join(root, 'sys', 'kernel', 'random'), { recursive: true })
  writeFileSync(join(root, 'sys', 'kernel', 'random', 'boot_id'), `${BOOT}\n`)
  mkdirSync(join(root, 'self', 'ns'), { recursive: true })
  writeFileSync(join(root, 'self', 'status'), 'Name:\tself\n')
  symlinkSync(NAMESPACE, join(root, 'self', 'ns', 'pid'))
  const held = join(root, String(process.pid))
  mkdirSync(join(held, 'ns'), { recursive: true })
  writeFileSync(join(held, 'stat'), statLineOf(process.pid, 192080865))
  writeFileSync(join(held, 'status'), `Name:\tmartha-472\nNSpid:\t${process.pid}\n`)
  symlinkSync(NAMESPACE, join(held, 'ns', 'pid'))
  // No `environ` at all: the environment the reader is after cannot be had.
}

test('a place that is not a /proc cannot be read, and the gate says so rather than passing (martha#472)', () => {
  const place = scratch()
  try {
    const { status, err } = ranOver(place.path)
    assert.equal(status, 2)
    assert.match(err, /could not be made: .* is not a \/proc this reader can read/)
  } finally {
    place.remove()
  }
})

test('a kernel holding no member of a run is answered 0, with the process it could not read counted (martha#472)', () => {
  const place = scratch()
  try {
    aKernelHoldingThisTest(place.path)
    const { status, err } = ranOver(place.path)
    assert.equal(status, 0, err)
    assert.match(err, new RegExp(`process ${process.pid} could not be read \\(ENOENT\\), so a member of yours cannot be ruled out among it`))
    assert.match(err, /check_no_member_outlives_its_run: no member outlives a run, and 1 process\(es\) of yours it could not read/)
  } finally {
    place.remove()
  }
})
