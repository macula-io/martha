// One member of a crew saying something to another, or to all of them (martha#253, slice 1).
//
// This exists so a hand-off and a verdict can travel between members without the owner carrying them. The member
// says `say_to_the_crew {to, text}`; the message is one row of the crew's channel, and the send is announced and concluded
// in the ledger of the package the member holds, as a `room_message`, so a member refreshed mid-send finds the act
// it never saw confirmed instead of hoping it asked.
//
// A name that is not on the declaration's roster is an addressing mistake, not a refusal to send: the answer names
// the roster, and nothing is written. Nothing here checks who the sender is: the sender is the member the launcher
// started, and under the owner's reset of 2026-11-11 a roster name is enough.
//
// The send goes through the recovery (martha#512 slice 2, ../recover_a_failed_act): a send whose row was not kept is
// sent once more, one whose outcome was not kept is looked for in the channel and never sent twice, and a package that
// stands paused holds it. The one message a pause lets through is one addressed only to those the crew's nudges go to,
// so a member on a paused package can still report; it passes the hold and nothing else.
//
// What does not stop a send is said in one line beside it (martha#601): a message longer than LONGEST_MESSAGE goes as it
// is, and a hand-off or verdict line that does not read goes as prose with the field that did not read named.

import { sameMemberName } from '../declare_crew/declare_crew.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { type Addressee, type ChannelHost, appendToTheChannel, readTheChannel, THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import { PackagePaused, RecoveryDecided, sendAnActAndRecover, type AnInspection } from '../recover_a_failed_act/recover_a_failed_act.ts'
import { linesACardTeaches } from '../read_a_crew_line/crew_lines.ts'
import { keepTheLinesRow, readEveryCrewLine, type CrewLineRead } from '../read_a_crew_line/read_a_crew_line.ts'

/** The name the crew registers this tool under (martha#343): the one tool that speaks, and it speaks to the crew. */
export const SAY_TO_THE_CREW = 'say_to_the_crew'

/**
 * What the tool says it is for, as the model reads it. The shapes a hand-off and a verdict take are not written here:
 * they are the lines the cards teach, generated from the one definition in crew_lines.ts, so what a member is told and
 * what a sent line is read against cannot drift apart (Mercurius, r=1: the generated lines reached no member at all).
 */
export const CREW_SAY_DESCRIPTION = [
  'A message to another member of this crew, or to all of them: a hand-off, a verdict, a question, a remark. It reaches the member as a turn of its own session; there is nothing to poll.',
  'A hand-off and a verdict each open with a line of their own, read as they are sent; the others are read as words:',
  ...linesACardTeaches().map(({ line, says }) => `${line} — ${says}`),
].join('\n')

/** What a member says, and to whom. */
export interface Saying {  /** The member the launcher started: never the model's to supply. */
  readonly member: string
  /** The members of this crew, in the declaration's order. */
  readonly roster: readonly string[]
  /** Who the crew's nudges go to: a message only to them passes a pause on the package (martha#512 slice 2). */
  readonly receivers: readonly string[]
  /** The package this member holds, whose ledger the send is announced in; null when it holds none. */
  readonly package: string | null
  readonly to: unknown
  readonly text: unknown
}

/** What became of a send: the message's position in the channel and the line the member is told, or why it was not sent. */
export type SendOutcome = { readonly sent: number; readonly told: string } | { readonly refused: string }

/**
 * The longest text one message should carry, so the channel does not grow into a document store. A longer message is
 * sent as it is, with one line saying it is long (martha#601).
 */
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

  if (to === THE_WHOLE_CREW) return THE_WHOLE_CREW
  if (Array.isArray(to)) return named(to)
  return { refused: `"to" is a list of members' names, or "${THE_WHOLE_CREW}" for every member. The crew is ${roster.join(', ')}. Nothing was sent.` }
}

/** The line the member is told once its message is in the channel. */
const toldOf = (sent: number, to: Addressee): string =>
  to === THE_WHOLE_CREW ? `sent as message ${sent} to the whole crew.` : `sent as message ${sent} to ${to.join(', ')}.`

/** Whether an address is the refusal of one: an array is a list of names, and 'crew' is the crew. */
const isRefusal = (value: Addressee | { readonly refused: string }): value is { readonly refused: string } => !Array.isArray(value) && value !== THE_WHOLE_CREW

/** A message that reads: who it is for, its text, every crew line it carries (martha#980), and what was noticed about it. */
interface AMessageRead {
  readonly to: Addressee
  readonly text: string
  readonly lines: readonly CrewLineRead[]
  /** One line about what Martha carried on past (martha#601): an over-long message, or a line read as prose. */
  readonly notice?: string
}

/** Reads a message before anything is sent: its text, who it is for, and a hand-off or verdict line; or why not. */
function theMessageRead(input: Saying): AMessageRead | { readonly refused: string } {
  if (typeof input.text !== 'string' || input.text.trim() === '') return { refused: 'a message needs its text. Nothing was sent.' }
  const to = addresseesOf(input.to, input.roster)
  if (isRefusal(to)) return { refused: to.refused }
  // Every crew line is read before the message goes out (martha#980): one that does not read goes as prose, with one
  // line naming the field, so the message still reaches the crew (martha#601).
  const reading = readEveryCrewLine(input.text)
  const notices = [
    ...(input.text.length > LONGEST_MESSAGE
      ? [`a message is at most ${LONGEST_MESSAGE} characters, and this one is ${input.text.length}: it was sent as it is.`]
      : []),
    ...reading.notices,
  ]
  return { to, text: input.text, lines: reading.lines, ...(notices.length === 0 ? {} : { notice: notices.join(' ') }) }
}

/** Keeps each crew line's row, in the order the message carries them. */
async function keepEveryLinesRow(host: LedgerHost, member: string, lines: readonly CrewLineRead[]): Promise<void> {
  for (const line of lines) await keepTheLinesRow(host, member, line)
}

/** The one line a send adds about what it carried on past, or nothing. */
const theNoticeSaid = (notice: string | undefined): string => (notice === undefined ? '' : ` notice: ${notice}`)

/** Says one thing, keeps the row first, and concludes the act: what the member is told, or why nothing was sent. */
export async function sendACrewMessage(host: ChannelHost & LedgerHost, input: Saying): Promise<SendOutcome> {
  const read = theMessageRead(input)
  if ('refused' in read) return read
  const { to, text } = read
  let sent = 0
  const send = async (): Promise<string> => {
    sent = await appendToTheChannel(host, { from: input.member, to, text, sent_at: host.clock.now() })
    return toldOf(sent, to)
  }

  // A member holding no package has no ledger stream to announce the send in, and its successor will hold none
  // either: the message is still sent, and the answer says that nothing was announced to a package.
  if (input.package === null) {
    const told = await send()
    await keepEveryLinesRow(host, input.member, read.lines)
    return { sent, told: `${told} No package was held, so nothing was announced to a package's ledger.${theNoticeSaid(read.notice)}` }
  }

  const since = host.clock.now()
  const look = async (): Promise<AnInspection> => {
    const found = theMessageIn(await readTheChannel(host), { from: input.member, to, text, since })
    if (found === undefined) return { state: 'it_did_not_happen', read: 'the crew channel', found: `no message from ${input.member} with this text` }
    sent = found
    return { state: 'it_happened', read: 'the crew channel', found: `the message is there as message ${String(found)}` }
  }
  const sending = await sentThroughTheRecovery(host, { ...input, package: input.package }, read, { send, look })
  if ('refused' in sending) return sending
  await keepEveryLinesRow(host, input.member, read.lines)
  return { sent, told: `${sending.told}${theNoticeSaid(read.notice)}` }
}

/** The send of a message on a package, through the recovery: what it said, or the recovery's own words for why not. */
async function sentThroughTheRecovery(
  host: ChannelHost & LedgerHost,
  input: Saying & { readonly package: string },
  read: AMessageRead,
  ways: { readonly send: () => Promise<string>; readonly look: () => Promise<AnInspection> },
): Promise<{ readonly told: string } | { readonly refused: string }> {
  const act = { package: input.package, member: input.member, act: { kind: 'room_message', what: whatOf(read.to, read.text) } } as const
  try {
    return { told: await sendAnActAndRecover(host, act, ways.send, ways.look, { passes_the_hold: isAReportToTheReceivers(read.to, input.receivers) }) }
  } catch (failure) {
    if (failure instanceof PackagePaused) return { told: await ways.send() }
    if (failure instanceof RecoveryDecided) return { refused: failure.told }
    throw failure
  }
}

/**
 * Whether a message is a report a pause lets through (martha#512 slice 2, Q1): addressed by name, and only to those the
 * crew's nudges go to. A message to the whole crew reaches every member, so it is not one.
 */
const isAReportToTheReceivers = (to: Addressee, receivers: readonly string[]): boolean =>
  to !== THE_WHOLE_CREW && receivers.length > 0 && to.every((name) => receivers.some((receiver) => sameMemberName(name, receiver)))

/** The position of this member's message in the channel, sent since the send began: the look a recovery reads. */
function theMessageIn(
  channel: readonly { readonly position: number; readonly message: { readonly from: string; readonly to: Addressee; readonly text: string; readonly sent_at: number } }[],
  sought: { readonly from: string; readonly to: Addressee; readonly text: string; readonly since: number },
): number | undefined {
  const same = (to: Addressee): boolean => JSON.stringify(to) === JSON.stringify(sought.to)
  return channel.find(({ message }) => message.from === sought.from && message.text === sought.text && message.sent_at >= sought.since && same(message.to))?.position
}

/** What the act acts on, in one line, as the ledger's own words ask. */
const whatOf = (to: Addressee, text: string): string => `to ${to === THE_WHOLE_CREW ? 'the crew' : to.join(', ')}: ${text.split('\n')[0]?.slice(0, 120) ?? ''}`
