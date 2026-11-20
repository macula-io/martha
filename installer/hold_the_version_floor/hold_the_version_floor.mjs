// This machine's version floor (martha#21, R9 of #84; design issuecomment-6753241669, build ruling
// issuecomment-6868833599). Once a machine runs a release that carries the floor, an older release that also carries
// it is installed with a one-line notice; the record still never moves down without the owner's withdrawal for that
// exact version.
//
// Three floors: the project's, floor.txt, a reviewed commit; the one a release declares, floor.json, which the packer
// generates from floor.txt into the signed layer; and this machine's record, <data>/martha/floor, beside releases/,
// one X.Y.Z line. A version below the record, and a release whose floor.json is missing, malformed or above itself,
// are each said in one line and the install goes ahead (martha#601): the floor protects no key, no work and no push
// to main. After current is swapped the record becomes the higher of what it held and what the release declares, so
// an ordinary install never lowers it. The only way down is a withdrawal, floor-withdrawal.json { version, from }, a
// tracked file inside a later release, so the release signature that already covers the layer is what signs it. It
// is honoured while the record is its `from`, and its version becomes the record.
//
// A record that is malformed or cannot be read is said in one line and read as no floor. No record at all is how
// every machine starts: anything signed installs, and the machine gains that release's floor.
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { compareVersions, isVersion } from '../read_the_release_registry/read_the_release_registry.mjs'

/** The record's name: <data>/martha/floor, beside releases/, where the launcher finds it from its own real path. */
export const FLOOR_RECORD = 'floor'

/**
 * @typedef {{ version: string, from: string }} Withdrawal
 *   the owner's statement that this machine may go from the floor `from` down to `version`
 */

/**
 * Where this machine keeps its floor: beside `releases`.
 * @param {import('../place_the_release/place_the_release.mjs').Places} places
 */
export const floorRecordOf = (places) => join(dirname(places.releases), FLOOR_RECORD)

/** @param {unknown} error */
const codeOf = (error) => /** @type {{ code?: unknown }} */ (error)?.code

/**
 * The floor this machine holds, or undefined when it holds none yet. The launcher's recordedFloor reads the record
 * alike, in the same words, held by every_reader_agrees_on_the_floor.node-test.mjs (martha#433).
 * @param {import('../place_the_release/place_the_release.mjs').Places} places
 * @param {(line: string) => void} [note]
 * @returns {Promise<string | undefined>}
 */
export async function machineFloor (places, note = () => {}) {
  const record = floorRecordOf(places)
  /** @type {string} */
  let text
  try { text = await readFile(record, 'utf8') } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    note(`${record}, this machine's version floor, could not be read (${codeOf(error) ?? error}); no floor is held`)
    return undefined
  }
  const version = text.endsWith('\n') ? text.slice(0, -1) : ''
  if (!isVersion(version)) {
    note(`${record}, this machine's version floor, is not one X.Y.Z line; no floor is held`)
    return undefined
  }
  return version
}

/**
 * The record set to `version`: one temporary file in the record's own directory, then one rename. Nothing is written
 * when there is no version to hold: a release that declares no floor, on a machine that holds none, leaves the record
 * as it was (martha#601).
 * @param {import('../place_the_release/place_the_release.mjs').Places} places
 * @param {string | undefined} version
 */
export async function holdTheFloor (places, version) {
  if (version === undefined) return
  const record = floorRecordOf(places)
  const temporary = join(dirname(record), `.${FLOOR_RECORD}.${process.pid}`)
  await unlink(temporary).catch(() => {})
  await writeFile(temporary, `${version}\n`)
  await rename(temporary, record)
}

/**
 * What the record becomes after an ordinary install: the higher of what it held and what the release declares, or
 * what was held when the release declares no floor this installer reads.
 * @param {string | undefined} held
 * @param {string | undefined} declared
 */
export const higherFloor = (held, declared) => {
  if (declared === undefined) return held
  return held !== undefined && compareVersions(held, declared) > 0 ? held : declared
}

/**
 * The JSON a release folder carries in `file`, said in one line when it is not there or not JSON.
 * @param {string} tree the directory the release unpacked to
 * @param {string} file
 * @param {string} missing what the release does not do without it, in words
 * @param {(line: string) => void} [note]
 */
async function jsonIn (tree, file, missing, note = () => {}) {
  const named = `${NAMES.releaseFolder}/${file}`
  /** @type {string} */
  let text
  try { text = await readFile(join(tree, named), 'utf8') } catch (error) {
    if (codeOf(error) === 'ENOENT') { note(`this release carries no ${named}, so it ${missing}`); return undefined }
    throw error
  }
  try { return JSON.parse(text) } catch { note(`${named} is not JSON`); return undefined }
}

/**
 * Whether `value` is an object naming exactly `keys`, each an X.Y.Z version.
 * @template {string} K
 * @param {unknown} value
 * @param {K[]} keys
 * @returns {value is Record<K, string>}
 */
const versionsOnly = (value, keys) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const own = Object.keys(value)
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key) && isVersion(/** @type {any} */ (value)[key]))
}

/**
 * The floor the release unpacked at `tree` declares, which is not above the release itself; undefined when it
 * declares none this installer reads.
 * @param {string} tree
 * @param {string} version the release's own version
 * @param {(line: string) => void} [note]
 * @returns {Promise<string | undefined>}
 */
export async function declaredFloor (tree, version, note = () => {}) {
  const value = await jsonIn(tree, NAMES.floorFile, 'declares no version floor', note)
  if (value === undefined) return undefined
  if (!versionsOnly(value, ['floor'])) {
    note(`${NAMES.releaseFolder}/${NAMES.floorFile} is not { "floor": "X.Y.Z" }; no floor is taken from it`)
    return undefined
  }
  if (compareVersions(value.floor, version) > 0) {
    note(`${version} declares the floor ${value.floor}, above itself; no floor is taken from it`)
    return undefined
  }
  return value.floor
}

/**
 * The withdrawal the release unpacked at `tree` carries, or undefined when it carries none this installer reads.
 * @param {string} tree
 * @param {(line: string) => void} [note]
 * @returns {Promise<Withdrawal | undefined>}
 */
export async function withdrawalIn (tree, note = () => {}) {
  const value = await jsonIn(tree, NAMES.withdrawalFile, 'withdraws no floor', note)
  if (value === undefined) return undefined
  if (!versionsOnly(value, ['version', 'from'])) {
    note(`${NAMES.releaseFolder}/${NAMES.withdrawalFile} is not { "version": "X.Y.Z", "from": "X.Y.Z" }; no withdrawal is taken from it`)
    return undefined
  }
  return { version: value.version, from: value.from }
}

/**
 * What the floor says about this version, said in one line and gone past (martha#601): a version below the floor,
 * and a withdrawal that does not fit, are installed anyway. The withdrawal is honoured for the record only when it
 * fits exactly, and that is what this answers.
 * @param {{ version: string, floor: string | undefined, withdrawal?: Withdrawal | undefined, carrier?: string | undefined, note?: (line: string) => void }} request
 *   carrier: the version of the release that carries the withdrawal
 * @returns {Withdrawal | undefined} the withdrawal honoured for the record, when it fits
 */
export function checkAgainstTheFloor ({ version, floor, withdrawal, carrier, note = () => {} }) {
  if (withdrawal) return checkTheWithdrawal({ version, floor, withdrawal, carrier: carrier ?? '', note })
  if (floor !== undefined && compareVersions(version, floor) < 0) {
    note(`${version} is below ${floor}, the version floor this machine holds; installing it`)
  }
  return undefined
}

/**
 * A withdrawal honoured only for its own version, and only while this machine's floor is its `from`.
 * @param {{ version: string, floor: string | undefined, withdrawal: Withdrawal, carrier: string, note: (line: string) => void }} request
 * @returns {Withdrawal | undefined}
 */
function checkTheWithdrawal ({ version, floor, withdrawal, carrier, note }) {
  const said = `the withdrawal in ${carrier}`
  if (withdrawal.version !== version) {
    note(`${said} is for ${withdrawal.version}, not ${version}; the version you named is installed`)
    return undefined
  }
  if (floor === undefined) {
    note(`${said} lowers the floor from ${withdrawal.from}, and this machine holds no floor`)
    return undefined
  }
  if (withdrawal.from !== floor) {
    note(`${said} lowers the floor from ${withdrawal.from}, and this machine's floor is ${floor}; it is not honoured`)
    return undefined
  }
  return withdrawal
}
