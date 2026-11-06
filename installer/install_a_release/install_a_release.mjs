// Martha installed from its signed public package (martha#21), in this order, and nothing linked until every step
// has passed:
//   1. this Node is one Martha runs on;
//   2. an anonymous pull token; the version (the one named, or the highest X.Y.Z, never :latest); the manifest's
//      bytes and the digest computed from them: from here on that digest is the release;
//   3. the one downgrade rule, and no second digest for a version this machine holds;
//   4. the signature on that digest, by a listed signer, for this repository and refs/tags/v<version>;
//   5. the one layer by digest, its size and sha256 checked;
//   6. every tar entry checked before anything is written;
//   7. its own read-only directory, current swapped by one rename, the command linked through current.
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { checkNodeVersion } from '../check_the_node_version/check_the_node_version.mjs'
import { NAMES, releaseRef } from '../keep_the_names_in_one_place/names.mjs'
import { checkAgainstInstalled, linkCommand, placeRelease, releaseName, swapLink } from '../place_the_release/place_the_release.mjs'
import { isDigest, isVersion, layerOf, registry } from '../read_the_release_registry/read_the_release_registry.mjs'
import { CouldNotCheck, refuse } from '../refuse_in_words/refuse_in_words.mjs'
import { unpackLayer } from '../unpack_the_release_layer/unpack_the_release_layer.mjs'
import { readSigners, signedBy } from '../verify_the_release_signature/verify_the_release_signature.mjs'

const SIGNERS = new URL('../signers.txt', import.meta.url)

export const listedSigners = async () => readSigners(await readFile(SIGNERS, 'utf8'))

/**
 * Where this machine keeps Martha, worked out once by the bin and passed in: the XDG data directory
 * ($XDG_DATA_HOME when it is an absolute path, else ~/.local/share) and ~/.local/bin.
 * @param {string} home
 * @param {string | undefined} xdgDataHome
 * @returns {import('../place_the_release/place_the_release.mjs').Places}
 */
export const placesOnThisMachine = (home, xdgDataHome) => {
  const data = xdgDataHome && isAbsolute(xdgDataHome) ? xdgDataHome : join(home, '.local', 'share')
  return {
    releases: join(data, 'martha', 'releases'),
    current: join(data, 'martha', 'current'),
    binDir: join(home, '.local', 'bin')
  }
}

/**
 * @typedef {object} InstallRequest
 * @property {import('../place_the_release/place_the_release.mjs').Places} places
 * @property {string} [version]        the version named; else the highest
 * @property {string} [digest]         the digest the user verified, sha256:<hex>
 * @property {boolean} [downgrade]
 * @property {string} [image]          a test's own; the release image otherwise
 * @property {string} [base]           the registry's URL; a test's own server
 * @property {typeof globalThis.fetch} [fetch]
 * @property {string[]} [signers]      a test's own; signers.txt otherwise
 * @property {import('../verify_the_release_signature/verify_the_release_signature.mjs').MakeVerifier} [makeVerifier]
 * @property {string} [tufCachePath]
 * @property {string} [nodeVersion]    a test's own; process.versions.node otherwise
 * @property {(line: string) => void} [log]
 */

/** @param {InstallRequest} request */
function checkRequest ({ version, digest }) {
  if (version !== undefined && !isVersion(version)) refuse(`a version is X.Y.Z, got '${version}'`)
  if (digest !== undefined && !isDigest(digest)) refuse(`--digest is sha256:<64 hex>, got '${digest}'`)
  if (digest !== undefined && version === undefined) refuse('--digest needs the version it is the digest of')
}

/**
 * @param {{ image: string, version: string, digest: string, named: boolean, reasons: string[] }} unsigned
 * @returns {never}
 */
function refuseUnsigned ({ image, version, digest, named, reasons }) {
  const why = reasons.length ? ` (${reasons.slice(0, 3).join('; ')})` : ''
  if (named) refuse(`${image}:${version} (${digest}) carries no signature from Martha's release workflow for ${releaseRef(version)}${why}; refused`)
  return refuse(`the highest version on ${image}, ${version} (${digest}), carries no signature from Martha's release workflow${why}; refused. Name a version: ${NAMES.command}-install <version>`)
}

/** @param {InstallRequest} request */
export async function installRelease (request) {
  const log = request.log ?? console.log
  checkNodeVersion(request.nodeVersion ?? process.versions.node)
  checkRequest(request)
  const image = request.image ?? NAMES.image
  const named = request.version !== undefined
  const reg = registry({ image, ...(request.base && { base: request.base }), ...(request.fetch && { fetch: request.fetch }) })
  await reg.authorize()
  const version = request.version ?? await reg.highestVersion()
  const manifest = await reg.manifest(version)
  const digest = manifest.digest
  if (request.digest && request.digest !== digest) refuse(`${image}:${version} is ${digest} now, not the ${request.digest} you verified; refused`)
  await checkAgainstInstalled({ version, digest, downgrade: request.downgrade ?? false, named, places: request.places })
  const signers = request.signers ?? await listedSigners()
  let bundles
  try { bundles = await reg.bundles(digest) } catch (error) {
    if (error instanceof CouldNotCheck) throw error
    refuseUnsigned({ image, version, digest, named, reasons: [error instanceof Error ? error.message : String(error)] })
  }
  const verdict = await signedBy({ bundles, digest, version, signers, ...(request.makeVerifier && { makeVerifier: request.makeVerifier }), tufCachePath: request.tufCachePath })
  if (!('sha' in verdict)) refuseUnsigned({ image, version, digest, named, reasons: verdict.reasons })
  const layer = layerOf(manifest.json, `${image}@${digest}`)
  const release = await placeRelease({
    releases: request.places.releases,
    name: releaseName(version, digest),
    unpack: async (stage) => unpackLayer(await reg.blob(layer, `the layer ${layer.digest}`), stage)
  })
  await swapLink(release, request.places.current)
  const command = await linkCommand({ release, places: request.places })
  log(`martha: ${version}, ${image}@${digest}`)
  log(`martha: signed by attest-image.yml@${verdict.sha} for ${NAMES.sourceRepository} ${releaseRef(version)}`)
  log(`martha: ${request.places.current} -> ${release}`)
  log(`martha: ${command}`)
  return { version, digest, signer: verdict.sha, release, command }
}
