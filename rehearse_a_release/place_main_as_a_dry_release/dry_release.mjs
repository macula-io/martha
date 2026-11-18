// A dry release of main: main's layer placed by the installer's own steps, for the live clean-install run before a
// release exists (martha#639, the dry step; ruled acceptable by the Supervisor on 2026-11-18 under four conditions).
//
// A release is an image holding `git archive` of the tagged tree plus the installer pin, and the installer takes it in
// seven steps (installer/install_a_release). Step 4 accepts only a signature for refs/tags/v<version>, so main cannot
// go through the installer whole, and this harness must not loosen that. So it runs only the installer's own exported
// steps that need no registry, on a layer packed from main the way a release is packed:
//
//   step 1  checkNodeVersion                     this Node is one Martha runs on
//   step 6  unpackLayer, inside placeRelease     every tar entry checked before a byte is written
//   step 7  placeRelease, swapLink, the floor,   its own read-only directory, current swapped, the floor held,
//           linkCommand                          the command linked
//
// and never runs steps 2-5: the registry and the version, the downgrade rule, the signature, and the layer's digest.
// The result line says so, so a dry pass can never be read as a release's proof.
//
// The four conditions, and where each is held:
//   1. it calls the installer's own exported steps and changes no installer code or verification path: INSTALLER_STEPS
//      names the module files, each in the installer package's "files", and nothing here unpacks, places or links;
//   2. it is proof code only: rehearse_a_release/ is export-ignored, so no layer carries it, and neither the martha
//      command nor the installer's CLI imports it;
//   3. its result line names what it skipped and is never the clean-install proof's release result;
//   4. every layer entry is still checked by unpackLayer, which placeRelease calls before anything is placed.
// The tests beside this file hold each one.

import { createHash } from 'node:crypto'

// The installer's own steps, imported by name from ../../installer: the repository's installer/ wherever this folder
// sits in a checkout. In the live run's container the harness is laid out with `installer` a link to the published
// installer package, installed with npm and never run, so these same imports load the published steps. The core's
// import check refuses a module name computed at run time, so the installer is never chosen by a path given in.
import { checkNodeVersion } from '../../installer/check_the_node_version/check_the_node_version.mjs'
import { placesOnThisMachine } from '../../installer/install_a_release/install_a_release.mjs'
import { declaredFloor, higherFloor, holdTheFloor, machineFloor } from '../../installer/hold_the_version_floor/hold_the_version_floor.mjs'
import { linkCommand, placeRelease, releaseName, swapLink } from '../../installer/place_the_release/place_the_release.mjs'
import { unpackLayer } from '../../installer/unpack_the_release_layer/unpack_the_release_layer.mjs'

/** The installer's own module files this harness imports, relative to the installer package, each a published step. */
export const INSTALLER_STEPS = Object.freeze({
  node: 'check_the_node_version/check_the_node_version.mjs',
  install: 'install_a_release/install_a_release.mjs',
  unpack: 'unpack_the_release_layer/unpack_the_release_layer.mjs',
  place: 'place_the_release/place_the_release.mjs',
  floor: 'hold_the_version_floor/hold_the_version_floor.mjs'
})

/** The steps of installer/install_a_release a dry release does not run, in the words its result line says. */
export const SKIPPED_STEPS = Object.freeze(['the registry', 'the downgrade rule', 'the signature', 'the layer digest'])

/** What every line a dry release prints starts with. */
export const DRY = 'dry:'

/** The two installers a dry run can exercise: main's own, or the published one (martha#695, option A). */
export const MAINS_OWN_INSTALLER = 'main'
export const THE_PUBLISHED_INSTALLER = 'published'

/**
 * Which installer the run exercised, in the words the result line says it by (martha#695, T3): main's own by the digest
 * of the tarball that was packed from main, or the published one by its name and version. A reader must never have to
 * guess which of the two was proven, and a run that cannot say is refused rather than reported.
 * @param {{ origin: string, digest?: string, published?: string }} proven
 */
export const theInstallerThatRan = (proven) => {
  if (proven.origin === MAINS_OWN_INSTALLER) {
    if (typeof proven.digest !== 'string' || proven.digest === '') {
      throw new Error(`a dry run that proves main's own installer names its digest, and none was given`)
    }
    return `main's own installer (${proven.digest})`
  }
  if (proven.origin === THE_PUBLISHED_INSTALLER) {
    if (typeof proven.published !== 'string' || proven.published === '') {
      throw new Error('a dry run that proves the published installer names its name and version, and none was given')
    }
    return `the published ${proven.published}`
  }
  throw new Error(`${String(proven.origin)} is not an installer a dry run proves`)
}

/**
 * The dry release's result line: what it placed, from what, which installer it was placed by, and what it did not run.
 * @param {string} sha
 * @param {{ origin: string, digest?: string, published?: string }} proven
 */
export const dryResultLine = (sha, proven) =>
  `${DRY} main at ${sha}, not a release, placed by ${theInstallerThatRan(proven)}; the installer's ${SKIPPED_STEPS.join(', ')} steps not run`

/** The installer's own steps, as this harness calls them: each is the installer's exported function, unwrapped. */
export const THE_INSTALLERS_STEPS = Object.freeze({
  checkNodeVersion,
  placesOnThisMachine,
  unpackLayer,
  placeRelease,
  releaseName,
  swapLink,
  linkCommand,
  declaredFloor,
  machineFloor,
  higherFloor,
  holdTheFloor
})

/** @typedef {typeof THE_INSTALLERS_STEPS} Steps */

/**
 * The layer's own sha256, which names its release directory as a release's digest does (never checked against one).
 * @param {Buffer} layer
 */
const digestOf = (layer) => `sha256:${createHash('sha256').update(layer).digest('hex')}`

/**
 * Main's layer placed by the installer's steps 1, 6 and 7, in installRelease's own order. `layer` is the gzipped tar,
 * `version` the version main's tree carries, `home` and `xdgDataHome` the places the installer itself would use.
 * Returns what was placed and every line to print, the result line last; a step that refuses throws its own words.
 * @param {{ steps: Steps, layer: Buffer, version: string, sha: string, home: string, xdgDataHome?: string, nodeVersion?: string, proven: { origin: string, digest?: string, published?: string } }} request
 */
export async function placeADryRelease ({ steps, layer, version, sha, home, xdgDataHome, nodeVersion, proven }) {
  steps.checkNodeVersion(nodeVersion ?? process.versions.node)
  const places = steps.placesOnThisMachine(home, xdgDataHome)
  // The machine's floor is read before anything is placed, where installRelease reads it (martha#659).
  const held = await steps.machineFloor(places)
  let declared = ''
  const release = await steps.placeRelease({
    releases: places.releases,
    name: steps.releaseName(version, digestOf(layer)),
    unpack: async (/** @type {string} */ stage) => steps.unpackLayer(layer, stage),
    accept: async (/** @type {string} */ tree) => { declared = await steps.declaredFloor(tree, version) }
  })
  await steps.swapLink(release, places.current)
  const floor = steps.higherFloor(held, declared)
  await steps.holdTheFloor(places, floor)
  const command = await steps.linkCommand({ release, places })
  const lines = [
    `${DRY} placed ${version} from main's layer: ${places.current} -> ${release}`,
    `${DRY} version floor ${floor}`,
    `${DRY} ${command}`,
    dryResultLine(sha, proven)
  ]
  return { release, command, floor, lines }
}
