// A row is written whole and by change, never by a copy (martha#254 tests 1 and 2, the store; martha#380).
//
// The store is the host's, so this drives the file the launcher really keeps: a reader handed it mid-write never sees
// half a row, and a change is applied to the row the store holds rather than to one its caller read first.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { rowFileNameOf, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { dashboardRowsIn } from './dashboard_rows_directory.ts'

/** A rows directory the test owns, removed when it ends. */
function aPlace(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-254-rows-'))
  t.after(() => removeTheTree(dir))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

/** A beat of one member, with everything a test does not care about filled in. */
function beat(member: string, at: number, changes: Partial<DashboardRow> = {}): DashboardRow {
  return {
    member,
    session: 'a-session',
    at,
    state: 'working',
    holds: 'macula-io/martha#254',
    task: 'Build martha#254, the crew store',
    progress: { step: 1, of: 4 },
    waits: null,
    needs: '',
    host: { model: 'opus', provider: '', contextPercent: 12, costUsd: 0.4 },
    ...changes,
  }
}

test('a beat is written whole: a reader handed the file mid-write never sees half a row (test 1)', async (t) => {
  const place = aPlace(t)
  const store = dashboardRowsIn(place)
  const filler = 'x'.repeat(64 * 1024)
  let reads = 0
  let writing = true
  const seen: string[] = []

  const readOnce = (): void => {
    try {
      const row = store.read('Vesta')
      if (row === null) return
      assert.equal(row.member, 'Vesta', 'the reader read a whole row')
      assert.equal(row.needs.length, filler.length, 'and every field of it')
      reads += 1
    } catch (error) {
      seen.push(error instanceof Error ? error.message : String(error))
    }
  }

  const reader = (async (): Promise<void> => {
    while (writing) {
      readOnce()
      await new Promise((resolve) => setImmediate(resolve))
    }
  })()

  for (let beat_number = 1; beat_number <= 400; beat_number += 1) {
    store.change('Vesta', () => beat('Vesta', beat_number, { needs: filler }))
    // The reader is handed the file between beats, which is when a torn write would be there to read.
    if (beat_number % 4 === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  writing = false
  await reader

  assert.deepEqual(seen, [], 'no read saw half a row')
  assert.ok(reads > 0, `the reader read the row while it was being written (${reads} reads)`)
  assert.deepEqual(readdirSync(place).filter((name) => name.startsWith('.staging-')), [], 'the writer leaves no staging file behind')
})

test('#380: a change is applied to the row the store holds, and the store keeps what the change answers', (t) => {
  const store = dashboardRowsIn(aPlace(t))

  assert.deepEqual(store.change('Vesta', () => beat('Vesta', 100, { task: 'what the writer read' })), { kept: true })
  const handed: (DashboardRow | null)[] = []
  const kept = store.change('Vesta', (held) => {
    handed.push(held)
    return held === null ? null : { ...held, needs: 'the change\'s own word' }
  })
  assert.equal(kept.kept, true)
  assert.equal(handed[0]?.task, 'what the writer read', 'the change was not handed the row the store holds')
  const row = store.read('Vesta')
  assert.equal(row?.needs, 'the change\'s own word', 'the store kept something other than what the change answered')
  assert.equal(row?.task, 'what the writer read', 'a field the change left alone was lost')

  const nothing = store.change('Vesta', () => null)
  assert.equal(nothing.kept, false, 'a change that answers nothing is a write that kept nothing')
  assert.match(nothing.why ?? '', /answered nothing/, 'and says why in words the owner can read')
  assert.equal(store.read('Vesta')?.needs, 'the change\'s own word', 'a change that kept nothing still moved the row')
})

test('a row is one per member, and every one of them is read back; a file that is not a row is not shown as one (test 7, the store half)', (t) => {
  const place = aPlace(t)
  const store = dashboardRowsIn(place)
  store.change('Vesta', () => beat('Vesta', 10))
  store.change('Uranus', () => beat('Uranus', 11))
  writeFileSync(join(place, rowFileNameOf('Terra')), 'not a row\n', { mode: 0o600 })

  assert.deepEqual(Object.keys(store.all()).sort(), ['Uranus', 'Vesta'], 'both members are there, and a file that is no row is left out')
})
