/**
 * The row after one turn's question, in ONE write: what the session reported about itself and what the flow said it is
 * doing, because the row store keeps the newest beat and two writes in the same millisecond would lose the second.
 *
 * The turn's end is also where the row settles its state (martha#1000, gap 8 of #957): what the member holds, and a
 * closing question it can put to the owner. It is a second file in ../a_crews_tools for the reason the repository's
 * structural floor gives: the table's file has no room left under the per-file cap.
 */

import type { TheAct, TheSessionsQuestion } from '../refresh_a_member/the_refresh_flow.ts'
import { carriesAReviewWord } from '../run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts'
import {
  SPEND_FIELD,
  type AUnitOnARow,
  type DashboardRow,
  type TheOwnersDefaultTold,
} from '../show_dashboard_beat/show_dashboard_beat.ts'
import { theStateThisSessionSettlesTo, type TheSessionsOwnState } from './a_sessions_own_tab.ts'

/**
 * What the row write is handed of the session (martha#1000): the facts its own tab keeps, and the owner's line waiting
 * to be said, which the write takes and clears.
 */
export interface TheSessionsRowFacts {
  readonly own: TheSessionsOwnState
  owner_needs: TheOwnersDefaultTold | null
}

export function theRowAfterTheTurn(
  state: TheSessionsRowFacts,
  row: DashboardRow,
  question: TheSessionsQuestion,
  act: TheAct,
  spend: readonly AUnitOnARow[] | undefined,
  may_ask_the_owner: boolean,
): DashboardRow {
  const settled =
    question.at_start || question.turn_running
      ? row.state
      : theStateThisSessionSettlesTo(state.own, row, question.session_id, question.answer, may_ask_the_owner, carriesAReviewWord)
  return {
    ...row,
    state: settled,
    ...(act.refresh === undefined ? {} : { refresh: act.refresh }),
    needs: theNeedsAfter(state, row),
    session: question.session_id,
    host: { ...row.host, contextPercent: question.percent, costUsd: question.cost_usd },
    [SPEND_FIELD]: spend,
  }
}

/** The row's `needs` after this turn (martha#359): what the owner's file said, or its own line taken away again. */
function theNeedsAfter(state: TheSessionsRowFacts, row: DashboardRow): string {
  const told = state.owner_needs
  if (told === null) return row.needs
  state.owner_needs = null
  if (told.why !== '') return told.why
  return told.before.includes(row.needs) ? '' : row.needs
}
