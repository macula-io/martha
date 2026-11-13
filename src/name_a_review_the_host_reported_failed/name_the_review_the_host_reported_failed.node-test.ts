// A review the host reports as failed, read from the host's own envelope and named to the member and its row (martha#390).
//
// Mercurius's ruling (martha#390, comment 6862772905) is what these hold the slice to:
//   - the decision is taken on the envelope's FIXED fields only: a status of `failed`, and a tool-use id that is an Agent
//     call this launcher allowed on the crew's reviewer model;
//   - the model is the allowed call's `resolvedModel`, never a name read out of the host's prose;
//   - the host's summary is repeated verbatim, and nothing here matches on 429, on "limit" or on any other word;
//   - the envelope is pinned to the host version it was recorded on, and a host that moves fails a check by name.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import {
  theEnvelopeIsStillTheOneRecorded,
  theFailedReviewIn,
  theLineAboutIt,
  THE_RECORDED_CALLS_ID,
  type TheReviewSpawns,
  reviewSpawnsRemembered,
} from './name_the_review_the_host_reported_failed.ts'
import recorded from './recorded_failed_review.json' with { type: 'json' }

/** The reviewer model, and the model an Agent call that is not a review names. */
const THE_REVIEWER_MODEL = 'opus'
const ANOTHER_MODEL = 'sonnet'
const RESOLVED = 'claude-opus-5-5'

/** The host's own text for the run recorded, as the recording holds it. */
const THE_HOSTS_TEXT: string = recorded.text

/** The recording's text with one element's value replaced, to drive a case without a second recording. */
const withTheElement = (name: string, value: string): string => THE_HOSTS_TEXT.replace(new RegExp(`<${name}>.*</${name}>`), `<${name}>${value}</${name}>`)

/** A spawn table with one review allowed on the reviewer model, and its resolved model known unless `null` says not. */
function aRememberedReview(resolved: string | null = RESOLVED): TheReviewSpawns {
  const spawns = reviewSpawnsRemembered()
  spawns.remember(THE_RECORDED_CALLS_ID, THE_REVIEWER_MODEL)
  if (resolved !== null) spawns.resolved(THE_RECORDED_CALLS_ID, resolved)
  return spawns
}

test('the envelope recorded is the one this host version writes, and a host that moves fails by name (martha#390)', () => {
  assert.equal(theEnvelopeIsStillTheOneRecorded(recorded.host_version), undefined, 'the recording does not hold the envelope it describes')
  const moved = theEnvelopeIsStillTheOneRecorded('9.9.9')
  assert.notEqual(moved, undefined, 'a host version that did not record this envelope passed the check')
  assert.match(String(moved), /9\.9\.9/, 'the refusal does not name the version the host now reports')
  assert.match(String(moved), new RegExp(recorded.host_version.replaceAll('.', '\\.')), 'the refusal does not name the version the envelope was recorded on')
  // The recording is this repository's own: the drift check is held to the recording the rest of the tree reads.
  assert.equal(theEnvelopeIsStillTheOneRecorded(RECORDED_HOST.host_version), undefined, 'the recorded host version and this envelope were recorded apart')
})

test('a failed envelope naming an allowed review is the review that failed, with the model from the call and the host\'s words verbatim (martha#390)', () => {
  const failed = theFailedReviewIn(aRememberedReview(), THE_HOSTS_TEXT, recorded.origin_kind, THE_REVIEWER_MODEL)
  assert.notEqual(failed, undefined, 'the host\'s own envelope for a failed review was not read as one')
  assert.equal(failed?.model, RESOLVED, 'the line would not name the model the host said the review ran on')
  assert.match(String(failed?.reason), /API Error: Request rejected \(429\)/, 'the host\'s own words were not repeated')
  assert.equal(String(failed?.reason), recorded.text.match(/<summary>([\s\S]*?)<\/summary>/)?.[1], 'the reason is not the host\'s summary verbatim')
})

test('an envelope for an agent this launcher never allowed on the reviewer model is not a review of this crew\'s (martha#390)', () => {
  // A different agent id, over the same words: the tool-use id is the only thing that says which spawn it was.
  const anotherAgent = withTheElement('tool-use-id', 'toolu_someone_else')
  assert.equal(theFailedReviewIn(aRememberedReview(), anotherAgent, recorded.origin_kind, THE_REVIEWER_MODEL), undefined, 'a failure of another agent was taken for the crew\'s review')
  // A review whose call named another model was allowed as something else, and is not held to the reviewer model.
  const spawns = reviewSpawnsRemembered()
  spawns.remember(THE_RECORDED_CALLS_ID, ANOTHER_MODEL)
  spawns.resolved(THE_RECORDED_CALLS_ID, 'claude-sonnet-5-5')
  assert.equal(theFailedReviewIn(spawns, THE_HOSTS_TEXT, recorded.origin_kind, THE_REVIEWER_MODEL), undefined, 'a call allowed on another model was read as the crew\'s review')
  // No resolved model: the line could only take one from the host's prose, and it never does.
  assert.equal(theFailedReviewIn(aRememberedReview(null), THE_HOSTS_TEXT, recorded.origin_kind, THE_REVIEWER_MODEL), undefined, 'a line was made without the model the call resolved to')
})

test('a turn that is not the host\'s failed envelope proves nothing, whatever its words (martha#390)', () => {
  const spawns = aRememberedReview()
  assert.equal(theFailedReviewIn(spawns, THE_HOSTS_TEXT, 'composer', THE_REVIEWER_MODEL), undefined, 'a composer turn was read as the host\'s report')
  const succeeded = withTheElement('status', 'completed')
  assert.equal(theFailedReviewIn(spawns, succeeded, recorded.origin_kind, THE_REVIEWER_MODEL), undefined, 'a status other than the host\'s failure was read as one')
  // The prose alone decides nothing: a turn that says 429 and "usage limit" without the envelope's status is not it.
  assert.equal(theFailedReviewIn(spawns, 'API Error: Request rejected (429), your account has reached its usage limit', recorded.origin_kind, THE_REVIEWER_MODEL), undefined, 'the words of a turn were read as a failure')
})

test('the line names the model and repeats the host\'s own words (martha#390)', () => {
  const line = theLineAboutIt({ tool_use_id: THE_RECORDED_CALLS_ID, model: RESOLVED, reason: 'the host says so' })
  assert.match(line, new RegExp(RESOLVED), 'the line does not name the model')
  assert.match(line, /the host says so/, 'the line does not carry the host\'s own words')
})
