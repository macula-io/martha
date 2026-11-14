#!/usr/bin/env node
// The release dry run's install half (martha#21): the installer's own checks, run against the image
// release-dry-run.yml just pushed and signed, with the real Sigstore trust root and nothing stood in for.
//   1. the signature verifies for the branch's ref, by a listed signer, for this repository;
//   2. the same signature is refused for refs/tags/v<version>, the ref every real install demands;
//   3. the unsigned digest beside it is refused;
//   4. the signed layer unpacks to exactly the committed tree plus the installer pin the packer generates after
//      `git archive`, and that pin is the installer npm serves for this tree's installer version (martha#207).
//
// It lives here, outside installer/, and not in package.json "files": it ships on npm nowhere, and its own fixes no
// longer force an installer bump and republish for a folder npm has never carried (martha#207). It imports the
// installer, which a release layer does not carry, so .gitattributes marks this folder export-ignore and it ships in
// no layer either. It is not a *.node-test.mjs: it needs a registry token, the network and an image the workflow
// pushed. Its one caller is release-dry-run.yml.
//
// Environment (all required): DRY_RUN_IMAGE, DRY_RUN_VERSION, DRY_RUN_DIGEST, DRY_RUN_UNSIGNED_DIGEST, DRY_RUN_REF,
// GHCR_TOKEN (the run's token: before the owner makes it public, the release package is not).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { listedSigners } from '../installer/install_a_release/install_a_release.mjs'
import { releaseRef } from '../installer/keep_the_names_in_one_place/names.mjs'
import { pinFor } from '../installer/pin_the_installer/pin_the_installer.mjs'
import { layerOf, registry } from '../installer/read_the_release_registry/read_the_release_registry.mjs'
import { TOP, unpackLayer } from '../installer/unpack_the_release_layer/unpack_the_release_layer.mjs'
import { signedBy } from '../installer/verify_the_release_signature/verify_the_release_signature.mjs'
import { removeEvenReadOnly, treeOf } from '../installer/serve_a_release_locally/serve_a_release_locally.mjs'
import { differences, inWords, pinFieldsThatDiffer, thePinIn, withoutWhatThePackerWrites } from './the_layer_is_the_tree_and_the_pin.mjs'

/** The checkout this runs in, whose committed tree the layer must hold. */
const REPO = dirname(import.meta.dirname)

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
  execFileSync('bash', ['-c', `git archive --format=tar --prefix=${TOP}/ HEAD | tar -x -C "$1"`, 'archive', archived], { cwd: REPO })
  // Both trees start at their own root, so the pin's path is the one the layer holds it at: the release folder, and
  // the file inside it. The packer writes that pin after the archive, so it is all the layer may add.
  const layerTree = treeOf(stage)
  const differing = inWords(differences(treeOf(archived), withoutWhatThePackerWrites(layerTree)))
  if (differing !== '') assert.fail(differing)
  const pin = thePinIn(stage)
  const published = await pinFor({ repo: REPO })
  const fields = pinFieldsThatDiffer(pin, published)
  if (fields.length > 0) assert.fail(`the pin is not the installer npm serves: ${fields.join('; ')}`)
  console.log(`4. the layer is the committed tree plus the pin and the floor, ${layerTree.size} entries, pinned to ${published.name}@${published.version}`)
} finally {
  removeEvenReadOnly(stage)
  removeEvenReadOnly(archived)
}
