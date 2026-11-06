// Every list a gate trusts is a signed object, opened where it is used.
//
// This exists so code that can write a file as a member's user cannot add a node
// id to a list a gate checks against, and so get its text acted on.
//
// Every gate in this repository compares against a list: the crew room's roster
// and the shared room's (../admit_a_room_message), the policy that says whose
// text a session may act on (../refuse_execution_after_ungated_text), and the
// supervisors who may act (../who_may_act). Kept as plain files, each can be
// rewritten by one command run as the member's user, and every gate then admits
// whoever was added. So each list is a document the owner signs, and it is
// opened from the signed bytes on every read, never from a copy.
//
// Five rules are load-bearing here.
//
//   1. NOTHING SIGNED, NOBODY TRUSTED. A document that is missing, unsigned,
//      signed by a key that is not pinned, malformed, or for something else
//      opens as an EMPTY list: the gate built on it admits nobody. There is no
//      fallback to the unsigned file.
//
//   2. ONLY A HARDWARE KEY, TOUCHED. The owner signs with `ssh-keygen -Y sign`
//      and a FIDO key (`sk-ssh-ed25519@openssh.com`) at their keyboard. A pinned
//      key of any other type is refused, so a key file a member's user can read
//      cannot be the anchor. The signature must carry the user-presence flag.
//
//   3. BOUND, NUMBERED, EXPIRING. The document names its crew and its kind, has
//      an epoch, and has an expiry. A list signed for another crew or kind, an
//      expired one, and one older than the newest this verifier has opened are
//      all refused. Otherwise a valid old roster that still lists a removed
//      member could be put back.
//
//   4. THE VERIFYING KEY IS PINNED BY THE HOST, NOT BY THE DOCUMENT. The key
//      comes from where the host installed it, outside the directory the lists
//      live in. A document cannot name its own key: its shape has no field for
//      one, and the key inside the signature counts only if it is pinned.
//
//   5. NOTHING SHIPPED SIGNS. This repository verifies; signing is the owner's
//      act on the owner's device. The test fixtures sign with keys held in
//      memory, and a test fails if shipped code imports them or if a private
//      key is tracked here.
//
// The residual, named: code running as the member's own user can replace the
// pinned key if the host installs it somewhere that user can write. Pinning it
// out of that user's reach is an OS boundary, filed separately; this module
// moves the anchor out of reach of every path that goes through a model.

import { isNodeId, type RoomRosters } from '../admit_a_room_message/admit_a_room_message.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import type { Roster } from '../who_may_act/who_may_act.ts'
import { SK_ED25519, parseSshPublicKey, verifySshSignature } from './ssh_signature.ts'

/** The namespace the owner signs trust lists in: `ssh-keygen -Y sign -n <this>`. */
export const TRUST_LIST_NAMESPACE = 'martha-trust-list'

/** Each list a gate trusts, and the field its node ids live in. */
export const LIST_FIELD = {
  crew_roster: 'member_node_ids',
  shared_roster: 'member_node_ids',
  policy: 'may_send_executable_text',
  supervisors: 'supervisor_node_ids',
} as const

export type TrustListKind = keyof typeof LIST_FIELD

/** Every field a trust list document has, and nothing else. */
const DOCUMENT_FIELDS = ['body', 'crew', 'epoch', 'expires_at', 'kind'] as const

/** The newest epoch this verifier has opened, per crew and kind. */
export interface EpochStore {
  highest(crew: string, kind: TrustListKind): number | undefined
  raise(crew: string, kind: TrustListKind, epoch: number): void
}

export type OpenedList =
  | { readonly trusted: true; readonly node_ids: readonly string[]; readonly epoch: number }
  | { readonly trusted: false; readonly why: string; readonly node_ids: readonly string[] }

export interface TrustListToOpen {
  readonly kind: TrustListKind
  /** The document's bytes, exactly as signed; undefined when there is none. */
  readonly document: Buffer | undefined
  /** The armored `.sig` file `ssh-keygen -Y sign` wrote; undefined when there is none. */
  readonly signature: string | undefined
  /** The owner's public keys, as OpenSSH lines, from where the host installed them. */
  readonly pinned_keys: readonly string[]
  readonly crew: string
  readonly now: Date
  readonly epochs: EpochStore
}

const NOBODY: readonly string[] = []

/** Open one trust list: its node ids when everything holds, and nobody otherwise. */
export function openTrustList(input: TrustListToOpen): OpenedList {
  const why = refusalOf(input)
  if (typeof why === 'string') return { trusted: false, why: `the ${input.kind} trusts nobody: ${why}`, node_ids: NOBODY }
  input.epochs.raise(input.crew, input.kind, why.epoch)
  return { trusted: true, node_ids: why.node_ids, epoch: why.epoch }
}

interface Accepted {
  readonly node_ids: readonly string[]
  readonly epoch: number
}

function refusalOf(input: TrustListToOpen): string | Accepted {
  if (input.document === undefined) return 'there is no document'
  if (input.signature === undefined) return 'the document is not signed'

  const pinned = pinnedHardwareKeys(input.pinned_keys)
  if (typeof pinned === 'string') return pinned

  const check = verifySshSignature(input.signature, input.document, TRUST_LIST_NAMESPACE)
  if (!check.valid) return check.why
  if (!pinned.some((blob) => blob.equals(check.key.blob))) return 'it is signed by a key that is not pinned'
  if (!check.user_present) return 'the hardware key was not touched when it signed'

  return contentOf(input)
}

function pinnedHardwareKeys(lines: readonly string[]): readonly Buffer[] | string {
  if (lines.length === 0) return 'no key is pinned'
  const keys = lines.map(parseSshPublicKey)
  if (keys.some((key) => key === undefined)) return 'a pinned key cannot be read'
  if (keys.some((key) => key?.type !== SK_ED25519)) return 'a pinned key is not a hardware key'
  return keys.flatMap((key) => (key === undefined ? [] : [key.blob]))
}

function contentOf(input: TrustListToOpen): string | Accepted {
  const document = parsed(input.document)
  if (typeof document === 'string') return document
  if (document.kind !== input.kind) return `the document is a ${String(document.kind)}`
  if (document.crew !== input.crew) return 'the document is signed for another crew'

  const epoch = document.epoch
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return 'the epoch is not a whole number'
  const highest = input.epochs.highest(input.crew, input.kind)
  if (highest !== undefined && epoch < highest) return `epoch ${epoch} is older than epoch ${highest}, already opened`

  const expires = typeof document.expires_at === 'string' ? Date.parse(document.expires_at) : Number.NaN
  if (Number.isNaN(expires)) return 'the expiry cannot be read'
  if (input.now.getTime() >= expires) return 'the document has expired'

  const node_ids = nodeIdsOf(document.body, LIST_FIELD[input.kind])
  if (typeof node_ids === 'string') return node_ids
  return { node_ids, epoch }
}

function parsed(document: Buffer | undefined): Record<string, unknown> | string {
  const value: unknown = parseJson(document?.toString('utf8') ?? '')
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'the document is not an object'
  const fields = Object.keys(value).sort()
  if (fields.join() !== [...DOCUMENT_FIELDS].join()) return `the document's fields are ${fields.join(', ')}`
  return value as Record<string, unknown>
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function nodeIdsOf(body: unknown, field: string): readonly string[] | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'the body is not an object'
  if (Object.keys(body).join() !== field) return `the body must hold ${field} and nothing else`
  const list: unknown = (body as Record<string, unknown>)[field]
  if (!Array.isArray(list)) return `${field} is not a list`
  if (!list.every((entry) => typeof entry === 'string' && isNodeId(entry))) return `${field} holds something that is not a node id`
  return list as string[]
}

/** The two room rosters a delivery gate reads, from their opened lists. */
export function trustedRoomRosters(crew: OpenedList, shared: OpenedList): RoomRosters {
  return { crew: { member_node_ids: crew.node_ids }, shared: { member_node_ids: shared.node_ids } }
}

/** The policy the shell gate reads, from its opened list. */
export function trustedPolicy(policy: OpenedList): Policy {
  return { may_send_executable_text: policy.node_ids }
}

/** The supervisors who may act, from their opened list. */
export function trustedSupervisors(supervisors: OpenedList): Roster {
  return { supervisor_node_ids: supervisors.node_ids }
}
