// One place builds a rows path (martha#254 R1, test 13).
//
// The crew's streams moved to the crew's own place, and the way that stays true is that no second place spells a
// `rows` directory at all: a slice that wants one is told to take it from the crew's place instead, which is how the
// ledger came to be split across worktrees in the first place. The name is allowed in two places only — the module
// that defines it, and a type that reads the rows store out of the host contract — so a third has to be added here
// with its reason, which is a decision rather than a drift. Test files are left out: a fixture makes its own
// directory under a temporary home, and never a place a member would read.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { coreSources } from '../../prove_the_core/core_sources.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The one file allowed to name the rows directory's own name: the place that defines it. */
const NAMES_THE_PLACE = 'keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The host contract's own type for the rows store, which names it without building a path. */
const READS_THE_STORE_FROM_THE_CONTRACT = /HostContract\['stores'\]\['rows'\]/

/** What may quote the name: a single quote, a double quote, or the backtick a template uses. */
const QUOTES = `'"${String.fromCharCode(96)}`

/** A quoted `rows`, which is either a path segment or an index into a type. */
const SPELLS_ROWS = new RegExp(`[${QUOTES}]rows[${QUOTES}]`)

/** The core's files that may build a path, which are the ones that ship. */
const shippingSources = (): ReturnType<typeof coreSources> => coreSources('src').filter((source) => !source.path.endsWith('.node-test.ts'))

test('no shipping file but the one that defines it spells a rows path (martha#254 R1, test 13)', () => {
  const offenders = shippingSources()
    .filter((source) => source.path !== NAMES_THE_PLACE)
    .flatMap((source) =>
      source.text
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => SPELLS_ROWS.test(line) && !READS_THE_STORE_FROM_THE_CONTRACT.test(line))
        .map(({ line, number }) => `${source.path}:${number}: ${line.trim()}`),
    )
  assert.deepEqual(offenders, [], "a rows path is built by the crew's own place (crewRowsDirectory) and nowhere else")
})

test('the place that defines it does spell it, so the scan above is looking for something real', () => {
  const definer = coreSources('src').find((source) => source.path === NAMES_THE_PLACE)
  assert.ok(definer !== undefined, `${NAMES_THE_PLACE} is in src`)
  assert.ok(definer.text.includes(`'${CREW_ROWS_PLACE}'`), 'the place names the rows directory it defines')
})
