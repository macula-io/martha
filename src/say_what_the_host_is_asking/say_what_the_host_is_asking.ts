// What the host is asking the owner, read from what the host itself did (martha#313).
//
// This exists so a dialog's opening and its closing meet on one key, and so the row's dialogs are changed by the host's
// own events and nothing else. ../tell_the_owner_a_session_waits owns the row: what a dialog reads for, how it is
// stripped and cut, and what the row says while one is open. This slice owns the other half — which of the host's
// events opens a dialog, which closes it, and which call a permission belongs to.
//
// THREE RULES, each learned from what the host does rather than from what it promises. The order they rest on is
// measured on 2.1.323 by prove_the_relay_loads/prove_the_order_of_the_dialogs.mjs (which any machine with the host can
// run again), and the relay's half of it is checked by ../claude_code_relay/claude_code_relay.node-test.ts, so a relay
// that posted its events in another order fails there by name:
//
//   - A PERMISSION IS KEYED BY THE CALL'S OWN ID. The engine's `tool.check` names the call (`tool_use_id`) about a
//     tenth of a second before it asks the owner, and the relay posts it. So a permission request is matched to the
//     check still pending for the same tool and input, and its dialog is keyed by that id. Two identical calls in
//     flight are then two dialogs, and each closes on its own.
//   - A DIALOG CLOSES WHEN ITS CALL IS ANSWERED. The host posts the call FIRST, before it checks it and before it
//     asks (`tool.call`, then `tool.check`, then `PermissionRequest`, all within a tenth of a second); it says nothing
//     while the owner decides; and after they answer, the next thing it says is the call's own answer, once the call
//     has run. So neither the call's posting nor the check's decision can be the close — the answer is. What that
//     costs is named: while an allowed call runs, the row still says "needs you", so a long command reads as the
//     run's own length. A dialog whose call is never answered (the owner said no, or the turn was cut) clears when
//     the next turn starts, and the row says the truth until then.
//   - A REFUSAL IS NOBODY'S EVENT. The host fires `PermissionDenied` only for its own auto-mode classifier, which opens
//     no dialog, so nothing here reads it.
//
// Nothing a host says reaches the row as it was sent: a notification's words and an elicitation's question are the
// dialogs slice's to strip and cut, and this slice passes them on untouched.

import {
  theDigestOf,
  theKeyOf,
  theKeyOfAnElicitation,
  theOwnerIsToldOf,
  type OwnerDialogEvent,
  type OwnerDialogKind,
  type RaisingADialog,
} from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'

/** The host's own menu: the tool it puts to the owner in its terminal, which the launcher hears as a call like any other. */
export const MENU_TOOL = 'AskUserQuestion'

/** A call the host raised, as the relay says it: the host's id for it, the tool, its input and the agent that asked. */
export interface ACallTheHostMade {
  readonly id?: string
  readonly tool: string
  readonly input: unknown
  readonly agent?: string
}

/** What the host said, in the crew's own words: one of the events a member's launcher hears. */
export type WhatTheHostSaid =
  | { readonly said: 'checked'; readonly call: ACallTheHostMade }
  | { readonly said: 'ran'; readonly call: ACallTheHostMade }
  | { readonly said: 'answered'; readonly call: ACallTheHostMade }
  | { readonly said: 'permission'; readonly call: ACallTheHostMade }
  | { readonly said: 'elicitation'; readonly server: string; readonly question: string; readonly id?: string }
  | { readonly said: 'elicitation-answered'; readonly server: string; readonly id?: string }
  | { readonly said: 'notification'; readonly type: string; readonly message: string }
  | { readonly said: 'turn-started' }

/** A call the host has decided to ask about and not yet run: what a permission dialog is later matched to. */
export interface ACheckStillPending {
  /** The host's own id for the call. */
  readonly id: string
  readonly tool: string
  /** The digest of its input, written the one way the dialogs slice writes it, so two equal inputs agree. */
  readonly digest: string
  /** The agent that made it, or '' when the host named none (the member's own call). */
  readonly agent: string
}

/** A dialog this slice raised and has not yet closed. */
export interface AnAskThatIsOpen {
  /** The key its opening and its closing meet on, as the dialogs slice builds one. */
  readonly key: string
  readonly kind: OwnerDialogKind
  /** The call it was opened for, when the host named one: the close that only one call can make. */
  readonly id?: string
  /** The MCP server that asked, when an elicitation did: the close that has no id is matched on it. */
  readonly server?: string
  /**
   * What a permission asked about, when the dialog is keyed by what asked rather than by a call's id: the tool, the
   * digest of its input and the agent, so a call that runs still closes the dialog it raised.
   */
  readonly tool?: string
  readonly digest?: string
  readonly agent?: string
}

/** What the host is still asking: the calls it has checked and not run, and the dialogs this slice has open. */
export interface WhatTheHostIsAsking {
  readonly checks: readonly ACheckStillPending[]
  readonly dialogs: readonly AnAskThatIsOpen[]
}

/** A host that has said nothing yet: nothing checked, nothing open. */
export const NOTHING_IS_ASKED: WhatTheHostIsAsking = { checks: [], dialogs: [] }

/** What one thing the host said leaves: the state after it, and the row's own events, in the order they happened. */
export interface WhatIsLeftToAsk {
  readonly state: WhatTheHostIsAsking
  readonly events: readonly OwnerDialogEvent[]
}

/**
 * The state after one event the host raised, and the dialog events that event is: a dialog opened, one closed, or
 * every one of them dropped because a turn started (martha#313).
 */
export function theAsksAfter(held: WhatTheHostIsAsking, said: WhatTheHostSaid, at: number): WhatIsLeftToAsk {
  switch (said.said) {
    case 'turn-started':
      return { state: NOTHING_IS_ASKED, events: [{ change: 'turn-started', at }] }
    case 'checked':
      return { state: withTheCheck(held, said.call), events: [] }
    case 'permission':
      return thePermissionAsks(held, said.call, at)
    case 'ran':
      return theCallRan(held, said.call, at)
    case 'answered':
      return theCallAnswered(held, said.call, at)
    case 'elicitation':
      return theElicitationOpened(held, said, at)
    case 'elicitation-answered':
      return theElicitationAnswered(held, said, at)
    case 'notification':
      return theNotificationOpened(held, said.message, said.type, at)
  }
}

/** What a call the host checked leaves: the check kept, so a permission about it can be matched, and no dialog yet. */
function withTheCheck(held: WhatTheHostIsAsking, call: ACallTheHostMade): WhatTheHostIsAsking {
  // A check the host named no call for can key nothing, and is dropped rather than guessed at.
  if (call.id === undefined || call.id === '') return held
  const check: ACheckStillPending = { id: call.id, tool: call.tool, digest: theDigestOf(call.input), agent: call.agent ?? '' }
  return { ...held, checks: [...held.checks.filter((pending) => pending.id !== check.id), check] }
}

/** A permission dialog: keyed by the call the host checked for it, or, when none is pending, by what asked. */
function thePermissionAsks(held: WhatTheHostIsAsking, call: ACallTheHostMade, at: number): WhatIsLeftToAsk {
  const digest = theDigestOf(call.input)
  const agent = call.agent ?? ''
  // The oldest pending check this ask has not already been matched to is the call it is about: the engine checks a call
  // before it asks about it, so two identical checks pending are two calls, and each ask takes the one no dialog holds.
  const taken = new Set(held.dialogs.map((dialog) => dialog.id))
  const matched = held.checks.find((pending) => !taken.has(pending.id) && pending.tool === call.tool && pending.digest === digest && (agent === '' || pending.agent === '' || pending.agent === agent))
  const uses = matched?.id ?? call.id
  const raised: RaisingADialog = { kind: 'permission', agent, tool: call.tool, input: call.input, ...(uses === undefined ? {} : { uses }) }
  return opened(held, raised, at)
}

/**
 * A call the host posted, a tenth of a second before it checks it: the menu it is opens, and nothing closes, because
 * on this host the call is posted before the owner has been asked anything (`theCallAnswered` is the close).
 */
function theCallRan(held: WhatTheHostIsAsking, call: ACallTheHostMade, at: number): WhatIsLeftToAsk {
  // The host's own menu is a call like any other: it is open from the moment the call is posted until the host
  // answers it, and the launcher already hears both (martha#313, the design's table).
  if (call.tool !== MENU_TOOL) return { state: held, events: [] }
  const menu = opened(held, { kind: 'menu', ...(call.id === undefined ? {} : { uses: call.id }) }, at)
  return { state: menu.state, events: menu.events }
}

/**
 * A call the host answered: every dialog it raised closes, which on this host is the owner having answered it. A
 * dialog is matched to the call by the call's own id, or — for one keyed by what asked, because the host named no call
 * before it asked — by the tool, the input and the agent that asked. A menu the host named no call for is the oldest
 * one open, and only a menu tool's answer may take it: the host asks one menu at a time in a session, and every answer
 * reaches this function, so a call of any other tool that the host named no id for says nothing at all about the menu
 * the owner is still looking at (r=3 R1).
 */
function theCallAnswered(held: WhatTheHostIsAsking, call: ACallTheHostMade, at: number): WhatIsLeftToAsk {
  const unnamed = call.id === undefined && call.tool === MENU_TOOL ? held.dialogs.find((dialog) => dialog.kind === 'menu') : undefined
  const closed = held.dialogs.filter((dialog) => (call.id !== undefined && dialog.id === call.id) || dialog.key === unnamed?.key || askedByTheCallThatAnswered(dialog, call))
  return {
    state: {
      checks: held.checks.filter((pending) => pending.id !== call.id),
      dialogs: held.dialogs.filter((dialog) => !closed.includes(dialog)),
    },
    events: closed.map((dialog) => ({ change: 'closed', at, key: dialog.key })),
  }
}

/**
 * Whether this dialog was keyed by what asked rather than by a call's id, and the call that answered is the one that
 * asked: the tool, the digest of its input and the agent, compared the way the dialog was keyed.
 */
function askedByTheCallThatAnswered(dialog: AnAskThatIsOpen, call: ACallTheHostMade): boolean {
  if (dialog.kind !== 'permission' || dialog.id !== undefined) return false
  return dialog.tool === call.tool && dialog.digest === theDigestOf(call.input) && (dialog.agent === '' || dialog.agent === (call.agent ?? ''))
}

/** An elicitation: keyed by its id, or by its server and question when the host named none. */
function theElicitationOpened(held: WhatTheHostIsAsking, said: { readonly server: string; readonly question: string; readonly id?: string }, at: number): WhatIsLeftToAsk {
  return opened(held, { kind: 'elicitation', server: said.server, question: said.question, ...(said.id === undefined ? {} : { id: said.id }) }, at)
}

/**
 * An elicitation the owner answered. The host names the elicitation in its own result only when it named one in the
 * request; without an id the close is the oldest elicitation that server still has open, because one server asks its
 * owner one question at a time and its answers come back in the order they were asked.
 */
function theElicitationAnswered(held: WhatTheHostIsAsking, said: { readonly server: string; readonly id?: string }, at: number): WhatIsLeftToAsk {
  const key = said.id === undefined || said.id === '' ? held.dialogs.find((dialog) => dialog.kind === 'elicitation' && dialog.server === said.server)?.key : theKeyOfAnElicitation(said.id, said.server, '')
  if (key === undefined) return { state: held, events: [] }
  return closed(held, key, at)
}

/** A notification the owner is told of, which closes when the next turn starts and never before. */
function theNotificationOpened(held: WhatTheHostIsAsking, message: string, type: string, at: number): WhatIsLeftToAsk {
  if (!theOwnerIsToldOf(type)) return { state: held, events: [] }
  return opened(held, { kind: 'notification', message }, at)
}

/** One dialog raised: the state that holds it, and the event that says so. */
function opened(held: WhatTheHostIsAsking, raised: RaisingADialog, at: number): WhatIsLeftToAsk {
  const key = theKeyOf(raised)
  const open: AnAskThatIsOpen = {
    key,
    kind: raised.kind,
    ...(raised.kind === 'permission'
      ? { ...(raised.uses === undefined ? {} : { id: raised.uses }), tool: raised.tool, digest: theDigestOf(raised.input), agent: raised.agent }
      : {}),
    ...(raised.kind === 'menu' && raised.uses !== undefined ? { id: raised.uses } : {}),
    ...(raised.kind === 'elicitation' ? { server: raised.server } : {}),
  }
  if (held.dialogs.some((dialog) => dialog.key === key)) return { state: held, events: [] }
  return { state: { ...held, dialogs: [...held.dialogs, open] }, events: [{ change: 'opened', at, raised }] }
}

/** One dialog put away, by the key it was raised under. */
function closed(held: WhatTheHostIsAsking, key: string, at: number): WhatIsLeftToAsk {
  const dialogs = held.dialogs.filter((dialog) => dialog.key !== key)
  if (dialogs.length === held.dialogs.length) return { state: held, events: [] }
  return { state: { ...held, dialogs }, events: [{ change: 'closed', at, key }] }
}

