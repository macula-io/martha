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
//      an epoch, and signs when it was issued and when it expires, at most
//      MAXIMUM_LIFETIME_DAYS apart. The cap counts from the signed issue date,
//      not from now: counted from now, a list signed to live ten years would
//      open in its final MAXIMUM_LIFETIME_DAYS. One issued in the future is
//      refused too. Both instants are RFC 3339 in UTC and must name a real
//      moment: a form Date.parse reads by the verifier's timezone has two
//      readings (rule 3a). A list signed for another crew or kind, an expired one, one older than the
//      newest this verifier has opened, and a different list at the epoch
//      already opened are all refused. Otherwise a valid old roster that still
//      lists a removed member could be put back, or a second list signed at the
//      same epoch could be swapped in for the first.
//
//   3a. ONE BYTE STRING, ONE READING. The signed bytes must be exactly how
//      JSON.stringify writes the value they parse to (compact, or indented by
//      PRETTY_INDENT, with or without one final newline). A duplicate key, at any
//      depth, or a key spelled with escapes, parses to a value that serialises
//      differently, so it is refused: the owner reviewed one reading of the
//      document, and a parser that keeps the other duplicate must not see a
//      list the owner never read.
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

import { createHash } from 'node:crypto'

import { isNodeId, type RoomRosters } from '../admit_a_room_message/admit_a_room_message.ts'
import { MEMBER_NAME, type SignedMember } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
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
  members: 'members',
} as const

export type TrustListKind = keyof typeof LIST_FIELD

/**
 * The kind of the one signed list that is not a list of node ids: the commands whose output keeps a member's
 * shell (martha#129). Its body is read by ../keep_the_shell_for_an_owner_signed_command, not by this module.
 */
export const COMMAND_SHAPES_KIND = 'command_shapes'

/** Every kind of document the owner signs and a verifier opens. */
export type SignedListKind = TrustListKind | typeof COMMAND_SHAPES_KIND

/** Every field a trust list document has, and nothing else. */
const DOCUMENT_FIELDS = ['body', 'crew', 'epoch', 'expires_at', 'issued_at', 'kind'] as const

/** The kind whose entries pair a member's name with its node id, not bare node ids. */
const MEMBERS_KIND = 'members' satisfies TrustListKind

/** The longest a list may live, from its signed issue date to its expiry. */
export const MAXIMUM_LIFETIME_DAYS = 366
const DAY_MS = 24 * 60 * 60 * 1000

/** The indent of the one non-compact form a signed document may take. */
export const PRETTY_INDENT = 2
const FINAL_NEWLINE = '\n'

/** The list a verifier last opened for a crew and kind: its epoch, and which list it was. */
export interface OpenedEpoch {
  readonly epoch: number
  /** sha256, in hex, of the document's value as JSON.stringify writes it compactly. */
  readonly digest: string
}

/**
 * The newest list this verifier has opened, per crew and kind.
 *
 * It MUST persist across processes, kept where the member's user cannot write.
 * A store held in memory forgets on every restart, and a restarted verifier then
 * opens an old epoch, or another list at the newest epoch, as if new.
 */
export interface EpochStore {
  newest(crew: string, kind: SignedListKind): OpenedEpoch | undefined
  /** Keep this as the newest; only a trusted open calls it. */
  keep(crew: string, kind: SignedListKind, opened: OpenedEpoch): void
}

export type OpenedList =
  | {
      readonly trusted: true
      readonly node_ids: readonly string[]
      readonly members: readonly SignedMember[]
      readonly epoch: number
    }
  | { readonly trusted: false; readonly why: string; readonly node_ids: readonly string[]; readonly members: readonly SignedMember[] }

/** One node-id trust list to open. */
export type TrustListToOpen = SignedDocumentToOpen<TrustListKind>

/** A signed document of any kind, to open with the body reader its kind has. */
export interface SignedDocumentToOpen<Kind extends SignedListKind = SignedListKind> {
  readonly kind: Kind
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
const NO_MEMBERS: readonly SignedMember[] = []

/** Open one trust list: its node ids when everything holds, and nobody otherwise. */
export function openTrustList(input: TrustListToOpen): OpenedList {
  const opened = openSignedDocument(input, (body) => entriesOf(input.kind, body))
  if (!opened.trusted) {
    return { trusted: false, why: `the ${input.kind} trusts nobody: ${opened.why}`, node_ids: NOBODY, members: NO_MEMBERS }
  }
  return { trusted: true, node_ids: opened.body.map((entry) => entry.node_id), members: membersOf(opened.body), epoch: opened.epoch }
}

/** A signed document opened: its body as its kind's reader read it, or why it opens as nothing. */
export type OpenedDocument<Body> = { readonly trusted: true; readonly body: Body; readonly epoch: number } | { readonly trusted: false; readonly why: string }

/**
 * Open one signed document of any kind, every rule above applied before `readBody` sees its body. `readBody`
 * gives the body as its kind reads it, or why it cannot be read; the epoch is kept only when it can.
 */
export function openSignedDocument<Body>(input: SignedDocumentToOpen, readBody: (body: unknown) => Body | string): OpenedDocument<Body> {
  const accepted = refusalOf(input, readBody)
  if (typeof accepted === 'string') return { trusted: false, why: accepted }
  input.epochs.keep(input.crew, input.kind, { epoch: accepted.epoch, digest: accepted.digest })
  return { trusted: true, body: accepted.body, epoch: accepted.epoch }
}

interface Entry {
  /** Lowercased: node ids compare without regard to case everywhere a gate reads them. */
  readonly node_id: string
  readonly member_name?: string
}

interface Accepted<Body> {
  readonly body: Body
  readonly epoch: number
  readonly digest: string
}

function refusalOf<Body>(input: SignedDocumentToOpen, readBody: (body: unknown) => Body | string): string | Accepted<Body> {
  if (input.document === undefined) return 'there is no document'
  if (input.signature === undefined) return 'the document is not signed'

  const pinned = pinnedHardwareKeys(input.pinned_keys)
  if (typeof pinned === 'string') return pinned

  const check = verifySshSignature(input.signature, input.document, TRUST_LIST_NAMESPACE)
  if (!check.valid) return check.why
  if (!pinned.some((blob) => blob.equals(check.key.blob))) return 'it is signed by a key that is not pinned'
  if (!check.user_present) return 'the hardware key was not touched when it signed'

  return contentOf(input, readBody)
}

function pinnedHardwareKeys(lines: readonly string[]): readonly Buffer[] | string {
  if (lines.length === 0) return 'no key is pinned'
  const keys = lines.map(parseSshPublicKey)
  if (keys.some((key) => key === undefined)) return 'a pinned key cannot be read'
  if (keys.some((key) => key?.type !== SK_ED25519)) return 'a pinned key is not a hardware key'
  return keys.flatMap((key) => (key === undefined ? [] : [key.blob]))
}

function contentOf<Body>(input: SignedDocumentToOpen, readBody: (body: unknown) => Body | string): string | Accepted<Body> {
  const document = parsed(input.document)
  if (typeof document === 'string') return document
  if (document.kind !== input.kind) return `the document is a ${String(document.kind)}`
  if (document.crew !== input.crew) return 'the document is signed for another crew'

  const lifetime = lifetimeRefusal(document, input.now)
  if (lifetime !== undefined) return lifetime

  const body = readBody(document.body)
  if (typeof body === 'string') return body

  const opened = epochToOpen(input, document)
  if (typeof opened === 'string') return opened

  return { body, epoch: opened.epoch, digest: opened.digest }
}

/** Why the document's signed issue date and expiry do not hold at `now` (rule 3), or undefined when they do. */
function lifetimeRefusal(document: Record<string, unknown>, now: Date): string | undefined {
  const issued = instantOf(document.issued_at)
  if (Number.isNaN(issued)) return 'the issue date cannot be read'
  const expires = instantOf(document.expires_at)
  if (Number.isNaN(expires)) return 'the expiry cannot be read'
  if (issued > now.getTime()) return 'the document is issued in the future'
  if (now.getTime() >= expires) return 'the document has expired'
  if (expires - issued > MAXIMUM_LIFETIME_DAYS * DAY_MS) {
    return `the document lives more than ${MAXIMUM_LIFETIME_DAYS} days from its issue date`
  }
  return undefined
}

/** The document's epoch and digest when it is newer than, or the very list, this verifier last opened. */
function epochToOpen(input: SignedDocumentToOpen, document: Record<string, unknown>): string | OpenedEpoch {
  const epoch = document.epoch
  if (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0) return 'the epoch is not a whole number'
  const digest = createHash('sha256').update(JSON.stringify(document)).digest('hex')
  const newest = input.epochs.newest(input.crew, input.kind)
  if (newest !== undefined && epoch < newest.epoch) return `epoch ${epoch} is older than epoch ${newest.epoch}, already opened`
  if (newest !== undefined && epoch === newest.epoch && digest !== newest.digest) {
    return `epoch ${epoch} was already opened for another list`
  }
  return { epoch, digest }
}

/**
 * The one form a signed instant may take: RFC 3339 in UTC, as toISOString writes it,
 * with or without milliseconds. Date.parse reads a form without an offset, or a
 * free form, in the verifier's own timezone, so one signed byte string would
 * open differently on two hosts (rule 3a).
 */
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/
/** Date and time, up to the seconds: the part of an instant toISOString must give back unchanged. */
const TO_THE_SECOND = 'YYYY-MM-DDTHH:mm:ss'.length

function instantOf(value: unknown): number {
  if (typeof value !== 'string' || !RFC3339_UTC.test(value)) return Number.NaN
  const instant = Date.parse(value)
  if (Number.isNaN(instant)) return Number.NaN
  // An impossible date (31 November, 24:00) parses by rolling over; it must not.
  const round_trip = new Date(instant).toISOString().slice(0, TO_THE_SECOND)
  return round_trip === value.slice(0, TO_THE_SECOND) ? instant : Number.NaN
}

function parsed(document: Buffer | undefined): Record<string, unknown> | string {
  const text = document?.toString('utf8') ?? ''
  const value: unknown = parseJson(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'the document is not an object'
  if (!isCanonical(text, value)) return 'the bytes are not one reading of the document (a duplicate or escaped key, or another layout)'
  const fields = Object.keys(value).sort()
  if (fields.join() !== [...DOCUMENT_FIELDS].join()) return `the document's fields are ${fields.join(', ')}`
  return value as Record<string, unknown>
}

function isCanonical(text: string, value: unknown): boolean {
  const layouts = [JSON.stringify(value), JSON.stringify(value, null, PRETTY_INDENT)]
  return layouts.some((layout) => text === layout || text === `${layout}${FINAL_NEWLINE}`)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function entriesOf(kind: TrustListKind, body: unknown): readonly Entry[] | string {
  const field = LIST_FIELD[kind]
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'the body is not an object'
  if (Object.keys(body).join() !== field) return `the body must hold ${field} and nothing else`
  const list: unknown = (body as Record<string, unknown>)[field]
  if (!Array.isArray(list)) return `${field} is not a list`
  const read = kind === MEMBERS_KIND ? memberEntry : nodeIdEntry
  const entries = list.map(read)
  if (entries.some((entry) => entry === undefined)) return `${field} holds something that is not ${kind === MEMBERS_KIND ? 'a member' : 'a node id'}`
  return entries.flatMap((entry) => (entry === undefined ? [] : [entry]))
}

function nodeIdEntry(entry: unknown): Entry | undefined {
  return typeof entry === 'string' && isNodeId(entry) ? { node_id: entry.toLowerCase() } : undefined
}

/** The fields of one entry in a members list, and nothing else. */
const MEMBER_FIELDS = ['member_name', 'node_id'] as const

function memberEntry(entry: unknown): Entry | undefined {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined
  if (Object.keys(entry).sort().join() !== [...MEMBER_FIELDS].join()) return undefined
  const { member_name, node_id } = entry as Record<string, unknown>
  if (typeof member_name !== 'string' || !MEMBER_NAME.test(member_name)) return undefined
  if (typeof node_id !== 'string' || !isNodeId(node_id)) return undefined
  return { member_name, node_id: node_id.toLowerCase() }
}

function membersOf(entries: readonly Entry[]): readonly SignedMember[] {
  return entries.flatMap(({ member_name, node_id }) => (member_name === undefined ? [] : [{ member_name, node_id }]))
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

/** The members the launcher may bind a sender to, from their opened list. */
export function trustedMembers(members: OpenedList): readonly SignedMember[] {
  return members.members
}
