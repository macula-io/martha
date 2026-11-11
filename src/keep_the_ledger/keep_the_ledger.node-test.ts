// The ledger is loaded: a later session reads what an earlier one kept, and a successor is told what was sent
// (martha#254 tests 9 and 10).
//
// Both tests use the store the launcher really composes, one directory per stream on disk, not the in-memory host #25
// proved the ledger on: what is being proved here is that a milestone outlives the session that kept it and that a
// package's history is in one place.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { hostForTests, type HostForTests } from '../host_contract/host_for_tests.ts'
import { removeTheTree } from '../launch_a_claude_code_member/relay_copy.ts'
import { ledgerStreamOf, readLedger, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { keepTheMilestone, theLineAStartingSessionIsHanded, whatWasSent, noteWhatBecameOfAnAct } from './keep_the_ledger.ts'

const PACKAGE = 'synthetic-owner/repo#7'

/** A crew's streams directory on disk, and a checkout beside it that must stay untouched, both removed when the test ends. */
function aCrewPlace(t: TestContext): { readonly streams: string; readonly checkout: string; readonly host: (now: number) => HostForTests } {
  const root = mkdtempSync(join(tmpdir(), 'martha-254-ledger-'))
  t.after(() => removeTheTree(root))
  const streams = join(root, 'crews', 'a-key', 'rows')
  const checkout = join(root, 'checkout')
  mkdirSync(streams, { recursive: true, mode: 0o700 })
  mkdirSync(checkout, { recursive: true })
  // A fresh host each time is what a later session has: the same directory, a new process.
  return { streams, checkout, host: (now: number) => hostForTests({ now, rows: rowStreamsDirectory(streams) }) }
}

/** An act announced and never concluded: the row a send keeps before the act runs, when the outcome never came. */
async function announce(hosts: LedgerHost, member: string, kind: 'push' | 'handoff', what: string): Promise<number> {
  return hosts.stores.rows.append(ledgerStreamOf(PACKAGE), { kind: 'act_announced', package: PACKAGE, member, at: hosts.clock.now(), act: { kind, what } })
}

test('a milestone kept with crew_log is read back by a later session of the same member, and nothing of it is in the checkout (test 9)', async (t) => {
  const place = aCrewPlace(t)
  const before = readdirSync(place.checkout)

  const kept = await keepTheMilestone(place.host(1_000).host, { package: PACKAGE, member: 'Vesta', event: 'checkpoint', note: 'the crew store is built' })
  assert.match(kept.told, /^Kept: checkpoint/, 'the member is told what was kept')

  const later = await readLedger(place.host(2_000).host, PACKAGE)
  assert.deepEqual(later, [
    { kind: 'checkpoint_reached', package: PACKAGE, member: 'Vesta', at: 1_000, note: 'the crew store is built' },
  ], 'a later session reads the milestone out of the same store')

  assert.deepEqual(readdirSync(place.checkout), before, 'nothing of the ledger is written in the checkout')

  const unknown = await keepTheMilestone(place.host(3_000).host, { package: PACKAGE, member: 'Vesta', event: 'shipped_it', note: 'x' })
  assert.match(unknown.told, /Not recorded: "shipped_it" is not a milestone/, 'an event the ledger has no milestone for is told, not kept')
})

test('a member starting on a package is handed exactly the acts with no outcome, in order, and one it concludes is concluded once (test 10)', async (t) => {
  const place = aCrewPlace(t)
  const first = await announce(place.host(10).host, 'Vesta', 'push', 'main 1111..2222')
  const second = await announce(place.host(20).host, 'Uranus', 'handoff', 'martha#254 r=1')
  await announce(place.host(30).host, 'Vesta', 'push', 'main 2222..3333')
  assert.deepEqual([first, second], [0, 1], 'the acts were announced at the rows the store gave them')

  const read = await whatWasSent(place.host(40).host, PACKAGE)
  assert.deepEqual(read.acts.map((act) => [act.announced_at, act.act.kind]), [[0, 'push'], [1, 'handoff'], [2, 'push']], 'oldest first, every act with no outcome')

  const line = theLineAStartingSessionIsHanded(PACKAGE, read.acts)
  assert.match(line ?? '', /row 0: a push by Vesta/, 'the line names each act and the row to quote back')
  assert.match(line ?? '', /note_what_became_of_an_act/, 'and names the tool that records what became of one')

  const concluded = await noteWhatBecameOfAnAct(place.host(50).host, { package: PACKAGE, member: 'Pliny', announced_at: 1, succeeded: true, detail: 'it reached the Supervisor' })
  assert.match(concluded.told, /the act at row 1 of synthetic-owner\/repo#7 is concluded/, 'the successor records what it found')

  const again = await noteWhatBecameOfAnAct(place.host(60).host, { package: PACKAGE, member: 'Pliny', announced_at: 1, succeeded: true, detail: 'it reached the Supervisor' })
  assert.match(again.told, /Not recorded: the act at row 1 is already concluded|Not recorded: the act at row 1 .*already concluded/, 'one act is concluded once')

  const after = await whatWasSent(place.host(70).host, PACKAGE)
  assert.deepEqual(after.acts.map((act) => act.announced_at), [0, 2], 'the concluded act is no longer awaiting')
  assert.equal(theLineAStartingSessionIsHanded(PACKAGE, []), null, 'a package with nothing waiting is not announced')
})
