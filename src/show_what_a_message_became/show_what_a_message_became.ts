// What became of each message a member sent (martha#253, slice 5).
//
// This exists so a member can see whether what it said reached the member it said it to, without asking that member
// and without the launcher keeping a record of its own: every answer is read from the two streams the channel already
// has. A message is written the moment its row is in the channel; it is taken in by a member when that member's own
// stream holds its position.

import { type ChannelHost, readTheChannel, takenInBy } from '../keep_the_crew_channel/crew_channel.ts'

/** What the tool says it is for, as the model reads it. */
export const CREW_RECEIPTS_DESCRIPTION =
  'What became of every message you sent on this crew: written, and for each member it was for, whether that member has taken it in.'

/** The state every message the channel holds is in: its row is there, which is how any member ever sees it. */
const WRITTEN = 'written'

/**
 * The lines a member reads about its own sends: one per message, naming the members it was for and whether each took
 * it in. A member that sent nothing is told so, rather than shown an empty list.
 */
export async function whatBecameOfWhatISent(host: ChannelHost, member: string, roster: readonly string[]): Promise<string> {
  const messages = (await readTheChannel(host)).filter(({ message }) => message.from === member)
  if (messages.length === 0) return 'You have sent nothing on this crew.'

  const lines: string[] = []
  for (const { position, message } of messages) {
    const forThem = message.to === 'crew' ? roster.filter((name) => name !== member) : message.to
    const states = await Promise.all(forThem.map(async (name) => ((await takenInBy(host, name)).has(position) ? `taken in by ${name}` : `not yet taken in by ${name}`)))
    lines.push(`message ${position} to ${message.to === 'crew' ? 'the whole crew' : message.to.join(', ')}: ${[WRITTEN, ...states].join(', ')}`)
  }
  return lines.join('\n')
}
