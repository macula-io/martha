// The two recordings this build reads a failed agent's report from, held to each other (martha#390): the names cut from
// the recorded host binary, and the envelope one run produced at a named host version.
//
// What only this test can prove is that the pair agrees: the names the binary gives are the elements the sample really
// carries, and the word that says an agent failed is the one the sample carries. A host that renames either fails here
// by name, before a review that stopped can read as one that never ran.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RECORDED_HOST } from './recorded_claude_code_host.ts'
import { theElementIn } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { THE_FAILED_REVIEW_RECORDING, THE_HOSTS_FAILED_REVIEW, THE_RECORDED_CALLS_ID, theEnvelopeIsStillTheOneRecorded } from './the_failed_reviews_envelope.ts'
import { THE_FAILED_TASK_STATUS } from '../read_a_failed_agents_report/read_a_failed_agents_report.ts'

test('the sample envelope names what the recorded host binary says it names, at the version it was recorded on (martha#390)', () => {
  const report = THE_HOSTS_FAILED_REVIEW
  const { text, host_version } = THE_FAILED_REVIEW_RECORDING
  // The record this build reads is the one the binary gives, and the version is the host the tree is pinned to.
  assert.equal(host_version, RECORDED_HOST.host_version, 'the sample was taken on a host this tree does not pin')
  assert.equal(report.notification, RECORDED_HOST.failed_agents_report.notification, 'the notification is not the one the binary builds')
  assert.equal(report.failed, THE_FAILED_TASK_STATUS, 'the failure word is not the one the binary cuts')
  assert.ok(RECORDED_HOST.failed_agents_report.task_statuses.includes(report.failed), 'the failure word is not one the host\'s tasks end in')
  // Every element the binary names is one the sample carries, and the status the sample carries is the host's failure.
  for (const [what, element] of Object.entries({ status: report.status, tool_use: report.tool_use, summary: report.summary })) {
    assert.notEqual(theElementIn(text, element), undefined, `the sample holds no <${element}>, which the binary names as ${what}`)
  }
  assert.equal(theElementIn(text, report.status), report.failed, 'the sample\'s status is not the host\'s failure')
  assert.notEqual(THE_RECORDED_CALLS_ID, '', 'the sample names no Agent call, so the review that failed cannot be read')
  assert.equal(theEnvelopeIsStillTheOneRecorded(RECORDED_HOST.host_version), undefined, 'the sample and the binary do not agree')
})

test('a host version that did not record this sample fails the check by name (martha#390)', () => {
  const moved = theEnvelopeIsStillTheOneRecorded('9.9.9')
  assert.match(String(moved), /9\.9\.9/, 'the refusal does not name the version the host now reports')
  assert.match(String(moved), new RegExp(THE_FAILED_REVIEW_RECORDING.host_version.replaceAll('.', '\\.')), 'the refusal does not name the version the sample was taken on')
})
