// The row's word about what the host is asking the owner (martha#313): every dialog on the owner's screen, and the
// words the row reads while one is open.
//
// This exists so the owner's dashboard says "needs you" when the host itself is holding a session up, not only when a
// member reports it. A member that is asked for a permission is not working and does not know it: the host is waiting,
// and until this slice the row said nothing.
//
// The row is still one whole beat, and this slice writes it through ../show_dashboard_beat's own shape and the one
// store that keeps a row, never around either: it takes the row as it stands and returns the row to write, with the
// dialogs it holds changed. The member's own state and words are never overwritten, and a reader is what says "needs
// you" (`whatTheOwnerIsShown`), so a dialog that closes leaves the row exactly as it read before it, with nothing put
// back and nothing remembered.
//
// A dialog is keyed by what raised it, never by its own text. A permission is keyed by the host's own id for the call
// when the engine named one before it asked, so two identical calls in flight are two dialogs and the one that runs
// closes only itself; without one it is keyed by the agent that called the tool, the tool and a digest of its input,
// and two identical calls at once are one dialog until the next turn starts. An elicitation is keyed by its id, which
// the host gives one per request. And a dialog an earlier turn left open is dropped when a turn starts, so a prompt
// nobody answered cannot pin the row at "needs you" for the rest of the session.
//
// Nothing a server says reaches the row as it was sent: every word is stripped of what a terminal cannot show and cut
// to one line's worth, because an MCP server's question is not this crew's text.

import { createHash } from 'node:crypto'

import { OWNER_DIALOGS_FIELD, type AnOwnerDialogOnARow, type DashboardRow, type State } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The dialogs this slice keeps, in the words the row reads them by. */
export const OWNER_DIALOG_KINDS = ['permission', 'elicitation', 'notification', 'menu'] as const
export type OwnerDialogKind = (typeof OWNER_DIALOG_KINDS)[number]

/** The longest a dialog's words are kept on the row: one line of the pane, and no more. */
export const OWNER_DIALOG_CHARACTERS = 120

/** What the row reads while a menu waits for the owner (the host's AskUserQuestion). */
export const MENU = 'a menu'

/** What raised a dialog, as the host told this slice. */
export type RaisingADialog =
  | {
      readonly kind: 'permission'
      readonly agent: string
      readonly tool: string
      readonly input: unknown
      /**
       * The host's own id for the call the owner is asked about, when the engine named one before it asked
       * (martha#313): two identical calls in flight are then two dialogs, and a call that runs closes the one it
       * was. Absent, the dialog is keyed by what asked (the agent, the tool and the input), and two identical calls
       * at once are one dialog until the next turn starts.
       */
      readonly uses?: string
    }
  | { readonly kind: 'elicitation'; readonly server: string; readonly question: string; readonly id?: string }
  | { readonly kind: 'notification'; readonly message: string }
  | { readonly kind: 'menu'; readonly uses?: string }

/** One thing the host said about the owner's screen: a dialog raised, put away, or a turn that starts with none. */
export type OwnerDialogEvent =
  | { readonly change: 'opened'; readonly at: number; readonly raised: RaisingADialog }
  | { readonly change: 'closed'; readonly at: number; readonly key: string }
  | { readonly change: 'turn-started'; readonly at: number }

/**
 * The row to write for one thing the host said: the dialogs it holds, changed. The member's own state and words are
 * left exactly as they were, and so is every other field, so a dialog never costs a member its report (martha#313) —
 * and never moves the row's `at`, which is the member's own beat: a dialog is the host's word, and a beat can never
 * refuse one (martha#380).
 */
export function takeAnOwnerDialog(row: DashboardRow, event: OwnerDialogEvent): DashboardRow {
  const kept = dialogsAfter(row[OWNER_DIALOGS_FIELD] ?? [], event)
  if (kept.length > 0) return { ...row, [OWNER_DIALOGS_FIELD]: kept }
  const { [OWNER_DIALOGS_FIELD]: _none, ...without } = row
  return without
}

/**
 * What the owner is shown for this row: "needs you" and the newest dialog's words while one is open, and otherwise the
 * member's own state and words. It is the reader's answer, as `offline` is (martha#254), so nothing has to be undone
 * when the last dialog closes.
 */
export function whatTheOwnerIsShown(row: DashboardRow): { readonly state: State; readonly needs: string } {
  const dialogs = row[OWNER_DIALOGS_FIELD] ?? []
  const newest = dialogs[dialogs.length - 1]
  return newest === undefined ? { state: row.state, needs: row.needs } : { state: 'needs-you', needs: newest.reads }
}

/** The dialogs the row holds after this event: one more, one fewer, or none at all when a turn starts. */
function dialogsAfter(held: readonly AnOwnerDialogOnARow[], event: OwnerDialogEvent): readonly AnOwnerDialogOnARow[] {
  if (event.change === 'turn-started') return []
  if (event.change === 'closed') return held.filter((dialog) => dialog.key !== event.key)
  const dialog = openedDialog(event.raised)
  const others = held.filter((open) => open.key !== dialog.key)
  return [...others, dialog]
}

/** The dialog one raise opens, in the words the row and the pane read it by. */
function openedDialog(raised: RaisingADialog): AnOwnerDialogOnARow {
  return { key: theKeyOf(raised), kind: raised.kind, reads: cutForTheRow(theWordsOfADialog(raised)) }
}

/** What the owner reads for a raise, in the crew's own sentence, with nothing a terminal cannot show kept. */
export function theWordsOfADialog(raised: RaisingADialog): string {
  if (raised.kind === 'permission') return `permission for ${withoutWhatATerminalCannotShow(raised.tool)}`
  if (raised.kind === 'elicitation') return `${withoutWhatATerminalCannotShow(raised.server)} asks: ${withoutWhatATerminalCannotShow(raised.question)}`
  if (raised.kind === 'notification') return withoutWhatATerminalCannotShow(raised.message)
  return MENU
}

/** The key a dialog's opening and its closing meet on: what raised it, never its text. */
export function theKeyOf(raised: RaisingADialog): string {
  if (raised.kind === 'permission') return theKeyOfAPermission(raised.agent, raised.tool, raised.input, raised.uses)
  if (raised.kind === 'elicitation') return theKeyOfAnElicitation(raised.id, raised.server, raised.question)
  if (raised.kind === 'menu') return theKeyOfAMenu(raised.uses)
  return theKeyOfTheWords(raised.kind, raised.message)
}

/**
 * The key of a permission: the host's own id for the call when it named one before asking, so two identical calls in
 * flight are two dialogs; and otherwise the agent, the tool and a digest of the input, so two agents asking are still
 * two dialogs (martha#313).
 */
export function theKeyOfAPermission(agent: string, tool: string, input: unknown, uses?: string): string {
  return uses === undefined || uses === '' ? `permission:${agent}:${tool}:${theDigestOf(input)}` : `permission:${uses}`
}

/** The key of an elicitation: its own id, which the host gives one per request; and, for a host that gives none, the
 * server and its question, digested, so an opening still meets its closing. */
export function theKeyOfAnElicitation(id: string | undefined, server: string, question: string): string {
  return id === undefined || id === '' ? `elicitation:${server}:${theDigestOf(question)}` : `elicitation:${id}`
}

/** The key of a menu: the host's own id for the call it opened the menu with, or the menu's one word when it gave none. */
export function theKeyOfAMenu(uses?: string): string {
  return uses === undefined || uses === '' ? theKeyOfTheWords('menu', MENU) : `menu:${uses}`
}

/** The key of a notification: what the host said, digested, since it has no id of its own. */
export function theKeyOfTheWords(kind: OwnerDialogKind, words: string): string {
  return `${kind}:${theDigestOf(words)}`
}

/** What the owner is told about one notification the host can send. */
export const SHOWN_AS_A_DIALOG = 'shown-as-a-dialog'
export const NOT_FOR_THE_OWNER = 'not-for-the-owner'

/**
 * What the owner is told about each notification the host sends, by the host's own name for it (martha#313, test 5).
 *
 * A notification that only says what another event already says is not the owner's news twice: a permission prompt and
 * an elicitation each arrive as their own dialog, and the idle prompt and an auth success are the host talking to
 * itself. Every other notification is the owner's. The list is named by the host's words rather than derived, so a host
 * that adds one fails the coverage check by name instead of being misread at run time; a name this table does not hold
 * is shown to nobody, because guessing what a stranger's notification means is worse than CI saying so first.
 */
export const WHAT_EACH_NOTIFICATION_SAYS: Readonly<Record<string, typeof SHOWN_AS_A_DIALOG | typeof NOT_FOR_THE_OWNER>> = {
  permission_prompt: NOT_FOR_THE_OWNER,
  idle_prompt: NOT_FOR_THE_OWNER,
  auth_success: NOT_FOR_THE_OWNER,
  elicitation_dialog: NOT_FOR_THE_OWNER,
  elicitation_url_dialog: SHOWN_AS_A_DIALOG,
  worker_permission_prompt: SHOWN_AS_A_DIALOG,
  agent_needs_input: SHOWN_AS_A_DIALOG,
  agent_completed: SHOWN_AS_A_DIALOG,
  push_notification: SHOWN_AS_A_DIALOG,
  computer_use_enter: SHOWN_AS_A_DIALOG,
  computer_use_exit: SHOWN_AS_A_DIALOG,
  quota_auto_resume_fired: SHOWN_AS_A_DIALOG,
  quota_auto_resume_stale: SHOWN_AS_A_DIALOG,
  quota_auto_resume_disabled: SHOWN_AS_A_DIALOG,
  model_refusal_fallback: SHOWN_AS_A_DIALOG,
  auth_storage_failure: SHOWN_AS_A_DIALOG,
  plugin_notification: SHOWN_AS_A_DIALOG,
}

/** Whether a notification the host sent is the owner's news, or one that only repeats what another event says. */
export function theOwnerIsToldOf(notification_type: string): boolean {
  return WHAT_EACH_NOTIFICATION_SAYS[notification_type] === SHOWN_AS_A_DIALOG
}

/**
 * `text` as a terminal may show it: every control character (C0, DEL and C1), and so every escape, dropped. What is
 * left is what a person reads; what is dropped can steer a terminal, which is why nothing a server wrote reaches one.
 */
export function withoutWhatATerminalCannotShow(text: string): string {
  return [...text].filter((character) => !isWhatATerminalCannotShow(character)).join('')
}

/** Whether this character is one a terminal would act on rather than show. */
function isWhatATerminalCannotShow(character: string): boolean {
  const code = character.codePointAt(0) ?? 0
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f)
}

/** The row's words for a dialog, cut to OWNER_DIALOG_CHARACTERS at the last word that fits when one does. */
export function cutForTheRow(words: string): string {
  const trimmed = words.trim()
  if (trimmed.length <= OWNER_DIALOG_CHARACTERS) return trimmed
  const head = trimmed.slice(0, OWNER_DIALOG_CHARACTERS + 1)
  const space = head.lastIndexOf(' ')
  return space > 0 ? head.slice(0, space).trimEnd() : trimmed.slice(0, OWNER_DIALOG_CHARACTERS)
}

/** A digest of a value as it would be written down, with every object's fields in one order, so two equal values agree. */
export function theDigestOf(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

/** `value` written with every object's own fields in sorted order, so a digest of it does not depend on how it was built. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const fields = Object.keys(value as Record<string, unknown>).sort()
    return `{${fields.map((field) => `${JSON.stringify(field)}:${canonical((value as Record<string, unknown>)[field])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}
