// When the bell rings, and what it carries (martha#313, tests 6 and 7).
//
// A bell that rings on every beat is a bell the owner turns off, and one that carries raw text is a terminal a stranger
// can steer. These tests pin both: it rings on the change into "needs you" and nowhere else, and what it carries is
// base64 and only base64.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OWNER } from '../declare_crew/declare_crew.ts'
import { BEAT_INTERVAL_MS } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { takeAnOwnerDialog, type RaisingADialog } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { NO_BELLS, NOTIFICATION_ENDING, NOTIFICATION_OPENING, theBellsFor, THE_BELL, type TheBellsSwitch } from './ring_the_owner.ts'

const BOTH: TheBellsSwitch = { bell: true, notify: true }

function row(at = 100): DashboardRow {
  return {
    member: 'Vesta',
    session: 'a-session',
    at,
    state: 'working',
    holds: 'macula-io/martha#313',
    task: 'Build the owner dialogs',
    progress: { step: 1, of: 4 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: '', contextPercent: 12, costUsd: 0.4 },
  }
}

const A_PERMISSION: RaisingADialog = { kind: 'permission', agent: '', tool: 'Edit', input: { file_path: 'a' } }

/** The row asking for a permission, as the launcher would write it at `at`. */
const asking = (at: number): DashboardRow => takeAnOwnerDialog(row(at), { change: 'opened', at, raised: A_PERMISSION })

test('ten beats while the host is asking ring the bell once (test 6)', () => {
  const first = asking(200)
  assert.notEqual(theBellsFor(row(), first, BOTH, true), '', 'the change into needs you rings')
  const rang: string[] = []
  let held = first
  for (let beat = 0; beat < 10; beat += 1) {
    const next = takeAnOwnerDialog(held, { change: 'opened', at: first.at + BEAT_INTERVAL_MS * (beat + 1), raised: A_PERMISSION })
    const bytes = theBellsFor(held, next, BOTH, true)
    if (bytes !== '') rang.push(bytes)
    held = next
  }
  assert.deepEqual(rang, [], 'the row still needs the owner, and nothing rings again for it')
})

test('the bell rings again on the next change into needs you, and never on the way out (test 6)', () => {
  const first = asking(200)
  const answered = takeAnOwnerDialog(first, { change: 'closed', at: 300, key: theKeyOfThePermission() })
  assert.equal(theBellsFor(first, answered, BOTH, true), '', 'a dialog closing rings nothing')
  const again = takeAnOwnerDialog(answered, { change: 'opened', at: 400, raised: A_PERMISSION })
  assert.notEqual(theBellsFor(answered, again, BOTH, true), '', 'being asked a second time rings again')
})

test('a member\'s own report that it waits on the owner rings nothing (test 6)', () => {
  const waiting = { ...row(200), state: 'waiting' as const, waits: { on: OWNER, for: 'a yes', since: 200 } }
  assert.equal(theBellsFor(row(), waiting, BOTH, true), '', 'the bell is the host\'s word, not a member\'s report')
})

test('with both bells off, or no terminal of the owner\'s, nothing is written (test 7)', () => {
  const first = asking(200)
  assert.equal(theBellsFor(row(), first, NO_BELLS, true), '', 'both off writes nothing')
  assert.equal(theBellsFor(row(), first, BOTH, false), '', 'a member started without the owner\'s terminal rings nothing')
})

test('each bell can be had without the other (test 7)', () => {
  const first = asking(200)
  assert.equal(theBellsFor(row(), first, { bell: true, notify: false }, true), THE_BELL, 'the bell alone is the one byte')
  const notify = theBellsFor(row(), first, { bell: false, notify: true }, true)
  assert.equal(notify.startsWith(NOTIFICATION_OPENING), true, 'the notification alone opens the sequence')
  assert.equal(notify.endsWith(NOTIFICATION_ENDING), true, 'and ends it')
})

test('what the notification carries is base64, so no server\'s text can end the sequence early (test 4)', () => {
  const question = 'a\u001b]0;x\u0007b'
  const asked = takeAnOwnerDialog(row(200), { change: 'opened', at: 200, raised: { kind: 'elicitation', server: 'mesh', question, id: 'e-1' } })
  const bytes = theBellsFor(row(), asked, { bell: false, notify: true }, true)
  const carried = bytes.slice(NOTIFICATION_OPENING.length, -NOTIFICATION_ENDING.length)
  assert.equal(/^[A-Za-z0-9+/]*={0,2}$/.test(carried), true, 'the payload is base64 and nothing else')
  assert.equal(Buffer.from(carried, 'base64').toString('utf8'), 'mesh asks: a]0;xb', 'and it says what the row says, with what a terminal acts on gone')
})

/** The key of the one permission these tests open, as the dialogs slice builds it. */
function theKeyOfThePermission(): string {
  const held = asking(200).dialogs ?? []
  return held[0]?.key ?? ''
}
