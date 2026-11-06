// Where a prompt came from, in the contract's words, from the origin the host
// stamped on it (#41, threats T1 and T5).
//
// This exists so a turn is recorded on the inbound path it really came in on:
// a channel message, a plugin's prompt or a scheduled task's stored text is
// never written down as text the owner typed.
//
// A host stamps every prompt with an origin where it queued the prompt, and no
// hook may set it: Claude Code's `prompt.submit` carries `origin.kind`, a closed
// set the engine owns. Each host declares here what every kind it sends means,
// as a turn source (../host_contract `TurnSource`), so the source is never read
// from the text and never left to the envelope rule, which reads any unframed
// text as the owner's (../take_in_a_turn, A10).
//
// Rules:
//
//   1. EVERY KIND IS A DECISION. A host's declaration names a source for each
//      kind it sends. The coverage check (../check_every_path_is_gated,
//      gapsInPromptOrigins) runs the declaration against the kinds the host's
//      adapter recorded from the host itself, so a kind a new host adds fails CI
//      by name.
//   2. AN UNKNOWN KIND FAILS CLOSED. A kind no declaration lists (a host newer
//      than its recording) is taken as another session's message, unattributed:
//      never as the owner's.
//   3. ONLY THE OWNER'S OWN GESTURES ARE THE OWNER'S. The engine stamps those
//      itself (Enter at the terminal, Remote Control, the owner's Slack ping, a
//      follow-up to the owner's click, the SDK host's own turn). Text a plugin,
//      a channel server, a schedule or another agent put there is not.
//   4. NOTHING IN AN ORIGIN IS IDENTITY. An arrival from here never carries a
//      `sender` or a `from_identity`: the binder alone names a cross-session
//      sender (A6, ../attribute_a_cross_session_sender).

import type { Arrival, TurnSource } from '../host_contract/host_contract.ts'

/** What each origin kind a host sends means, as a turn source. */
export interface HostPromptOrigins {
  readonly host: string
  readonly sources: Readonly<Record<string, TurnSource>>
}

/** The source of a kind no declaration lists: another session's message (rule 2). */
export const SOURCE_OF_AN_UNKNOWN_ORIGIN: TurnSource = 'cross_session'

/**
 * Claude Code's origin kinds, as its engine names them for `prompt.submit`
 * (recorded from the 2.1.318 binary by ../claude_code_host).
 */
export const CLAUDE_CODE_PROMPT_ORIGINS: HostPromptOrigins = {
  host: 'claude-code',
  sources: {
    // The owner's own gestures, stamped by the engine (rule 3).
    composer: 'owner_paste',
    bridge: 'owner_paste',
    'slack-ping': 'owner_paste',
    'auto-continuation': 'owner_paste',
    sdk: 'owner_paste',
    // Another session's model wrote it.
    peer: 'cross_session',
    'peer-send-message': 'cross_session',
    'projects-relay': 'cross_session',
    coordinator: 'cross_session',
    // A digest of another agent's activity, delivered to the agent observing it.
    'observer-activity': 'cross_session',
    // No provenance the engine can name, a same-user socket among them (rule 2).
    unclassified: 'cross_session',
    // An agent's own report coming back in: an observer's report, a background
    // task's notification (a subagent finishing, a background command, the
    // session inbox), a schedule firing text stored earlier, mostly by a model.
    // The schedule attests storage, not authorship.
    observer: 'subagent',
    'task-notification': 'subagent',
    'scheduled-trigger': 'subagent',
    // Text a package put there: a channel server relaying a chat, a plugin's own
    // prompt (Martha's handToModel included, whose turn its slice already
    // recorded on its own path).
    channel: 'mcp_result',
    plugin: 'mcp_result',
  },
}

/** Where a prompt with this origin kind came from, in the contract's words. */
export function arrivalOfPrompt(declared: HostPromptOrigins, kind: string): Arrival {
  const source = Object.hasOwn(declared.sources, kind) ? declared.sources[kind] : undefined
  return { source: source ?? SOURCE_OF_AN_UNKNOWN_ORIGIN }
}

/** The origin kinds a host sends that its declaration does not list. */
export function undeclaredPromptOrigins(declared: HostPromptOrigins, emitted: readonly string[]): readonly string[] {
  return emitted.filter((kind) => !Object.hasOwn(declared.sources, kind))
}
