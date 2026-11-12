// Where a crew's messages live, and the only way one is written or read back (martha#253, slice 1).
//
// This exists so every slice of the crew channel reads one shape and one set of stream names. A message is one row
// of `crew_channel`, in the crew's one rows store: who sent it, who it is for, its text, and when it was sent. Its
// position in the stream is its message id, so a reader can name one message without a second index.
//
// What a member took in is a row of that member's own stream, `crew_channel_taken/<member>`, holding the position of
// the message it took in. Both are append-only, as every stream here is: nothing is rewritten, so a member refreshed
// mid-read finds the same channel its predecessor read.
//
// Two members can send at once. An append that finds the stream moved (ROW_STREAM_MOVED) reads again and appends
// behind what landed, so neither send is lost; the store's own expected-length append is what tells it the stream
// moved, and no row is ever appended over another.

import type { HostContract, Row, StoredRow } from '../host_contract/host_contract.ts'
import { ROW_STREAM_MOVED } from '../host_contract/host_contract.ts'

/** The stream the crew's messages live in, in the crew's one rows store. */
export const CHANNEL_STREAM = 'crew_channel'

/** The stream that records what one member took in. Keyed by the member's name, never by a session's. */
export const takenStreamOf = (member: string): string => `crew_channel_taken/${member}`

/** Who a message is for: the members it names, or the whole crew. */
export type Addressee = readonly string[] | 'crew'

/** One message of the crew's channel, as it is kept. */
export interface ChannelRow {
  /** The member the launcher started: the model never supplies it. */
  readonly from: string
  readonly to: Addressee
  readonly text: string
  /** Milliseconds since the epoch, from the host's clock. */
  readonly sent_at: number
}

/** One message as a reader sees it: the row, and the position that is its id. */
export interface PlacedMessage {
  readonly position: number
  readonly message: ChannelRow
}

/** What the channel needs of a host: its clock and the rows the crew shares. */
export type ChannelHost = Pick<HostContract, 'clock'> & { readonly stores: { readonly rows: HostContract['stores']['rows'] } }

/** How many times a send reads the stream again after another writer moved it. */
export const SEND_ATTEMPTS = 5

const isText = (value: unknown): value is string => typeof value === 'string'

/** Whether a row read back is one this slice wrote: a stream another code wrote into is not read as messages. */
export function isChannelRow(row: Row): row is Row & ChannelRow {
  if (!isText(row['from']) || !isText(row['text']) || typeof row['sent_at'] !== 'number') return false
  const to = row['to']
  return to === 'crew' || (Array.isArray(to) && to.every(isText))
}

/** Appends one message to the channel and answers its position, the message's id. */
export async function appendToTheChannel(host: ChannelHost, message: ChannelRow): Promise<number> {
  for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
    const held = await host.stores.rows.read(CHANNEL_STREAM)
    const outcome = await appendedOnce(host, message, held.length)
    if (typeof outcome === 'number') return outcome
    if (!streamMoved(outcome) || attempt === SEND_ATTEMPTS) throw outcome
  }
  // Unreachable: the last attempt either answers or throws above.
  throw new Error(`the channel did not keep a message after ${SEND_ATTEMPTS} attempts`)
}

/** One append that expects the stream at `length`, as its position or the error the store refused it with. */
async function appendedOnce(host: ChannelHost, message: ChannelRow, length: number): Promise<number | Error> {
  try {
    return await host.stores.rows.append(CHANNEL_STREAM, message as unknown as Row, length)
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/** Whether an append was refused because another writer moved the stream first. */
const streamMoved = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === ROW_STREAM_MOVED

/** Every message of the channel, oldest first. */
export async function readTheChannel(host: ChannelHost): Promise<readonly PlacedMessage[]> {
  return placed(await host.stores.rows.read(CHANNEL_STREAM))
}

/** Whether a message is for this member: it names the member, or it names the whole crew. */
export function addressedTo(message: Pick<ChannelRow, 'to'>, member: string): boolean {
  return message.to === 'crew' || message.to.includes(member)
}

/** Records that a member took one message in. */
export async function keepTakenIn(host: ChannelHost, member: string, position: number): Promise<void> {
  await host.stores.rows.append(takenStreamOf(member), { took_in: position })
}

/**
 * Every took-in row a member has, one entry per row, oldest first: a message taken in twice is two entries of the same
 * position. `takenInBy` reads the same rows as a set, which is the question "did it take this in at all"; this is the
 * question "how many times", which a run that re-offers a message has to be able to ask (martha#253).
 */
export async function tookInRowsOf(host: ChannelHost, member: string): Promise<readonly number[]> {
  const rows: readonly StoredRow[] = await host.stores.rows.read(takenStreamOf(member))
  return rows.flatMap(({ row }) => (typeof row['took_in'] === 'number' ? [row['took_in']] : []))
}

/** The positions a member has taken in, as its own stream records them. */
export async function takenInBy(host: ChannelHost, member: string): Promise<ReadonlySet<number>> {
  return new Set(await tookInRowsOf(host, member))
}

/** The messages the channel really holds, each with the position that is its id. */
function placed(rows: readonly StoredRow[]): readonly PlacedMessage[] {
  return rows.flatMap(({ position, row }) => (isChannelRow(row) ? [{ position, message: { from: row.from, to: row.to, text: row.text, sent_at: row.sent_at } }] : []))
}
