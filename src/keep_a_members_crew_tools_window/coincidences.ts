// The coincidences of keep_a_members_crew_tools_window: words its own files spell like a constant held elsewhere,
// meaning something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax
// tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { RELAY_JOURNAL_SUFFIX } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import { REFRESHES_PLACE } from '../refresh_a_member/refresh_a_member.ts'

export const COINCIDENCES: readonly Exception[] = [
  // A window closed by the session a refresh started (martha#658) says so in the word the crew already uses for that
  // act. The refresh place is the store's folder of refreshes, named the same word, and is not this.
  { value: REFRESHES_PLACE, file: 'keep_a_members_crew_tools_window/keep_a_members_crew_tools_window.ts', reason: 'what closed a member\'s crew tools window: the session its refresh started; the crew\'s refresh place is a store folder named the same word and is not this' },
  // A member's window is kept as one JSON file named for the member (martha#658 part 3 reads the member back from the
  // name). The relay's journal ends its files the same way because they too are JSON; neither name follows the other.
  { value: RELAY_JOURNAL_SUFFIX, file: 'keep_a_members_crew_tools_window/keep_a_members_crew_tools_window.ts', reason: "what ends a member's crew tools window file, a JSON file named for the member; the relay journal's files end the same way for their own JSON, and neither follows the other" },
]
