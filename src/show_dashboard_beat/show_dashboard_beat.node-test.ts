// A beat is a whole row, and the newest beat wins (martha#254 tests 1 and 2).
//
// The writer is the one place a row is folded in, so these are the writer's two promises: a reader never sees half a
// row however often it is written, and a beat taken earlier that lands later never takes the row back.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import {
  beatOf,
  beatsIn,
  BEAT_INTERVAL_MS,
  keepBeat,
  memberOfRowFileName,
  OFFLINE_AFTER_MS,
  rowFileNameOf,
  type DashboardRow,
} from './show_dashboard_beat.ts'

/** A row directory the test owns, removed when it ends. */
function aPlace(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'martha-254-beat-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
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
  const filler = 'x'.repeat(64 * 1024)
  let reads = 0
  let writing = true
  const seen: string[] = []

  const readOnce = (): void => {
    try {
      const row = beatOf(place, 'Vesta')
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
    keepBeat(place, beat('Vesta', beat_number, { needs: filler }))
    // The reader is handed the file between beats, which is when a torn write would be there to read.
    if (beat_number % 4 === 0) await new Promise((resolve) => setImmediate(resolve))
  }
  writing = false
  await reader

  assert.deepEqual(seen, [], 'no read saw half a row')
  assert.ok(reads > 0, `the reader read the row while it was being written (${reads} reads)`)
  assert.deepEqual(readdirSync(place).filter((name) => name.startsWith('.staging-')), [], 'the writer leaves no staging file behind')
})

test('the newest beat wins: a beat taken earlier and landing later leaves the row where the newer beat put it (test 2)', (t) => {
  const place = aPlace(t)

  assert.deepEqual(keepBeat(place, beat('Vesta', 100, { task: 'the newer beat' })), { kept: true })
  const late = keepBeat(place, beat('Vesta', 50, { task: 'the older beat, landing late' }))
  assert.equal(late.kept, false, 'the older beat is dropped whole')
  assert.match(late.why ?? '', /already here/, 'and says why in words the owner can read')
  assert.equal(beatOf(place, 'Vesta')?.task, 'the newer beat', 'the row still says what the newer beat said')

  assert.equal(keepBeat(place, beat('Vesta', 150, { task: 'the newest beat' })).kept, true)
  assert.equal(beatOf(place, 'Vesta')?.task, 'the newest beat', 'a newer beat takes the row over')
})

test('a row is one per member, named by the member, and every one of them is read back (test 7, the store half)', (t) => {
  const place = aPlace(t)
  keepBeat(place, beat('Vesta', 10))
  keepBeat(place, beat('Uranus', 11))

  assert.equal(rowFileNameOf('Vesta'), 'Vesta.json', 'a plain name is its own file name')
  assert.equal(memberOfRowFileName('Vesta.json'), 'Vesta')
  assert.equal(memberOfRowFileName('.staging-1'), undefined, 'a staging file is no member')
  const read = beatsIn(place)
  assert.deepEqual(Object.keys(read.rows).sort(), ['Uranus', 'Vesta'], 'both members are there')
  assert.deepEqual(read.unread, [], 'and neither is unreadable')
})

test('the beat interval and its offline threshold are named once, and the threshold is a whole multiple of it (test 3, the constants)', () => {
  assert.ok(OFFLINE_AFTER_MS > BEAT_INTERVAL_MS, 'a row must miss more than one beat to read offline')
  assert.equal(OFFLINE_AFTER_MS % BEAT_INTERVAL_MS, 0, 'the threshold counts beats')
})
