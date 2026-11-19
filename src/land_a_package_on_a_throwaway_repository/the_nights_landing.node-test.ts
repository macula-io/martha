// The night's landing claims (martha#639 section 6, rows 5 to 7): each row read from the builder's own transcript and
// the crew's own rows, and each row's failure named. The question and the ledger's note are written out here, never
// built with the producer's function. The lead-in is the producer's constant, which the #605 landing test holds to
// what verify_range really prints.

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { OWNERS_QUESTION_LEAD_IN } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import type { StoredRow } from '../host_contract/host_contract.ts'
import { ledgerStreamOf, type LedgerRow } from '../log_ledger/log_ledger.ts'
import { ASK_QUEUED, ASKS_SETTLED, ASKS_TAKEN, OWNER_ASKS_STREAM } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { asked, landing } from './main.ts'
import type { TheNight } from './the_nights_claims.ts'
import { IT_LANDED, LANDING_ASKED, OWNER_SAID_YES, whichLandingClaimFails, type TheLandingRecord } from './the_nights_landing.ts'

const BASE = 'a'.repeat(40)
const TIP = 'b'.repeat(40)
const PACKAGE = 'night-bot/martha-live-20261118-221500#1'
const NIGHT: TheNight = { package: PACKAGE, range: `${BASE}..${TIP}`, builder: 'ada', reviewer: 'bo' }
const QUESTION = `Land ${PACKAGE} on night-bot/martha-live-20261118-221500 main at ${TIP}?`

const T1 = '2026-11-18T21:30:00.000Z'
const T2 = '2026-11-18T21:30:01.000Z'
const T3 = '2026-11-18T21:31:00.000Z'

/** A record of the builder's, as the host writes it. */
const aRecord = (at: string, role: string, content: unknown, change: Record<string, unknown> = {}): string =>
  JSON.stringify({ type: role, timestamp: at, isSidechain: false, message: { role, content }, ...change })

/** verify_range called on `tip`, as a tool_use block. */
const aVerify = (at: string, tip = TIP, change: Record<string, unknown> = {}): string =>
  aRecord(at, 'assistant', [{ type: 'tool_use', id: 'toolu_verify', name: 'mcp__martha__verify_range', input: { path: '/home/node/c', base: BASE, tip, packages: [PACKAGE] } }], change)

/** verify_range's answer, the way it lays its lines out: commits, diffstat, the lead-in, the question, the menu line. */
const anAnswer = (at: string, lines: readonly string[] = ['one commit', ' work.txt | 1 +', '', OWNERS_QUESTION_LEAD_IN, QUESTION, '', 'the range']): string =>
  aRecord(at, 'user', [{ type: 'tool_result', tool_use_id: 'toolu_verify', content: [{ type: 'text', text: lines.join('\n') }] }])

/** The builder queues `ask` with ask_the_owner. */
const anAsk = (at: string, ask = QUESTION): string =>
  aRecord(at, 'assistant', [{ type: 'tool_use', id: 'toolu_ask', name: 'mcp__martha__ask_the_owner', input: { ask } }])

const transcriptOf = (...lines: string[]): string => lines.join('\n') + '\n'
const GOOD_TRANSCRIPT = transcriptOf(aVerify(T1), anAnswer(T2), anAsk(T3))

const SETTLED_AT = 1_795_040_000_000
const PUSHED_AT = SETTLED_AT + 5_000

/** The owner_asks stream: ask 0 queued, taken, and settled with `yes`. */
const theAsks = (yes: readonly number[] = [0], at = SETTLED_AT, question = QUESTION): readonly StoredRow[] => [
  { position: 0, row: { kind: ASK_QUEUED, question, asked_by: 'ada', since: SETTLED_AT - 73_000 } },
  { position: 1, row: { kind: ASKS_TAKEN, asks: [0], at: at - 1_000, by: 'owner', session: 's' } },
  { position: 2, row: { kind: ASKS_SETTLED, batch: 1, yes, at, by: 'owner' } },
]

/** The package's ledger: the push announced, then the landing noted on the owner's yes to ask `ask`. */
const theLedger = (note = `${BASE}..${TIP} on the owner's yes to ask 0`, pushed = TIP): readonly LedgerRow[] => [
  { kind: 'act_announced', package: PACKAGE, member: 'ada', at: PUSHED_AT, act: { kind: 'push', what: `the default branch of /home/node/c fast-forwarded to ${pushed}` } },
  { kind: 'package_landed', package: PACKAGE, member: 'ada', at: PUSHED_AT + 1, note },
] as unknown as readonly LedgerRow[]

const GOOD: TheLandingRecord = { builderTranscript: GOOD_TRANSCRIPT, asks: theAsks(), ledger: theLedger() }
const failsAt = (record: Partial<TheLandingRecord>, row: string): void => {
  assert.match(whichLandingClaimFails(NIGHT, { ...GOOD, ...record }) ?? '', new RegExp(`^${row}: `))
}

test('all three landing rows hold when the transcript and the rows show them in order', () => {
  assert.equal(whichLandingClaimFails(NIGHT, GOOD), undefined)
})

/** The reason the landing-asked row gives when no verify_range answer on the night's range handed a question. */
const NO_QUESTION = `${LANDING_ASKED}: no verify_range answer on ${NIGHT.range} in ada's transcript hands the owner a question`

test('verify_range on another tip or base, or a subagent\'s call, is not the landing asked on the night\'s range', () => {
  const failsWith = (transcript: string): void => assert.equal(whichLandingClaimFails(NIGHT, { ...GOOD, builderTranscript: transcript }), NO_QUESTION)
  failsWith(transcriptOf(aVerify(T1, 'c'.repeat(40)), anAnswer(T2), anAsk(T3)))
  const otherBase = aVerify(T1).replace(`"base":"${BASE}"`, `"base":"${'c'.repeat(40)}"`)
  assert.notEqual(otherBase, aVerify(T1), 'the other-base record did not change')
  failsWith(transcriptOf(otherBase, anAnswer(T2), anAsk(T3)))
  failsWith(transcriptOf(aVerify(T1, TIP, { isSidechain: true }), anAnswer(T2), anAsk(T3)))
})

test('an answer with no lead-in hands no question, however the question line reads', () => {
  assert.equal(whichLandingClaimFails(NIGHT, { ...GOOD, builderTranscript: transcriptOf(aVerify(T1), anAnswer(T2, ['one commit', QUESTION]), anAsk(T3)) }), NO_QUESTION)
})

test('an ask that is not the question word for word, or one queued before the answer, is not the landing\'s ask', () => {
  failsAt({ builderTranscript: transcriptOf(aVerify(T1), anAnswer(T2), anAsk(T3, `${QUESTION} `)) }, LANDING_ASKED)
  failsAt({ builderTranscript: transcriptOf(anAsk(T1), aVerify(T2), anAnswer(T3)) }, LANDING_ASKED)
})

test('the owner\'s asks with no ask queued as the question fail the landing-asked row', () => {
  failsAt({ asks: theAsks([0], SETTLED_AT, `${QUESTION}x`) }, LANDING_ASKED)
})

test('a settle that does not list the ask as yes fails the yes row, and so does a yes settled after the push', () => {
  failsAt({ asks: theAsks([]) }, OWNER_SAID_YES)
  failsAt({ asks: theAsks([0], PUSHED_AT) }, OWNER_SAID_YES)
})

test('a ledger with no push of the tip, or a landing noted on another ask or range, fails the landed row', () => {
  failsAt({ ledger: theLedger(undefined, 'c'.repeat(40)) }, IT_LANDED)
  failsAt({ ledger: theLedger(`${BASE}..${TIP} on the owner's yes to ask 1`) }, IT_LANDED)
  failsAt({ ledger: theLedger(`${'c'.repeat(40)}..${TIP} on the owner's yes to ask 0`) }, IT_LANDED)
})

// --- the landing verb: the run's bash hands it a night file naming the transcript and the rows folder ----------------

test('the landing verb reads the rows folder through the store and holds (0), refuses (1), or could not look (2)', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'martha-639-landing-'))
  t.after(() => removeTheTree(folder))
  const rows = join(folder, 'the-crews-rows')
  mkdirSync(rows, { mode: 0o700 })
  const store = rowStreamsDirectory(rows)
  for (const { row } of theAsks()) await store.append(OWNER_ASKS_STREAM, row)
  for (const row of theLedger()) await store.append(ledgerStreamOf(PACKAGE), row as unknown as Record<string, unknown>)
  writeFileSync(join(folder, 'builder.jsonl'), GOOD_TRANSCRIPT)
  const night = (change: Record<string, unknown> = {}): string => {
    const file = join(folder, 'night.json')
    writeFileSync(file, JSON.stringify({ ...NIGHT, builder_transcript: join(folder, 'builder.jsonl'), rows_folder: rows, ...change }))
    return file
  }
  assert.deepEqual(await landing(night()), { code: 0 })
  writeFileSync(join(folder, 'other.jsonl'), transcriptOf(aVerify(T1), anAnswer(T2)))
  const refused = await landing(night({ builder_transcript: join(folder, 'other.jsonl') }))
  assert.equal(refused.code, 1)
  assert.match(refused.err ?? '', new RegExp(`^${LANDING_ASKED}: `))
  assert.equal((await landing(night({ rows_folder: '' }))).code, 2)
  assert.equal((await landing(night({ builder_transcript: join(folder, 'missing.jsonl') }))).code, 2)
})

test('the asked verb holds (0) once the crew has queued an ask of the owner, refuses (1) before, and could not look (2) at no folder', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'martha-639-asked-'))
  t.after(() => removeTheTree(folder))
  const rows = join(folder, 'the-crews-rows')
  mkdirSync(rows, { mode: 0o700 })
  const store = rowStreamsDirectory(rows)
  await store.append(ledgerStreamOf(PACKAGE), theLedger()[0] as unknown as Record<string, unknown>)
  const before = await asked(rows)
  assert.equal(before.code, 1, 'a ledger row is not an ask')
  assert.match(before.err ?? '', /has queued no ask of the owner/)
  await store.append(OWNER_ASKS_STREAM, (theAsks()[0] as StoredRow).row)
  assert.deepEqual(await asked(rows), { code: 0 })
  assert.equal((await asked(join(folder, 'no-such-folder'))).code, 2)
})
