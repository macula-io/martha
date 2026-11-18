// Where a line of Martha's own reaches a member (martha#390): its row the owner reads, and the member's own session,
// handed the line through the crew's channel the way every crew message is.
//
// A row the store does not hold yet is not made here: the line waits for a row there is, as the dialogs slice leaves it.
// The row's `needs` is one slot shared with every other line the owner is told (a model switch's, martha#359), and who
// may write it, and whose line may be taken back, is the row's own rule in the core (../show_dashboard_beat,
// `theRowWithTheLine` / `theRowWithoutTheLineItWrote`). This telling keeps only which line it wrote, so it can tell its
// own from another owner's, and the store calls that put that line there and take it away.
//
// The launch hands it: the member's name, the dashboard and rows directories, and the journal a telling that did not
// reach the member is written down in rather than swallowed (martha#430).

import { appendToTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import type { RelayJournal } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { dashboardRowsIn } from '../dashboard_rows_directory/dashboard_rows_directory.ts'
import { rowStreamsDirectory } from '../row_streams_directory/row_streams_directory.ts'
import { theRowWithTheLine, theRowWithoutTheLineItWrote } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { TheMembersTelling } from '../answer_the_relay/answer_the_relay.ts'

/**
 * Where a line of Martha's own is told: the member whose row and channel it goes to, and the two store directories those
 * are kept in. Named apart from the launch so the telling can be built and read on its own (martha#390 r=1).
 */
export interface TheTellingPlaces {
  readonly member: string
  readonly dashboard: string
  readonly rows: string
  /** The launch's journal, where a telling that did not reach the member is written down rather than swallowed (martha#430). */
  readonly journal?: RelayJournal
}

/** The journal's own name for a line of Martha's that the member's channel store refused (martha#430). */
export const A_TELLING_THAT_DID_NOT_REACH = 'a telling that did not reach the member'

/** Where a line of Martha's own reaches this member (martha#390): the row the owner reads, and the member's own session. */
export function theMembersTelling(places: TheTellingPlaces): TheMembersTelling {
  const beats = dashboardRowsIn(places.dashboard)
  // The line this telling last put in the row, so it can tell its own line from another owner's, and take back its own.
  let wrote: string | null = null
  return {
    theRow: (line) => {
      beats.change(places.member, (held) => {
        if (held === null) return null
        const next = theRowWithTheLine(held, { wrote, line, at: Date.now() })
        // Nothing comes back when another owner's line stands there, and then the line is not this telling's to take back.
        if (next === null) return null
        wrote = line
        return next
      })
    },
    theMember: (line, call) =>
      appendToTheChannel(
        { clock: { now: () => Date.now() }, stores: { rows: rowStreamsDirectory(places.rows) } },
        // The program's own name, and never a member's: the word is spelled here rather than defined as a value, because
        // eleven places in the tree spell it for something else — a repository, a state directory, an installed binary, a
        // test's command word — and a constant of it would make every one of them stale at once (martha#390 r=4).
        { from: 'martha', to: [places.member], text: line, sent_at: Date.now() },
      ).then(
        () => undefined,
        // The member's half of the telling did not happen, and the journal is the only place a run can read that it did
        // not (martha#430): the line says which review's call it was about, so a run can put the two halves together.
        (why: unknown) => places.journal?.notedWhatItCouldNotFinish(A_TELLING_THAT_DID_NOT_REACH, why instanceof Error ? why.message : String(why), call),
      ),
    takeTheLineBack: () => {
      const line = wrote
      if (line === null) return
      wrote = null
      beats.change(places.member, (held) => (held === null ? null : theRowWithoutTheLineItWrote(held, line)))
    },
  }
}
