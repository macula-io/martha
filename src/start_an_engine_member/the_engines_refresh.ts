// An engine member's refresh (martha#999 package 5, gap 7 row 7 and the Supervisor's ruling 3): the launch asks the
// crew's refresh question at the engine member's session start and after each of its turns, with the context the
// engine reported, and carries the act it is answered with.
//
// This exists because a martha-engine member never asked the question: Claude Code's crew mod asks it from its hooks
// (../claude_code_relay/hooks/crew.tsx `takeTheAct`), and the engine has no mod. Without it the member has no context
// share on its row, the limit handover never starts, and the wake cannot tell a member past its limit.
//
// The question is the mod's own, sent through the launch's crew tools as the member's session sends it, so the flow in
// ../refresh_a_member/the_refresh_flow.ts decides for both hosts alike. The engine's usage is ACP's `usage_update`
// (../speak_acp_to_an_agent/the_acp_client.ts `usageOf`), turned into the usage shape the flow reads
// (../keep_what_a_session_spent/the_hosts_usage.ts). The acts carried are the prompt, sent as the member's next turn
// ahead of any other, and the clear (martha#1002, option B): the launch opens a new ACP session on the same engine,
// records its start, and asks the question at that session's start, so the resume the flow holds for the member is the
// new session's first turn. An order this launch does not carry (a model switch, the end of a running turn, a clear at
// a session's own start) is told to the owner by name, never dropped silently.

import { randomUUID } from 'node:crypto'

import { ARRIVAL_OF_A_PLUGINS_PROMPT } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import { CARRY_A_TEXT, CARRY_THE_CLEAR, THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import type { AnAgentsUsage, ATurn } from '../speak_acp_to_an_agent/the_acp_client.ts'
import type { ATurnToSend } from '../send_an_engine_member_its_turns/the_engine_members_turns.ts'

/** The currency a cost is kept in: the flow keeps a session's cost in US dollars, as martha-engine prices it (acp/server.rs `Cost::new(amount, "USD")`). */
export const THE_CURRENCY_A_COST_IS_KEPT_IN = 'USD'

/** A share of a whole, as the flow reads a context share. */
const A_WHOLE_IN_PERCENT = 100

/**
 * The engine's usage in the shape the flow reads a host's usage in: the session's start, the context share when the
 * engine reported one, and the cost when it priced it in the currency the flow keeps. A session the engine said nothing
 * of yet carries only its start, which the flow reads as no share at all.
 */
export function theEnginesUsageAsAHostsUsage(usage: AnAgentsUsage | undefined, started_at: number): Readonly<Record<string, unknown>> {
  const context = usage === undefined ? {} : { context: { percent: (usage.used / usage.size) * A_WHOLE_IN_PERCENT } }
  const cost = usage?.cost?.currency === THE_CURRENCY_A_COST_IS_KEPT_IN ? { cost: { usd: usage.cost.amount } } : {}
  return { startedAt: started_at, ...context, ...cost }
}

/** Where a turn the launch sends on the crew's account is recorded from: as Claude Code records the crew mod's own prompt. */
export const THE_ARRIVAL_OF_A_REFRESH_PROMPT = ARRIVAL_OF_A_PLUGINS_PROMPT

/** What the launch heard: the crew tools' answer, or why there was none. */
export type Heard = { readonly said: string } | { readonly why: string }

/** What an engine member's refresh is given by its launch. */
export interface TheEnginesRefreshPlaces {
  readonly member: string
  /** The engine's session, and when the launch opened it. */
  readonly session_id: string
  readonly started_at: number
  /** The usage the engine last reported for a session. */
  readonly usageOf: (session_id: string) => AnAgentsUsage | undefined
  /** Asks the launch's crew tools as the session asks them, in the launch's order. */
  readonly ask: (session_id: string, tool: string, args: Readonly<Record<string, unknown>>) => Promise<Heard>
  /** Tells the owner what the launch could not carry. */
  readonly tell: (line: string) => void
  /** The clear: the next session opened and its start recorded, or why not (martha#1002). */
  readonly clear: () => Promise<{ readonly session_id: string; readonly started_at: number } | { readonly why: string }>
}

/** An engine member's refresh: the turn that follows its session's start or one of its turns. */
export interface TheEnginesRefresh {
  /** The question at the session's start, and the turn its act sends, if any. */
  atTheStart(): Promise<ATurnToSend | undefined>
  /** The question after a turn that ended, and the turn its act sends, if any. */
  afterATurn(ended: unknown): Promise<ATurnToSend | undefined>
  /** The question once the owner typed `/crew-refresh now` (martha#999 package 3), and the turn its act sends, if any. */
  onTheOwnersNow(): Promise<ATurnToSend | undefined>
}

/** The order the crew answered with, read as the mod reads it: a text, or another word. Null when it is neither. */
export function anOrderIn(said: string): { readonly carry: typeof CARRY_A_TEXT; readonly text: string } | { readonly carry: string } | null {
  let order: unknown
  try {
    order = JSON.parse(said)
  } catch {
    return null
  }
  if (typeof order !== 'object' || order === null || Array.isArray(order)) return null
  const { carry, text } = order as Record<string, unknown>
  if (carry === CARRY_A_TEXT) return typeof text === 'string' && text !== '' ? { carry, text } : null
  return typeof carry === 'string' ? { carry } : null
}

/** The line the owner is told when an act cannot be carried. */
export const theLineOfAnActNotCarried = (member: string, why: string): string => `Martha did not carry ${member}'s refresh act: ${why}`

/**
 * What the owner is told of a clear ordered at a session's own start: the session is already fresh, and carrying it
 * would open sessions without end.
 */
export const THE_CLEAR_AT_A_START = 'a clear ordered at a session\'s start is not carried: the session is already new'

/** The word an order says nothing under: the flow's `'none'`, spelled as ../refresh_a_member/the_refresh_flow.ts `theOrderOf` gives it. */
const NOTHING_ORDERED = 'none'

/** The refresh of one engine member. */
export function theEnginesRefresh(places: TheEnginesRefreshPlaces): TheEnginesRefresh {
  let current: { readonly session_id: string; readonly started_at: number } = { session_id: places.session_id, started_at: places.started_at }
  const question = (turn_id: string, answer: string): Readonly<Record<string, unknown>> => ({
    usage: theEnginesUsageAsAHostsUsage(places.usageOf(current.session_id), current.started_at),
    turn_id,
    answer,
  })
  const notCarried = (why: string): undefined => void places.tell(theLineOfAnActNotCarried(places.member, why))
  const atTheStart = async (): Promise<ATurnToSend | undefined> => carried(await places.ask(current.session_id, THE_REFRESH_ASK, question('', '')), true)
  /** The clear carried: the next session, then the question at its start, whose act is its first turn. */
  const cleared = async (): Promise<ATurnToSend | undefined> => {
    const next = await places.clear()
    if ('why' in next) return notCarried(next.why)
    current = next
    return atTheStart()
  }
  const carried = async (heard: Heard, at_a_start: boolean): Promise<ATurnToSend | undefined> => {
    if ('why' in heard) return notCarried(heard.why)
    const order = anOrderIn(heard.said)
    if (order === null || order.carry === NOTHING_ORDERED) return undefined
    if ('text' in order) return { text: order.text, arrival: THE_ARRIVAL_OF_A_REFRESH_PROMPT }
    if (order.carry !== CARRY_THE_CLEAR) return notCarried(`an engine member is not ordered to ${order.carry}`)
    return at_a_start ? notCarried(THE_CLEAR_AT_A_START) : cleared()
  }
  return {
    atTheStart,
    // The engine stamps no turn of its own: each ended turn gets a fresh id, the one the flow's question needs, and a
    // turn's answer is the text the engine streamed in it.
    afterATurn: async (ended) => carried(await places.ask(current.session_id, THE_REFRESH_ASK, question(randomUUID(), (ended as Partial<ATurn> | undefined)?.text ?? '')), false),
    // Asked as Claude Code's mod asks it after the owner's `now` (martha#999 package 3): no turn ended, so none is named.
    onTheOwnersNow: async () => carried(await places.ask(current.session_id, THE_REFRESH_ASK, question('', '')), false),
  }
}
