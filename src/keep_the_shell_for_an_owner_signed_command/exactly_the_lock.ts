// The dependencies a signed command may run (martha#129, design step 6, with r=3 and r=4): exactly the packages
// the base tree's lock pins, checked both ways against what is installed.
//
// One rule for #127 and #129: a package's bytes count as the owner's when the BASE lock pins them and this check
// holds. A run has that evidence; a `Read` of the live node_modules does not, so #127's B4 row for it stands.
//
//   - Whose lock: the live package-lock.json and package.json must be the base tree's own blobs. A member that
//     re-pins or adds a dependency through its own writes gets no exemption until the owner merges the change.
//   - Both files, one shape: the base lock and node_modules/.package-lock.json both exist, both at
//     LOCKFILE_VERSION with a `packages` map. pnpm, yarn, --no-package-lock, older npm, v1 and v2 refuse.
//   - Every installed entry matches: each key of the installed map (nested ones included) is in the base lock
//     with the same version and integrity, and has an integrity. `link` and `inBundle` refuse in the first
//     release. The root entry "" is the lock's only and is not compared.
//   - Nothing missing: a base lock entry may be absent from the installed map only when it is `optional`.
//   - Nothing beyond it: a package directory is one whose path is a key of the installed map. At every
//     node_modules level each entry whose name does not start with `.` is a package directory, or a `@scope`
//     directory whose every child is one. A package's own contents are its own; its nested node_modules is one
//     more level.
//   - The copied set is the package directories. Entries starting with `.` (.bin, .cache, .package-lock.json) are
//     never copied. `.bin` is rebuilt from the BASE lock's `bin` field of each package, every name it maps, as a
//     relative link that points inside that package.

import { posix } from 'node:path'

import { MANIFEST } from '../../prove_the_core/declared_in_package_json.ts'

/**
 * The manifest's name, handed on from the one place that defines it (martha#256 r=3): this slice compares the live
 * manifest with the base's, and the checks that read or write one import it from here with the lock's other names.
 */
export { MANIFEST }

/** The one lock format whose installed tree can be compared entry for entry with the lock. */
export const LOCKFILE_VERSION = 3
export const LOCK = 'package-lock.json'
export const DEPENDENCIES = 'node_modules'
export const INSTALLED_LOCK = `${DEPENDENCIES}/.package-lock.json`
const ROOT_ENTRY = ''
const BIN_DIRECTORY = '.bin'
const HIDDEN = '.'
const SCOPE = '@'

/** A link the run's .bin gets: where it lives, and what it points at, relative to it. */
export interface BinLink {
  readonly link: string
  readonly target: string
  readonly points_at: string
}

export interface DependenciesTheRunMaySee {
  readonly packages: readonly string[]
  readonly bin_links: readonly BinLink[]
  readonly refusals: readonly string[]
}

export interface DependenciesToJudge {
  /** The base tree's blob ids of the lock and the manifest; undefined where the base has none. */
  readonly base_blobs: { readonly lock: string | undefined; readonly manifest: string | undefined }
  /** The live tree's blob ids of the same two files; undefined where the checkout has none. */
  readonly live_blobs: { readonly lock: string | undefined; readonly manifest: string | undefined }
  /** The base lock, parsed from the base blob's bytes. */
  readonly base_lock: unknown
  /** node_modules/.package-lock.json, parsed; undefined when it is not there. */
  readonly installed_lock: unknown
  /** The names in one directory of the checkout, or undefined when it is not a directory. */
  readonly namesIn: (directory: string) => readonly string[] | undefined
}

type Packages = Readonly<Record<string, Readonly<Record<string, unknown>>>>

const NOTHING: DependenciesTheRunMaySee = { packages: [], bin_links: [], refusals: [] }

/** The packages a run may see and the links its .bin gets, or every reason the exemption is taken away. */
export function dependenciesTheRunMaySee(judged: DependenciesToJudge): DependenciesTheRunMaySee {
  const whose = whoseLock(judged)
  if (whose !== undefined) return { ...NOTHING, refusals: [whose] }
  const base = packagesOf(judged.base_lock)
  if (base === undefined) return { ...NOTHING, refusals: [`the base ${LOCK} is not lockfileVersion ${LOCKFILE_VERSION} with a packages map`] }
  const installed = packagesOf(judged.installed_lock)
  if (installed === undefined) return { ...NOTHING, refusals: [`${INSTALLED_LOCK} is missing, or not lockfileVersion ${LOCKFILE_VERSION} with a packages map`] }
  const keys = Object.keys(installed)
  const refusals = [...keys.flatMap((key) => entryRefusals(key, installed[key]!, base[key])), ...missingRefusals(base, installed), ...strayRefusals(keys, judged.namesIn)]
  const links = keys.map((key) => binLinksOf(key, base[key]))
  const bin_refusals = links.flatMap((l) => (typeof l === 'string' ? [l] : []))
  return { packages: keys, bin_links: links.flatMap((l) => (typeof l === 'string' ? [] : l)), refusals: [...refusals, ...bin_refusals] }
}

function whoseLock(judged: DependenciesToJudge): string | undefined {
  if (judged.base_blobs.lock === undefined) return `the base has no ${LOCK}`
  if (judged.live_blobs.lock !== judged.base_blobs.lock) return `the live ${LOCK} is not the base's`
  if (judged.live_blobs.manifest !== judged.base_blobs.manifest) return `the live ${MANIFEST} is not the base's`
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function packagesOf(lock: unknown): Packages | undefined {
  if (!isRecord(lock) || lock.lockfileVersion !== LOCKFILE_VERSION || !isRecord(lock.packages)) return undefined
  const entries = Object.entries(lock.packages)
  return entries.every(([, entry]) => isRecord(entry)) ? (lock.packages as Packages) : undefined
}

function entryRefusals(key: string, installed: Readonly<Record<string, unknown>>, base: Readonly<Record<string, unknown>> | undefined): readonly string[] {
  if (!isPackageKey(key)) return [`${INSTALLED_LOCK} names ${key}, which is not a package under ${DEPENDENCIES}`]
  if (base === undefined) return [`${key} is installed and the base ${LOCK} does not pin it`]
  if (isLinkOrBundled(installed) || isLinkOrBundled(base)) return [`${key} is a link or a bundled package`]
  if (typeof installed.integrity !== 'string' || typeof installed.version !== 'string') return [`${key} is installed with no version or integrity`]
  if (installed.version !== base.version || installed.integrity !== base.integrity) return [`${key} is installed at another version or integrity than the base ${LOCK} pins`]
  return []
}

const isLinkOrBundled = (entry: Readonly<Record<string, unknown>>): boolean => entry.link === true || entry.inBundle === true

const isPackageKey = (key: string): boolean => key.startsWith(`${DEPENDENCIES}/`) && posix.normalize(key) === key && !key.split('/').includes('..')

function missingRefusals(base: Packages, installed: Packages): readonly string[] {
  return Object.keys(base)
    .filter((key) => key !== ROOT_ENTRY && installed[key] === undefined && base[key]!.optional !== true)
    .map((key) => `${key} is pinned by the base ${LOCK} and not installed`)
}

/** Every directory at every node_modules level that is not a package directory. */
function strayRefusals(keys: readonly string[], namesIn: (directory: string) => readonly string[] | undefined): readonly string[] {
  const packages = new Set(keys)
  const levels = [DEPENDENCIES, ...keys.map((key) => `${key}/${DEPENDENCIES}`)]
  return levels.flatMap((level) => (namesIn(level) ?? []).filter((name) => !name.startsWith(HIDDEN)).flatMap((name) => strayAt(`${level}/${name}`, name, packages, namesIn)))
}

function strayAt(path: string, name: string, packages: ReadonlySet<string>, namesIn: (directory: string) => readonly string[] | undefined): readonly string[] {
  if (!name.startsWith(SCOPE)) return packages.has(path) ? [] : [`${path} is installed and is not in ${INSTALLED_LOCK}`]
  return (namesIn(path) ?? []).map((child) => `${path}/${child}`).filter((child) => !packages.has(child)).map((child) => `${child} is installed and is not in ${INSTALLED_LOCK}`)
}

/** The .bin links a package's BASE lock entry names, each pointing inside the package, or why one cannot. */
function binLinksOf(key: string, base: Readonly<Record<string, unknown>> | undefined): readonly BinLink[] | string {
  const bin = base?.bin
  if (bin === undefined) return []
  const named = typeof bin === 'string' ? { [posix.basename(key)]: bin } : bin
  if (!isRecord(named)) return `${key} has a bin field that is neither a path nor a map`
  const level = key.slice(0, key.lastIndexOf(`${DEPENDENCIES}/`) + DEPENDENCIES.length)
  const links = Object.entries(named).map(([name, target]) => binLink(key, level, name, target))
  const bad = links.find((link) => typeof link === 'string')
  return typeof bad === 'string' ? bad : (links as BinLink[])
}

function binLink(key: string, level: string, name: string, target: unknown): BinLink | string {
  if (name === '' || name.includes('/') || name.startsWith(HIDDEN)) return `${key} names a bin ${name} that is not a plain name`
  if (typeof target !== 'string') return `${key} names bin ${name} with no path`
  const inside = posix.normalize(posix.join(key, target))
  if (!inside.startsWith(`${key}/`)) return `${key} names bin ${name} pointing outside the package`
  const link = posix.join(level, BIN_DIRECTORY, name)
  return { link, target: inside, points_at: posix.relative(posix.dirname(link), inside) }
}
