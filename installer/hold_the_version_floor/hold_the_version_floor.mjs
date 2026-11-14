// This machine's version floor (martha#21, R9 of #84; design issuecomment-6753241669, build ruling
// issuecomment-6868833599). Once a machine runs a release that carries the floor, no script, page or typed command
// puts it back on an older release that also carries it, without the owner's withdrawal for that exact version.
//
// Three floors: the project's, floor.txt, a reviewed commit; the one a release declares, floor.json, which the packer
// generates from floor.txt into the signed layer; and this machine's record, <data>/martha/floor, beside releases/,
// one X.Y.Z line. An install refuses a version below the record, and a release whose floor.json is missing, malformed
// or above itself; after current is swapped the record becomes the higher of what it held and what the release
// declares, so an ordinary install never lowers it. The only way down is a withdrawal, floor-withdrawal.json
// { version, from }, a tracked file inside a later release, so the release signature that already covers the layer is
// what signs it. It is honoured while the record is its `from`, and its version becomes the record.
//
// A record that is malformed or cannot be read is refused, never read as no floor. No record at all is how every
// machine starts: anything signed installs, and the machine gains that release's floor.
import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { compareVersions, isVersion } from '../read_the_release_registry/read_the_release_registry.mjs'
import { refuse } from '../refuse_in_words/refuse_in_words.mjs'

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
 * The floor this machine holds, or undefined when it holds none yet.
 * @param {import('../place_the_release/place_the_release.mjs').Places} places
 * @returns {Promise<string | undefined>}
 */
export async function machineFloor (places) {
  const record = floorRecordOf(places)
  /** @type {string} */
  let text
  try { text = await readFile(record, 'utf8') } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    return refuse(`${record}, this machine's version floor, could not be read (${codeOf(error) ?? error}); refused, never read as no floor`)
  }
  const version = text.endsWith('\n') ? text.slice(0, -1) : ''
  if (!isVersion(version)) refuse(`${record}, this machine's version floor, is not one X.Y.Z line; refused, never read as no floor`)
  return version
}

/**
 * The record set to `version`: one temporary file in the record's own directory, then one rename.
 * @param {import('../place_the_release/place_the_release.mjs').Places} places
 * @param {string} version
 */
export async function holdTheFloor (places, version) {
  const record = floorRecordOf(places)
  const temporary = join(dirname(record), `.${FLOOR_RECORD}.${process.pid}`)
  await unlink(temporary).catch(() => {})
  await writeFile(temporary, `${version}\n`)
  await rename(temporary, record)
}

/**
 * What the record becomes after an ordinary install: the higher of what it held and what the release declares.
 * @param {string | undefined} held
 * @param {string} declared
 */
export const higherFloor = (held, declared) => (held !== undefined && compareVersions(held, declared) > 0 ? held : declared)

/**
 * The JSON a release folder carries in `file`, refused by name when it is not there or not JSON.
 * @param {string} tree the directory the release unpacked to
 * @param {string} file
 * @param {string} missing what the release does not do without it, in words
 */
async function jsonIn (tree, file, missing) {
  const named = `${NAMES.releaseFolder}/${file}`
  /** @type {string} */
  let text
  try { text = await readFile(join(tree, named), 'utf8') } catch (error) {
    if (codeOf(error) === 'ENOENT') return refuse(`this release carries no ${named}, so it ${missing}; refused`)
    throw error
  }
  try { return JSON.parse(text) } catch { return refuse(`${named} is not JSON; refused`) }
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
 * The floor the release unpacked at `tree` declares, which must not be above the release itself.
 * @param {string} tree
 * @param {string} version the release's own version
 */
export async function declaredFloor (tree, version) {
  const value = await jsonIn(tree, NAMES.floorFile, 'declares no version floor')
  if (!versionsOnly(value, ['floor'])) return refuse(`${NAMES.releaseFolder}/${NAMES.floorFile} is not { "floor": "X.Y.Z" }; refused`)
  if (compareVersions(value.floor, version) > 0) refuse(`${version} declares the floor ${value.floor}, above itself; refused`)
  return value.floor
}

/**
 * The withdrawal the release unpacked at `tree` carries.
 * @param {string} tree
 * @returns {Promise<Withdrawal>}
 */
export async function withdrawalIn (tree) {
  const value = await jsonIn(tree, NAMES.withdrawalFile, 'withdraws no floor')
  if (!versionsOnly(value, ['version', 'from'])) {
    return refuse(`${NAMES.releaseFolder}/${NAMES.withdrawalFile} is not { "version": "X.Y.Z", "from": "X.Y.Z" }; refused`)
  }
  return { version: value.version, from: value.from }
}

/**
 * The floor check before anything is placed: `version` at or above the machine's floor, or a withdrawal for exactly
 * `version` from exactly the floor the machine holds.
 * @param {{ version: string, floor: string | undefined, withdrawal?: Withdrawal | undefined, carrier?: string | undefined }} request
 *   carrier: the version of the release that carries the withdrawal
 */
export function checkAgainstTheFloor ({ version, floor, withdrawal, carrier }) {
  if (withdrawal) return checkTheWithdrawal({ version, floor, withdrawal, carrier: carrier ?? '' })
  if (floor !== undefined && compareVersions(version, floor) < 0) {
    refuse(`${version} is below ${floor}, the version floor this machine holds; refused. Only a withdrawal the owner signed goes below it: ${NAMES.command}-install ${version} --withdrawal-in <the release that carries it>`)
  }
}

/**
 * A withdrawal honoured only for its own version, and only while this machine's floor is its `from`.
 * @param {{ version: string, floor: string | undefined, withdrawal: Withdrawal, carrier: string }} request
 */
function checkTheWithdrawal ({ version, floor, withdrawal, carrier }) {
  const said = `the withdrawal in ${carrier}`
  if (withdrawal.version !== version) refuse(`${said} is for ${withdrawal.version}, not ${version}; refused`)
  if (floor === undefined) refuse(`${said} lowers the floor from ${withdrawal.from}, and this machine holds no floor; install ${version} without it`)
  if (withdrawal.from !== floor) refuse(`${said} lowers the floor from ${withdrawal.from}, and this machine's floor is ${floor}; refused`)
}
