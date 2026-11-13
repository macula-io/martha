// Reading the HANDOFF and VERDICT lines a member sends (martha#253, slice 4).
//
// These cases pin the two things the design demands of this slice: a line that does not read is answered with the
// field that is wrong (a tip of thirty-nine hex digits, PASS|FAIL after the range), and every line the generated card
// text teaches does read and adds its row to that package's ledger — the join that stops a card and a reader drifting.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { hostForTests } from '../host_contract/host_for_tests.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { readLedger } from '../log_ledger/log_ledger.ts'
import { CREW_LINES, linesACardTeaches } from './crew_lines.ts'
import { keepTheLinesRow, readACrewLine } from './read_a_crew_line.ts'

const BASE = 'a'.repeat(40)
const TIP = 'b'.repeat(40)
const PACKAGE = 'macula-io/martha#253'

const ledgerHost = (): LedgerHost => {
  const { host } = hostForTests({ now: 3_000 })
  return { clock: host.clock, stores: { rows: host.stores.rows } }
}

/** A well-formed line of each verb, on a range, with every key the shape requires, as the crew really sends them: a verdict that passed required no change, so it says `req=0`. */
const WELL_FORMED = [`HANDOFF ${PACKAGE} ${BASE}..${TIP} r=1 ci=41700170944`, `VERDICT ${PACKAGE} PASS ${BASE}..${TIP} r=2 ci=41700170944 req=0`]

test('#253: a well-formed HANDOFF and VERDICT read, with the package and the verdict they name', () => {
  const handoff = readACrewLine(WELL_FORMED[0] ?? '')
  assert.ok('line' in handoff && handoff.line !== null)
  assert.deepEqual([handoff.line.verb, handoff.line.package, handoff.line.keys['r'], handoff.line.keys['ci']], ['HANDOFF', PACKAGE, '1', '41700170944'])

  const verdict = readACrewLine(WELL_FORMED[1] ?? '')
  assert.ok('line' in verdict && verdict.line !== null)
  assert.equal(verdict.line.verdict, 'PASS')
  assert.equal(verdict.line.keys['req'], '0')
})

test('#256: a PASS that required no change reads, because req=0 is what the crew sends when a review passes', () => {
  const reading = readACrewLine(`VERDICT ${PACKAGE} PASS ${BASE}..${TIP} r=1 ci=41700170944 req=0`)
  assert.ok('line' in reading && reading.line !== null, `a real PASS line was refused, so it would write no row: ${JSON.stringify(reading)}`)
  assert.equal(reading.line.verdict, 'PASS')
  assert.equal(reading.line.keys['req'], '0')
})

test('#256: the round is still one or more, and req is still a whole number', () => {
  const round_zero = readACrewLine(`VERDICT ${PACKAGE} PASS ${BASE}..${TIP} r=0 ci=41700170944 req=0`)
  assert.ok('refused' in round_zero, `a round of zero read: ${JSON.stringify(round_zero)}`)
  assert.match(round_zero.refused, /r is not/, 'the answer did not name the round that is wrong')

  const negative = readACrewLine(`VERDICT ${PACKAGE} PASS ${BASE}..${TIP} r=1 ci=41700170944 req=-1`)
  assert.ok('refused' in negative, `a negative count read: ${JSON.stringify(negative)}`)
  assert.match(negative.refused, /req is not/, 'the answer did not name the count that is wrong')
})

test('#253: a tip of thirty-nine hex digits is answered with the field, and nothing reaches a ledger', () => {
  const reading = readACrewLine(`HANDOFF ${PACKAGE} ${BASE}..${TIP.slice(1)} r=1 ci=41700170944`)
  assert.ok('refused' in reading)
  assert.match(reading.refused, /range/, 'the answer did not name the field that is wrong')
})

test('#253: a VERDICT with PASS|FAIL after the range is answered with the word out of place', () => {
  const reading = readACrewLine(`VERDICT ${PACKAGE} ${BASE}..${TIP} PASS r=2 ci=41700170944`)
  assert.ok('refused' in reading)
  assert.match(reading.refused, /PASS or FAIL/, 'the answer did not say which word was out of place')
})

test('#253: a key the verb does not name is answered by its name', () => {
  const reading = readACrewLine(`HANDOFF ${PACKAGE} ${BASE}..${TIP} r=1 ci=1 round=2`)
  assert.ok('refused' in reading)
  assert.match(reading.refused, /round/)
})

test('#253: a message that is not a crew line is left alone', () => {
  assert.deepEqual(readACrewLine('just a remark to the crew'), { line: null })
  assert.deepEqual(readACrewLine('HANDOFFISH text that only looks like a line'), { line: null })
})

test('#253: a design reads with its URL in place of the range', () => {
  const handoff = readACrewLine('HANDOFF macula-io/martha#253 doc=https://github.com/macula-io/martha/issues/253#issuecomment-1 r=2')
  assert.ok('line' in handoff && handoff.line !== null)
  assert.equal(handoff.line.keys['doc'], 'https://github.com/macula-io/martha/issues/253#issuecomment-1')

  const verdict = readACrewLine('VERDICT macula-io/martha#253 PASS doc=https://github.com/macula-io/martha/issues/253#issuecomment-2 r=2 req=0')
  assert.ok('line' in verdict && verdict.line !== null)
  assert.equal(verdict.line.verdict, 'PASS')
})

test('#253: every line the generated card text teaches reads, and adds its row to that package\'s ledger', async () => {
  const taught = linesACardTeaches()
  assert.equal(taught.length, CREW_LINES.length * 2, 'the card text teaches a line per verb per form')
  for (const { line } of taught) {
    // A card shows the judgement as `PASS|FAIL`, the words a member may choose between: a member sends one of them.
    const filled = line
      .replace('PASS|FAIL', 'PASS')
      .replace('<org/repo#n>', PACKAGE)
      .replace('<base40>..<tip40>', `${BASE}..${TIP}`)
      .replace('<url>', 'https://github.com/macula-io/martha/issues/253')
      .replace(/<(N|run ids)>/g, '1')
    const reading = readACrewLine(filled)
    assert.ok('line' in reading && reading.line !== null, `the card teaches a line the reader refuses: ${line} → ${JSON.stringify(reading)}`)

    const host = ledgerHost()
    await keepTheLinesRow(host, 'Builder', reading.line)
    const rows = await readLedger(host, PACKAGE)
    assert.ok(rows.length > 0, `a line the card teaches added no row to ${PACKAGE}'s ledger: ${line}`)
  }
})

test('#253: a VERDICT adds the verdict it gave, and a HANDOFF the act it announced (martha#350)', async () => {
  const host = ledgerHost()
  const verdict = readACrewLine(WELL_FORMED[1] ?? '')
  assert.ok('line' in verdict && verdict.line !== null)
  await keepTheLinesRow(host, 'Mercurius', verdict.line)
  assert.deepEqual((await readLedger(host, PACKAGE)).map((row) => row.kind), ['verdict_given'])

  const handoff = readACrewLine(WELL_FORMED[0] ?? '')
  assert.ok('line' in handoff && handoff.line !== null)
  await keepTheLinesRow(host, 'Pallas', handoff.line)
  assert.deepEqual((await readLedger(host, PACKAGE)).map((row) => row.kind), ['verdict_given', 'act_announced', 'act_concluded'])
})

/** The text each row kept of a line: a VERDICT's note, or the act a HANDOFF announced. */
const keptTextOf = (rows: Awaited<ReturnType<typeof readLedger>>): readonly string[] =>
  rows.flatMap((row) => (row.kind === 'verdict_given' ? [row.note] : row.kind === 'act_announced' ? [row.act.what] : []))

test('#256: the row a line writes carries the whole line, so its range reads back out of the ledger', async () => {
  for (const written of WELL_FORMED) {
    const host = ledgerHost()
    const reading = readACrewLine(written)
    assert.ok('line' in reading && reading.line !== null, `the line did not read: ${written}`)
    await keepTheLinesRow(host, 'Mercurius', reading.line)

    const kept = keptTextOf(await readLedger(host, PACKAGE))
    assert.equal(kept.length, 1, `a line did not keep one text to read back: ${JSON.stringify(kept)}`)
    const back = readACrewLine(kept[0] ?? '')
    assert.ok('line' in back && back.line !== null, `the row does not read as the line it was: ${JSON.stringify(kept[0])}`)
    assert.deepEqual(back.line, reading.line, 'the row dropped something of the line it was written from, the range among it')
    assert.ok(back.line.words.includes(`${BASE}..${TIP}`), 'the range is not in the words the row kept')
  }
})
