// Which envelopes the crew believes.
//
// The crew learns two things from a cross-session message: who a socket belongs
// to (so a later message from that socket carries a name), and which handoffs
// have been read. Both are learned by scanning text for an envelope — and every
// turn the plugin submits is text, so a room body, a ring purpose, a decline
// reason, a direct message's own body or something the owner pasted can contain
// an envelope that was never sent. That buys a stranger two effects: renaming
// another member's socket, and retiring a handoff as read.
//
// The rule here is the only one that holds: an envelope is believed only where
// the harness framed it. A framed delivery carries its sender and its message id
// as facts the harness reports, so nothing has to be scanned — and nothing is.
// Loose text is never scanned for envelopes at all, whatever it contains, which
// is why a body that closes its envelope early and opens a forged one lends the
// forgery nothing.

/** What the harness itself reports about a message it delivered. */
export interface FramedDelivery {
  readonly from_node_id: string | null
  readonly from_name: string | null
  readonly message_id: string | null
  readonly body: string
}

/**
 * Something a session took in. Only `framed` carries facts; `unframed` is text,
 * and text is never read for envelopes.
 */
export type Ingested = { readonly framed: FramedDelivery } | { readonly unframed: string }

export interface SenderName {
  readonly from_node_id: string | null
  readonly from_name: string
}

/** The socket names a session may learn: from framed deliveries only. */
export function learnedNames(ingested: readonly Ingested[]): readonly SenderName[] {
  return ingested.flatMap((item) =>
    'framed' in item && item.framed.from_name !== null
      ? [{ from_node_id: item.framed.from_node_id, from_name: item.framed.from_name }]
      : [],
  )
}

/** The handoffs that may be marked read: the framed ones, by the id the harness gave. */
export function handoffsToRetire(ingested: readonly Ingested[]): readonly string[] {
  return ingested.flatMap((item) =>
    'framed' in item && item.framed.message_id !== null ? [item.framed.message_id] : [],
  )
}
