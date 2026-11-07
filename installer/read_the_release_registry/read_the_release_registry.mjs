// The Martha release on its registry, read anonymously (martha#21). A tag is read once, to find the manifest; from
// then on the release is that manifest's sha256, computed here from the bytes and never taken from a header.
//
// Every read is capped, whatever the server says its length is: anyone who can push to the package can pile tags,
// signatures and bytes into it, and a capped read refuses what it cannot afford instead of exhausting the machine.
import { createHash } from 'node:crypto'

import { couldNotCheck, refuse } from '../refuse_in_words/refuse_in_words.mjs'

export const LIMITS = Object.freeze({
  manifestBytes: 64 * 1024,
  tagListBytes: 1024 * 1024,
  bundles: 16,
  bundleBytes: 64 * 1024,
  layerBytes: 64 * 1024 * 1024
})

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
// The one manifest type a release is pushed as. An image index is refused: the release job pushes one image, and
// the digest it signs is that image's manifest, never an index over several.
export const IMAGE_MANIFEST = 'application/vnd.oci.image.manifest.v1+json'
const GZIP_LAYER = 'application/vnd.oci.image.layer.v1.tar+gzip'
const INDEX = 'application/vnd.oci.image.index.v1+json'
const BUNDLE = 'application/vnd.dev.sigstore.bundle.v0.3+json'
// cosign labels each bundle's manifest with what it attests. The label is not trusted, only used to pass over the
// SBOM and provenance bundles (large, and not what an install checks); the signature itself is checked in full.
const COSIGN_SIGN = 'https://sigstore.dev/cosign/sign/v1'

/** @param {Uint8Array} bytes */
export const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
/** @param {unknown} v @returns {v is string} */
export const isVersion = (v) => typeof v === 'string' && SEMVER.test(v)
/** @param {unknown} d @returns {d is string} */
export const isDigest = (d) => typeof d === 'string' && DIGEST.test(d)

/**
 * -1, 0 or 1, as a sort comparator, for two X.Y.Z versions.
 * @param {string} a
 * @param {string} b
 */
export const compareVersions = (a, b) => {
  const numbers = (/** @type {string} */ v) => (v.match(SEMVER) ?? []).slice(1).map(Number)
  const x = numbers(a)
  const y = numbers(b)
  const at = x.findIndex((n, i) => n !== y[i])
  return at < 0 ? 0 : Math.sign((x[at] ?? 0) - (y[at] ?? 0))
}

/**
 * Refuses an answer without reading it. Its body is cancelled first, or its connection stays open behind the
 * refusal (martha#112).
 * @param {Response} response
 * @param {string} message
 * @returns {Promise<never>}
 */
async function refusedUnread (response, message) {
  await response.body?.cancel()
  return refuse(message)
}

/**
 * The body, refused once it passes `limit` bytes, whether or not the server said how long it is.
 * @param {Response} response
 * @param {number} limit
 * @param {string} what
 */
async function readCapped (response, limit, what) {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > limit) await refusedUnread(response, `${what} is ${declared} bytes, over the ${limit} a release may carry; refused`)
  /** @type {Buffer[]} */
  const chunks = []
  let total = 0
  if (!response.body) return Buffer.concat(chunks)
  for await (const chunk of response.body) {
    total += chunk.length
    if (total > limit) refuse(`${what} is over the ${limit} bytes a release may carry; refused`)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * @param {Buffer} bytes
 * @param {string} what
 * @returns {any}
 */
const parsed = (bytes, what) => {
  try { return JSON.parse(bytes.toString('utf8')) } catch { return refuse(`${what} is not JSON; refused`) }
}

/**
 * The manifest is the one image manifest a release pushes; an index, or any other type, is named and refused
 * before anything looks for a signature.
 * @param {any} manifest
 * @param {string} where
 */
export function checkManifestType (manifest, where) {
  const type = manifest?.mediaType
  if (type === INDEX) refuse(`${where} is an image index, not the one image manifest a release is; refused`)
  if (type !== IMAGE_MANIFEST) refuse(`${where} is a ${typeof type === 'string' ? type : 'manifest of no type'}, not ${IMAGE_MANIFEST}; refused`)
}

/**
 * The one gzip layer of the image manifest, as {digest, size}.
 * @param {any} manifest
 * @param {string} where
 * @returns {{ digest: string, size: number }}
 */
export function layerOf (manifest, where) {
  checkManifestType(manifest, where)
  const layers = Array.isArray(manifest.layers) ? manifest.layers : []
  const layer = layers[0]
  const ok = layers.length === 1 && layer?.mediaType === GZIP_LAYER && isDigest(layer.digest) &&
    Number.isInteger(layer.size) && layer.size > 0
  if (!ok) refuse(`${where} is not one image with one gzip layer; refused`)
  if (layer.size > LIMITS.layerBytes) refuse(`${where} has a ${layer.size}-byte layer, over the ${LIMITS.layerBytes} a release may carry; refused`)
  return { digest: layer.digest, size: layer.size }
}

/**
 * @typedef {(path: string, accept: string, what: string) => Promise<Response>} Get
 */

/**
 * A blob by digest, exactly `size` bytes, hashing to that digest.
 * @param {Get} get
 * @param {{ digest: string, size: number }} blob
 * @param {string} what
 */
async function blobOf (get, { digest, size }, what) {
  const bytes = await readCapped(await get(`blobs/${digest}`, '', what), size, what)
  if (bytes.length !== size) refuse(`${what} is ${bytes.length} bytes, not the ${size} its manifest names; refused`)
  if (sha256(bytes) !== digest) refuse(`${what} hashes to ${sha256(bytes)}, not ${digest}; refused`)
  return bytes
}

/**
 * The sigstore bundle a signature manifest holds, or undefined for a manifest that is no cosign signature.
 * @param {Get} get
 * @param {string} manifestDigest
 */
async function bundleAt (get, manifestDigest) {
  const response = await get(`manifests/${manifestDigest}`, IMAGE_MANIFEST, 'a signature manifest')
  const bytes = await readCapped(response, LIMITS.manifestBytes, 'a signature manifest')
  if (sha256(bytes) !== manifestDigest) refuse(`a signature manifest hashes to ${sha256(bytes)}, not ${manifestDigest}; refused`)
  const manifest = parsed(bytes, 'a signature manifest')
  if (manifest.annotations?.['dev.sigstore.bundle.predicateType'] !== COSIGN_SIGN) return undefined
  const layer = (manifest.layers ?? [])[0] ?? {}
  if (layer.mediaType !== BUNDLE || !isDigest(layer.digest) || !(layer.size <= LIMITS.bundleBytes)) {
    refuse(`signature ${manifestDigest} is not one sigstore bundle of at most ${LIMITS.bundleBytes} bytes; refused`)
  }
  return parsed(await blobOf(get, layer, `signature bundle ${layer.digest}`), `signature bundle ${layer.digest}`)
}

/**
 * A reader for one package. `image` is <registry host>/<owner>/<name>; `base` the registry's URL, a test's own
 * server or the real one.
 * @param {{ image: string, base?: string, fetch?: typeof globalThis.fetch }} options
 */
export function registry ({ image, base = `https://${image.split('/')[0]}`, fetch = globalThis.fetch }) {
  const name = image.slice(image.indexOf('/') + 1)
  let token = ''

  /**
   * A network failure is no answer: the check could not be made.
   * @param {string} url
   * @param {RequestInit} init
   * @param {string} what
   */
  const ask = async (url, init, what) => {
    try { return await fetch(url, init) } catch (error) {
      return couldNotCheck(`${what}: ${base} did not answer (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  /**
   * @param {string} path
   * @param {string} accept
   * @param {string} what
   */
  const get = async (path, accept, what) => {
    /** @type {Record<string, string>} */
    const headers = { authorization: `Bearer ${token}` }
    if (accept) headers['accept'] = accept
    const response = await ask(`${base}/v2/${name}/${path}`, { headers, redirect: 'follow' }, what)
    if (!response.ok) await refusedUnread(response, `${what}: ${image} answered ${response.status}; refused`)
    return response
  }

  /**
   * @param {{ digest: string, size: number }} wanted
   * @param {string} what
   */
  const blob = async (wanted, what) => blobOf(get, wanted, what)

  return {
    image,
    blob,

    async authorize () {
      const what = `an anonymous pull token for ${name}`
      const response = await ask(`${base}/token?scope=repository:${name}:pull`, {}, what)
      if (!response.ok) await refusedUnread(response, `${base} gave no anonymous pull token for ${name} (${response.status}); is the package public?`)
      token = parsed(await readCapped(response, LIMITS.manifestBytes, what), what).token ?? ''
      if (!token) refuse(`${base} gave no anonymous pull token for ${name}; refused`)
    },

    // The highest X.Y.Z tag. A signature tag (sha256-<hex>) or anything else that is no version is passed over.
    // The list is one capped page: a registry that says there is a next page holds more tags than an install
    // reads, so it is refused, and naming a version gets past it.
    async highestVersion () {
      const response = await get('tags/list?n=10000', '', 'the version list')
      if (/rel="?next"?/.test(response.headers.get('link') ?? '')) refuse(`${image} lists more tags than one page; name a version`)
      const tags = parsed(await readCapped(response, LIMITS.tagListBytes, 'the version list'), 'the version list').tags ?? []
      const versions = (Array.isArray(tags) ? tags : []).filter(isVersion).sort(compareVersions)
      const highest = versions.at(-1)
      if (highest === undefined) refuse(`${image} carries no version; refused`)
      return highest
    },

    /**
     * The image manifest a tag or digest names: its bytes, their digest and the parsed JSON.
     * @param {string} ref
     */
    async manifest (ref) {
      const response = await get(`manifests/${ref}`, IMAGE_MANIFEST, `${image}:${ref}`)
      const bytes = await readCapped(response, LIMITS.manifestBytes, `the manifest of ${image}:${ref}`)
      const json = parsed(bytes, `the manifest of ${image}:${ref}`)
      checkManifestType(json, `${image}:${ref}`)
      return { bytes, digest: sha256(bytes), json }
    },

    /**
     * The signature bundles cosign attached to a digest, through the tag schema it falls back to on ghcr
     * (sha256-<hex>, an index of referrers): at most LIMITS.bundles entries, each at most LIMITS.bundleBytes.
     * @param {string} digest
     */
    async bundles (digest) {
      const tag = digest.replace(':', '-')
      const response = await get(`manifests/${tag}`, INDEX, `the signatures of ${digest}`)
      const index = parsed(await readCapped(response, LIMITS.manifestBytes, `the signature index of ${digest}`), `the signature index of ${digest}`)
      const listed = Array.isArray(index.manifests) ? index.manifests : []
      const entries = listed.filter((/** @type {any} */ m) => m?.artifactType === BUNDLE && isDigest(m.digest))
      if (entries.length > LIMITS.bundles) refuse(`${digest} carries ${entries.length} signature entries, over the ${LIMITS.bundles} read; refused`)
      /** @type {any[]} */
      const found = []
      for (const entry of entries) {
        const bundle = await bundleAt(get, entry.digest)
        if (bundle) found.push(bundle)
      }
      return found
    }
  }
}
