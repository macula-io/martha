// The envelope the recorded Claude Code host writes when an agent fails, as this build reads it (martha#390).
//
// Two recordings, held together here and never in the slice that decides on them. The NAMES — the notification's own
// name, the status, tool-use and summary elements, and the word that says an agent failed — are cut from the recorded
// host binary (../read_a_failed_agents_report/read_a_failed_agents_report.ts): a host that renames one fails the drift job by name. The SAMPLE is
// the text one run produced at a named host version (recorded_failed_review.json), and it is what says the names the
// binary gives are the ones the envelope really carries.
//
// So a re-recorded host that renames an element fails HERE, by name, rather than a review that stopped reading as one
// that never ran: the slice is handed what both recordings agree on and reads no disk of its own.

import { readFileSync } from 'node:fs'

import { whatTheEnvelopeNoLongerHolds, theElementIn, type TheReportTheHostWrites } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { CLAUDE_CODE_FAILED_AGENTS_REPORT } from './recorded_claude_code_host.ts'
import { theReportToRead } from '../read_a_failed_agents_report/read_a_failed_agents_report.ts'

/** The report this host writes for a failed agent, in the names and the word its own binary gives them. */
export const THE_HOSTS_FAILED_REVIEW: TheReportTheHostWrites = theReportToRead(CLAUDE_CODE_FAILED_AGENTS_REPORT)

/** The sample envelope this tree carries, as it was recorded: the host's own text, and the version that wrote it. */
interface RecordedFailedReview {
  readonly host_version: string
  readonly text: string
}

/** The sample, read once. A sample this tree cannot read is a fault of the tree, not of a member's turn. */
export const THE_FAILED_REVIEW_RECORDING: RecordedFailedReview = JSON.parse(
  readFileSync(new URL('./recorded_failed_review.json', import.meta.url), 'utf8'),
) as RecordedFailedReview

/** The id of the Agent call the sample names: the review that failed in the run recorded. */
export const THE_RECORDED_CALLS_ID = theElementIn(THE_FAILED_REVIEW_RECORDING.text, THE_HOSTS_FAILED_REVIEW.tool_use) ?? ''

/**
 * Why this tree's sample envelope is not the one the recorded host writes, or undefined when it is. Two things move: the
 * host version the sample was taken on, which says it was never re-read for this host, and an element or a status the
 * sample no longer holds, which says the host renamed one. Either way a review's failure could read as no failure at all.
 */
export function theEnvelopeIsStillTheOneRecorded(host_version: string): string | undefined {
  const { text, host_version: recorded_on } = THE_FAILED_REVIEW_RECORDING
  if (host_version !== recorded_on) {
    return `the host's failed-review envelope was recorded on ${recorded_on} and this tree reads ${host_version}: record it again (recorded_failed_review.json, beside this check) before a review that fails is read as one that did not`
  }
  return whatTheEnvelopeNoLongerHolds(text, THE_HOSTS_FAILED_REVIEW)
}
