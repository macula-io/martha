// Every registry read is capped, and the one manifest a release is pushed as is the only one read (martha#21, T6,
// design step 4). Against a local registry.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { CouldNotCheck, Refused } from '../refuse_in_words/refuse_in_words.mjs'
import { release, serveRegistry } from '../serve_a_release_locally/serve_a_release_locally.mjs'
import { LIMITS, isVersion, layerOf, registry } from './read_the_release_registry.mjs'

/**
 * @param {Promise<unknown>} promise
 * @param {RegExp} pattern
 * @param {Function} [kind]
 */
const refusedWith = async (promise, pattern, kind = Refused) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof kind, `expected a ${kind.name}, got ${error}`)
    assert.match(/** @type {Error} */ (error).message, pattern)
    return true
  })
}

/**
 * @param {import('node:test').TestContext} t
 * @param {Parameters<typeof serveRegistry>} args
 */
const opened = async (t, ...args) => {
  const served = await serveRegistry(...args)
  t.after(served.close)
  const answers = answersKept()
  t.after(() => everyAnswerReadOrCancelled(answers.kept))
  const reg = registry({ image: NAMES.image, base: served.base, fetch: answers.fetch })
  await reg.authorize()
  return { reg, served, answers: answers.kept }
}

/** A fetch that keeps every answer it hands out, so a test can see whether each was read or cancelled. */
const answersKept = () => {
  /** @type {{ url: string, response: Response }[]} */
  const kept = []
  /** @type {typeof globalThis.fetch} */
  const fetch = async (url, init) => {
    const response = await globalThis.fetch(url, init)
    kept.push({ url: String(url), response })
    return response
  }
  return { kept, fetch }
}

/**
 * An answer whose body is neither read nor cancelled holds its connection open behind the refusal (martha#112).
 * @param {{ url: string, response: Response }[]} kept
 */
const everyAnswerReadOrCancelled = (kept) => {
  const unread = kept.filter(({ response }) => response.body !== null && !response.bodyUsed).map(({ url }) => url)
  assert.deepEqual(unread, [], `answers left unread: ${unread.join(', ')}`)
}

test('the highest X.Y.Z tag is taken; signature tags and names that are no version are passed over', async (t) => {
  const { reg } = await opened(t, [release({ version: '1.2.0' }), release({ version: '1.10.0' }), release({ version: '1.9.1' })], { extraTags: ['latest', 'main'] })
  assert.equal(await reg.highestVersion(), '1.10.0')
})

test('a dry run\'s tags, pushed into the release package before any release, are never taken for a version', async (t) => {
  assert.equal(typeof NAMES.dryRunTagPrefix, 'string', 'the dry-run tag prefix is one of the names')
  const dryRun = `${NAMES.dryRunTagPrefix}42-1`
  const { reg } = await opened(t, [release({ version: '1.2.0' })], { extraTags: [dryRun, `${dryRun}-unsigned`] })
  assert.equal(isVersion(dryRun), false)
  assert.equal(await reg.highestVersion(), '1.2.0')
})

test('refused: a tag list over 1 MiB', async (t) => {
  const { reg } = await opened(t, [release()], { tagListPadding: LIMITS.tagListBytes })
  await refusedWith(reg.highestVersion(), /the version list is \d+ bytes, over the 1048576/)
})

test('refused: a tag list that says there is a next page', async (t) => {
  const { reg } = await opened(t, [release()], { nextPage: true })
  await refusedWith(reg.highestVersion(), /more tags than one page; name a version/)
})

test('refused unread: a tag list that says there is a next page has its body cancelled, not left open', async (t) => {
  const { reg, answers } = await opened(t, [release()], { nextPage: true })
  await refusedWith(reg.highestVersion(), /more tags than one page; name a version/)
  const tagList = answers.find(({ url }) => url.includes('/tags/list'))
  assert.ok(tagList, 'the tag list was asked for')
  assert.equal(tagList.response.bodyUsed, true, 'the refused tag list\'s body is cancelled')
})

test('refused: a manifest over 64 KiB', async (t) => {
  const big = release({ padTo: LIMITS.manifestBytes })
  const { reg } = await opened(t, [big])
  await refusedWith(reg.manifest(big.version), /over the 65536/)
})

test('refused: an image index served for the version, by name', async (t) => {
  const index = release({ mediaType: 'application/vnd.oci.image.index.v1+json' })
  const { reg } = await opened(t, [index])
  await refusedWith(reg.manifest(index.version), /is an image index, not the one image manifest a release is/)
})

test('refused: a manifest of any other type', async (t) => {
  const docker = release({ mediaType: 'application/vnd.docker.distribution.manifest.v2+json' })
  const { reg } = await opened(t, [docker])
  await refusedWith(reg.manifest(docker.version), /docker\.distribution\.manifest\.v2\+json, not application\/vnd\.oci\.image\.manifest\.v1\+json/)
})

test('refused: a layer over 64 MiB, named in the manifest before it is fetched', async (t) => {
  const huge = release({ layerSize: LIMITS.layerBytes + 1 })
  const { reg, served } = await opened(t, [huge])
  const manifest = await reg.manifest(huge.version)
  assert.throws(() => layerOf(manifest.json, 'the release'), /67108865-byte layer, over the 67108864/)
  assert.ok(!served.hits.some((h) => h.includes('/blobs/')), 'no layer was fetched')
})

test('refused: a layer served longer than its manifest says, cut off at the size', async (t) => {
  const r = release()
  const { reg } = await opened(t, [{ ...r, layer: Buffer.concat([r.layer, Buffer.alloc(1024)]) }])
  const manifest = await reg.manifest(r.version)
  await refusedWith(reg.blob(layerOf(manifest.json, 'the release'), 'the layer'), /over the \d+ a release may carry/)
})

test('signature entries: 16 are read, 17 are refused before one is fetched', async (t) => {
  const r = release()
  const atCap = await opened(t, [r], { signatureEntries: LIMITS.bundles })
  assert.equal((await atCap.reg.bundles(r.digest)).length, LIMITS.bundles)
  const over = await opened(t, [r], { signatureEntries: LIMITS.bundles + 1 })
  await refusedWith(over.reg.bundles(r.digest), new RegExp(`carries ${LIMITS.bundles + 1} signature entries, over the ${LIMITS.bundles} read`))
  assert.ok(!over.served.hits.some((h) => h.includes('/blobs/')), 'no bundle was fetched')
})

test('refused: a signature bundle over 64 KiB, named in its manifest before it is fetched', async (t) => {
  const r = release()
  const { reg, served } = await opened(t, [r], { bundlePadding: LIMITS.bundleBytes })
  await refusedWith(reg.bundles(r.digest), new RegExp(`is not one sigstore bundle of at most ${LIMITS.bundleBytes} bytes`))
  assert.ok(!served.hits.some((h) => h.includes('/blobs/')), 'no bundle was fetched')
})

test('refused: a signature manifest whose layer is not a sigstore bundle', async (t) => {
  const r = release()
  const { reg } = await opened(t, [r], { bundleLayer: { mediaType: 'application/json' } })
  await refusedWith(reg.bundles(r.digest), new RegExp(`is not one sigstore bundle of at most ${LIMITS.bundleBytes} bytes`))
})

test('refused: a signature bundle served longer than its manifest says', async (t) => {
  const r = release()
  const { reg } = await opened(t, [r], { bundleLayer: { size: 16 } })
  await refusedWith(reg.bundles(r.digest), /signature bundle sha256:[0-9a-f]{64}/)
})

test('a registry that does not answer is a check that could not be made, not a refusal of the release', async () => {
  const reg = registry({ image: NAMES.image, base: 'http://127.0.0.1:9', fetch: async () => { throw new TypeError('fetch failed') } })
  await refusedWith(reg.authorize(), /^could not check: an anonymous pull token .* did not answer/, CouldNotCheck)
})
