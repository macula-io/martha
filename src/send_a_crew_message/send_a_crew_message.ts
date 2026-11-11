// One member of a crew saying something to another, or to all of them (martha#253, slice 1).
//
// This exists so a hand-off and a verdict can travel between members without the owner carrying them. The member
// says `crew_say {to, text}`; the message is one row of the crew's channel, and the send is announced and concluded
// in the ledger of the package the member holds, as a `room_message`, so a member refreshed mid-send finds the act
// it never saw confirmed instead of hoping it asked.
//
// A name that is not on the declaration's roster is an addressing mistake, not a refusal to send: the answer names
// the roster, and nothing is written. Nothing here checks who the sender is: the sender is the member the launcher
// started, and under the owner's reset of 2026-11-11 a roster name is enough.

import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { sendOutwardAct } from '../log_ledger/log_ledger.ts'
import { type Addressee, type ChannelHost, appendToTheChannel } from '../keep_the_crew_channel/crew_channel.ts'

/** What the tool says it is for, as the model reads it. */
export const CREW_SAY_DESCRIPTION =
  'A message to another member of this crew, or to all of them: a hand-off, a verdict, a question, a remark. It reaches the member as a turn of its own session; there is nothing to poll.'

/** What a member says, and to whom. */
export interface Saying {  /** The member the launcher started: never the model's to supply. */
  readonly member: string
  /** The members of this crew, in the declaration's order. */
  readonly roster: readonly string[]
  /** The package this member holds, whose ledger the send is announced in; null when it holds none. */
  readonly package: string | null
  readonly to: unknown
  readonly text: unknown
}

/** What became of a send: the message's position in the channel and the line the member is told, or why it was not sent. */
export type SendOutcome = { readonly sent: number; readonly told: string } | { readonly refused: string }

/** The longest text one message may carry, so a message cannot grow into a document the channel is not for. */
export const LONGEST_MESSAGE = 20_000

/** Who the message is for, as the argument names them; or why it names nobody this crew can take. */
export function addresseesOf(to: unknown, roster: readonly string[]): Addressee | { readonly refused: string } {
  const named = (value: readonly unknown[]): string[] | { readonly refused: string } => {
    const names = value.filter((name): name is string => typeof name === 'string' && name !== '')
    if (names.length === 0 || names.length !== value.length) return { refused: `"to" names at least one member, each a member's name. The crew is ${roster.join(', ')}. Nothing was sent.` }
    const strangers = names.filter((name) => !roster.includes(name))
    if (strangers.length > 0) {
      return { refused: `${strangers.map((name) => JSON.stringify(name)).join(', ')} ${strangers.length === 1 ? 'is not a member' : 'are not members'} of this crew. The crew is ${roster.join(', ')}. Nothing was sent.` }
    }
    return names
  }

  if (to === 'crew') return 'crew'
  if (Array.isArray(to)) return named(to)
  return { refused: `"to" is a list of members' names, or "crew" for every member. The crew is ${roster.join(', ')}. Nothing was sent.` }
}

/** The line the member is told once its message is in the channel. */
const toldOf = (sent: number, to: Addressee): string =>
  to === 'crew' ? `sent as message ${sent} to the whole crew.` : `sent as message ${sent} to ${to.join(', ')}.`

/** Whether an address is the refusal of one: an array is a list of names, and 'crew' is the crew. */
const isRefusal = (value: Addressee | { readonly refused: string }): value is { readonly refused: string } => !Array.isArray(value) && value !== 'crew'

/** Says one thing, keeps the row first, and concludes the act: what the member is told, or why nothing was sent. */
export async function sendACrewMessage(host: ChannelHost & LedgerHost, input: Saying): Promise<SendOutcome> {
  if (typeof input.text !== 'string' || input.text.trim() === '') return { refused: 'a message needs its text. Nothing was sent.' }
  if (input.text.length > LONGEST_MESSAGE) return { refused: `a message is at most ${LONGEST_MESSAGE} characters. Nothing was sent.` }
  const to = addresseesOf(input.to, input.roster)
  if (isRefusal(to)) return { refused: to.refused }

  const text = input.text
  let sent = 0
  const send = async (): Promise<string> => {
    sent = await appendToTheChannel(host, { from: input.member, to, text, sent_at: host.clock.now() })
    return toldOf(sent, to)
  }

  // A member holding no package has no ledger stream to announce the send in, and its successor will hold none
  // either: the message is still sent, and the answer says that nothing was announced to a package.
  if (input.package === null) {
    const told = await send()
    return { sent, told: `${told} No package was held, so nothing was announced to a package's ledger.` }
  }

  const told = await sendOutwardAct(host, { package: input.package, member: input.member, act: { kind: 'room_message', what: whatOf(to, text) } }, send)
  return { sent, told }
}

/** What the act acts on, in one line, as the ledger's own words ask. */
const whatOf = (to: Addressee, text: string): string => `to ${to === 'crew' ? 'the crew' : to.join(', ')}: ${text.split('\n')[0]?.slice(0, 120) ?? ''}`
