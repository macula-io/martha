// The bell that rings when the host starts asking the owner something (martha#313): a bell in the member's own
// terminal, and a desktop notification beside it, from the row's change alone.
//
// This exists so an owner who is not looking at the dashboard learns that a member is being asked, once — on the change
// into "needs you", never on every beat. It is the host's word and not a member's report: a member that says it waits on
// the owner moves its row, and rings nothing, so the bell cannot be used as a nuisance by what it reports.
//
// The launcher holds the member's terminal (../launch_a_claude_code_member/member_on_the_owners_terminal), so these
// bytes go to the launcher's own terminal and nowhere else: a member started without one has no terminal to ring, and
// rings nothing. crew-code's ghost bell, which had to find its terminal by walking up to the process's own, cannot
// happen here by construction.
//
// What the notification carries is base64 and only base64, as crew-code's OSC 99 does: a question an MCP server wrote
// cannot end the escape sequence early, so no text a stranger wrote can steer the terminal it lands on.

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
export const NOTIFICATION_OPENING = '\u001b]99;i=martha:d=0;'
export const NOTIFICATION_ENDING = '\u001b\\'

/** The state a row reads while the owner is being asked, as the dialogs slice says it. */
const ASKING = 'needs-you'

/**
 * The bytes to write for one change of a member's row: a bell and a notification when the change is the first into
 * "needs you", and nothing at all on every other beat (martha#313 test 6), with the bells off (test 7), or with no
 * terminal of the owner's to ring (test 7).
 */
export function theBellsFor(
  before: DashboardRow | null,
  after: DashboardRow,
  bells: TheBellsSwitch,
  onTheOwnersTerminal: boolean,
): string {
  if (!onTheOwnersTerminal) return ''
  if (!isTheFirstChangeIntoAsking(before, after)) return ''
  return bellBytes(bells, theWordsTheNotificationCarries(after))
}

/** Whether this beat is the one the owner started being asked on, which is the only one that rings. */
function isTheFirstChangeIntoAsking(before: DashboardRow | null, after: DashboardRow): boolean {
  if (whatTheOwnerIsShown(after).state !== ASKING) return false
  return before === null || whatTheOwnerIsShown(before).state !== ASKING
}

/** The bytes for this change: the bell, the notification, both, or neither. */
function bellBytes(bells: TheBellsSwitch, words: string): string {
  return `${bells.bell ? THE_BELL : ''}${bells.notify ? notificationOf(words) : ''}`
}

/** A notification for these words: base64 only, so nothing in them can end the sequence early. */
export function notificationOf(words: string): string {
  return `${NOTIFICATION_OPENING}${Buffer.from(words, 'utf8').toString('base64')}${NOTIFICATION_ENDING}`
}

/** What the notification says: the owner's own words for what is being asked, as the row reads them. */
function theWordsTheNotificationCarries(row: DashboardRow): string {
  return whatTheOwnerIsShown(row).needs
}
