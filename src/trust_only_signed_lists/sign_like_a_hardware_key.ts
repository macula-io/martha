// Test fixtures only: sign the way a FIDO key does, with a key held in memory.
//
// The real owner signs with a hardware key that never leaves the device. A test
// cannot touch one, so this builds the same bytes an authenticator would: the
// SSHSIG blob of OpenSSH's PROTOCOL.sshsig with the `sk-ssh-ed25519@openssh.com`
// signature of PROTOCOL.u2f. Nothing here is a key on disk, and no shipped code
// imports it: the interop test proves real `ssh-keygen -Y verify` accepts what it
// writes, so the verifier is tested against the format, not against itself.

import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'

import { ED25519, SK_ED25519, USER_PRESENT, sshString } from './ssh_signature.ts'

const MAGIC = Buffer.from('SSHSIG')
const APPLICATION = 'ssh:'
const HASH = 'sha512'
const ARMOR_LINE = 70

export interface FixtureKey {
  readonly type: typeof SK_ED25519 | typeof ED25519
  readonly private_key: KeyObject
  readonly blob: Buffer
  /** The OpenSSH public key line a host would pin. */
  readonly line: string
}

/** A fresh key, of the hardware type unless asked for a plain one. */
export function fixtureKey(type: FixtureKey['type'] = SK_ED25519): FixtureKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const raw = Buffer.from(String(publicKey.export({ format: 'jwk' }).x), 'base64url')
  const blob = Buffer.concat([
    sshString(Buffer.from(type)),
    sshString(raw),
    ...(type === SK_ED25519 ? [sshString(Buffer.from(APPLICATION))] : []),
  ])
  return { type, private_key: privateKey, blob, line: `${type} ${blob.toString('base64')} fixture` }
}

export interface SignOptions {
  readonly namespace: string
  /** The authenticator flags; user presence unless a test says otherwise. */
  readonly flags?: number
}

/** The armored SSHSIG `ssh-keygen -Y sign` would write for this key and message. */
export function signLikeAHardwareKey(key: FixtureKey, message: Buffer, options: SignOptions): string {
  const signed = Buffer.concat([
    MAGIC,
    sshString(Buffer.from(options.namespace)),
    sshString(Buffer.alloc(0)),
    sshString(Buffer.from(HASH)),
    sshString(createHash(HASH).update(message).digest()),
  ])
  const signature = key.type === SK_ED25519 ? skSignature(key, signed, options.flags ?? USER_PRESENT) : plain(key, signed)

  const version = Buffer.alloc(4)
  version.writeUInt32BE(1)
  const blob = Buffer.concat([
    MAGIC,
    version,
    sshString(key.blob),
    sshString(Buffer.from(options.namespace)),
    sshString(Buffer.alloc(0)),
    sshString(Buffer.from(HASH)),
    sshString(signature),
  ])
  const lines = blob.toString('base64').match(new RegExp(`.{1,${ARMOR_LINE}}`, 'g')) ?? []
  return ['-----BEGIN SSH SIGNATURE-----', ...lines, '-----END SSH SIGNATURE-----', ''].join('\n')
}

function skSignature(key: FixtureKey, signed: Buffer, flags: number): Buffer {
  const counter = Buffer.alloc(4)
  counter.writeUInt32BE(1)
  const authenticated = Buffer.concat([
    createHash('sha256').update(APPLICATION).digest(),
    Buffer.from([flags]),
    counter,
    createHash('sha256').update(signed).digest(),
  ])
  return Buffer.concat([
    sshString(Buffer.from(SK_ED25519)),
    sshString(sign(null, authenticated, key.private_key)),
    Buffer.from([flags]),
    counter,
  ])
}

function plain(key: FixtureKey, signed: Buffer): Buffer {
  return Buffer.concat([sshString(Buffer.from(ED25519)), sshString(sign(null, signed, key.private_key))])
}
