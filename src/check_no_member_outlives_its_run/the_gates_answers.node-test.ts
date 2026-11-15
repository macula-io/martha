// The gate's own answers (martha#472): what it exits with when it cannot look, and what it says over a kernel that
// holds no member of a run's.
//
// A runner holds no members, so the gate's quiet answer proves nothing on its own: that it BITES is
// find_a_member_a_run_left_behind's and linux_process_identity's, over readings and over this machine. What is pinned
// here is the gate's wiring — that it reads the kernel it is given, reports every line of it, and answers 0, 1 or 2.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'

const GATE = join(import.meta.dirname, 'main.ts')

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

test('a kernel that holds no member of a run is answered 0, with the one process it could not read counted (martha#472)', () => {
  const place = scratch()
  try {
    // A kernel whose one process of this user is this test itself, with an environment the reader cannot have: the
    // gate looked, said so, and nothing it found fails it.
    mkdirSync(join(place.path, 'self'), { recursive: true })
    writeFileSync(join(place.path, 'self', 'status'), 'Name:\tself\n')
    mkdirSync(join(place.path, String(process.pid)), { recursive: true })
    writeFileSync(join(place.path, String(process.pid), 'stat'), `${process.pid} (martha-472) R 1 1 1 0 -1\n`)
    const { status, err } = ranOver(place.path)
    assert.equal(status, 0, err)
    assert.match(err, new RegExp(`process ${process.pid} could not be read \\(ENOENT\\)`))
    assert.match(err, /check_no_member_outlives_its_run: no member outlives a run, and 1 process\(es\) of yours it could not read/)
  } finally {
    place.remove()
  }
})
