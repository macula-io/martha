// A Martha release the tests can shape and break (martha#21): a tar written header by header (so a test can name an
// absolute path, a '..', a fifo or an escaping link that no tar tool would write), the manifest that names it, and
// the cosign signature index and bundle over its digest, all served by a local registry on 127.0.0.1. Never shipped:
// the package's "files" leave this directory out.
import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
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
  for (const e of entries) parts.push(...longNameHeadersOf(e), ...entryBlocksOf(e))
  parts.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(parts)
}

/**
 * The headers that carry an entry's long name ahead of it: pax 'x' records, then a GNU 'L' header.
 * @param {TarEntry} e
 * @returns {Buffer[]}
 */
function longNameHeadersOf (e) {
  /** @type {[string, string, Buffer][]} */
  const extra = []
  if (e.pax !== undefined) extra.push(['PaxHeader', 'x', Buffer.from(paxRecord('path', e.pax))])
  if (e.paxRaw !== undefined) extra.push(['PaxHeader', 'x', Buffer.from(e.paxRaw)])
  if (e.gnuLong !== undefined) extra.push(['././@LongLink', 'L', Buffer.from(`${e.gnuLong}\0`)])
  return extra.flatMap(([name, type, body]) => [header({ name, type, size: body.length }), padded(body)])
}

/**
 * An entry's own header and, for a type that carries one, its padded body.
 * @param {TarEntry} e
 * @returns {Buffer[]}
 */
function entryBlocksOf (e) {
  const body = Buffer.from(e.body ?? '')
  const carries = e.type !== '5' && e.type !== '2'
  const head = header({ ...e, size: carries ? body.length : 0 })
  return body.length && carries ? [head, padded(body)] : [head]
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
 * header, `unsigned` serves no signature for those digests. `signatureEntries` lists each signature that many times
 * in its index, `bundlePadding` pads each bundle by that many bytes, and `bundleLayer` overrides what its manifest
 * says of the bundle's layer. hits[] records every path asked for.
 * @param {Release[]} releases
 * @param {RegistryOptions} [options]
 */
export async function serveRegistry (releases, options = {}) {
  /** @type {string[]} */
  const hits = []
  const contents = contentsOf(releases, options)
  const server = createServer((req, res) => {
    const url = req.url ?? ''
    hits.push(url)
    const { body, status, extra } = answerTo(url, contents, options)
    res.writeHead(status, { 'content-length': body.length, ...extra })
    res.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const address = server.address()
  const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  return { base, hits, close: () => new Promise((resolve) => server.close(() => resolve(undefined))) }
}

/** The repository path the registry serves, as its URLs name it. */
const REPOSITORY = NAMES.image.slice(NAMES.image.indexOf('/') + 1)

/**
 * @typedef {{ tags?: Record<string, Release>, extraTags?: string[], tagListPadding?: number, nextPage?: boolean, unsigned?: string[], signatureEntries?: number, bundlePadding?: number, bundleLayer?: { mediaType?: string, size?: number } }} RegistryOptions
 * @typedef {{ blobs: Map<string, Buffer>, manifests: Map<string, Buffer>, tags: Map<string, Buffer> }} RegistryContents
 */

/**
 * What the registry holds: each release's manifest by tag and digest, its signature unless `unsigned` names it,
 * the moved tags, and each layer under its manifest's layer digest, whatever bytes the release carries (a
 * tampered layer).
 * @param {Release[]} releases
 * @param {RegistryOptions} options
 * @returns {RegistryContents}
 */
function contentsOf (releases, { tags: moved = {}, unsigned = [], ...signing }) {
  const contents = { blobs: new Map(), manifests: new Map(), tags: new Map() }
  for (const r of releases) {
    contents.tags.set(r.version, r.manifest)
    contents.manifests.set(r.digest, r.manifest)
    if (!unsigned.includes(r.digest)) addSignature(contents, r, signing)
  }
  for (const [tag, r] of Object.entries(moved)) contents.tags.set(tag, r.manifest)
  for (const r of releases) contents.blobs.set(JSON.parse(r.manifest.toString()).layers[0].digest, r.layer)
  return contents
}

/**
 * A release's signature as cosign stores it: the bundle as a blob, its manifest, and an index under the
 * release digest's tag that lists that manifest `signatureEntries` times.
 * @param {RegistryContents} contents
 * @param {Release} r
 * @param {RegistryOptions} options
 */
function addSignature ({ blobs, manifests, tags }, r, { signatureEntries = 1, bundlePadding = 0, bundleLayer = {} }) {
  const bundleBytes = Buffer.from(JSON.stringify(bundlePadding ? { ...r.bundle, padding: 'x'.repeat(bundlePadding) } : r.bundle))
  blobs.set(sha256(bundleBytes), bundleBytes)
  const bundleManifest = Buffer.from(JSON.stringify({
    schemaVersion: 2, mediaType: 'application/vnd.oci.image.manifest.v1+json', artifactType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    annotations: { 'dev.sigstore.bundle.predicateType': 'https://sigstore.dev/cosign/sign/v1' },
    layers: [{ mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json', digest: sha256(bundleBytes), size: bundleBytes.length, ...bundleLayer }]
  }))
  manifests.set(sha256(bundleManifest), bundleManifest)
  const entry = { mediaType: 'application/vnd.oci.image.manifest.v1+json', artifactType: 'application/vnd.dev.sigstore.bundle.v0.3+json', digest: sha256(bundleManifest), size: bundleManifest.length }
  tags.set(r.digest.replace(':', '-'), Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: Array(signatureEntries).fill(entry) })))
}

/** @param {Buffer} body @param {number} [status] @param {Record<string, string>} [extra] */
const reply = (body, status = 200, extra = {}) => ({ body, status, extra })
const NOT_FOUND = () => reply(Buffer.from('{}'), 404)

/**
 * The registry's answer to one request: an anonymous token, the tag list, or a manifest or blob by name.
 * @param {string} url
 * @param {RegistryContents} contents
 * @param {RegistryOptions} options
 */
function answerTo (url, contents, options) {
  if (url.startsWith('/token')) return reply(Buffer.from(JSON.stringify({ token: 'anonymous' })))
  if (!url.startsWith(`/v2/${REPOSITORY}/`)) return NOT_FOUND()
  const m = url.slice(`/v2/${REPOSITORY}/`.length).match(/^(tags\/list|manifests|blobs)\/?([^?]*)/)
  if (!m) return NOT_FOUND()
  if (m[1] === 'tags/list') return tagListOf(contents, options)
  const key = m[2] ?? ''
  const body = m[1] === 'blobs' ? contents.blobs.get(key) : (contents.tags.get(key) ?? contents.manifests.get(key))
  return body ? reply(body) : NOT_FOUND()
}

/**
 * The tag list, with `extraTags` added, padded by `tagListPadding` bytes, and a Link header when `nextPage`.
 * @param {RegistryContents} contents
 * @param {RegistryOptions} options
 */
function tagListOf ({ tags }, { extraTags = [], tagListPadding = 0, nextPage = false }) {
  const list = { tags: [...tags.keys(), ...extraTags], ...(tagListPadding ? { padding: 'x'.repeat(tagListPadding) } : {}) }
  return reply(Buffer.from(JSON.stringify(list)), 200, nextPage ? { link: `</v2/${REPOSITORY}/tags/list?last=z&n=10000>; rel="next"` } : {})
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
 * Whether an error is the file system saying the path is no longer there (martha#189).
 * @param {unknown} error
 */
const isGone = (error) => error instanceof Error && /** @type {{ code?: unknown }} */ (error).code === 'ENOENT'

/**
 * The file-system calls one removal makes. A test passes its own to stand in for a directory that vanishes between
 * the chmod that opens it and the read that lists it, which is what an interrupted launch does (martha#189).
 * @typedef {{
 *   chmodSync: (path: string, mode: number) => void,
 *   readdirSync: (path: string, options: { withFileTypes: true }) => import('node:fs').Dirent[],
 *   rmSync: (path: string, options: { recursive: true, force: true }) => void
 * }} RemovalReads
 */

/** The file system a removal reads, unchanged: the calls this module already imports. @type {RemovalReads} */
export const THIS_MACHINES_FILES = { chmodSync, readdirSync, rmSync }

/**
 * A scratch tree removed whole, its read-only release directories included.
 *
 * A folder that is already gone is gone, not a failure: an interrupted launch can take its own directory away while
 * this walks, and demanding it failed the tear-down of every run a member was interrupted in (martha#189). Any other
 * error still comes out, so a tree that is there and cannot be removed is named by the caller.
 * @param {string} path
 * @param {RemovalReads} [files] the file-system calls; this machine's unless a test stands in for one
 */
export function removeEvenReadOnly (path, files = THIS_MACHINES_FILES) {
  /** @param {string} dir */
  const walk = (dir) => {
    let entries
    try {
      files.chmodSync(dir, 0o700)
      entries = files.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      if (isGone(error)) return
      throw error
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
    }
  }
  walk(path)
  files.rmSync(path, { recursive: true, force: true })
}

/**
 * Every file and link under `root`, as path -> sha256 of its bytes or "link:<target>".
 * @param {string} root
 */
export function treeOf (root) {
  /** @type {Map<string, string>} */
  const found = new Map()
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name)
    if (entry.isSymbolicLink()) found.set(relative(root, path), `link:${readlinkSync(path)}`)
    else if (entry.isFile()) found.set(relative(root, path), createHash('sha256').update(readFileSync(path)).digest('hex'))
  }
  return found
}
