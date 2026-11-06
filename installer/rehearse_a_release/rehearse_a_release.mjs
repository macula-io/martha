#!/usr/bin/env node
// The release dry run's install half (martha#21): the installer's own checks, run against the image
// release-dry-run.yml just pushed and signed, with the real Sigstore trust root and nothing stood in for.
//   1. the signature verifies for the branch's ref, by a listed signer, for this repository;
//   2. the same signature is refused for refs/tags/v<version>, the ref every real install demands;
//   3. the unsigned digest beside it is refused;
//   4. the signed layer unpacks to exactly the committed tree (git archive of HEAD).
// Not shipped (package.json "files" leaves it out), and not a *.node-test.mjs, so npm test never runs it: it needs a
// registry token, the network and an image the workflow pushed. Its one caller is release-dry-run.yml.
//
// Environment (all required): DRY_RUN_IMAGE, DRY_RUN_VERSION, DRY_RUN_DIGEST, DRY_RUN_UNSIGNED_DIGEST, DRY_RUN_REF,
// GHCR_TOKEN (the run's token: the dry-run package is not public).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { listedSigners } from '../install_a_release/install_a_release.mjs'
import { releaseRef } from '../keep_the_names_in_one_place/names.mjs'
import { layerOf, registry } from '../read_the_release_registry/read_the_release_registry.mjs'
import { TOP, unpackLayer } from '../unpack_the_release_layer/unpack_the_release_layer.mjs'
import { signedBy } from '../verify_the_release_signature/verify_the_release_signature.mjs'
import { removeEvenReadOnly } from '../serve_a_release_locally/serve_a_release_locally.mjs'

/** @param {string} name */
const need = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}
const env = Object.fromEntries(['DRY_RUN_IMAGE', 'DRY_RUN_VERSION', 'DRY_RUN_DIGEST', 'DRY_RUN_UNSIGNED_DIGEST', 'DRY_RUN_REF', 'GHCR_TOKEN'].map((n) => [n, need(n)]))

// The token request alone carries the run's credentials; every other request goes as the installer sends it.
/** @type {typeof globalThis.fetch} */
const withPullCredentials = (url, options = {}) => {
  if (!String(url).includes('/token?')) return globalThis.fetch(url, options)
  const basic = Buffer.from(`dry-run:${env['GHCR_TOKEN']}`).toString('base64')
  return globalThis.fetch(url, { ...options, headers: { ...options.headers, authorization: `Basic ${basic}` } })
}

/**
 * Every file and link under `root`, as path -> sha256 of its bytes or "link:<target>".
 * @param {string} root
 */
function treeOf (root) {
  /** @type {Map<string, string>} */
  const found = new Map()
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name)
    if (entry.isSymbolicLink()) found.set(relative(root, path), `link:${readlinkSync(path)}`)
    else if (entry.isFile()) found.set(relative(root, path), createHash('sha256').update(readFileSync(path)).digest('hex'))
  }
  return found
}

const version = env['DRY_RUN_VERSION'] ?? ''
const digest = env['DRY_RUN_DIGEST'] ?? ''
const reg = registry({ image: env['DRY_RUN_IMAGE'] ?? '', fetch: withPullCredentials })
await reg.authorize()
const manifest = await reg.manifest(digest)
assert.equal(manifest.digest, digest, 'the manifest hashes to the digest the build pushed')
const signers = await listedSigners()
const bundles = await reg.bundles(digest)

const onBranch = await signedBy({ bundles, digest, version, signers, ref: env['DRY_RUN_REF'] })
assert.ok('sha' in onBranch, `the dry run's signature verifies for ${env['DRY_RUN_REF']}: ${JSON.stringify(onBranch)}`)
console.log(`1. verified: attest-image.yml@${onBranch.sha} for ${env['DRY_RUN_REF']}`)

const asRelease = await signedBy({ bundles, digest, version, signers })
assert.ok('reasons' in asRelease && asRelease.reasons.includes(`signed for ${env['DRY_RUN_REF']}, not ${releaseRef(version)}`), JSON.stringify(asRelease))
console.log(`2. refused for ${releaseRef(version)}: ${asRelease.reasons.join('; ')}`)

const unsigned = env['DRY_RUN_UNSIGNED_DIGEST'] ?? ''
const unsignedBundles = await reg.bundles(unsigned).catch(() => [])
const notSigned = await signedBy({ bundles: unsignedBundles, digest: unsigned, version, signers, ref: env['DRY_RUN_REF'] })
assert.ok(!('sha' in notSigned), 'the unsigned digest is refused')
console.log(`3. refused, unsigned: ${unsigned}`)

const stage = mkdtempSync(join(tmpdir(), 'martha-dry-run-'))
const archived = mkdtempSync(join(tmpdir(), 'martha-dry-run-tree-'))
try {
  const layer = layerOf(manifest.json, `${env['DRY_RUN_IMAGE']}@${digest}`)
  await unpackLayer(await reg.blob(layer, `the layer ${layer.digest}`), stage)
  execFileSync('bash', ['-c', `git archive --format=tar --prefix=${TOP}/ HEAD | tar -x -C "$1"`, 'archive', archived])
  assert.deepEqual(treeOf(join(stage, TOP)), treeOf(join(archived, TOP)), 'the layer is the committed tree')
  console.log(`4. the layer is the committed tree, ${treeOf(join(stage, TOP)).size} entries`)
} finally {
  removeEvenReadOnly(stage)
  removeEvenReadOnly(archived)
}
