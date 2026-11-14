// Handing a crew's messages to the member they are for (martha#253, slice 2), and counting one taken in (slice 3).
//
// This exists so a message reaches a member as a turn of its own session, with no room to poll and no message left
// sitting where nobody reads it. The member's mod asks the launcher for the next message it has not taken in; the
// launcher reads the channel past what that member took in and answers with the next one, framed so its position is
// part of the text — `[crew #<position>] <sender>: <text>`. The mod submits that text as a prompt while the session
// is idle, and the host queues it into the next main turn it starts.
//
// Being handed is not being taken in. The taken row is written when the mod reports that the member's next MAIN turn
// started after the hand-over (`turn.start` with no `agentId`): that is the turn the host drains the queued prompt
// into. The host does not raise every submit back through the prompt hook: a submit the interval tick made into an
// idle session reached the model and was never raised (martha#253, Pallas's live run on 93437b7), so the raise is no
// writer. The host fires `turn.start` for every turn, whatever path dispatched it (Pluto's ruling, side (a)). A
// subagent's turn start carries its agent and counts nothing: it can arrive while the member is idle with a message
// handed. A message is handed **once per session**: the host queues every prompt a mod submits until it is next idle,
// so handing the same text again on each read tick put one message into the model's context once per tick (Mercurius,
// r=1, seen live on the recorded host: ten copies of one message, one taken row). While a handed message waits for its
// turn the carrier hands nothing, and a session that ends before that turn starts writes nothing, so the next
// session's carrier hands the message again. Being late is acceptable; being lost is not, and neither is being read
// ten times.

import { type ChannelHost, addressedTo, keepTakenIn, readTheChannel, takenInBy } from '../keep_the_crew_channel/crew_channel.ts'

/** What the mod asks the launcher for: the next message this member has not taken in (martha#253). */
export const THE_NEXT_MESSAGE_ASK = 'take_a_crew_message'

/** What the mod tells the launcher at every turn start, with the agent the host stamped on it, if any (martha#253). */
export const THE_TURN_STARTED_ASK = 'a_turn_started'

/** What every handed message's text opens with, before the position it names: a reader tells a crew's turn by it. */
export const FRAME_OPENING = '[crew #'

/** The frame a message is handed in: its position, so the text the model reads names one message and no other. */
export const framed = (position: number, from: string, text: string): string => `${FRAME_OPENING}${position}] ${from}: ${text}`

/** What a member's launcher hands its session, one message at a time. */
export interface MessageCarrier {
  /** The next message this member has not taken in, framed; or null when there is none, or when the one already
   * handed has not been taken in yet. */
  next(): Promise<string | null>
  /** A turn started in the member's session: the first MAIN turn after a hand-over takes the handed message in. A
   * subagent's turn (one that carries an `agentId`) counts nothing. */
  aTurnStarted(agentId?: unknown): Promise<void>
}

export interface CarryingTo {
  readonly member: string
  readonly host: ChannelHost
}

/** Whether a turn start is a subagent's: the host stamps those with the agent they belong to, and the main turn with none. */
const aSubagents = (agentId: unknown): boolean => agentId !== undefined

/** The carrier for one member of one crew: it hands one message at a time and counts it at the next main turn. */
export function carryingTo(input: CarryingTo): MessageCarrier {
  /** The position last handed, until a main turn starts; a message handed and not taken in is handed again. */
  let handed: number | null = null

  return {
    async next(): Promise<string | null> {
      // One message per session at a time: what was handed and not yet taken in is not handed again, because the host
      // queues each submit until it is idle and the model would read the same message once per read tick.
      if (handed !== null) return null
      const [taken, messages] = await Promise.all([takenInBy(input.host, input.member), readTheChannel(input.host)])
      const nextOne = messages.find(({ position, message }) => !taken.has(position) && forThisMember(message, input.member))
      if (nextOne === undefined) return null
      handed = nextOne.position
      return framed(nextOne.position, nextOne.message.from, nextOne.message.text)
    },
    async aTurnStarted(agentId?: unknown): Promise<void> {
      const waiting = handed
      if (waiting === null || aSubagents(agentId)) return
      handed = null
      try {
        await keepTakenIn(input.host, input.member, waiting)
      } catch {
        // The row was not kept, so the message was not taken in: it is offered again rather than counted.
        handed = waiting
      }
    },
  }
}

/**
 * The mod's two asks of the channel (martha#253), answered by this launch's carrier: the next message to hand, or ''
 * when none is waiting; and a turn start, with the agent the host stamped on it. Undefined for any other ask.
 */
export async function answerAChannelAsk(
  carrier: MessageCarrier | undefined,
  name: string,
  args: Readonly<Record<string, unknown>>,
): Promise<{ readonly answer: string } | { readonly refused: string } | undefined> {
  if (name !== THE_NEXT_MESSAGE_ASK && name !== THE_TURN_STARTED_ASK) return undefined
  if (carrier === undefined) return { refused: 'this launch reads no crew channel' }
  if (name === THE_NEXT_MESSAGE_ASK) return { answer: (await carrier.next()) ?? '' }
  await carrier.aTurnStarted(args['agentId'])
  return { answer: '' }
}

/** Whether a message is this member's to take in: the whole crew's, or its own by name — never its own send to the crew. */
const forThisMember = (message: { readonly from: string; readonly to: readonly string[] | 'crew' }, member: string): boolean =>
  message.to === 'crew' ? message.from !== member : addressedTo(message, member)
