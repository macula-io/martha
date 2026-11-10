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
//   3. ONLY THE OWNER'S OWN TYPING IS THE OWNER'S: Enter at the member's own
//      terminal, which the engine stamps itself (Raf's ruling on martha#51: an
//      engine-stamped composer origin is host-attested). A kind that can carry
//      anyone else's text is not the owner's, even where the engine often fills
//      it from the owner: Remote Control's `bridge` also carries relayed human
//      turns (a Slack user, an email sender, a project member), the engine itself
//      groups `slack-ping` with peer messages, and `sdk` is whatever the program
//      driving the host pipes in. Those fail closed under rule 2, as another
//      session's message. `auto-continuation` is text the engine or a model
//      wrote after the owner's click, not the owner's words: an approved
//      ultraplan carrying the cloud session's output, the usage-limit resume
//      prompt, an accepted plan's content (read from the 2.1.319 binary).
//   4. NOTHING IN AN ORIGIN IS IDENTITY. An arrival from here never carries a
//      `sender` or a `from_identity`: the binder alone names a cross-session
//      sender (A6, ../attribute_a_cross_session_sender).
//   5. TYPING IS WHAT THE OWNER TYPED. A composer turn that carries a slash
//      command holds text the engine expanded from a command file, which a
//      checkout can plant; a meta turn is text the engine wrote. Either is
//      recorded as the owner's in name only (`owner_paste`, unattributed). The
//      engine raises both marks on the prompt itself, beside its origin. Any
//      command but an absent or null one, and any meta mark but an absent or
//      false one, counts (whatAPromptCarries).

import type { Arrival, TurnSource } from '../host_contract/host_contract.ts'

/** What each origin kind a host sends means, as a turn source. */
export interface HostPromptOrigins {
  readonly host: string
  readonly sources: Readonly<Record<string, TurnSource>>
}

/** The source of a kind no declaration lists: another session's message (rule 2). */
export const SOURCE_OF_AN_UNKNOWN_ORIGIN: TurnSource = 'cross_session'

/** The source of the owner's typing that carries more than typing (rule 5). */
export const SOURCE_OF_TYPING_THAT_CARRIES_MORE: TurnSource = 'owner_paste'

/** What a prompt carries besides its origin: an expanded command, or the engine's meta mark (rule 5). */
export interface PromptCarries {
  readonly command: boolean
  readonly meta: boolean
}

/**
 * What a prompt carries, from the fields the engine raises beside its origin.
 * Fails closed: any command but an absent one, and any meta mark but an absent
 * or false one, counts.
 */
export function whatAPromptCarries(prompt: { readonly command?: unknown; readonly isMeta?: unknown }): PromptCarries {
  return {
    command: prompt.command !== undefined && prompt.command !== null,
    meta: prompt.isMeta !== undefined && prompt.isMeta !== false,
  }
}

/**
 * Claude Code's origin kinds, as its engine names them for `prompt.submit`
 * (recorded from the host binary by ../claude_code_host, whose
 * recorded_claude_code_host.json names the version).
 */
export const CLAUDE_CODE_PROMPT_ORIGINS: HostPromptOrigins = {
  host: 'claude-code',
  sources: {
    // The owner's own typing, stamped by the engine (rules 3 and 5).
    composer: 'owner_typed',
    // Text the engine or a model wrote after the owner's click (rule 3): an
    // agent's text coming back in, whose storage the engine attests, not its
    // authorship.
    'auto-continuation': 'subagent',
    // Often the owner, and able to carry anyone (rule 3): fail closed.
    bridge: 'cross_session',
    'slack-ping': 'cross_session',
    sdk: 'cross_session',
    // An unpromoted task notification: besides a background task finishing, the
    // engine stamps it on a GitHub webhook, a PR steward, a signal subscription,
    // other triggers and the session inbox from any sender. A stranger's GitHub
    // comment must not read as a subagent's result, so this declaration places
    // every one of them as another session's message. A launcher that holds the
    // agent the notice is about may place that one on its own record instead
    // (CLAUDE_CODE_COMPLETION_ORIGIN, martha#170).
    'task-notification': 'cross_session',
    // Another session's model wrote it.
    peer: 'cross_session',
    'peer-send-message': 'cross_session',
    'projects-relay': 'cross_session',
    coordinator: 'cross_session',
    // A digest of another agent's activity, delivered to the agent observing it.
    'observer-activity': 'cross_session',
    // No provenance the engine can name, a same-user socket among them (rule 2).
    // The engine also maps a voice call to it: a remote session's message, which
    // the bridge can carry from someone other than the owner, marked as meta
    // (Claude Code 2.1.319, martha#139).
    unclassified: 'cross_session',
    // An agent's own report coming back in: an observer's report, or a schedule
    // firing text stored earlier, mostly by a model. The schedule attests
    // storage, not authorship.
    observer: 'subagent',
    'scheduled-trigger': 'subagent',
    // Text a package put there: a channel server relaying a chat, and every
    // plugin's injected prompt, a crew mod's and Martha's own handToModel
    // included (whose turn its slice already recorded on its own path).
    channel: 'mcp_result',
    plugin: 'mcp_result',
  },
}

/**
 * The origin kind a background agent's completion arrives on when the engine has no subkind to promote it to
 * (martha#170). The declaration above places that kind as another session's message, and rightly: the same kind
 * carries texts from senders this member never saw. A launcher that can name the agent the notice is about — the task
 * and the call its own record holds, and that agent vouched for — places that one on the agent's own record instead.
 */
export const CLAUDE_CODE_COMPLETION_ORIGIN = 'task-notification'

/** Where a prompt with this origin kind, carrying this, came from, in the contract's words. */
export function arrivalOfPrompt(declared: HostPromptOrigins, kind: string, carries: PromptCarries): Arrival {
  const declaredSource = Object.hasOwn(declared.sources, kind) ? declared.sources[kind] : undefined
  const source = declaredSource ?? SOURCE_OF_AN_UNKNOWN_ORIGIN
  const typedOnly = !carries.command && !carries.meta
  return { source: source === 'owner_typed' && !typedOnly ? SOURCE_OF_TYPING_THAT_CARRIES_MORE : source }
}

/** The origin kinds a host sends that its declaration does not list. */
export function undeclaredPromptOrigins(declared: HostPromptOrigins, emitted: readonly string[]): readonly string[] {
  return emitted.filter((kind) => !Object.hasOwn(declared.sources, kind))
}
