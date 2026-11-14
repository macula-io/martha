// Verifying an OpenSSH signature (SSHSIG), the format `ssh-keygen -Y sign` writes.
//
// The owner signs a trust list with a hardware key at their keyboard. On the
// owner's machine that is `ssh-keygen -Y sign` with a FIDO key
// (`sk-ssh-ed25519@openssh.com`): no new tool, and the key never leaves the
// device. This file only verifies; nothing in this repository signs.
//
// The format, from OpenSSH's PROTOCOL.sshsig and PROTOCOL.u2f:
//
//   blob    = "SSHSIG" u32(1) string(public key) string(namespace)
//             string(reserved) string(hash algorithm) string(signature)
//   signed  = "SSHSIG" string(namespace) string(reserved)
//             string(hash algorithm) string(H(message))
//
// For `ssh-ed25519` the Ed25519 signature is over `signed`. For a FIDO key the
// authenticator signs sha256(application) || flags || u32(counter) ||
// sha256(signed), and the signature string carries the flags and the counter
// after the Ed25519 bytes. Flag 0x01 is user presence: the owner touched it.

import { createHash, createPublicKey, verify } from 'node:crypto'

const MAGIC = Buffer.from('SSHSIG')
const VERSION = 1
const ARMOR_BEGIN = '-----BEGIN SSH SIGNATURE-----'
const ARMOR_END = '-----END SSH SIGNATURE-----'

export const ED25519 = 'ssh-ed25519'
export const SK_ED25519 = 'sk-ssh-ed25519@openssh.com'

/** Flag bit an authenticator sets when the owner touched it. */
export const USER_PRESENT = 0x01

/** The hash a hardware key signs with, as ssh names it in a signature. */
export const SSH_SHA512 = 'sha512'

const HASHES: Readonly<Record<string, string>> = { sha256: 'sha256', sha512: SSH_SHA512 }

/** The 12 bytes that turn a raw Ed25519 key into an SPKI DER key node can load. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

export interface SshPublicKey {
  readonly type: string
  /** The key's wire blob, exactly as OpenSSH writes it: what a pinned key is compared on. */
  readonly blob: Buffer
  readonly ed25519: Buffer
  /** The FIDO application a hardware key is bound to; absent for a plain key. */
  readonly application?: string
}

export type SignatureCheck =
  | { readonly valid: true; readonly key: SshPublicKey; readonly user_present: boolean }
  | { readonly valid: false; readonly why: string }

/** Read one OpenSSH public key line: `<type> <base64 blob> [comment]`. */
export function parseSshPublicKey(line: string): SshPublicKey | undefined {
  const [type, encoded] = line.trim().split(/\s+/)
  if (type === undefined || encoded === undefined) return undefined
  const key = keyFromBlob(Buffer.from(encoded, 'base64'))
  return key?.type === type ? key : undefined
}

/** Verify an armored SSHSIG over `message`, in `namespace`. */
export function verifySshSignature(armored: string, message: Buffer, namespace: string): SignatureCheck {
  const blob = dearmor(armored)
  if (blob === undefined) return { valid: false, why: 'the signature is not an armored SSH signature' }
  const parsed = parseBlob(blob)
  if (typeof parsed === 'string') return { valid: false, why: parsed }

  if (parsed.namespace !== namespace) return { valid: false, why: `the signature is for namespace ${parsed.namespace}` }
  const hash = HASHES[parsed.hash]
  if (hash === undefined) return { valid: false, why: `the signature uses hash ${parsed.hash}, which is not accepted` }

  const signed = Buffer.concat([
    MAGIC,
    sshString(Buffer.from(parsed.namespace)),
    sshString(parsed.reserved),
    sshString(Buffer.from(parsed.hash)),
    sshString(createHash(hash).update(message).digest()),
  ])
  return checkSignature(parsed.key, parsed.signature, signed)
}

interface ParsedBlob {
  readonly key: SshPublicKey
  readonly namespace: string
  readonly reserved: Buffer
  readonly hash: string
  readonly signature: Buffer
}

function parseBlob(blob: Buffer): ParsedBlob | string {
  if (!blob.subarray(0, MAGIC.length).equals(MAGIC)) return 'the signature does not start with SSHSIG'
  const reader = new WireReader(blob, MAGIC.length)
  if (reader.u32() !== VERSION) return 'the signature is not SSHSIG version 1'
  const key_blob = reader.string()
  const namespace = reader.string()
  const reserved = reader.string()
  const hash = reader.string()
  const signature = reader.string()
  if (!reader.ok() || !reader.atEnd()) return 'the signature blob is malformed'
  const key = keyFromBlob(key_blob ?? Buffer.alloc(0))
  if (key === undefined) return 'the signature carries a key type that is not accepted'
  return {
    key,
    namespace: String(namespace),
    reserved: reserved ?? Buffer.alloc(0),
    hash: String(hash),
    signature: signature ?? Buffer.alloc(0),
  }
}

function checkSignature(key: SshPublicKey, signature: Buffer, signed: Buffer): SignatureCheck {
  const reader = new WireReader(signature, 0)
  const type = String(reader.string())
  const raw = reader.string()
  if (type !== key.type || raw === undefined) return { valid: false, why: 'the signature type does not match its key' }

  if (key.type === ED25519) {
    if (!readToTheEnd(reader)) return { valid: false, why: 'the signature is malformed' }
    return verified(key, raw, signed, true)
  }
  return checkHardwareKeySignature(key, raw, reader, signed)
}

/** A FIDO signature: the flags and counter follow the Ed25519 bytes, and the authenticator signed over them. */
function checkHardwareKeySignature(key: SshPublicKey, raw: Buffer, reader: WireReader, signed: Buffer): SignatureCheck {
  const flags = reader.byte()
  const counter = reader.u32()
  if (!reader.ok() || !reader.atEnd() || flags === undefined || counter === undefined) {
    return { valid: false, why: 'the hardware key signature is malformed' }
  }
  const counter_bytes = Buffer.alloc(4)
  counter_bytes.writeUInt32BE(counter)
  const authenticated = Buffer.concat([
    createHash('sha256').update(String(key.application)).digest(),
    Buffer.from([flags]),
    counter_bytes,
    createHash('sha256').update(signed).digest(),
  ])
  return verified(key, raw, authenticated, (flags & USER_PRESENT) === USER_PRESENT)
}

/** The reader met no short read and has nothing left over. */
function readToTheEnd(reader: WireReader): boolean {
  return reader.ok() && reader.atEnd()
}

function verified(key: SshPublicKey, raw: Buffer, data: Buffer, user_present: boolean): SignatureCheck {
  const public_key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, key.ed25519]), format: 'der', type: 'spki' })
  return verify(null, data, public_key, raw)
    ? { valid: true, key, user_present }
    : { valid: false, why: 'the signature does not verify' }
}

function keyFromBlob(blob: Buffer): SshPublicKey | undefined {
  const reader = new WireReader(blob, 0)
  const type = String(reader.string())
  const ed25519 = reader.string()
  if (ed25519?.length !== 32) return undefined
  if (type === ED25519) return reader.atEnd() && reader.ok() ? { type, blob, ed25519 } : undefined
  if (type !== SK_ED25519) return undefined
  return hardwareKeyFrom(reader, blob, ed25519)
}

/** A FIDO key's blob carries the application it is bound to after the Ed25519 bytes. */
function hardwareKeyFrom(reader: WireReader, blob: Buffer, ed25519: Buffer): SshPublicKey | undefined {
  const application = reader.string()
  if (application === undefined || !reader.atEnd() || !reader.ok()) return undefined
  return { type: SK_ED25519, blob, ed25519, application: application.toString() }
}

function dearmor(armored: string): Buffer | undefined {
  const text = armored.trim()
  if (!text.startsWith(ARMOR_BEGIN) || !text.endsWith(ARMOR_END)) return undefined
  const body = text.slice(ARMOR_BEGIN.length, text.length - ARMOR_END.length).replace(/\s+/g, '')
  return /^[A-Za-z0-9+/]*={0,2}$/.test(body) ? Buffer.from(body, 'base64') : undefined
}

/** An SSH wire string: u32 length, then the bytes. */
export function sshString(bytes: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  return Buffer.concat([length, bytes])
}

class WireReader {
  private failed = false
  private readonly bytes: Buffer
  private offset: number

  constructor(bytes: Buffer, offset: number) {
    this.bytes = bytes
    this.offset = offset
  }

  u32(): number | undefined {
    if (this.offset + 4 > this.bytes.length) return this.fail()
    const value = this.bytes.readUInt32BE(this.offset)
    this.offset += 4
    return value
  }

  byte(): number | undefined {
    if (this.offset + 1 > this.bytes.length) return this.fail()
    const value = this.bytes[this.offset]
    this.offset += 1
    return value
  }

  string(): Buffer | undefined {
    const length = this.u32()
    if (length === undefined || this.offset + length > this.bytes.length) return this.fail()
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  ok(): boolean {
    return !this.failed
  }

  atEnd(): boolean {
    return this.offset === this.bytes.length
  }

  private fail(): undefined {
    this.failed = true
    return undefined
  }
}
