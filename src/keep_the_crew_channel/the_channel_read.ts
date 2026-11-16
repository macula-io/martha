// How often the mod reads the crew channel (martha#253, #443 part 5): the ask it makes at a session's start, and the
// declaration's own answer.
//
// The mod decides nothing here: it asks how often to read, and the launcher answers with the number the owner declared,
// so the cadence a session keeps the channel at is the declaration's, never a value the session guessed. The tools slice
// (../a_crews_tools) keeps only the table that answers this ask.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'

/** What the mod asks for: how often, in seconds, to read the channel (martha#253). */
export const THE_CHANNEL_READ_ASK = 'channel_read_seconds'

/** How often the mod is to read the crew channel, as the declaration gives it. */
export const theChannelReadAsk = (settings: CrewSettings): string => String(settings.channel_read_seconds)
