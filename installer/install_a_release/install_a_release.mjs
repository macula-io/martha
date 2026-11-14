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
//
// The version floor (martha#21, R9 of #84) runs through the same steps: after step 3, the version must be at or above
// the floor this machine holds, unless a withdrawal carried by the release --withdrawal-in names (resolved, signed and
// unpacked as in steps 2 to 6, never placed) is for exactly this version from exactly that floor; before step 7's
// rename, the floor.json the release declares is read from its unpacked tree; after current is swapped, the record
// becomes the higher of what it held and what the release declares, or the withdrawal's version.
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { checkNodeVersion } from '../check_the_node_version/check_the_node_version.mjs'
import { NAMES, releaseRef } from '../keep_the_names_in_one_place/names.mjs'
import { checkAgainstTheFloor, declaredFloor, higherFloor, holdTheFloor, machineFloor, withdrawalIn } from '../hold_the_version_floor/hold_the_version_floor.mjs'
import { checkAgainstInstalled, linkCommand, placeRelease, releaseName, removeTree, swapLink } from '../place_the_release/place_the_release.mjs'
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
 * @property {string} [withdrawalIn]   the release that carries the owner's withdrawal down to `version` (martha#21)
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
function checkRequest ({ version, digest, withdrawalIn }) {
  if (version !== undefined && !isVersion(version)) refuse(`a version is X.Y.Z, got '${version}'`)
  if (digest !== undefined && !isDigest(digest)) refuse(`--digest is sha256:<64 hex>, got '${digest}'`)
  if (digest !== undefined && version === undefined) refuse('--digest needs the version it is the digest of')
  checkWithdrawalRequest({ version, withdrawalIn })
}

/**
 * --withdrawal-in names a release version, never the target itself, and only with the target named.
 * @param {{ version?: string | undefined, withdrawalIn?: string | undefined }} request
 */
function checkWithdrawalRequest ({ version, withdrawalIn: carrier }) {
  if (carrier === undefined) return
  if (!isVersion(carrier)) refuse(`--withdrawal-in is X.Y.Z, got '${carrier}'`)
  if (version === undefined) refuse('--withdrawal-in needs the version it withdraws to; name it')
  if (carrier === version) refuse(`--withdrawal-in names ${version} itself; a withdrawal is carried by another release, name that one`)
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

/**
 * The steps in the order the top of this file lists them; nothing is linked until every one has passed.
 * @param {InstallRequest} request
 */
export async function installRelease (request) {
  checkNodeVersion(request.nodeVersion ?? process.versions.node)
  checkRequest(request)
  const image = request.image ?? NAMES.image
  const reg = registry({ image, ...(request.base && { base: request.base }), ...(request.fetch && { fetch: request.fetch }) })
  const chosen = await chosenRelease(request, reg, image)
  const held = await machineFloor(request.places)
  const withdrawal = await withdrawalOf(request, reg, image)
  checkAgainstTheFloor({ version: chosen.version, floor: held, withdrawal, carrier: request.withdrawalIn })
  const signer = await signerOf(request, reg, chosen)
  const { release, declared } = await placedRelease(request, reg, chosen)
  // Written only once current is swapped, so a failed install never leaves the floor moved with nothing installed.
  const floor = withdrawal ? withdrawal.version : higherFloor(held, declared)
  await holdTheFloor(request.places, floor)
  const command = await linkCommand({ release, places: request.places })
  const log = request.log ?? console.log
  log(`martha: ${chosen.version}, ${image}@${chosen.digest}`)
  log(`martha: signed by attest-image.yml@${signer} for ${NAMES.sourceRepository} ${releaseRef(chosen.version)}`)
  log(`martha: ${request.places.current} -> ${release}`)
  log(`martha: version floor ${floor}${withdrawal ? `, lowered by the withdrawal in ${request.withdrawalIn}` : ''}`)
  log(`martha: ${command}`)
  return { version: chosen.version, digest: chosen.digest, signer, release, command, floor }
}

/**
 * The withdrawal the release --withdrawal-in names carries: that release resolved to its digest, its signature
 * checked as an install checks one, its layer unpacked to a staging directory removed afterwards, and its
 * floor-withdrawal.json read. It is never placed, so the floor it declares is never adopted. Undefined when none is
 * named.
 * @param {InstallRequest} request
 * @param {Registry} reg
 * @param {string} image
 */
async function withdrawalOf (request, reg, image) {
  const version = request.withdrawalIn
  if (version === undefined) return undefined
  const manifest = await reg.manifest(version)
  const carrier = { image, version, digest: manifest.digest, named: true, manifest }
  await signerOf(request, reg, carrier)
  const layer = layerOf(manifest.json, `${image}@${carrier.digest}`)
  await mkdir(request.places.releases, { recursive: true })
  const stage = await mkdtemp(join(request.places.releases, '.withdrawal-'))
  try {
    await unpackLayer(await reg.blob(layer, `the layer ${layer.digest}`), stage)
    return await withdrawalIn(stage)
  } finally {
    await removeTree(stage)
  }
}

/**
 * @typedef {ReturnType<typeof registry>} Registry
 * @typedef {{ image: string, version: string, digest: string, named: boolean, manifest: Awaited<ReturnType<Registry['manifest']>> }} ChosenRelease
 */

/**
 * Steps 2 and 3: the version and its manifest, whose digest is the release from here on; the digest the user
 * verified, when given, and the one downgrade rule.
 * @param {InstallRequest} request
 * @param {Registry} reg
 * @param {string} image
 * @returns {Promise<ChosenRelease>}
 */
async function chosenRelease (request, reg, image) {
  const named = request.version !== undefined
  await reg.authorize()
  const version = request.version ?? await reg.highestVersion()
  const manifest = await reg.manifest(version)
  const digest = manifest.digest
  if (request.digest && request.digest !== digest) refuse(`${image}:${version} is ${digest} now, not the ${request.digest} you verified; refused`)
  await checkAgainstInstalled({ version, digest, downgrade: request.downgrade ?? false, named, places: request.places })
  return { image, version, digest, named, manifest }
}

/**
 * Step 4: the signature on the release's digest, by a listed signer; the signing workflow's commit, or a refusal.
 * @param {InstallRequest} request
 * @param {Registry} reg
 * @param {ChosenRelease} chosen
 */
async function signerOf (request, reg, chosen) {
  const { version, digest } = chosen
  const signers = request.signers ?? await listedSigners()
  const bundles = await bundlesOf(reg, chosen)
  const verdict = await signedBy({ bundles, digest, version, signers, ...(request.makeVerifier && { makeVerifier: request.makeVerifier }), tufCachePath: request.tufCachePath })
  if (!('sha' in verdict)) refuseUnsigned({ ...chosen, reasons: verdict.reasons })
  return verdict.sha
}

/**
 * The signature bundles stored for the release's digest. A registry that could not be asked stays that fault;
 * anything else it says is a release with no signature, refused.
 * @param {Registry} reg
 * @param {ChosenRelease} chosen
 */
async function bundlesOf (reg, chosen) {
  try {
    return await reg.bundles(chosen.digest)
  } catch (error) {
    if (error instanceof CouldNotCheck) throw error
    return refuseUnsigned({ ...chosen, reasons: [error instanceof Error ? error.message : String(error)] })
  }
}

/**
 * Steps 5 to 7: the one layer by digest, unpacked into its own read-only directory, the floor it declares read
 * before the rename, current swapped to it.
 * @param {InstallRequest} request
 * @param {Registry} reg
 * @param {ChosenRelease} chosen
 */
async function placedRelease (request, reg, { image, version, digest, manifest }) {
  const layer = layerOf(manifest.json, `${image}@${digest}`)
  let declared = ''
  const release = await placeRelease({
    releases: request.places.releases,
    name: releaseName(version, digest),
    unpack: async (stage) => unpackLayer(await reg.blob(layer, `the layer ${layer.digest}`), stage),
    accept: async (tree) => { declared = await declaredFloor(tree, version) }
  })
  await swapLink(release, request.places.current)
  return { release, declared }
}
