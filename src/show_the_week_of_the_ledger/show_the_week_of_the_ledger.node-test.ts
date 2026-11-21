// The words `martha week` is used with, and what it does when a stream cannot be read (martha#308): no week, or exactly
// one named, and never a switch; a week that is not one is refused before any stream is read; a store that refuses the
// ask queue leaves the week without its owner-wait line, and the stream is named.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { CREWS_PLACE, crewRowsDirectory } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { streamDirectoryNameOf } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { showTheWeek, weekOf } from './show_the_week_of_the_ledger.ts'

const WEEK = 'week'

test('week is taken alone, or with one week named, and no other way', () => {
  assert.deepEqual(weekOf(WEEK, [WEEK]), { act: WEEK, args: [] }, 'no week named is a way the command is used')
  assert.deepEqual(weekOf(WEEK, [WEEK, '2026-W47']), { act: WEEK, args: ['2026-W47'] }, 'one week named is a way the command is used')
  assert.equal(weekOf(WEEK, [WEEK, '2026-W47', 'extra']), undefined, 'a second word after the week was taken')
  assert.equal(weekOf(WEEK, [WEEK, '']), undefined, 'an empty word was taken as a week')
  assert.equal(weekOf(WEEK, [WEEK, '--wat']), undefined, 'a switch was taken as a week')
})

/** A state root of this test's own, removed when it ends. */
function aStateRoot(t: { after: (fn: () => void) => void }): string {
  const root = mkdtempSync(join(tmpdir(), 'martha-308-show-week-'))
  t.after(() => removeTheTree(root))
  return root
}

/** A terminal that keeps everything it is shown. */
const aTerminal = (said: string[]) => ({ out: (line: string) => said.push(line), err: (line: string) => said.push(line) })

test('a word that is not a week is refused before any stream is read', async (t) => {
  const state_root = aStateRoot(t)
  const said: string[] = []
  const status = await showTheWeek(aTerminal(said), { root: state_root, state: { state_root } }, { args: ['2026-47'] })
  assert.equal(status, 1)
  assert.ok(said.some((line) => line.includes('is not an ISO week')), `the refusal is not the week's: ${said.join(' / ')}`)
  assert.ok(!existsSync(join(state_root, CREWS_PLACE)), 'the crew rows were looked for before the word was judged')
})

test('a store that refuses the ask queue leaves the week without its owner-wait line, and the stream is named', async (t) => {
  const state_root = aStateRoot(t)
  const root = state_root
  const place = crewRowsDirectory(state_root, root)
  if ('refusal' in place) assert.fail(place.refusal)
  const asks = join(place.path, streamDirectoryNameOf(OWNER_ASKS_STREAM))
  mkdirSync(asks, { mode: 0o700 })
  writeFileSync(join(asks, 'not-a-row.json'), '{}')
  const said: string[] = []
  const status = await showTheWeek(aTerminal(said), { root, state: { state_root } }, { args: ['2026-W47'] })
  assert.equal(status, 0, `the week was refused: ${said.join(' / ')}`)
  assert.ok(said.some((line) => line.startsWith(`skipped: ${OWNER_ASKS_STREAM}`)), `the refused stream was not named: ${said.join(' / ')}`)
  assert.ok(said.every((line) => !line.startsWith('owner wait: ')), 'an owner-wait line was printed for a queue that could not be read')
  assert.ok(said.includes('nothing in this week'), 'a week with no package row did not say nothing is in it')
})
