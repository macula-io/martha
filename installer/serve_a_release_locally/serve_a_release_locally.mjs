// A Martha release the tests can shape and break (martha#21): a tar written header by header (so a test can name an
// absolute path, a '..', a fifo or an escaping link that no tar tool would write), the manifest that names it, and
// the cosign signature index and bundle over its digest, all served by a local registry on 127.0.0.1. Never shipped:
// the package's "files" leave this directory out.
import { chmodSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

import { PolicyError, VerificationError } from 'sigstore'

import { placesOnThisMachine } from '../install_a_release/install_a_release.mjs'
import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { sha256 } from '../read_the_release_registry/read_the_release_registry.mjs'

const BLOCK = 512
export const SIGNER = 'b4c41abb404c32215a2823b7f19ac65b732e1dfe'
// A sha of attest-image.yml from before its guard: never listed, so a signature under it is refused.
export const PRE_GUARD_SIGNER = 'e8fe1a8000000000000000000000000000000000'

/**
 * @typedef {{ name: string, type?: string, body?: string | Buffer, mode?: number, target?: string, pax?: string, paxRaw?: string, gnuLong?: string, size?: number }} TarEntry
 */

/** @param {{ name: string, type?: string, size?: number, mode?: number, target?: string }} h */
function header ({ name, type = '0', size = 0, mode = 0o644, target = '' }) {
  const block = Buffer.alloc(BLOCK)
  block.write(name, 0, 100, 'utf8')
  block.write(mode.toString(8).padStart(7, '0'), 100, 8, 'ascii')
  block.write('0000000', 108, 8, 'ascii')
  block.write('0000000', 116, 8, 'ascii')
  block.write(size.toString(8).padStart(11, '0'), 124, 12, 'ascii')
  block.write('00000000000', 136, 12, 'ascii')
  block.write(type, 156, 1, 'ascii')
  block.write(target, 157, 100, 'utf8')
  block.write('ustar\u000000', 257, 8, 'ascii')
  block.fill(0x20, 148, 156)
  const sum = block.reduce((n, b) => n + b, 0)
  block.write(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148, 8, 'ascii')
  return block
}

/**
 * "<len> <key>=<value>\n", where <len> counts its own digits.
 * @param {string} key
 * @param {string} value
 */
export const paxRecord = (key, value) => {
  const rest = ` ${key}=${value}\n`
  const restBytes = Buffer.byteLength(rest)
  for (let digits = 1; ; digits++) if (String(restBytes + digits).length === digits) return `${restBytes + digits}${rest}`
}

/** @param {Buffer} body */
const padded = (body) => Buffer.concat([body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK)])

/**
 * A tar of `entries`; `pax` carries a long name in a pax 'x' header first, `gnuLong` in a GNU 'L' header.
 * @param {TarEntry[]} entries
 */
export function tarOf (entries) {
  /** @type {Buffer[]} */
  const parts = []
  for (const e of entries) {
    if (e.pax !== undefined) {
      const body = Buffer.from(paxRecord('path', e.pax))
      parts.push(header({ name: 'PaxHeader', type: 'x', size: body.length }), padded(body))
    }
    if (e.paxRaw !== undefined) {
      const body = Buffer.from(e.paxRaw)
      parts.push(header({ name: 'PaxHeader', type: 'x', size: body.length }), padded(body))
    }
    if (e.gnuLong !== undefined) {
      const body = Buffer.from(`${e.gnuLong}\0`)
      parts.push(header({ name: '././@LongLink', type: 'L', size: body.length }), padded(body))
    }
    const body = Buffer.from(e.body ?? '')
    const carries = e.type !== '5' && e.type !== '2'
    parts.push(header({ ...e, size: carries ? body.length : 0 }))
    if (body.length && carries) parts.push(padded(body))
  }
  parts.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(parts)
}

/** @param {{ command?: boolean }} [shape] @returns {TarEntry[]} */
export const goodEntries = ({ command = true } = {}) => [
  { name: 'martha/', type: '5', mode: 0o755 },
  { name: 'martha/README.md', body: '# Martha\n' },
  { name: 'martha/docs', type: '2', target: 'README.md' },
  ...(command
    ? [{ name: 'martha/bin/', type: '5', mode: 0o755 }, { name: 'martha/bin/martha', body: '#!/bin/sh\necho martha\n', mode: 0o755 }]
    : [])
]

/** @param {string} text */
const derUtf8 = (text) => { const b = Buffer.from(text); return Buffer.concat([Buffer.from([0x0c, b.length]), b]) }
/** @param {string} id @param {string} text */
export const oid = (id, text) => ({ oid: { id: id.split('.').map(Number) }, value: derUtf8(text) })

/**
 * @typedef {{ version: string, layer: Buffer, manifest: Buffer, digest: string, bundle: any }} Release
 */

/**
 * A release as the registry serves it. The manifest always names the honest layer: `layerBytes` serves other bytes
 * under its digest (a tampered layer), `layerSize` makes the manifest claim another size, `gzipped` replaces the
 * honest layer outright (a bomb), `mediaType` gives the manifest another type, `padTo` pads the manifest's bytes.
 * @param {{ version?: string, entries?: TarEntry[], layerBytes?: Buffer, layerSize?: number, gzipped?: Buffer, mediaType?: string, padTo?: number }} [shape]
 * @returns {Release}
 */
export function release ({ version = '1.2.0', entries = goodEntries(), layerBytes, layerSize, gzipped, mediaType, padTo } = {}) {
  const honest = gzipped ?? gzipSync(tarOf(entries))
  const json = {
    schemaVersion: 2,
    mediaType: mediaType ?? 'application/vnd.oci.image.manifest.v1+json',
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: sha256(Buffer.from('{}')), size: 2 },
    layers: [{ mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip', digest: sha256(honest), size: layerSize ?? honest.length }],
    // As the release job's labels do: two versions of the same tree are two manifests, two digests.
    annotations: { 'org.opencontainers.image.version': version, ...(padTo ? { padding: 'x'.repeat(padTo) } : {}) }
  }
  const manifest = Buffer.from(JSON.stringify(json))
  const digest = sha256(manifest)
  const statement = { _type: 'https://in-toto.io/Statement/v1', subject: [{ digest: { sha256: digest.slice(7) } }], predicateType: 'https://sigstore.dev/cosign/sign/v1', predicate: {} }
  const bundle = { mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json', dsseEnvelope: { payloadType: 'application/vnd.in-toto+json', payload: Buffer.from(JSON.stringify(statement)).toString('base64'), signatures: [] } }
  return { version, layer: layerBytes ?? honest, manifest, digest, bundle }
}

/**
 * A registry serving `releases` (tag -> release), anonymously, on 127.0.0.1. `tags` overrides what a tag names
 * (a moved tag), `extraTags` adds names to the list, `tagListPadding` pads the list's bytes, `nextPage` adds a Link
 * header, `unsigned` serves no signature for those digests. hits[] records every path asked for.
 * @param {Release[]} releases
 * @param {{ tags?: Record<string, Release>, extraTags?: string[], tagListPadding?: number, nextPage?: boolean, unsigned?: string[] }} [options]
 */
export async function serveRegistry (releases, { tags: moved = {}, extraTags = [], tagListPadding = 0, nextPage = false, unsigned = [] } = {}) {
  /** @type {string[]} */
  const hits = []
  /** @type {Map<string, Buffer>} */
  const blobs = new Map()
  /** @type {Map<string, Buffer>} */
  const manifests = new Map()
  /** @type {Map<string, Buffer>} */
  const tags = new Map()
  for (const r of releases) {
    tags.set(r.version, r.manifest)
    manifests.set(r.digest, r.manifest)
    if (unsigned.includes(r.digest)) continue
    const bundleBytes = Buffer.from(JSON.stringify(r.bundle))
    blobs.set(sha256(bundleBytes), bundleBytes)
    const bundleManifest = Buffer.from(JSON.stringify({
      schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', artifactType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
      annotations: { 'dev.sigstore.bundle.predicateType': 'https://sigstore.dev/cosign/sign/v1' },
      layers: [{ mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json', digest: sha256(bundleBytes), size: bundleBytes.length }]
    }))
    manifests.set(sha256(bundleManifest), bundleManifest)
    const entry = { mediaType: 'application/vnd.oci.image.manifest.v1+json', artifactType: 'application/vnd.dev.sigstore.bundle.v0.3+json', digest: sha256(bundleManifest), size: bundleManifest.length }
    tags.set(r.digest.replace(':', '-'), Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [entry] })))
  }
  for (const [tag, r] of Object.entries(moved)) tags.set(tag, r.manifest)
  // A layer served for its manifest's layer digest, whatever bytes the release carries (a tampered layer).
  for (const r of releases) blobs.set(JSON.parse(r.manifest.toString()).layers[0].digest, r.layer)
  const name = NAMES.image.slice(NAMES.image.indexOf('/') + 1)
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    hits.push(url)
    /** @param {Buffer} body @param {number} [status] @param {Record<string, string>} [extra] */
    const send = (body, status = 200, extra = {}) => { res.writeHead(status, { 'content-length': body.length, ...extra }); res.end(body) }
    if (url.startsWith('/token')) return send(Buffer.from(JSON.stringify({ token: 'anonymous' })))
    if (!url.startsWith(`/v2/${name}/`)) return send(Buffer.from('{}'), 404)
    const m = url.slice(`/v2/${name}/`.length).match(/^(tags\/list|manifests|blobs)\/?([^?]*)/)
    if (!m) return send(Buffer.from('{}'), 404)
    if (m[1] === 'tags/list') {
      const list = { tags: [...tags.keys(), ...extraTags], ...(tagListPadding ? { padding: 'x'.repeat(tagListPadding) } : {}) }
      return send(Buffer.from(JSON.stringify(list)), 200, nextPage ? { link: `</v2/${name}/tags/list?last=z&n=10000>; rel="next"` } : {})
    }
    const key = m[2] ?? ''
    const body = m[1] === 'blobs' ? blobs.get(key) : (tags.get(key) ?? manifests.get(key))
    return body ? send(body) : send(Buffer.from('{}'), 404)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const address = server.address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  return { base, hits, close: () => new Promise((resolve) => server.close(() => resolve(undefined))) }
}

const SAN = `${NAMES.signerWorkflow}@${SIGNER}`

/**
 * sigstore's createVerifier, stood in for: it checks the SAN by the anchored pattern it is given, as
 * @sigstore/verify does, and "verifies" only the digests in `signed`, for the ref and repository each was signed
 * on. It refuses with sigstore's own VerificationError, so a refusal reads as a verdict.
 * @param {Map<string, { ref: string, repository?: string, signerSha?: string }>} signed
 */
export const sigstoreStandIn = (signed) => async (/** @type {any} */ options) => ({
  verify: (/** @type {any} */ bundle) => {
    const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, 'base64').toString())
    const found = signed.get(`sha256:${statement.subject[0].digest.sha256}`)
    if (!found) throw new VerificationError({ code: 'SIGNATURE_ERROR', message: 'signature verification failed' })
    const san = `${NAMES.signerWorkflow}@${found.signerSha ?? SIGNER}`
    if (!new RegExp(options.certificateIdentityURI).test(san)) {
      throw new PolicyError({ code: 'UNTRUSTED_SIGNER_ERROR', message: `certificate identity error - expected ${options.certificateIdentityURI}, got ${san}` })
    }
    return {
      identity: {
        subjectAlternativeName: SAN,
        oids: [oid('1.3.6.1.4.1.57264.1.12', found.repository ?? NAMES.sourceRepository), oid('1.3.6.1.4.1.57264.1.14', found.ref)]
      }
    }
  }
})

/**
 * A scratch home, removed by `close`. Its places are the ones the bin would work out for it.
 */
export function scratchMachine () {
  const home = mkdtempSync(join(tmpdir(), 'martha-install-home-'))
  return { home, places: placesOnThisMachine(home, undefined), close: () => removeEvenReadOnly(home) }
}

/**
 * A scratch tree removed whole, its read-only release directories included.
 * @param {string} path
 */
export function removeEvenReadOnly (path) {
  /** @param {string} dir */
  const walk = (dir) => {
    try { chmodSync(dir, 0o700) } catch { return }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
    }
  }
  walk(path)
  rmSync(path, { recursive: true, force: true })
}
