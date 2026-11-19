// The night's watch claims (martha#843, #601 Done when 4): the owner watched the builder's terminal read-only, the
// builder's ring was sent to a client attached there, and the VERDICT line was drawn on that screen.
//
// What tmux sends a client is read from the proof's own read-only client on the builder's session, which records every
// byte it is sent. The owner's own client is not readable: what it is shown is what tmux sends every client of that
// session at that moment, and the listing of the session's clients, taken at the ring, shows the owner's was one of
// them. So this proves what tmux sent while the owner was attached, never what the owner's terminal drew.
//
// The ring is matched in the bytes as they were sent, since a terminal reads its escape that way. The VERDICT line is
// matched on the screen as drawn: escapes and every whitespace taken out of both, since a full-screen host places its
// words by moving the cursor and wraps a long line wherever its width falls.

import { notificationIdOf, NOTIFICATION_ESCAPE } from '../ring_the_owner/ring_the_owner.ts'
import { THE_VERDICT, type TheNight } from './the_nights_claims.ts'

/** The rows this module proves, by the name a failure is reported under. */
export const THE_OWNER_WATCHED = 'the owner watched read-only'
export const THE_RING_REACHED = "the builder's ring was sent to the owner's screen"
export const THE_VERDICT_WAS_SHOWN = "the verdict was on the owner's screen"

/** The flag tmux lists a read-only client with (`list-clients -F '#{client_flags}'`, read on tmux 3.3a). */
export const READ_ONLY_FLAG = 'read-only'

/** One client of the builder's session, as `list-clients -F '#{client_pid} #{client_tty} #{client_flags}'` lists it. */
interface AClient {
  readonly pid: string
  readonly tty: string
  readonly flags: readonly string[]
}

/** Every client a listing names; a line that is not `<pid> <tty> <flags>` names none. */
function theClients(listing: string): AClient[] {
  return listing.split('\n').flatMap((line) => {
    const [pid, tty, flags, ...rest] = line.trim().split(' ')
    if (pid === undefined || tty === undefined || flags === undefined || rest.length > 0 || !/^\d+$/.test(pid)) return []
    return [{ pid, tty, flags: flags.split(',') }]
  })
}

/** CSI, OSC (to BEL or ST), DCS and two-byte escapes: what a terminal acts on and does not draw. */
const ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001bP[^\u001b]*\u001b\\|\u001b[@-_]/g

/** `text` as matched on a drawn screen: its escapes and all its whitespace taken out. */
export const drawnPlain = (text: string): string => text.replace(ESCAPES, '').replace(/\s+/g, '')

/**
 * The first watch row the record does not show, as `<row>: <why>`, or undefined when all three hold.
 *
 * `watched` is every byte the proof's own read-only client was sent, `clients` the session's listing at the ring, and
 * `recorder` the pid of the proof's own client in that listing, which is never the owner's.
 */
export function whichWatchClaimFails(night: Pick<TheNight, 'builder' | 'package'>, watched: string, clients: string, recorder: string): string | undefined {
  const listed = theClients(clients)
  if (!listed.some((one) => one.pid === recorder)) return `${THE_OWNER_WATCHED}: the proof's own client (pid ${recorder}) is not in the listing, so it cannot be told from the owner's`
  const owners = listed.filter((one) => one.pid !== recorder)
  if (owners.length === 0) return `${THE_OWNER_WATCHED}: no client but the proof's own was attached to ${night.builder}'s session at the ring`
  if (!owners.some((one) => one.flags.includes(READ_ONLY_FLAG))) return `${THE_OWNER_WATCHED}: no client of the owner's on ${night.builder}'s session is ${READ_ONLY_FLAG}`
  const ring = `${NOTIFICATION_ESCAPE}i=${notificationIdOf(night.builder)}`
  if (!watched.includes(ring)) return `${THE_RING_REACHED}: no notification for ${night.builder} in what ${night.builder}'s session sent its clients`
  const verdict = `VERDICT ${night.package} ${THE_VERDICT}`
  if (!drawnPlain(watched).includes(drawnPlain(verdict))) return `${THE_VERDICT_WAS_SHOWN}: '${verdict}' was never drawn on ${night.builder}'s session`
  return undefined
}
