// What a release layer holds, and what it may hold (martha#84, martha#207): `git archive HEAD`, plus the one pin the
// packer generates after the archive, at one path in the release's one folder.
//
// The pin is not in the tree, so comparing the layer with the archive alone refused a correct release, and node's
// deepEqual cut the Map holding the one difference at a fixed width, so the failure named no path at all. Here the
// pin is set aside before the trees are compared, and every path that still differs is named.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NAMES } from '../installer/keep_the_names_in_one_place/names.mjs'

/** Where a layer holds the pin the packer generated: the release folder, and the file the installer package names. */
export const PIN_IN_THE_LAYER = `${NAMES.releaseFolder}/${NAMES.pinFile}`

/** At most this many paths are named in one refusal, so a tree that differs everywhere stays readable. */
const NAMED_AT_MOST = 10

/**
 * The layer's tree with the pin taken out: what is left must be the committed tree, path for path and byte for byte.
 * @param {Map<string, string>} layer path -> hash, as treeOf reads them
 * @returns {Map<string, string>}
 */
export const withoutThePin = (layer) => new Map([...layer].filter(([path]) => path !== PIN_IN_THE_LAYER))

/**
 * Every path on which two trees differ: what only `expected` holds, what only `layer` holds, and what both hold with
 * other bytes. Sorted, so one refusal reads the same on every run.
 * @param {Map<string, string>} expected @param {Map<string, string>} layer
 */
export function differences (expected, layer) {
  return {
    missing: [...expected.keys()].filter((path) => !layer.has(path)).sort(),
    extra: [...layer.keys()].filter((path) => !expected.has(path)).sort(),
    changed: [...expected.keys()].filter((path) => layer.has(path) && layer.get(path) !== expected.get(path)).sort()
  }
}

/**
 * A list of paths as one clause: all of them up to the cap, and how many follow the ones it names.
 * @param {string[]} paths
 */
const someOf = (paths) => paths.length <= NAMED_AT_MOST
  ? paths.join(', ')
  : `${paths.slice(0, NAMED_AT_MOST).join(', ')}, and ${paths.length - NAMED_AT_MOST} more`

/**
 * The differences as one sentence naming the paths, or the empty string when there are none.
 * @param {{ missing: string[], extra: string[], changed: string[] }} differing
 */
export function inWords ({ missing, extra, changed }) {
  const parts = [
    { what: 'missing from the layer', paths: missing },
    { what: 'not in the committed tree', paths: extra },
    { what: 'differing bytes', paths: changed }
  ].filter((part) => part.paths.length > 0)
  if (parts.length === 0) return ''
  return `the layer is not the committed tree plus the pin: ${parts.map((part) => `${part.what} (${part.paths.length}): ${someOf(part.paths)}`).join('; ')}`
}

/**
 * The pin a layer holds, as it was written. A layer with no pin, or a pin that is not JSON, is named by its path: a
 * pin nobody can read is not a pin that agrees.
 * @param {string} layerRoot the folder a layer unpacked to, the release folder inside it
 * @returns {any}
 */
export function thePinIn (layerRoot) {
  const file = join(layerRoot, PIN_IN_THE_LAYER)
  /** @type {Buffer} */
  let bytes
  try { bytes = readFileSync(file) } catch (error) {
    throw new Error(`the layer holds no pin at ${PIN_IN_THE_LAYER}: ${error instanceof Error ? error.message : String(error)}`)
  }
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`the pin at ${PIN_IN_THE_LAYER} is not JSON`) }
}

/**
 * Every field either object names, sorted: a pin carrying one field more than the published installer is a
 * difference in that field, so the comparison cannot be limited to the fields the writer is known to write.
 * @param {any} pin @param {any} published
 * @returns {string[]}
 */
const fieldsOf = (pin, published) => [...new Set([...Object.keys(pin ?? {}), ...Object.keys(published ?? {})])].sort()

/** One field's value as it reads in a refusal, so two values are compared and shown the same way. @param {any} value */
const asRead = (value) => JSON.stringify(value)

/**
 * Which fields of the pin are not the installer npm serves, each with both values; empty when the pin is that
 * installer's, and every field either object names when the layer holds no pin at all.
 * @param {any} pin the pin as the layer holds it @param {any} published what pin_the_installer would write
 */
export function pinFieldsThatDiffer (pin, published) {
  return fieldsOf(pin, published)
    .filter((field) => asRead(pin?.[field]) !== asRead(published?.[field]))
    .map((field) => `${field} is ${asRead(pin?.[field])}, not ${asRead(published?.[field])}`)
}
