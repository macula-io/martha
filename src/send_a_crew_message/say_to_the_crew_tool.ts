// The `say_to_the_crew` tool (martha#253, #443 part 5): what it takes, and what a member's message does.
//
// A send names who it is for and what it says, and the launcher does the rest as this member: the roster is the
// declaration's, the package is the one the member holds, and the roster is never a name the call carries. The tools
// slice (../a_crews_tools) keeps only the table that calls it.

import type { ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import { CREW_SAY_DESCRIPTION, SAY_TO_THE_CREW, sendACrewMessage } from './send_a_crew_message.ts'

/** What `say_to_the_crew` takes, as the mod registers it. */
export const SAY_TO_THE_CREW_TOOL = {
  name: SAY_TO_THE_CREW,
  description: CREW_SAY_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        description: `Who it is for: a list of this crew's members' names, or "${THE_WHOLE_CREW}" for every member but you`,
        anyOf: [{ type: 'string', enum: [THE_WHOLE_CREW] }, { type: 'array', items: { type: 'string' }, minItems: 1 }],
      },
      text: { type: 'string', description: 'What you say. A HANDOFF or VERDICT line is read from its first line' },
    },
    required: ['to', 'text'],
  },
}

/** What a send is handed: the channel's ledger, this member, the crew's roster, and the row that says what it holds. */
export interface ASendAsked {
  readonly ledger: ChannelHost & LedgerHost
  readonly member: string
  readonly roster: readonly string[]
  /** The member's row, whose `holds` is the package the send is announced in; null when it holds none. */
  readonly held: DashboardRow | null
  readonly to: unknown
  readonly text: unknown
}

/** What the tool answers: the position the message was kept at, or why nothing was sent. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** `say_to_the_crew`: the message is appended to the channel, and the member is told what landed. */
export async function sayToTheCrewOver(asked: ASendAsked): Promise<AToolAnswer> {
  const held = asked.held
  const sent = await sendACrewMessage(asked.ledger, {
    member: asked.member,
    roster: asked.roster,
    package: held === null || held.holds === '' ? null : held.holds,
    to: asked.to,
    text: asked.text,
  })
  return 'refused' in sent ? { refused: sent.refused } : { answer: sent.told }
}
