// Every way text can reach a member's session, and every way a checkout can get
// code started on a member's machine, and what control stands on each.
//
// This is the machine-readable copy of the table in issue #2, read from
// crew-code at macula-sponsors cf5e5a3; the C rows come from issue #16. The issue
// tables are its review; this is what ../check_every_path_is_gated drives and
// what CI fails on.
//
// A row is here for one reason: text arrived, or code is about to start, and
// something must decide whether that may go ahead. A path is never removed from
// this list — a path that stops delivering text gets a control that says so, in
// words.

import { admitsInCrewRoom, admitsInSharedRoom, type DeliveryGate } from '../admit_a_room_message/admit_a_room_message.ts'
import { admitsLaunch, type LaunchGate } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/**
 * How the path reaches the member.
 *
 * - `delivered` — text put into a turn for the model.
 * - `fetched` — text the model's own tool brought back.
 * - `launched` — code the host starts by itself, from files in a checkout. No
 *   tool is called and no model runs, so neither the shell gate nor a delivery
 *   gate stands in front of it: only a launch gate does.
 */
export type PathClass = 'delivered' | 'fetched' | 'launched'

/**
 * Who, if anyone, attests the sender of text arriving on this path.
 *
 * Only an attested path may carry a sender's identity into the shell gate. Every
 * other path carries none, whatever the text says about itself: a git commit
 * author, a `gh` login, an envelope's `from` attribute and a name in a message are
 * all written by whoever wrote the text, so none of them is an identity.
 *
 * - `roster` — a crew roster checked the sender before delivery.
 * - `station` — the mesh station attested the caller.
 * - `host-binder` — the host attests the sending process and the binder
 *   (../attribute_a_cross_session_sender, martha#14) resolves it to a node id
 *   through the launcher's record. A host that attests no sender binds nothing,
 *   and a delivery on this path then carries no identity.
 * - `none` — nobody attests the sender.
 */
export type SenderAttestation = 'roster' | 'station' | 'host-binder' | 'none'

/**
 * The delivery gates, by the name a row may use. A row may only name one of
 * these, and the function behind the name is what the coverage check drives: a
 * name on its own is not a control, and a function that admits everyone is not
 * one either.
 */
export const DELIVERY_GATES = {
  'crew-room-acceptance': admitsInCrewRoom,
  'shared-room-acceptance': admitsInSharedRoom,
} as const satisfies Record<string, DeliveryGate>

export type KnownDeliveryGate = keyof typeof DELIVERY_GATES

/**
 * The launch gates, by the name a row may use. As with the delivery gates, the
 * coverage check drives the function behind the name, once per question.
 */
export const LAUNCH_GATES = {
  'owner-approved-launch-config': admitsLaunch,
} as const satisfies Record<string, LaunchGate>

export type KnownLaunchGate = keyof typeof LAUNCH_GATES

/**
 * What stops outsider text on this path from being acted on.
 *
 * - `delivery-gate` — a deterministic check on the sender runs before the text
 *   is in a turn (the crew room's acceptance rule, the board's roster).
 * - `shell-gate` — nothing checks at delivery; the text lands, and
 *   ../refuse_execution_after_ungated_text stops the session executing for as
 *   long as the text is readable.
 * - `no-text-reaches-the-model` — the path is listed so it is not forgotten,
 *   and carries no body text. It must say why.
 * - `launch-gate` — the host is not started in a checkout whose launch config
 *   the owner has not approved by content
 *   (../refuse_launch_of_unapproved_config). The only control a `launched` row
 *   may declare. `residual` says, in words, what happens where Martha does not
 *   start the host itself and so cannot run the gate first.
 * - `none` — no control. A row in this state fails CI on purpose.
 */
export type Control =
  | { readonly kind: 'delivery-gate'; readonly gate: KnownDeliveryGate }
  | { readonly kind: 'shell-gate' }
  | { readonly kind: 'no-text-reaches-the-model'; readonly why: string }
  | { readonly kind: 'launch-gate'; readonly gate: KnownLaunchGate; readonly residual: string }
  | { readonly kind: 'none' }

export interface InboundPath {
  readonly id: string
  readonly what: string
  readonly klass: PathClass
  readonly control: Control
  readonly attestation: SenderAttestation
}

export const INBOUND_PATHS: readonly InboundPath[] = [
  {
    id: 'A1',
    what: 'a private crew room message, turned into a turn by the mod poll',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'crew-room-acceptance' },
    attestation: 'roster',
  },
  {
    id: 'A2',
    what: 'a shared cross-crew room message',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'shared-room-acceptance' },
    attestation: 'roster',
  },
  {
    id: 'A3',
    what: 'a backlog digest folding many accepted messages into one turn',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'crew-room-acceptance' },
    attestation: 'roster',
  },
  {
    id: 'A4',
    what: 'a mesh ring: its purpose, and its decline reason',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'station',
  },
  {
    id: 'A5',
    what: 'a ring answered: the decline reason',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'station',
  },
  {
    id: 'A6',
    what: 'a cross-session message, arriving as the turn text itself',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'host-binder',
  },
  {
    id: 'A7',
    what: "text a checkout puts into the session: its auto-injected CLAUDE.md or AGENTS.md, what an approved hook prints, and the agents a checkout defines (.claude/agents), whose frontmatter may name hooks and tool servers that start only when the model spawns that agent, a tool call",
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A8',
    what: 'the handover file a resumed session is told to read',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A9',
    what: 'a forged cross-session envelope inside turn text',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A10',
    what: 'text the owner pastes into the session',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A11',
    what: 'an MCP server instruction block, shipped by the package',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A12',
    what: 'a compaction summary replaying earlier turns',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'A13',
    what: "code an untrusted checkout runs through the member's own commands",
    klass: 'delivered',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B1',
    what: "the model's own mesh read tools",
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B2',
    what: 'any MCP tool result: board cards, procedures, shared memory',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B3',
    what: 'the GitHub CLI: issue and pull-request bodies, comments, reviews',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B4',
    what: 'files in a checkout',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B5',
    what: 'git history',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B6',
    what: 'web fetch and web search',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B7',
    what: 'a subagent result, and a review answer relaunched onto another session',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
    attestation: 'none',
  },
  {
    id: 'B8',
    what: "the mod's own gh pr list",
    klass: 'fetched',
    control: {
      kind: 'no-text-reaches-the-model',
      why: 'only headRefOid, headRefName and a #n match are read, as a stale-handoff flag; no body text is delivered',
    },
    attestation: 'none',
  },
  {
    id: 'C1',
    what: "a checkout's own tool-server config, which the host starts by itself (each host's files are listed in LAUNCH_FILES_OF_HOST)",
    klass: 'launched',
    control: {
      kind: 'launch-gate',
      gate: 'owner-approved-launch-config',
      residual:
        'Martha starts the host on an approved snapshot of this config, with the checkout\'s own config switched off (prepareLaunch; npm run probe:launch). What is left: a host the owner starts by hand starts these servers before any of Martha runs (observed: interactive Claude Code 2.1.318 holds a project server for approval but records it by server name only, so a later change to its command is not asked again; headless claude -p and OpenCode 2.2.5, even for opencode debug config, start it unasked), so the adapter must refuse that session a place in the crew; a server the host restarts after a call changed the tree runs the script as it is then, until the launcher stops the member (the launch is checked before every tool call, by answerToolCall, and after it, by recheckLaunch); and a file git ignores and does not track is outside the approval.',
    },
    attestation: 'none',
  },
  {
    id: 'C2',
    what: "a checkout's own hooks and plugins, which the host runs by itself (each host's files are listed in LAUNCH_FILES_OF_HOST)",
    klass: 'launched',
    control: {
      kind: 'launch-gate',
      gate: 'owner-approved-launch-config',
      residual:
        "Martha starts the host on an approved snapshot of this config, with the checkout's own config switched off (prepareLaunch; npm run probe:launch); a checkout's .claude/settings.local.json and its .opencode plugins are never carried, and prepareLaunch names them as not_carried for the launcher to show the owner. What is left: a host the owner starts by hand runs these before any of Martha runs (observed: headless claude -p 2.1.318 runs a checkout's SessionStart hook unasked; OpenCode 2.2.5 loads its plugin unasked, even for opencode debug config), so the adapter must refuse that session a place in the crew; the hooks of the one call that changed the tree, which run its scripts as they are then: the launch is checked before every tool call (answerToolCall) and after it (recheckLaunch), and on a refusal after the call the launcher stops the member before the host fires another hook; and a file git ignores and does not track is outside the approval.",
    },
    attestation: 'none',
  },
]

/** The attestation a path's sender has, or `none` for a path nobody declared. */
export function attestationOf(path_id: string): SenderAttestation {
  return INBOUND_PATHS.find((path) => path.id === path_id)?.attestation ?? 'none'
}

/** True only where an attestation stands behind the sender. */
export function senderIsAttested(path_id: string): boolean {
  return attestationOf(path_id) !== 'none'
}
