// The live checkout, read once (martha#129, design steps 3.2, 5 and 6): every path git would see, and the
// installed dependencies, as entries and bytes. The run directory is written from these same bytes, so the check
// and the run work on one object, and a file swapped in the checkout mid-run cannot reach the run.
//
// git lists the paths (tracked, plus untracked and unignored) with no global or system config, no inherited GIT_
// variable and fsmonitor off, the one setting that would make it start a program. The checkout's own index and
// ignore rules are read, which can only hide a file from the run, never admit one: every listed file is still
// judged against the base and the own writes. Each path is `lstat`ed under the checkout's real top: a path whose
// directory resolves elsewhere (a directory swapped for a link) or that is not a regular file is not a regular
// file here, and the tree rule refuses it. A path that is gone is a deletion.
//
// A regular file's blob here is the one git gives its bytes with no filter applied, computed in this process. That is
// exact and needs no program: when it matches an object the tree already holds, the file is that object whatever any
// git configuration says. Only a file that matches nothing is asked of git, and then in the launcher's own repository
// with the attributes the base commit sets (../signed_base, normalise), never in the checkout, whose config and
// attributes a member may write (martha#132, #129 r=4).

import { spawnSync } from 'node:child_process'
import { lstatSync, readdirSync, readFileSync, realpathSync, type Stats } from 'node:fs'
import { dirname, join, sep } from 'node:path'

import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { rawBlobOf, type GitObjectFormat } from '../hash_a_file_under_a_tree/hash_a_file_under_a_tree.ts'
import { DEPENDENCIES, INSTALLED_LOCK } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import type { LiveEntry } from '../keep_the_shell_for_an_owner_signed_command/whose_tree.ts'
import { OWN_WRITE_MODES } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'

const [REGULAR_MODE, EXECUTABLE_MODE] = OWN_WRITE_MODES
const ANY_EXECUTE_BIT = 0o111
const RECORD = '\u0000'
const NULL_CONFIG = '/dev/null'

/** The live checkout as the run may see it: an entry per path, and the bytes of every regular file read. */
export interface CheckoutRead {
  readonly live: readonly LiveEntry[]
  readonly bytes: ReadonlyMap<string, Buffer>
}

/** Every path git sees in the checkout, or why git could not list them. */
function pathsGitSees(top: string, inherited: Readonly<Record<string, string | undefined>>): readonly string[] | string {
  const env = { PATH: inherited['PATH'] ?? '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_CONFIG }
  const run = spawnSync('git', marthasOwnGitArgs(['-C', top, 'ls-files', '-z', '--cached', '--others', '--exclude-standard']), { env, maxBuffer: Number.MAX_SAFE_INTEGER })
  if (run.status !== 0) return `git cannot list the checkout (${run.stderr?.toString('utf8').trim() ?? String(run.error)})`
  return [...new Set(run.stdout.toString('utf8').split(RECORD).filter((path) => path !== ''))]
}

/** The id git gives `bytes` with no filter applied, in the checkout's object format: exact, and no program runs. */
/** Whether `path`'s directory, resolved, is where it is named under `top`: no component is a link out. */
function staysUnder(top: string, path: string): boolean {
  try {
    return realpathSync(join(top, dirname(path))) === join(top, dirname(path))
  } catch {
    return false
  }
}

/** One path as it stands on disk: a regular file with its bytes and mode, something else, or gone. */
type OnDisk = { readonly kind: 'file'; readonly mode: string; readonly bytes: Buffer } | { readonly kind: 'other' } | { readonly kind: 'gone' }

function readOne(top: string, path: string): OnDisk {
  if (!staysUnder(top, path)) return { kind: 'other' }
  const status = lstatOrGone(join(top, path))
  if (status === undefined) return { kind: 'gone' }
  if (!status.isFile()) return { kind: 'other' }
  const mode = (status.mode & ANY_EXECUTE_BIT) === 0 ? REGULAR_MODE : EXECUTABLE_MODE
  return { kind: 'file', mode, bytes: readFileSync(join(top, path)) }
}

function lstatOrGone(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return undefined
    throw error
  }
}

/** One path of the live tree as the read holds it: its entry, and the bytes when it is a regular file. */
type ReadEntry = { readonly entry: LiveEntry; readonly bytes?: Buffer }

/** Read every path git sees in the checkout at `top` once; or why it cannot be read. */
export function readTheCheckoutOnce(top: string, format: GitObjectFormat, inherited: Readonly<Record<string, string | undefined>>): CheckoutRead | string {
  const real = realpathSync(top)
  const paths = pathsGitSees(real, inherited)
  if (typeof paths === 'string') return paths
  const entries: ReadEntry[] = []
  for (const path of paths) {
    const one = readOne(real, path)
    if (one.kind === 'gone') continue
    if (one.kind === 'other') {
      entries.push({ entry: { path, regular: false } })
      continue
    }
    entries.push({ entry: { path, regular: true, mode: one.mode, blob: rawBlobOf(one.bytes, format) }, bytes: one.bytes })
  }
  return {
    live: entries.map((one) => one.entry),
    bytes: new Map(entries.flatMap((one) => (one.bytes === undefined ? [] : [[one.entry.path, one.bytes] as const]))),
  }
}

/** The names in one directory under `top`, or undefined when it is not a directory reached without a link. */
export function namesUnder(top: string): (directory: string) => readonly string[] | undefined {
  const real = realpathSync(top)
  return (directory) => {
    if (!staysUnder(real, join(directory, 'x'))) return undefined
    const status = lstatOrGone(join(real, directory))
    return status?.isDirectory() === true ? readdirSync(join(real, directory)) : undefined
  }
}

/** node_modules/.package-lock.json parsed, undefined when it is missing or not JSON. */
export function installedLockOf(top: string): unknown {
  const path = join(realpathSync(top), INSTALLED_LOCK)
  const status = lstatOrGone(path)
  if (status?.isFile() !== true || !staysUnder(realpathSync(top), INSTALLED_LOCK)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

/** One file of a package directory, read once. */
export interface PackageFile {
  readonly path: string
  readonly executable: boolean
  readonly bytes: Buffer
}

/** Every file in one package directory, its nested node_modules left out; or why a part of it is not a plain file or directory. */
export function readPackageOnce(top: string, key: string): readonly PackageFile[] | string {
  const real = realpathSync(top)
  if (!staysUnder(real, join(key, 'x'))) return `${key} is reached through a link`
  return walk(real, key)
}

function walk(top: string, directory: string): readonly PackageFile[] | string {
  const files: PackageFile[] = []
  for (const name of readdirSync(join(top, directory))) {
    const path = `${directory}/${name}`
    if (name === DEPENDENCIES) continue
    const read = readEntry(top, path)
    if (typeof read === 'string') return read
    files.push(...read)
  }
  return files
}

function readEntry(top: string, path: string): readonly PackageFile[] | string {
  const status = lstatSync(join(top, path))
  if (status.isDirectory()) return walk(top, path)
  if (!status.isFile()) return `${path.split(sep).join('/')} is neither a file nor a directory`
  return [{ path, executable: (status.mode & ANY_EXECUTE_BIT) !== 0, bytes: readFileSync(join(top, path)) }]
}
