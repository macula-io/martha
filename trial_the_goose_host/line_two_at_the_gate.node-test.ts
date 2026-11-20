// Line 2 of the Goose trial is the launch gate's (macula-io/martha#614): with skills on, an unapproved checkout is kept
// from the session by the gate refusing it before anything starts, naming each skill root it holds.

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { aPlaceFor, CHECKOUT_MARKERS, plant, type Place } from './a_launch_the_trial_writes/a_launch_the_trial_writes.ts'
import { lineTwoAtTheGate, type AGateAtAPlace } from './the_nine_lines.ts'
import { RECORDED_GOOSE_ENGINE } from '../src/know_the_goose_engines_facts/recorded_goose_engine.ts'
import { removeTheTree } from '../src/serve_the_relay_to_a_launch/relay_copy.ts'

const ROOTS = RECORDED_GOOSE_ENGINE.checkout_skill_roots
const EVERY_SKILL_ROOT = [...ROOTS.skill_folders, ROOTS.plugin_folder, ...ROOTS.plugin_settings]

/** A place for line 2, under a directory removed when the case ends; `planted` says whether the checkout holds the markers. */
function aPlace(t: TestContext, planted: boolean): Place {
  const base = mkdtempSync(join(tmpdir(), 'martha-614-line-2-'))
  t.after(() => removeTheTree(base))
  const place = aPlaceFor(2, join(base, 'evidence'), join(base, 'launch'))
  if (planted) plant(place.checkout, CHECKOUT_MARKERS)
  return place
}

test('the real launch gate refuses the unapproved checkout before anything starts, naming every skill root it holds (martha#614)', (t) => {
  const seen = lineTwoAtTheGate(aPlace(t, true))
  assert.equal(seen.verdict, 'pass', seen.say)
  assert.deepEqual(seen.evidence['held'], EVERY_SKILL_ROOT, 'the markers do not plant every skill root the engine reads')
  assert.deepEqual(seen.evidence['unnamed'], [])
})

test('a gate that lets the unapproved checkout start fails the line by name (martha#614)', (t) => {
  const lets: AGateAtAPlace = () => ({ allow: true })
  const seen = lineTwoAtTheGate(aPlace(t, true), lets)
  assert.equal(seen.verdict, 'fail')
  assert.match(seen.say, /^the launch gate let an unapproved checkout holding .* start$/)
})

test('a refusal that leaves a skill root unnamed fails the line, naming the root (martha#614)', (t) => {
  for (const left of EVERY_SKILL_ROOT) {
    const naming: AGateAtAPlace = () => ({ allow: false, refusal: `refused: ${EVERY_SKILL_ROOT.filter((root) => root !== left).join(', ')}` })
    const seen = lineTwoAtTheGate(aPlace(t, true), naming)
    assert.equal(seen.verdict, 'fail', left)
    assert.equal(seen.say, `the launch gate refused the checkout without naming ${left}`, left)
  }
})

test('a checkout holding no skill root is not observed, never passed (martha#614)', (t) => {
  const refuses: AGateAtAPlace = () => ({ allow: false, refusal: 'refused' })
  assert.equal(lineTwoAtTheGate(aPlace(t, false), refuses).verdict, 'not-observed')
})
