// The owner's screen as a member's launcher keeps it: the row written, and the bell rung on the change it makes
// (martha#313, tests 1, 6 and 7).
//
// The row's shape is ../show_dashboard_beat's, the words ../tell_the_owner_a_session_waits's and the bytes
// ../ring_the_owner's. What is pinned here is what joining them does: the member's own report survives a dialog, the
// bell rings once on the change into "needs you", a store that refuses the write rings nothing, and a member with no
// terminal rings nothing.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { theBellsFor } from '../ring_the_owner/ring_the_owner.ts'
import { IDLE, theRowWithNothingSaid, type DashboardRow, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { whatTheOwnerIsShown } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { theOwnersScreen, type AnOwnersScreen } from './the_owners_screen.ts'

/** A store that keeps one member's row in memory, and can be told to refuse what it is given. */
function aStore(held: DashboardRow | null = null, refusing = false): DashboardStore & { readonly kept: DashboardRow[] } {
  const kept: DashboardRow[] = []
  let row = held
  return {
    kept,
    read: () => row,
    keep: (beat) => {
      if (refusing) return { kept: false, why: 'the store refused it' }
      row = beat
      kept.push(beat)
      return { kept: true }
    },
    all: () => (row === null ? {} : { [row.member]: row }),
  }
}

/** A screen over `store`, writing the bell's bytes into `wrote`, with the switches as given. */
function aScreen(store: DashboardStore, wrote: string[], bells = { bell: true, notify: false }, onTheOwnersTerminal = true): AnOwnersScreen {
  return { beats: store, member: 'Vesta', bells, onTheOwnersTerminal, write: (bytes) => void wrote.push(bytes) }
}

/** The row a member reported before the host asked anything. */
function aReportedRow(): DashboardRow {
  return {
    ...theRowWithNothingSaid(),
    member: 'Vesta',
    session: 'a-session',
    at: 10,
    state: 'working',
    holds: 'macula-io/martha#313',
    task: 'Build the owner dialogs',
    progress: { step: 3, of: 7 },
    needs: 'my own words',
  }
}

const A_PERMISSION = { tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'rm -rf build' } }

test('a dialog leaves the member\'s own report alone, and the row reads needs you while it is open (test 1)', () => {
  const store = aStore(aReportedRow())
  const wrote: string[] = []
  const screen = theOwnersScreen(aScreen(store, wrote))
  screen.heard('a-session', { said: 'permission', call: A_PERMISSION }, 20)
  const row = store.read('Vesta')
  assert.ok(row !== null)
  assert.equal(row.state, 'working', 'the member is still working, in its own words')
  assert.equal(row.task, 'Build the owner dialogs')
  assert.equal(row.needs, 'my own words')
  assert.equal(row.dialogs?.length, 1)
  assert.deepEqual(whatTheOwnerIsShown(row), { state: 'needs-you', needs: 'permission for Bash' })
  assert.equal(wrote.length, 1, 'the bell rings once, on the change into needs you')
  assert.equal(wrote[0], theBellsFor(aReportedRow(), row, { bell: true, notify: false }, true))
})

test('the call that runs clears the row back to exactly what the member said, and rings nothing (test 1, test 6)', () => {
  const store = aStore(aReportedRow())
  const wrote: string[] = []
  const screen = theOwnersScreen(aScreen(store, wrote))
  screen.heard('a-session', { said: 'checked', call: { id: 'toolu_1', ...A_PERMISSION } }, 20)
  screen.heard('a-session', { said: 'permission', call: A_PERMISSION }, 21)
  wrote.length = 0
  screen.heard('a-session', { said: 'ran', call: { id: 'toolu_1', ...A_PERMISSION } }, 22)
  const row = store.read('Vesta')
  assert.ok(row !== null)
  assert.equal(row.dialogs, undefined, 'no dialogs are left on the row at all')
  assert.deepEqual(whatTheOwnerIsShown(row), { state: 'working', needs: 'my own words' })
  assert.deepEqual(wrote, [], 'a bell rings on the change into needs you, never on the way out')
})

test('ten beats while a dialog is open ring the bell once (test 6)', () => {
  const store = aStore(aReportedRow())
  const wrote: string[] = []
  const screen = theOwnersScreen(aScreen(store, wrote))
  screen.heard('a-session', { said: 'permission', call: A_PERMISSION }, 20)
  for (let beat = 1; beat <= 10; beat++) screen.heard('a-session', { said: 'notification', type: 'idle_prompt', message: `beat ${beat}` }, 20 + beat)
  assert.equal(wrote.length, 1)
})

test('a bell switched off writes nothing, and a member with no terminal of the owner\'s writes nothing (test 7)', () => {
  for (const [bells, terminal] of [
    [{ bell: false, notify: false }, true],
    [{ bell: true, notify: false }, false],
  ] as const) {
    const store = aStore(aReportedRow())
    const wrote: string[] = []
    const screen = theOwnersScreen(aScreen(store, wrote, bells, terminal))
    screen.heard('a-session', { said: 'permission', call: A_PERMISSION }, 20)
    assert.equal(store.read('Vesta')?.dialogs?.length, 1, 'the row still says the owner is needed')
    assert.deepEqual(wrote, [])
  }
})

test('a store that refuses the row rings nothing, because the owner sees nothing to ring about', () => {
  const store = aStore(aReportedRow(), true)
  const wrote: string[] = []
  theOwnersScreen(aScreen(store, wrote)).heard('a-session', { said: 'permission', call: A_PERMISSION }, 20)
  assert.deepEqual(wrote, [])
  assert.equal(store.kept.length, 0)
})

test('before the member has reported, a dialog writes a row of its own: idle, and the host\'s ask on it', () => {
  const store = aStore(null)
  theOwnersScreen(aScreen(store, [])).heard('a-session', { said: 'permission', call: A_PERMISSION }, 20)
  const row = store.read('Vesta')
  assert.ok(row !== null)
  assert.equal(row.member, 'Vesta')
  assert.equal(row.session, 'a-session')
  assert.equal(row.state, IDLE)
  assert.deepEqual(whatTheOwnerIsShown(row), { state: 'needs-you', needs: 'permission for Bash' })
})

test('a turn\'s start drops a dialog an earlier turn left open, and the row reads what the member said', () => {
  const store = aStore(aReportedRow())
  const wrote: string[] = []
  const screen = theOwnersScreen(aScreen(store, wrote))
  screen.heard('a-session', { said: 'permission', call: A_PERMISSION }, 20)
  screen.heard('a-session', { said: 'turn-started' }, 30)
  const row = store.read('Vesta')
  assert.ok(row !== null)
  assert.deepEqual(whatTheOwnerIsShown(row), { state: 'working', needs: 'my own words' })
})
