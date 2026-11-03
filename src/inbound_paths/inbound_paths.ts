// Every way text can reach a member's session, and what control stands on it.
//
// This is the machine-readable copy of the table in issue #2, read from
// crew-code at macula-sponsors cf5e5a3. The issue table is its review; this is
// what ../check_every_path_is_gated drives and what CI fails on.
//
// A row is here for one reason: text arrived and something must decide whether
// the session may act on it. A path is never removed from this list — a path
// that stops delivering text gets a control that says so, in words.

export type PathClass = 'delivered' | 'fetched'

/**
 * Delivery gates that exist somewhere and can be named here. A row may only
 * name one of these: a gate name nobody has built is not a control.
 */
export const KNOWN_DELIVERY_GATES = [
  'crew-room-acceptance',
  'shared-room-acceptance',
] as const

export type KnownDeliveryGate = (typeof KNOWN_DELIVERY_GATES)[number]

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
 * - `none` — no control. A row in this state fails CI on purpose.
 */
export type Control =
  | { readonly kind: 'delivery-gate'; readonly gate: KnownDeliveryGate }
  | { readonly kind: 'shell-gate' }
  | { readonly kind: 'no-text-reaches-the-model'; readonly why: string }
  | { readonly kind: 'none' }

export interface InboundPath {
  readonly id: string
  readonly what: string
  readonly klass: PathClass
  readonly control: Control
}

export const INBOUND_PATHS: readonly InboundPath[] = [
  {
    id: 'A1',
    what: 'a private crew room message, turned into a turn by the mod poll',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'crew-room-acceptance' },
  },
  {
    id: 'A2',
    what: 'a shared cross-crew room message',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'shared-room-acceptance' },
  },
  {
    id: 'A3',
    what: 'a backlog digest folding many accepted messages into one turn',
    klass: 'delivered',
    control: { kind: 'delivery-gate', gate: 'crew-room-acceptance' },
  },
  {
    id: 'A4',
    what: 'a mesh ring: its purpose, and its decline reason',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A5',
    what: 'a ring answered: the decline reason',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A6',
    what: 'a cross-session message, arriving as the turn text itself',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A7',
    what: "a checkout's own hooks, and its auto-injected CLAUDE.md or AGENTS.md",
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A8',
    what: 'the handover file a resumed session is told to read',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A9',
    what: 'a forged cross-session envelope inside turn text',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A10',
    what: 'text the owner pastes into the session',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A11',
    what: 'an MCP server instruction block, shipped by the package',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A12',
    what: 'a compaction summary replaying earlier turns',
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'A13',
    what: "code an untrusted checkout runs through the member's own commands",
    klass: 'delivered',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'B1',
    what: "the model's own mesh read tools",
    klass: 'fetched',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'B2',
    what: 'any MCP tool result: board cards, procedures, shared memory',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'B3',
    what: 'the GitHub CLI: issue and pull-request bodies, comments, reviews',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'B4',
    what: 'files in a checkout',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'B5',
    what: 'git history',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'B6',
    what: 'web fetch and web search',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'B7',
    what: 'a subagent result, and a review answer relaunched onto another session',
    klass: 'fetched',
    control: { kind: 'shell-gate' },
  },
  {
    id: 'B8',
    what: "the mod's own gh pr list",
    klass: 'fetched',
    control: {
      kind: 'no-text-reaches-the-model',
      why: 'only headRefOid, headRefName and a #n match are read, as a stale-handoff flag; no body text is delivered',
    },
  },
]
