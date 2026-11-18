// The gate's own answers (martha#658 part 3), over state roots this test keeps windows in through the crew's own store
// and the window's own steps, never by writing a window's JSON by hand: a member whose session lost its crew tools and
// worked on is named and fails the gate; the same member once a later session holds the tools again passes it; a file
// that holds no window fails it as a place it could not tell about; a place the store refuses, and a state root it
// cannot read, are checks that could not be made; and a machine with no state root is a clean reading that makes nothing.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import type { CrewPlace, ServedToolsHeld } from '../host_contract/host_contract.ts'
import { CREWS_PLACE, crewStateDirectory } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { keepTheCrewsFilesAsDirectories } from '../keep_the_crews_files_as_directories/keep_the_crews_files_as_directories.ts'
import {
  aShellLineCounted,
  aTurnCounted,
  CREW_TOOLS_PLACE,
  keepTheWindow,
  theNoticeOf,
  theWindowStep,
  type ACrewToolsWindow,
} from '../keep_a_members_crew_tools_window/keep_a_members_crew_tools_window.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'

const GATE = join(import.meta.dirname, 'main.ts')
const NAME = 'check_no_member_works_without_its_crew_tools'

const MEMBER = 'Vesta'
const LOST_SESSION = 'session-that-lost-them'
const LATER_SESSION = 'session-that-holds-them'
const LOST_AT = Date.parse('2026-11-18T01:07:00.000Z')
const BACK_AT = Date.parse('2026-11-18T03:20:00.000Z')

/** The fact a session reads when the host withdrew the served tools, and the one it reads once they are held again. */
const WITHDRAWN: ServedToolsHeld = { state: 'withdrawn', at: LOST_AT, cause_neutral: true, causes: ['left_the_configuration'], failed_servers: 1 }
const HELD: ServedToolsHeld = { state: 'held', at: BACK_AT }

/** The gate over one state root, as it ran: its status and its error stream, where every line goes. */
const ranOver = (state_root: string) => {
  const run = spawnSync(process.execPath, [GATE, '--state-root', state_root], { encoding: 'utf8' })
  return { status: run.status, err: run.stderr }
}

/** A directory this test takes away with everything it made, the state root inside it, and the checkout the crew is keyed by. */
function scratch() {
  const path = mkdtempSync(join(tmpdir(), 'martha-658-gate-'))
  return { state_root: join(path, 'state'), checkout: path, remove: () => removeTheTree(path) }
}

/** The crew's windows place under a state root, made by the crew's own store as the launcher makes it. */
function theWindowsPlace(state_root: string, checkout: string): CrewPlace {
  const crew = crewStateDirectory(state_root, checkout)
  if ('refusal' in crew) throw new Error(crew.refusal)
  const place = keepTheCrewsFilesAsDirectories(crew.path).place(CREW_TOOLS_PLACE)
  if ('refusal' in place) throw new Error(place.refusal)
  return place
}

/** The step's window, or a failure: each fixture takes a step that must change the window. */
function steppedTo(step: ReturnType<typeof theWindowStep>): ACrewToolsWindow {
  if (step.step === 'none') throw new Error('the fixture took a step that changed nothing')
  return step.window
}

/** Kept, or a failure: the fixture's window must be in the place for the gate to read it. */
function kept(place: CrewPlace, window: ACrewToolsWindow): ACrewToolsWindow {
  const refused = keepTheWindow(place, window)
  if (refused !== undefined) throw new Error(refused.refusal)
  return window
}

/** The window of a member whose session lost the tools and worked on: two turns, a push and a merge in one line, then a push. */
function aLostMembersWindow(place: CrewPlace): ACrewToolsWindow {
  let window = steppedTo(theWindowStep(undefined, WITHDRAWN, MEMBER, LOST_SESSION, null))
  for (const counted of [
    (w: ACrewToolsWindow) => aTurnCounted(w, LOST_SESSION),
    (w: ACrewToolsWindow) => aTurnCounted(w, LOST_SESSION),
    (w: ACrewToolsWindow) => aShellLineCounted(w, LOST_SESSION, 'git merge origin/main && git push origin topic'),
    (w: ACrewToolsWindow) => aShellLineCounted(w, LOST_SESSION, 'git push origin topic'),
  ]) {
    window = counted(window) ?? window
  }
  return kept(place, window)
}

test('a member whose session lost its crew tools and worked on fails the gate, named with what it did (martha#658)', () => {
  const run = scratch()
  try {
    const window = aLostMembersWindow(theWindowsPlace(run.state_root, run.checkout))
    assert.deepEqual([window.turns, window.pushes, window.merges], [2, 2, 1], 'the fixture counted what it says it counted')
    const { status, err } = ranOver(run.state_root)
    assert.equal(status, 1, err)
    const lines = err.trimEnd().split('\n')
    assert.deepEqual(lines, [
      `${NAME}: ${theNoticeOf(window)} 2 turn(s), 2 push(es) and 1 merge(s) tried since.`,
      `${NAME}: 1 member(s) and 0 file(s) above: a session lost its crew tools and no later session of that member holds them again`,
    ])
    assert.match(lines[0] ?? '', new RegExp(`^${NAME}: ${MEMBER} has worked without its crew tools since 2026-11-18T01:07:00.000Z \\(session ${LOST_SESSION}\\)`))
  } finally {
    run.remove()
  }
})

test('the same member, once a later session holds the tools again, passes the gate (martha#658)', () => {
  const run = scratch()
  try {
    const place = theWindowsPlace(run.state_root, run.checkout)
    const closed = kept(place, steppedTo(theWindowStep(aLostMembersWindow(place), HELD, MEMBER, LATER_SESSION, LOST_SESSION)))
    assert.equal(closed.to, BACK_AT, 'the fixture closed the window')
    const { status, err } = ranOver(run.state_root)
    assert.equal(status, 0, err)
    assert.equal(err, `${NAME}: no member works without its crew tools (read under ${run.state_root})\n`)
  } finally {
    run.remove()
  }
})

test('a file in the windows place that holds no window fails the gate as a place it could not tell about (martha#658)', () => {
  const run = scratch()
  try {
    const place = theWindowsPlace(run.state_root, run.checkout)
    writeFileSync(join(place.path, `${MEMBER}.json`), 'not a window\n', { mode: 0o600 })
    const { status, err } = ranOver(run.state_root)
    assert.equal(status, 1, err)
    assert.ok(err.includes(`${NAME}: ${join(place.path, `${MEMBER}.json`)} holds no window this check can read`), err)
    assert.ok(err.includes(`${NAME}: 0 member(s) and 1 file(s) above`), err)
  } finally {
    run.remove()
  }
})

test('a windows place the crew store refuses is a check that could not be made, never a pass (martha#658)', () => {
  const run = scratch()
  try {
    const place = theWindowsPlace(run.state_root, run.checkout)
    aLostMembersWindow(place)
    chmodSync(place.path, 0o777)
    const { status, err } = ranOver(run.state_root)
    assert.equal(status, 2, err)
    assert.match(err, new RegExp(`^${NAME}: could not be made: `))
  } finally {
    run.remove()
  }
})

// Two ways a look is stopped: the crews directory is seen but cannot be listed, and the state root cannot even be
// entered, so whether the crews directory is there at all cannot be told. Neither may read as a machine with no state.
for (const [stopped, lockedOf] of [
  ['a crews directory it cannot list', (state_root: string) => join(state_root, CREWS_PLACE)],
  ['a state root it cannot enter', (state_root: string) => state_root],
] as const) {
  test(`${stopped} is a check that could not be made, never a pass (martha#658)`, () => {
    const run = scratch()
    try {
      aLostMembersWindow(theWindowsPlace(run.state_root, run.checkout))
      const locked = lockedOf(run.state_root)
      chmodSync(locked, 0o000)
      try {
        const { status, err } = ranOver(run.state_root)
        assert.equal(status, 2, err)
        assert.match(err, new RegExp(`^${NAME}: could not be made: `))
      } finally {
        chmodSync(locked, 0o700)
      }
    } finally {
      run.remove()
    }
  })
}

test('a machine with no state root is a clean reading, and the gate makes nothing there (martha#658)', () => {
  const run = scratch()
  try {
    const { status, err } = ranOver(run.state_root)
    assert.equal(status, 0, err)
    assert.equal(existsSync(run.state_root), false, 'the gate made the state root it reads')
  } finally {
    run.remove()
  }
})
