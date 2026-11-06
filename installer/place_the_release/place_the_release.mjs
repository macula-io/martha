// Where a verified release lives, and how the command finds it (martha#21). Each release has its own read-only
// directory, <data>/martha/releases/<version>-sha256-<hex>, staged inside releases/ and renamed into place; then
// <data>/martha/current is swapped to it by one rename (the old release or the new one, never neither); then the
// command on PATH, <bin>/martha, is linked through current, so it follows every install.
//
// One downgrade rule: a version lower than the one current points at is refused unless the user passes
// --downgrade and names that exact version. A version is published once, so a second digest for a version this
// machine holds is always refused. Anything at a link's place that is not a link is someone else's: it is named,
// never replaced.
import { chmod, lstat, mkdir, mkdtemp, readdir, readlink, rename, rm, symlink, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { NAMES } from '../keep_the_names_in_one_place/names.mjs'
import { compareVersions, isVersion } from '../read_the_release_registry/read_the_release_registry.mjs'
import { refuse } from '../refuse_in_words/refuse_in_words.mjs'
import { TOP } from '../unpack_the_release_layer/unpack_the_release_layer.mjs'

/**
 * @typedef {{ releases: string, current: string, binDir: string }} Places
 *   releases: where each release has its directory; current: the link to the one in use; binDir: where the command
 *   is linked.
 */

/** @param {string} version @param {string} digest */
export const releaseName = (version, digest) => `${version}-${digest.replace(':', '-')}`

/** @param {string} path */
const there = async (path) => { try { return await lstat(path) } catch { return undefined } }

/**
 * The version current points at, when it points at a release in `releases`; undefined when nothing is installed.
 * @param {Places} places
 */
export async function installedVersion ({ releases, current }) {
  const at = await there(current)
  if (!at) return undefined
  if (!at.isSymbolicLink()) refuse(`${current} is not a link; move it aside and install again`)
  const target = await readlink(current)
  if (dirname(target) !== releases) return undefined
  const version = basename(target).split('-sha256-')[0]
  return isVersion(version) ? version : undefined
}

/**
 * The one downgrade rule, and no second digest for a version this machine holds.
 * @param {{ version: string, digest: string, downgrade: boolean, named: boolean, places: Places }} request
 */
export async function checkAgainstInstalled ({ version, digest, downgrade, named, places }) {
  if (downgrade && !named) refuse('--downgrade installs only the version you name; name it')
  const have = await installedVersion(places)
  if (have && compareVersions(version, have) < 0 && !downgrade) {
    refuse(`${version} is lower than the installed ${have}; refused. To go back on purpose: ${NAMES.command}-install ${version} --downgrade`)
  }
  const held = (await readdir(places.releases).catch(() => [])).filter((n) => n.startsWith(`${version}-sha256-`))
  const other = held.find((n) => n !== releaseName(version, digest))
  if (other) {
    refuse(`${version} is installed as ${other.slice(version.length + 1)} and the package now names ${digest} for it; a version is published once, refused`)
  }
}

/**
 * `link` made to point at `target` by one rename.
 * @param {string} target
 * @param {string} link
 */
export async function swapLink (target, link) {
  const at = await there(link)
  if (at && !at.isSymbolicLink()) {
    refuse(`${link} is ${at.isDirectory() ? 'a directory' : 'a file'}, not a link; move it aside and install again`)
  }
  await mkdir(dirname(link), { recursive: true })
  const temporary = join(dirname(link), `.${basename(link)}.${process.pid}`)
  await unlink(temporary).catch(() => {})
  await symlink(target, temporary)
  await rename(temporary, link)
}

/**
 * A tree this run made, removed even when it is read-only.
 * @param {string} path
 */
async function removeTree (path) {
  /** @param {string} dir */
  const walk = async (dir) => {
    await chmod(dir, 0o700).catch(() => {})
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) await walk(join(dir, entry.name))
    }
  }
  await walk(path)
  await rm(path, { recursive: true, force: true })
}

/**
 * The release unpacked into its own directory, unless it is already there: staged inside `releases`, so it
 * arrives by a rename on one filesystem, and removed when anything fails.
 * @param {{ releases: string, name: string, unpack: (stage: string) => Promise<void> }} request
 * @returns {Promise<string>} the release directory
 */
export async function placeRelease ({ releases, name, unpack }) {
  const final = join(releases, name)
  if (await there(final)) return final
  await mkdir(releases, { recursive: true })
  const stage = await mkdtemp(join(releases, '.work-'))
  try {
    await unpack(stage)
    await rename(stage, final)
  } catch (error) {
    await removeTree(stage)
    throw error
  }
  await chmod(final, 0o555)
  return final
}

/**
 * The command on PATH, <bin>/martha -> <current>/martha/bin/martha, when the release carries one; otherwise a line
 * saying there is no command to link. A <bin>/martha that is not a link is left alone and named.
 * @param {{ release: string, places: Places }} request
 * @returns {Promise<string>} what happened, in words
 */
export async function linkCommand ({ release, places }) {
  const inRelease = join(release, TOP, 'bin', NAMES.command)
  if (!(await there(inRelease))?.isFile()) return `this release carries no ${TOP}/bin/${NAMES.command}, so there is no command to link`
  const link = join(places.binDir, NAMES.command)
  const target = join(places.current, TOP, 'bin', NAMES.command)
  const at = await there(link)
  if (at && !at.isSymbolicLink()) return `${link} is not a link, so it was left alone; the command is ${target}`
  if (at && (await readlink(link)) === target) return `${link} -> ${target}`
  await swapLink(target, link)
  return `${link} -> ${target}`
}
