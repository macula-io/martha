// Which envelopes the crew believes.
//
// The crew learns two things from a cross-session message: whose a socket is (so
// a later message from that socket carries a name), and which handoffs have been
// read. Both were learned by scanning text for an envelope — and every turn the
// plugin submits is text, so a room body, a ring purpose, a decline reason, a
// direct message's own body or something the owner pasted could contain an
// envelope that was never sent. That buys a stranger two effects: renaming
// another member's socket, and retiring a handoff as read.
//
// "Framed by the harness" is not a fact a host hands over on every host: on the
// Claude Code host the plugin is given the turn's text and nothing else. So the
// frame has to be DERIVED, by a rule strict enough that an ordinary turn cannot
// wear one. This module is that rule:
//
//   1. the turn starts with the envelope's opening tag, at offset 0;
//   2. its closing tag is the very end of the turn;
//   3. there is exactly one envelope in the turn — a second opening tag anywhere
//      in the body means the turn is not framed at all, which is what refutes
//      the early-close trick;
//   4. attributes are read from that one opening tag, never from the body.
//
// Everything between the tags is body, and body is never scanned for anything.
//
// The residual, stated rather than papered over: with the rule above, a turn that
// IS a whole envelope — the owner pasting one in — is indistinguishable from a
// delivery. A host that can say where a turn came from must say so (`origin`), and
// `origin: 'owner'` is then never framed; where the host says nothing, the paste
// is believed. That is the one place text alone cannot decide.

const TAG_NAME = 'cross-session-message'
const OPENING = `<${TAG_NAME}`
const CLOSING = `</${TAG_NAME}>`

/** What the host says about where a turn came from, when it says anything. */
export type TurnOrigin = 'harness_delivery' | 'owner'

/** One turn a session took in. */
export interface Turn {
  readonly text: string
  readonly origin?: TurnOrigin
}

/**
 * A delivery the rule has accepted.
 *
 * `from_address` is the harness's sender address — the local socket path on the
 * Claude Code host, a node id on the mesh host. It is what a name is learned
 * against. `from_name` is the sender's OWN chosen display name: good for routing
 * a reply, never for authority (see ../who_may_act).
 */
export interface FramedDelivery {
  readonly from_address: string | null
  readonly from_name: string | null
  readonly message_id: string | null
  readonly body: string
}

/** A name the crew may carry for an address. */
export interface SenderName {
  readonly from_address: string
  readonly from_name: string
}

/** The handoffs a session may mark read. */
export interface Retirement {
  /** Framed deliveries that carried an id: retired by it. */
  readonly by_id: readonly string[]
  /** Framed deliveries with no id: only their body may be matched, never loose text. */
  readonly by_body: readonly string[]
}

/** The delivery this turn is, or undefined when the turn is not framed. */
export function framedDeliveryOf(turn: Turn): FramedDelivery | undefined {
  if (turn.origin === 'owner') return undefined

  const { text } = turn
  if (!text.startsWith(OPENING) || !text.endsWith(CLOSING)) return undefined
  if (text.length < OPENING.length + CLOSING.length + 1) return undefined

  const opening_end = text.indexOf('>')
  if (opening_end === -1) return undefined

  const opening_tag = text.slice(0, opening_end + 1)
  const body = text.slice(opening_end + 1, text.length - CLOSING.length)

  // Exactly one envelope: a second opening tag in the body means the turn is not
  // framed at all. A member that receives a delivery quoting another envelope
  // loses that delivery's name rather than lending the quote any of it.
  if (body.includes(OPENING)) return undefined

  return {
    from_address: attribute(opening_tag, 'from'),
    from_name: attribute(opening_tag, 'from-name'),
    message_id: attribute(opening_tag, 'id'),
    body,
  }
}

/** The socket names a session may learn, from framed deliveries only. */
export function learnedNames(turns: readonly Turn[]): readonly SenderName[] {
  return framedDeliveries(turns).flatMap((delivery) =>
    delivery.from_address !== null && delivery.from_name !== null
      ? [{ from_address: delivery.from_address, from_name: delivery.from_name }]
      : [],
  )
}

/**
 * The handoffs that may be marked read.
 *
 * The Claude Code host gives no message id on a cross-session delivery, so on
 * that host `by_id` is empty and only the framed body can be matched against an
 * unread DM. An id could come from the sender's own record, keyed by address and
 * time; until it does, matching a body is the only option that does not scan
 * loose text.
 */
export function handoffsToRetire(turns: readonly Turn[]): Retirement {
  return framedDeliveries(turns).reduce<Retirement>(
    (retirement, delivery) =>
      delivery.message_id !== null
        ? { by_id: [...retirement.by_id, delivery.message_id], by_body: retirement.by_body }
        : { by_id: retirement.by_id, by_body: [...retirement.by_body, delivery.body] },
    { by_id: [], by_body: [] },
  )
}

function framedDeliveries(turns: readonly Turn[]): readonly FramedDelivery[] {
  return turns.flatMap((turn) => {
    const delivery = framedDeliveryOf(turn)
    return delivery === undefined ? [] : [delivery]
  })
}

function attribute(opening_tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(opening_tag)

  return match?.[1] ?? null
}
