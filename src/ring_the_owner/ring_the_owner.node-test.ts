// When the bell rings, what it carries, and how kitty reads the notification (martha#313, tests 6 and 7; martha#574).
//
// A bell that rings on every beat is a bell the owner turns off, one that carries raw text is a terminal a stranger can
// steer, and one written outside kitty's protocol is never shown at all. These tests pin all three: it rings on the
// change into "needs you" and nowhere else, what it carries is base64 and only base64, and the sequence is the one
// kitty's desktop-notification protocol reads — a title chunk, a body chunk that completes it, an id per member, and a
// close that takes that id's notification down when the question is answered.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OWNER } from '../declare_crew/declare_crew.ts'
import { BEAT_INTERVAL_MS } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { takeAnOwnerDialog, type RaisingADialog } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import { NO_BELLS, NOTIFICATION_ENDING, NOTIFICATION_ESCAPE, notificationIdOf, theBellsFor, theCloseOf, THE_BELL, type TheBellsSwitch } from './ring_the_owner.ts'
import { EDIT_TOOL } from '../claude_code_host/claude_code_file_tools.ts'

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

const A_PERMISSION: RaisingADialog = { kind: 'permission', agent: '', tool: EDIT_TOOL, input: { file_path: 'a' } }

/** The row asking for a permission, as the launcher would write it at `at`. */
const asking = (at: number): DashboardRow => takeAnOwnerDialog(row(at), { change: 'opened', at, raised: A_PERMISSION })

/** One chunk of an OSC 99 sequence: the metadata kitty reads, and the payload it decodes. */
interface Chunk {
  readonly metadata: ReadonlyMap<string, string>
  readonly payload: string
}

/** `text` cut at the first `at`, which is the separator a metadata pair and a payload are split by. */
function splitAt(text: string, at: string): [string, string] {
  const index = text.indexOf(at)
  return [text.slice(0, index), text.slice(index + at.length)]
}

/** Every chunk of an OSC 99 sequence, in the order it is written, as kitty's protocol splits one (martha#574). */
function chunksOf(bytes: string): Chunk[] {
  const found: Chunk[] = []
  let at = bytes.indexOf(NOTIFICATION_ESCAPE)
  while (at !== -1) {
    const ended = bytes.indexOf(NOTIFICATION_ENDING, at)
    const [metadata, payload] = splitAt(bytes.slice(at + NOTIFICATION_ESCAPE.length, ended), ';')
    found.push({ metadata: new Map(metadata.split(':').map((pair) => splitAt(pair, '='))), payload })
    at = bytes.indexOf(NOTIFICATION_ESCAPE, ended + NOTIFICATION_ENDING.length)
  }
  return found
}

const metadataOf = (chunks: readonly Chunk[], key: string): (string | undefined)[] => chunks.map((chunk) => chunk.metadata.get(key))

test('ten beats while the host is asking ring the bell once (test 6)', () => {
  const first = asking(200)
  assert.notEqual(theBellsFor(row(), first, BOTH, true, false), '', 'the change into needs you rings')
  const rang: string[] = []
  let held = first
  for (let beat = 0; beat < 10; beat += 1) {
    const next = takeAnOwnerDialog(held, { change: 'opened', at: first.at + BEAT_INTERVAL_MS * (beat + 1), raised: A_PERMISSION })
    const bytes = theBellsFor(held, next, BOTH, true, false)
    if (bytes !== '') rang.push(bytes)
    held = next
  }
  assert.deepEqual(rang, [], 'the row still needs the owner, and nothing rings again for it')
})

test('the bell rings again on the next change into needs you, and never on the way out (test 6)', () => {
  const first = asking(200)
  const answered = takeAnOwnerDialog(first, { change: 'closed', at: 300, key: theKeyOfThePermission() })
  const onTheWayOut = theBellsFor(first, answered, BOTH, true, false)
  assert.equal(onTheWayOut.includes(THE_BELL), false, 'a dialog closing rings no bell')
  assert.equal(onTheWayOut, `${NOTIFICATION_ESCAPE}i=${notificationIdOf('Vesta')}:p=close;${NOTIFICATION_ENDING}`, 'and takes the notification it showed down instead (martha#574, T5)')
  const again = takeAnOwnerDialog(answered, { change: 'opened', at: 400, raised: A_PERMISSION })
  assert.notEqual(theBellsFor(answered, again, BOTH, true, false), '', 'being asked a second time rings again')
})

test('a member\'s own report that it waits on the owner rings nothing (test 6)', () => {
  const waiting = { ...row(200), state: 'waiting' as const, waits: { on: OWNER, for: 'a yes', since: 200 } }
  assert.equal(theBellsFor(row(), waiting, BOTH, true, false), '', 'the bell is the host\'s word, not a member\'s report')
})

test('with both bells off, or no terminal of the owner\'s, nothing is written (test 7)', () => {
  const first = asking(200)
  assert.equal(theBellsFor(row(), first, NO_BELLS, true, false), '', 'both off writes nothing')
  assert.equal(theBellsFor(row(), first, BOTH, false, false), '', 'a member started without the owner\'s terminal rings nothing')
})

test('each bell can be had without the other (test 7)', () => {
  const first = asking(200)
  assert.equal(theBellsFor(row(), first, { bell: true, notify: false }, true, false), THE_BELL, 'the bell alone is the one byte')
  const notify = theBellsFor(row(), first, { bell: false, notify: true }, true, false)
  assert.equal(notify.startsWith(NOTIFICATION_ESCAPE), true, 'the notification alone opens the sequence')
  assert.equal(notify.endsWith(NOTIFICATION_ENDING), true, 'and ends it')
})

test('the notification is a title chunk and a body chunk that completes it, with the keys kitty reads (martha#574)', () => {
  const chunks = chunksOf(theBellsFor(row(), asking(200), { bell: false, notify: true }, true, false))

  assert.equal(chunks.length, 2, 'a title, then the body that completes it')
  assert.deepEqual(metadataOf(chunks, 'p'), ['title', 'body'], 'each chunk says which of the two it carries')
  assert.deepEqual(metadataOf(chunks, 'd'), ['0', '1'], 'the title holds the notification open, the body completes it')
  assert.deepEqual(metadataOf(chunks, 'e'), ['1', '1'], 'every chunk says its payload is base64')
  assert.equal(new Set(metadataOf(chunks, 'i')).size, 1, 'one notification, one id')
})

test('one id per member, so a second member does not take the first member\'s notification away (martha#574)', () => {
  const first = chunksOf(theBellsFor(row(), asking(200), { bell: false, notify: true }, true, false))
  const other = { ...row(), member: 'Juno' }
  const second = chunksOf(theBellsFor(row(), takeAnOwnerDialog(other, { change: 'opened', at: 200, raised: A_PERMISSION }), { bell: false, notify: true }, true, false))
  const idOf = (chunks: readonly Chunk[]): (string | undefined)[] => metadataOf(chunks, 'i')

  assert.match(idOf(first)[0] ?? '', /^[A-Za-z0-9_+.-]+$/, 'an id kitty\'s protocol accepts')
  assert.equal(idOf(first)[0]?.includes('Vesta'), true, 'the id names the member')
  assert.equal(idOf(first)[0]?.includes('Juno'), false, 'and no other member')
  assert.notEqual(idOf(first)[0], idOf(second)[0], 'two members, two ids')
})

test('the notification is taken down when the row stops needing the owner, and the bell does not ring again (martha#574, T5)', () => {
  const first = asking(200)
  const answered = takeAnOwnerDialog(first, { change: 'closed', at: 300, key: theKeyOfThePermission() })
  const close = theBellsFor(first, answered, { bell: true, notify: true }, true, false)

  assert.equal(close, `${NOTIFICATION_ESCAPE}i=${notificationIdOf('Vesta')}:p=close;${NOTIFICATION_ENDING}`, 'exactly kitty\'s close, for the id the notification was shown under, and no bell')
  const chunks = chunksOf(close)
  assert.equal(chunks.length, 1, 'one chunk')
  assert.deepEqual([...(chunks[0]?.metadata ?? [])], [['i', notificationIdOf('Vesta')], ['p', 'close']], 'the id, and the one word that takes it away')
  assert.equal(chunks[0]?.payload, '', 'no payload, so it says neither d nor e')
})

test('the close names the member that was asking, so an answered question takes down no other member\'s (martha#574, T5)', () => {
  const mine = asking(200)
  const others = takeAnOwnerDialog({ ...row(), member: 'Juno' }, { change: 'opened', at: 200, raised: A_PERMISSION })
  const closed = (holding: DashboardRow): Chunk[] =>
    chunksOf(theBellsFor(holding, takeAnOwnerDialog(holding, { change: 'closed', at: 300, key: theKeyOfThePermission() }), { bell: false, notify: true }, true, false))
  const closeOfMine = metadataOf(closed(mine), 'i')
  const closeOfOthers = metadataOf(closed(others), 'i')

  assert.equal(closeOfMine[0]?.includes('Vesta'), true, 'the member that was asking')
  assert.equal(closeOfOthers[0]?.includes('Juno'), true, 'and the other member\'s, for its own row')
  assert.notEqual(closeOfMine[0], closeOfOthers[0], 'two members, two closes')
})

test('nothing is taken down when nothing was shown (martha#574, T5)', () => {
  const first = asking(200)
  const answered = takeAnOwnerDialog(first, { change: 'closed', at: 300, key: theKeyOfThePermission() })

  assert.equal(theBellsFor(first, answered, { bell: true, notify: false }, true, false), '', 'no notification was shown, so none comes down')
  assert.equal(theBellsFor(first, answered, { bell: false, notify: true }, false, false), '', 'no terminal of the owner\'s, so nothing was shown or closed there')
  assert.equal(theBellsFor(first, first, { bell: false, notify: true }, true, false), '', 'a beat that stays in needs-you closes nothing')
  assert.equal(theBellsFor(null, answered, { bell: false, notify: true }, true, false), '', 'with no row before, this terminal showed nothing to take down')
})

test('the owner\'s mute silences the way in and never the way out (martha#371)', () => {
  const first = asking(200)
  const answered = takeAnOwnerDialog(first, { change: 'closed', at: 300, key: theKeyOfThePermission() })

  assert.equal(theBellsFor(row(), first, BOTH, true, true), '', 'a muted member rings nothing into needs you, bell and notification both')
  assert.notEqual(theBellsFor(row(), first, BOTH, true, false), '', 'and the same beat rings with the mute lifted')
  assert.equal(
    theBellsFor(first, answered, { bell: true, notify: true }, true, true),
    theCloseOf('Vesta'),
    'a member muted while its ask was open still has its notification taken down when the ask is answered',
  )
})

test('what the notification carries is base64, so no server\'s text can end the sequence early (test 4)', () => {
  const question = 'a\u001b]0;x\u0007b'
  const asked = takeAnOwnerDialog(row(200), { change: 'opened', at: 200, raised: { kind: 'elicitation', server: 'mesh', question, id: 'e-1' } })
  const chunks = chunksOf(theBellsFor(row(), asked, { bell: false, notify: true }, true, false))

  for (const chunk of chunks) assert.equal(/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.payload), true, 'the payload is base64 and nothing else')
  assert.equal(Buffer.from(chunks[1]?.payload ?? '', 'base64').toString('utf8'), 'mesh asks: a]0;xb', 'and the body says what the row says, with what a terminal acts on gone')
})

/** The key of the one permission these tests open, as the dialogs slice builds it. */
function theKeyOfThePermission(): string {
  const held = asking(200).dialogs ?? []
  return held[0]?.key ?? ''
}
