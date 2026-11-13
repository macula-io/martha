// What the row says while the host is asking the owner something (martha#313, tests 1 to 4).
//
// The row is one whole beat and its store keeps it whole (../show_dashboard_beat); what is pinned here is what this
// slice does to it: a dialog raises the row's need, a closing leaves the row exactly as it read, two agents' dialogs are
// two, a turn's start drops what an earlier turn left open, and nothing a server wrote reaches the row as it was sent.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { CLAUDE_CODE_NOTIFICATION_TYPES } from '../claude_code_host/recorded_claude_code_host.ts'
import { OWNER_DIALOGS_FIELD, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import {
  cutForTheRow,
  MENU,
  OWNER_DIALOG_CHARACTERS,
  takeAnOwnerDialog,
  theKeyOfAPermission,
  theKeyOfAnElicitation,
  theOwnerIsToldOf,
  WHAT_EACH_NOTIFICATION_SAYS,
  whatTheOwnerIsShown,
  withoutWhatATerminalCannotShow,
  type OwnerDialogEvent,
  type RaisingADialog,
} from './tell_the_owner_a_session_waits.ts'
import { EDIT_TOOL } from '../claude_code_host/claude_code_file_tools.ts'

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

const opened = (raised: RaisingADialog, at = 200): OwnerDialogEvent => ({ change: 'opened', at, raised })
const closed = (key: string, at = 300): OwnerDialogEvent => ({ change: 'closed', at, key })
const turnStarted = (at: number): OwnerDialogEvent => ({ change: 'turn-started', at })

const A_PERMISSION: RaisingADialog = { kind: 'permission', agent: '', tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'ls' } }
const AN_ELICITATION: RaisingADialog = { kind: 'elicitation', server: 'mesh', question: 'Which realm?', id: 'e-1' }

test('a permission dialog opens and then closes: the row reads needs you, then exactly what it read before (test 1)', () => {
  const held = row()
  const asking = takeAnOwnerDialog(held, opened(A_PERMISSION))
  assert.deepEqual(whatTheOwnerIsShown(asking), { state: 'needs-you', needs: `permission for ${CLAUDE_CODE_SHELL_TOOL}` }, 'the row says what the host is asking for')
  assert.equal(asking.state, held.state, 'the member\'s own state is never overwritten, so nothing has to be put back')
  assert.equal(asking.task, held.task, 'the member\'s own words stay too')

  const after = takeAnOwnerDialog(asking, closed(theKeyOfAPermission('', CLAUDE_CODE_SHELL_TOOL, { command: 'ls' })))
  assert.deepEqual(whatTheOwnerIsShown(after), whatTheOwnerIsShown(held), 'the row reads exactly what it read before the dialog')
  assert.equal(after[OWNER_DIALOGS_FIELD], undefined, 'and holds no dialog at all, rather than an empty list')
  const elsewhere = takeAnOwnerDialog(asking, closed(theKeyOfAPermission('', EDIT_TOOL, { file_path: 'a' })))
  assert.deepEqual(whatTheOwnerIsShown(elsewhere), { state: 'needs-you', needs: `permission for ${CLAUDE_CODE_SHELL_TOOL}` }, 'a close for another key clears nothing')
})

test('two agents raising a dialog for the same tool are two dialogs, and one closing leaves the other (test 2)', () => {
  const first = takeAnOwnerDialog(row(), opened({ kind: 'permission', agent: 'agent-1', tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'ls' } }))
  const both = takeAnOwnerDialog(first, opened({ kind: 'permission', agent: 'agent-2', tool: CLAUDE_CODE_SHELL_TOOL, input: { command: 'ls' } }, 201))
  assert.equal(both[OWNER_DIALOGS_FIELD]?.length, 2, 'the same tool from two agents is two dialogs')
  const one = takeAnOwnerDialog(both, closed(theKeyOfAPermission('agent-1', CLAUDE_CODE_SHELL_TOOL, { command: 'ls' }), 202))
  assert.equal(one[OWNER_DIALOGS_FIELD]?.length, 1, 'one closing clears one dialog')
  assert.equal(whatTheOwnerIsShown(one).state, 'needs-you', 'and the row still needs the owner')
})

test('a dialog is keyed by what raised it, never by its text: the same input in another order is the same dialog (test 2)', () => {
  const one = theKeyOfAPermission('', EDIT_TOOL, { a: 1, b: { c: 2, d: 3 } })
  const same = theKeyOfAPermission('', EDIT_TOOL, { b: { d: 3, c: 2 }, a: 1 })
  assert.equal(one, theKeyOfAPermission('', EDIT_TOOL, { b: { d: 3, c: 2 }, a: 1 }), 'a digest does not depend on the order the fields were built in')
  assert.equal(one, same, 'the same call, written another way, is the same dialog')
  assert.notEqual(one, theKeyOfAPermission('', EDIT_TOOL, { a: 1, b: { c: 2, d: 4 } }), 'different input is a different dialog')
  assert.notEqual(one, theKeyOfAPermission('agent-1', EDIT_TOOL, { a: 1, b: { c: 2, d: 3 } }), 'and so is another agent')
  assert.notEqual(theKeyOfAnElicitation('e-1', 'mesh', 'q'), theKeyOfAnElicitation('e-2', 'mesh', 'q'), 'an elicitation is keyed by its own id')
  assert.equal(theKeyOfAnElicitation(undefined, 'mesh', 'q'), theKeyOfAnElicitation('', 'mesh', 'q'), 'a host that gives no id falls back to the same key either way')
})

test('a dialog an earlier turn left open is dropped when a turn starts (test 3)', () => {
  const asking = takeAnOwnerDialog(row(), opened(A_PERMISSION))
  const nextTurn = takeAnOwnerDialog(asking, turnStarted(400))
  assert.equal(nextTurn[OWNER_DIALOGS_FIELD], undefined, 'the prompt nobody answered is gone')
  assert.deepEqual(whatTheOwnerIsShown(nextTurn), whatTheOwnerIsShown(row()), 'and the row says what the member said')
})

test('a server\'s question reaches the row stripped of what a terminal acts on, and cut (test 4)', () => {
  const question = `\u001b${'is this the realm you meant '.repeat(80)}\u0007`
  const asking = takeAnOwnerDialog(row(), opened({ kind: 'elicitation', server: 'mesh', question, id: 'e-9' }))
  const reads = whatTheOwnerIsShown(asking).needs
  assert.equal(reads.includes('\u001b'), false, 'no escape reaches the row')
  assert.equal(reads.includes('\u0007'), false, 'and no bell either')
  assert.equal(reads.length <= OWNER_DIALOG_CHARACTERS, true, 'the words are cut to one line\'s worth')
  assert.equal(reads.startsWith('mesh asks: is this the realm'), true, 'and what is left still says what the server asks')
})

test('a tool name is stripped too: the host\'s own word is not trusted to be printable either (test 4)', () => {
  const asking = takeAnOwnerDialog(row(), opened({ kind: 'permission', agent: '', tool: `${CLAUDE_CODE_SHELL_TOOL}\u001b]0;x\u0007`, input: {} }))
  assert.deepEqual(whatTheOwnerIsShown(asking), { state: 'needs-you', needs: `permission for ${CLAUDE_CODE_SHELL_TOOL}]0;x` }, 'the escape sequence is gone with its characters')
  assert.equal(withoutWhatATerminalCannotShow('a\u007fb\u009bc'), 'abc', 'DEL and C1 go with the rest')
})

test('a menu says one thing, and a notification says what the host said (test 4)', () => {
  const menu = takeAnOwnerDialog(row(), opened({ kind: 'menu' }))
  assert.equal(whatTheOwnerIsShown(menu).needs, MENU, 'a menu reads as a menu')
  const told = takeAnOwnerDialog(row(), opened({ kind: 'notification', message: 'Claude needs your attention' }))
  assert.equal(whatTheOwnerIsShown(told).needs, 'Claude needs your attention', 'a notification reads as its message')
})

test('the newest open dialog is what the row reads, and closing it falls back to the one before it (test 1)', () => {
  const first = takeAnOwnerDialog(row(), opened({ kind: 'notification', message: 'first' }))
  const both = takeAnOwnerDialog(first, opened(AN_ELICITATION, 210))
  assert.equal(whatTheOwnerIsShown(both).needs, 'mesh asks: Which realm?', 'the newest is what the owner reads')
  const left = takeAnOwnerDialog(both, closed(theKeyOfAnElicitation('e-1', 'mesh', 'Which realm?')))
  assert.equal(whatTheOwnerIsShown(left).needs, 'first', 'the one still open is what the row reads again')
})

test('the words are cut at the last word that fits, never in the middle of one', () => {
  const words = `${'a'.repeat(OWNER_DIALOG_CHARACTERS - 3)} bbbbbbbbbb`
  assert.equal(cutForTheRow(words), 'a'.repeat(OWNER_DIALOG_CHARACTERS - 3), 'a word that would cross the limit is left whole and out')
  assert.equal(cutForTheRow('short'), 'short', 'and words that fit are kept as they are')
})

test('every notification the host can send is named, and the ones another event already says are not the owner\'s (test 5)', () => {
  for (const notification_type of ['permission_prompt', 'idle_prompt', 'auth_success', 'elicitation_dialog']) {
    assert.equal(theOwnerIsToldOf(notification_type), false, `${notification_type} is not the owner's news twice`)
  }
  assert.equal(theOwnerIsToldOf('agent_needs_input'), true, 'a notification that is its own news is the owner\'s')
  assert.equal(theOwnerIsToldOf('one-no-host-sends'), false, 'a name the table does not hold is shown to nobody, and the coverage check says so first')
})

test('every notification the recorded host can send is named in the table, by the host\'s own name (test 5)', () => {
  const unnamed = CLAUDE_CODE_NOTIFICATION_TYPES.filter((notification_type) => !Object.hasOwn(WHAT_EACH_NOTIFICATION_SAYS, notification_type))
  assert.deepEqual(unnamed, [], `the host sends notifications this build does not name: ${unnamed.join(', ')}`)
  const named = Object.keys(WHAT_EACH_NOTIFICATION_SAYS).filter((notification_type) => !CLAUDE_CODE_NOTIFICATION_TYPES.includes(notification_type))
  assert.deepEqual(named, [], `this build names notifications the host does not send, so the list has drifted: ${named.join(', ')}`)
})
