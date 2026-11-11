// Handing a crew's messages to the member they are for (martha#253, slice 2), and counting one taken in (slice 3).
//
// This exists so a message reaches a member as a turn of its own session, with no room to poll and no message left
// sitting where nobody reads it. The member's mod asks the launcher for the next message it has not taken in; the
// launcher reads the channel past what that member took in and answers with the next one, framed so its position is
// part of the text — `[crew #<position>] <sender>: <text>`. The mod submits that text as a prompt, and the host
// raises it back through the prompt hook; only then is it taken in.
//
// Being handed is not being taken in. The taken row is written when the turn the host raised carries exactly the text
// that was handed, from the origin kind a mod's own submitted prompt carries; anything else writes nothing. So a
// message handed over just before a session ended is handed to the next session first, and a message taken in is
// never handed again. Being handed twice is acceptable; being lost is not.

import type { ArrivingTurn } from '../host_contract/host_contract.ts'
import { type ChannelHost, addressedTo, keepTakenIn, readTheChannel, takenInBy } from '../keep_the_crew_channel/crew_channel.ts'
import type { TurnRaising } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'

/** What the source is called on an arrival that a mod's own submitted prompt carries (`plugin` → `mcp_result`). */
const A_MODS_OWN_TURN = 'mcp_result'

/** What the mod asks the launcher for: the next message this member has not taken in (martha#253). */
export const THE_NEXT_MESSAGE_ASK = 'take_a_crew_message'

/** The frame a message is handed in: its position, so the text a host raises back names one message and no other. */
export const framed = (position: number, from: string, text: string): string => `[crew #${position}] ${from}: ${text}`

/** What a member's launcher hands its session, one message at a time. */
export interface MessageCarrier {
  /** The next message this member has not taken in, framed, or null when there is none. */
  next(): Promise<string | null>
}

export interface CarryingTo {
  readonly member: string
  readonly host: ChannelHost
  /** What this launch raises turns to: a handed message counts only when the host raises it back. */
  readonly turns: TurnRaising
}

/** The carrier for one member of one crew, listening for the turns that take its messages in. */
export function carryingTo(input: CarryingTo): MessageCarrier {
  /** The message last handed, until the host raises it back; a message handed and not raised is handed again. */
  let handed: { readonly position: number; readonly text: string } | null = null

  const takeIn = async (turn: ArrivingTurn): Promise<void> => {
    const waiting = handed
    if (waiting === null || turn.text !== waiting.text) return
    if (!('source' in turn.arrival) || turn.arrival.source !== A_MODS_OWN_TURN) return
    handed = null
    try {
      await keepTakenIn(input.host, input.member, waiting.position)
    } catch {
      // The row was not kept, so the message was not taken in: it is offered again rather than counted.
      handed = waiting
    }
  }

  input.turns.onTurn((turn) => void takeIn(turn))

  return {
    async next(): Promise<string | null> {
      const [taken, messages] = await Promise.all([takenInBy(input.host, input.member), readTheChannel(input.host)])
      const nextOne = messages.find(({ position, message }) => !taken.has(position) && forThisMember(message, input.member))
      if (nextOne === undefined) return null
      handed = { position: nextOne.position, text: framed(nextOne.position, nextOne.message.from, nextOne.message.text) }
      return handed.text
    },
  }
}

/** Whether a message is this member's to take in: the whole crew's, or its own by name — never its own send to the crew. */
const forThisMember = (message: { readonly from: string; readonly to: readonly string[] | 'crew' }, member: string): boolean =>
  message.to === 'crew' ? message.from !== member : addressedTo(message, member)
