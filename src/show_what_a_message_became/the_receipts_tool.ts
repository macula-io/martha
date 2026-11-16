// The `read_the_receipts` tool (martha#253, #443 part 5): what it is for, and what a member is told about what it sent.
//
// The tool takes nothing: a member asks what became of its own messages, and this slice reads the channel it already
// keeps. The tools slice (../a_crews_tools) keeps only the table that calls it.

import type { ChannelHost } from '../keep_the_crew_channel/crew_channel.ts'
import { READ_THE_RECEIPTS, CREW_RECEIPTS_DESCRIPTION, whatBecameOfWhatISent } from './show_what_a_message_became.ts'

/** What `read_the_receipts` takes, as the mod registers it: nothing. */
export const READ_THE_RECEIPTS_TOOL = {
  name: READ_THE_RECEIPTS,
  description: CREW_RECEIPTS_DESCRIPTION,
  inputSchema: { type: 'object', properties: {} },
}

/** What the receipts are read over: the channel's ledger, the member that sent, and the crew it sent to. */
export interface TheReceiptsAsked {
  readonly ledger: ChannelHost
  readonly member: string
  readonly roster: readonly string[]
}

/** `read_the_receipts`: every message this member sent, and what its addressees did with it. */
export async function theReceiptsOver(asked: TheReceiptsAsked): Promise<{ readonly answer: string }> {
  return { answer: await whatBecameOfWhatISent(asked.ledger, asked.member, asked.roster) }
}
