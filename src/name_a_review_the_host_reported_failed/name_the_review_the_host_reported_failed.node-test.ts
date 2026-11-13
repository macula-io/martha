// A review the host reports as failed, read from the host's own envelope and named to the member and its row (martha#390).
//
// Mercurius's ruling (martha#390, comment 6862772905) is what these hold the slice to:
//   - the decision is taken on the envelope's FIXED fields only: a status of `failed`, and a tool-use id that is an Agent
//     call this launcher allowed on the crew's reviewer model;
//   - the model is the allowed call's `resolvedModel`, never a name read out of the host's prose;
//   - the host's summary is repeated verbatim, and nothing here matches on 429, on "limit" or on any other word.
//
// The names below are the host's, spelled in a report of this test's own: on the tree's own host they are cut from its
// binary and held with the sample envelope by ../claude_code_host/the_failed_reviews_envelope.ts, whose own test proves
// that pair agrees.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  reviewSpawnsRemembered,
  theFailedReviewIn,
  theLineAboutIt,
  whatTheEnvelopeNoLongerHolds,
  type HowTheTurnIsRead,
  type TheReportTheHostWrites,
  type TheReviewSpawns,
} from './name_the_review_the_host_reported_failed.ts'

/** The reviewer model, and the model an Agent call that is not a review names. */
const THE_REVIEWER_MODEL = 'opus'
const ANOTHER_MODEL = 'sonnet'
const RESOLVED = 'claude-opus-5-5'

/** The host's own names for the envelope, as its binary gives them (../claude_code_host/the_hosts_failed_agents_report). */
const THE_REPORT: TheReportTheHostWrites = { notification: 'task-notification', status: 'status', tool_use: 'tool-use-id', summary: 'summary', failed: 'failed' }

/** The id of the Agent call the envelope names: the review that failed. */
const THE_CALLS_ID = 'toolu_standin_1'

/** One envelope the host wrote, in the shape one run produced it: the fields, and its own words for the stop. */
const THE_HOSTS_TEXT = [
  '<task-notification>',
  '<task-id>afad1959430f3ba35</task-id>',
  `<${THE_REPORT.tool_use}>${THE_CALLS_ID}</${THE_REPORT.tool_use}>`,
  '<output-file>/tmp/a-run/tasks/afad1959430f3ba35.output</output-file>',
  `<${THE_REPORT.status}>${THE_REPORT.failed}</${THE_REPORT.status}>`,
  `<${THE_REPORT.summary}>Agent "review the patch" failed: API Error: Request rejected (429) · Your account has reached its usage limit for opus (model sent to the API: claude-opus-5-5)</${THE_REPORT.summary}>`,
  '</task-notification>',
].join('\n')

/** How a turn is read here: the crew's reviewer model, and this host's report. */
const READ: HowTheTurnIsRead = { origin_kind: THE_REPORT.notification, review_model: THE_REVIEWER_MODEL, report: THE_REPORT }

/** What the envelope's own summary element holds, read here by the element's name and nothing else. */
const theSummaryOf = (text: string): string => text.slice(text.indexOf(`<${THE_REPORT.summary}>`) + THE_REPORT.summary.length + 2, text.indexOf(`</${THE_REPORT.summary}>`))

/** The envelope's text with one element's value replaced, to drive a case without a second envelope. */
const withTheElement = (name: string, value: string): string => THE_HOSTS_TEXT.replace(new RegExp(`<${name}>.*</${name}>`), `<${name}>${value}</${name}>`)

/** A spawn table with one review allowed on the reviewer model, and its resolved model known unless `null` says not. */
function aRememberedReview(resolved: string | null = RESOLVED): TheReviewSpawns {
  const spawns = reviewSpawnsRemembered()
  spawns.remember(THE_CALLS_ID, THE_REVIEWER_MODEL)
  if (resolved !== null) spawns.resolved(THE_CALLS_ID, resolved)
  return spawns
}

test('a failed envelope naming an allowed review is the review that failed, with the model from the call and the host\'s words verbatim (martha#390)', () => {
  const failed = theFailedReviewIn(aRememberedReview(), THE_HOSTS_TEXT, READ)
  assert.notEqual(failed, undefined, 'the host\'s own envelope for a failed review was not read as one')
  assert.equal(failed?.model, RESOLVED, 'the line would not name the model the host said the review ran on')
  assert.match(String(failed?.reason), /API Error: Request rejected \(429\)/, 'the host\'s own words were not repeated')
  assert.equal(String(failed?.reason), theSummaryOf(THE_HOSTS_TEXT), 'the reason is not the host\'s summary verbatim')
})

test('an envelope for an agent this launcher never allowed on the reviewer model is not a review of this crew\'s (martha#390)', () => {
  // A different agent id, over the same words: the tool-use id is the only thing that says which spawn it was.
  const anotherAgent = withTheElement(THE_REPORT.tool_use, 'toolu_someone_else')
  assert.equal(theFailedReviewIn(aRememberedReview(), anotherAgent, READ), undefined, 'a failure of another agent was taken for the crew\'s review')
  // A review whose call named another model was allowed as something else, and is not held to the reviewer model.
  const spawns = reviewSpawnsRemembered()
  spawns.remember(THE_CALLS_ID, ANOTHER_MODEL)
  spawns.resolved(THE_CALLS_ID, 'claude-sonnet-5-5')
  assert.equal(theFailedReviewIn(spawns, THE_HOSTS_TEXT, READ), undefined, 'a call allowed on another model was read as the crew\'s review')
  // No resolved model: the line could only take one from the host's prose, and it never does.
  assert.equal(theFailedReviewIn(aRememberedReview(null), THE_HOSTS_TEXT, READ), undefined, 'a line was made without the model the call resolved to')
})

test('a turn that is not the host\'s failed envelope proves nothing, whatever its words (martha#390)', () => {
  const spawns = aRememberedReview()
  assert.equal(theFailedReviewIn(spawns, THE_HOSTS_TEXT, { ...READ, origin_kind: 'composer' }), undefined, 'a composer turn was read as the host\'s report')
  const succeeded = withTheElement(THE_REPORT.status, 'completed')
  assert.equal(theFailedReviewIn(spawns, succeeded, READ), undefined, 'a status other than the host\'s failure was read as one')
  // The prose alone decides nothing: a turn that says 429 and "usage limit" without the envelope's status is not it.
  assert.equal(theFailedReviewIn(spawns, 'API Error: Request rejected (429), your account has reached its usage limit', READ), undefined, 'the words of a turn were read as a failure')
})

test('the line names the model the allowed call resolved to, never one the host\'s prose names (martha#390)', () => {
  // The recorded envelope's summary happens to name the same model as the call's answer, so a line read from the prose
  // would look right on it: here the prose names another model, and the line must still name the one the call resolved
  // to. The words stay the host's, unedited.
  const prose = withTheElement(THE_REPORT.summary, 'the review failed (model sent to the API: claude-sonnet-4-5)')
  const failed = theFailedReviewIn(aRememberedReview(), prose, READ)
  assert.equal(failed?.model, RESOLVED, 'the line took a model out of the host\'s prose instead of the call\'s own answer')
  assert.equal(String(failed?.reason), 'the review failed (model sent to the API: claude-sonnet-4-5)', 'the host\'s words were not repeated verbatim')
})

test('an element or a word the envelope no longer holds is named, and never read as a report that proved nothing (martha#390)', () => {
  assert.equal(whatTheEnvelopeNoLongerHolds(THE_HOSTS_TEXT, THE_REPORT), undefined, 'the envelope the host wrote was not read as the one reported')
  assert.match(String(whatTheEnvelopeNoLongerHolds(THE_HOSTS_TEXT, { ...THE_REPORT, summary: 'a-renamed-element' })), /a-renamed-element/, 'an element the envelope does not hold was not named')
  assert.match(String(whatTheEnvelopeNoLongerHolds(THE_HOSTS_TEXT, { ...THE_REPORT, failed: 'a-word-the-host-does-not-write' })), /a-word-the-host-does-not-write/, 'a failure word the envelope does not carry was not named')
})

test('the line names the model and repeats the host\'s own words (martha#390)', () => {
  const line = theLineAboutIt({ tool_use_id: THE_CALLS_ID, model: RESOLVED, reason: 'the host says so' })
  assert.match(line, new RegExp(RESOLVED), 'the line does not name the model')
  assert.match(line, /the host says so/, 'the line does not carry the host\'s own words')
})
