// One place builds a rows path (martha#254 R1, test 13).
//
// The crew's streams moved to the crew's own place, and the way that stays true is that no second place joins a
// `rows` directory of its own: a slice that wants one is told to take it from the crew's place instead, which is how
// the ledger came to be split across worktrees in the first place. Test files are left out: a fixture makes its own
// directory under a temporary home, and never a place a member would read.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { coreSources } from '../../prove_the_core/core_sources.ts'
import { CREW_ROWS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The one file allowed to name the rows directory's own name: the place that defines it. */
const NAMES_THE_PLACE = 'keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** What may quote a path segment: a single quote, a double quote, or the backtick a template uses. */
const QUOTES = `'"${String.fromCharCode(96)}`

/** A `rows` directory joined by hand: `join(..., 'rows')`, or a quoted path whose last segment is `/rows`. */
const BUILDS_A_ROWS_PATH = new RegExp(`(?:^|[^\\w.])join\\([^)]*[${QUOTES}]rows[${QUOTES}]|[${QUOTES}][^${QUOTES}]*/rows[${QUOTES}]`)

/** The core's files that may build a path, which are the ones that ship. */
const shippingSources = (): ReturnType<typeof coreSources> => coreSources('src').filter((source) => !source.path.endsWith('.node-test.ts'))

test('no shipping file but the one that defines it builds a rows path (martha#254 R1, test 13)', () => {
  const offenders = shippingSources()
    .filter((source) => source.path !== NAMES_THE_PLACE)
    .flatMap((source) =>
      source.text
        .split('\n')
        .map((line, index) => ({ line, number: index + 1 }))
        .filter(({ line }) => BUILDS_A_ROWS_PATH.test(line))
        .map(({ line, number }) => `${source.path}:${number}: ${line.trim()}`),
    )
  assert.deepEqual(offenders, [], "a rows path is built by the crew's own place (crewRowsDirectory) and nowhere else")
})

test('the place that defines it does spell it, so the scan above is looking for something real', () => {
  const definer = coreSources('src').find((source) => source.path === NAMES_THE_PLACE)
  assert.ok(definer !== undefined, `${NAMES_THE_PLACE} is in src`)
  assert.ok(definer.text.includes(`'${CREW_ROWS_PLACE}'`), 'the place names the rows directory it defines')
})
