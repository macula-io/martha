// The launcher's own record of an end, so a run can tell an end carried at the tool boundary from one ordered after
// the tool finished (martha#498).
//
// The hold carries an end on the answer to the last call in flight (./hold_the_end.ts), and it writes one line in the
// launcher's journal when it does, with the host's own id for that call: this is the reading of that line, and the two
// sentences a run says of it. So what was a moment in the launcher's memory is on disk beside the lines a run already
// reads, and a red run can say which of the two it saw.
//
// It exists because a run that judged the order of its requests without it asserted the runner's speed: CI run
// 43649753458 failed on an ordering assertion over a diff that changes nothing about when the end is carried, and the
// same tree passed on the run's second attempt. A red that reads like a regression is the cost this removes.

import { CARRY_THE_END } from './end_the_running_turn.ts'

/** The line a launcher writes when the end rode on a call's answer, as the journal says what it was. */
export const THE_END_RODE_ON_THE_CALL = "the turn's end was carried on the answer to this call"

/**
 * What a run says when the end it waited on came too late to judge the order of its requests (martha#498): nothing in
 * this run says the host would have carried an end at the tool's boundary, so its request numbers prove nothing.
 */
export const THE_END_CAME_TOO_LATE = 'the end was ordered after the long tool finished, so this run cannot judge the order'

/** What this needs of a launch's journal, as a run reads it back: the lines it kept, each with the call it names. */
export interface TheLinesTheLauncherKept {
  readonly events: readonly TheLinesCall[]
}

/** One line, as the reading below uses it: what the launcher wrote it about, and the host's id for the call it names. */
interface TheLinesCall {
  readonly event: string
  readonly tool_use_id?: string
}

/**
 * Whether the journal shows the end was carried on the answer to `call`, whose id is the host's own for that call
 * (`standInCallId` in ../drive_the_recorded_host/drive_the_recorded_host.ts names one a stand-in offered).
 */
export const theEndRodeOn = (journal: TheLinesTheLauncherKept, call: string): boolean =>
  journal.events.some((line) => line.event === CARRY_THE_END && line.tool_use_id === call)

/** Why this run cannot judge the order of the requests it made after the tool, or undefined when the end rode `call`. */
export const whyTheOrderCannotBeJudged = (journal: TheLinesTheLauncherKept, call: string): string | undefined =>
  theEndRodeOn(journal, call) ? undefined : THE_END_CAME_TOO_LATE
