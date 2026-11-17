// The bell that rings when the host starts asking the owner something (martha#313): a bell in the member's own
// terminal, and a desktop notification beside it, from the row's change alone.
//
// This exists so an owner who is not looking at the dashboard learns that a member is being asked, once — on the change
// into "needs you", never on every beat. It is the host's word and not a member's report: a member that says it waits on
// the owner moves its row, and rings nothing, so the bell cannot be used as a nuisance by what it reports.
//
// The launcher holds the member's terminal (../start_the_member_on_the_owners_terminal/member_on_the_owners_terminal.ts), so these
// bytes go to the launcher's own terminal and nowhere else: a member started without one has no terminal to ring, and
// rings nothing. crew-code's ghost bell, which had to find its terminal by walking up to the process's own, cannot
// happen here by construction.
//
// What the notification carries is base64 and only base64, as crew-code's OSC 99 does: a question an MCP server wrote
// cannot end the escape sequence early, so no text a stranger wrote can steer the terminal it lands on.
//
// The sequence is the one kitty's desktop-notification protocol reads (martha#574): a title chunk that holds the
// notification open, then the body chunk that completes it, both saying their payload is base64 — a notification with no
// completing chunk is one kitty holds back forever, and one without `e=1` would show the base64 itself. Each member's
// notification carries its own id, so a second member asking does not take the first member's notification away, and the
// member that stops needing the owner takes its own notification down again (T5).

import { whatTheOwnerIsShown } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The bell a terminal rings: one byte, and nothing else. */
export const THE_BELL = '\u0007'

/** What the bell and the notification are switched by, as the declaration or the owner sets them. */
export interface TheBellsSwitch {
  readonly bell: boolean
  readonly notify: boolean
}

/** Neither: a launch that says nothing about its bells rings none, as every switch in the declaration is off unasked. */
export const NO_BELLS: TheBellsSwitch = { bell: false, notify: false }

/** The bells a crew's declaration asks for (martha#313): the bell and the notification both, or neither. */
export function theBellsTheOwnerDeclared(on: boolean): TheBellsSwitch {
  return { bell: on, notify: on }
}

/** The kitty notification protocol's opening, and the string terminator that ends it whatever it carried. */
export const NOTIFICATION_ESCAPE = '\u001b]99;'
export const NOTIFICATION_ENDING = '\u001b\\'

/**
 * The keys kitty's desktop-notification protocol reads (martha#574), by the protocol's own one-letter names: the
 * notification's identifier, whether this chunk completes it, whether the payload is base64, and which of the two a
 * chunk carries. Read from here wherever the sequence is written, so no key is spelled twice.
 */
const THE_NOTIFICATION_KEYS = { identifier: 'i', done: 'd', encoded: 'e', as: 'p' } as const

/** What `d` says of a chunk: more of the notification follows, or this is the last of it (martha#574). */
const MORE_OF_THE_NOTIFICATION_FOLLOWS = '0'
const THE_LAST_OF_THE_NOTIFICATION = '1'

/** What `e` says of a payload: base64-encoded UTF-8, which is what every chunk here carries (martha#574). */
const THE_PAYLOAD_IS_BASE64 = '1'

/** What `p` says a chunk carries, in the protocol's own two words, and the word that takes a notification away (martha#574). */
const THE_TITLE = 'title'
const THE_BODY = 'body'
const THE_CLOSE = 'close'

/** What an identifier may hold: letters, digits and `_ - + .`, never the `:` and `;` the sequence is built from (martha#574). */
const NOT_ALLOWED_IN_AN_IDENTIFIER = /[^A-Za-z0-9_+.-]/g

/** What Martha's own notifications are named by, before the member's name, so a terminal can tell them from another program's. */
const MARTHAS_NOTIFICATION = 'martha-'

/** A notification's id for one member, so each member's notification replaces only its own (martha#574). */
export const notificationIdOf = (member: string): string => `${MARTHAS_NOTIFICATION}${member.replaceAll(NOT_ALLOWED_IN_AN_IDENTIFIER, '')}`

/** The one line a desktop shows first: whose member is asking (martha#574). */
export const theTitleFor = (member: string): string => `${member} needs you`

/** One chunk: its metadata, then the payload as base64 and only base64, ended by the terminator (martha#574). */
function aChunk(id: string, done: string, as: string, words: string): string {
  const metadata = [
    `${THE_NOTIFICATION_KEYS.identifier}=${id}`,
    `${THE_NOTIFICATION_KEYS.done}=${done}`,
    `${THE_NOTIFICATION_KEYS.encoded}=${THE_PAYLOAD_IS_BASE64}`,
    `${THE_NOTIFICATION_KEYS.as}=${as}`,
  ].join(':')
  return `${NOTIFICATION_ESCAPE}${metadata};${Buffer.from(words, 'utf8').toString('base64')}${NOTIFICATION_ENDING}`
}

/**
 * One notification as the bytes a terminal reads (martha#574): a title chunk that holds it open, then the body chunk
 * that completes it, so kitty shows it rather than holding it back forever. Two chunks, because the protocol reads a
 * chunk's payload as the title unless it says otherwise: the owner reads who is asking first, then what is asked. Both
 * carry base64 and say so with `e=1`; without it the terminal would show the base64 itself.
 */
export function notificationOf(id: string, title: string, body: string): string {
  return `${aChunk(id, MORE_OF_THE_NOTIFICATION_FOLLOWS, THE_TITLE, title)}${aChunk(id, THE_LAST_OF_THE_NOTIFICATION, THE_BODY, body)}`
}

/** The notification for one member's row: its own id, its title, and the words the row carries (martha#574). */
export const notificationFor = (row: DashboardRow): string =>
  notificationOf(notificationIdOf(row.member), theTitleFor(row.member), whatTheOwnerIsShown(row).needs)

/**
 * The bytes that take one member's notification off the desktop again (martha#574, T5): kitty's `p=close` for the id the
 * notification was shown under, so the question the owner already answered stops sitting on their screen. It carries no
 * payload, so it says neither `d` nor `e`: nothing is carried and nothing is decoded.
 */
export const theCloseOf = (member: string): string =>
  `${NOTIFICATION_ESCAPE}${THE_NOTIFICATION_KEYS.identifier}=${notificationIdOf(member)}:${THE_NOTIFICATION_KEYS.as}=${THE_CLOSE};${NOTIFICATION_ENDING}`

/** The state a row reads while the owner is being asked, as the dialogs slice says it. */
const ASKING = 'needs-you'

/**
 * The bytes to write for one change of a member's row: a bell and a notification when the change is the first into
 * "needs you", the notification's own close when the change is out of it and takes a shown notification down (martha#574,
 * T5), and nothing at all on every other beat (martha#313 test 6), with the bells off (test 7), or with no terminal of the
 * owner's to ring (test 7). A close is not a bell: the bell rings once, on the way in.
 */
export function theBellsFor(
  before: DashboardRow | null,
  after: DashboardRow,
  bells: TheBellsSwitch,
  onTheOwnersTerminal: boolean,
): string {
  if (!onTheOwnersTerminal) return ''
  if (isTheFirstChangeIntoAsking(before, after)) return bellBytes(bells, after)
  if (isTheChangeOutOfAsking(before, after)) return bells.notify ? theCloseOf(before.member) : ''
  return ''
}

/** Whether this beat is the one the owner started being asked on, which is the only one that rings. */
function isTheFirstChangeIntoAsking(before: DashboardRow | null, after: DashboardRow): boolean {
  if (whatTheOwnerIsShown(after).state !== ASKING) return false
  return before === null || whatTheOwnerIsShown(before).state !== ASKING
}

/**
 * Whether this beat is the one the owner stopped being asked on, which takes a notification that was shown down again
 * (martha#574, T5). The member's own name comes from the row that was asking, which is the id the notification was shown
 * under; with no row before, nothing was shown on this terminal and nothing is closed.
 */
function isTheChangeOutOfAsking(before: DashboardRow | null, after: DashboardRow): before is DashboardRow {
  if (before === null) return false
  return whatTheOwnerIsShown(before).state === ASKING && whatTheOwnerIsShown(after).state !== ASKING
}

/** The bytes for this change: the bell, the notification, both, or neither. */
function bellBytes(bells: TheBellsSwitch, row: DashboardRow): string {
  return `${bells.bell ? THE_BELL : ''}${bells.notify ? notificationFor(row) : ''}`
}
