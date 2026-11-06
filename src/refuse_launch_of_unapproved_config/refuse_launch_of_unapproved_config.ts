// A checkout cannot get a process started on a member's machine through config
// that the host launches by itself.
//
// A coding tool reads files from the directory it starts in and starts what they
// name: a project's tool servers (.mcp.json, opencode.json), its hooks
// (.claude/settings.json), its plugins (.opencode/). No tool is called and no
// model runs, so the shell gate has nothing to refuse and no sender exists for a
// delivery gate to check. Whoever last wrote those files — the author of a pull
// request a reviewer checks out, the author of a repository a member clones —
// runs code as the owner's OS user. Issue #16 has the threat model.
//
// So the gate stands before the host starts, and asks one question: has the
// owner approved exactly this config? Four rules carry it.
//
//   1. APPROVAL IS BY CONTENT, NEVER BY NAME. The config is fingerprinted: every
//      file the host would read, its content hash, and which of those files are
//      absent. A pull that changes an approved server's command changes the
//      fingerprint and needs a new approval. Claude Code's own approval is a
//      list of server names, which is why it cannot be this control.
//
//   2. THE DIRECTORIES ABOVE COUNT. A config one directory up from the checkout
//      is fingerprinted with it, up to (not including) the directory the
//      launcher names as the stop, the owner's home. What the owner keeps there
//      is the owner's own config, not a checkout's.
//
//   3. WHAT THE GATE CANNOT PIN DOWN IS REFUSED. A symlink can point anywhere, so
//      a fingerprint holding one is refused even when approved, and so is a file
//      that could not be read. A host this module has no file list for is
//      refused whatever is on disk: no list means nothing can be checked, never
//      that nothing needs to be.
//
//   4. NO CONFIG NEEDS NO APPROVAL — BUT ONLY WHEN IT WAS LOOKED FOR. A
//      checkout holding none of the files starts as it does today. A request
//      that does not show every listed file as read is refused: a reader that
//      returned nothing must not pass for a checkout with nothing in it.
//
// The approvals themselves are the owner's, typed in that member's tab and
// logged, which no model can mint (martha#1, decision 4). They are a same-user
// file like the roster, which martha#1 decision 2 accepts for now.

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

/**
 * The files and directories each host reads from a project directory to start
 * something by itself. Each list is what that host was observed to start
 * unasked or to hold for a name-keyed approval (issue #16); a path is added
 * when a host is seen to read it, never on a guess.
 */
export const LAUNCH_FILES_OF_HOST = {
  'claude-code': ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json'],
  opencode: ['opencode.json', 'opencode.jsonc', '.opencode'],
} as const satisfies Record<string, readonly string[]>

export type Host = keyof typeof LAUNCH_FILES_OF_HOST

/**
 * One thing the host would read, as found on disk. `path` is relative to the
 * directory the host starts in and uses `/`, so a config one directory up reads
 * `../.mcp.json`.
 */
export type ConfigEntry =
  | { readonly path: string; readonly kind: 'absent' }
  | { readonly path: string; readonly kind: 'file'; readonly sha256: string }
  | { readonly path: string; readonly kind: 'directory' }
  | { readonly path: string; readonly kind: 'symlink'; readonly target: string }
  | { readonly path: string; readonly kind: 'unreadable'; readonly why: string }

/** What a launcher asks before it starts a host, and before every turn after. */
export interface LaunchRequest {
  /** The host about to start, by its name in LAUNCH_FILES_OF_HOST. */
  readonly host: string
  /** What `readLaunchConfig` found. */
  readonly entries: readonly ConfigEntry[]
  /** The fingerprints the owner has approved. */
  readonly approved_fingerprints: readonly string[]
}

/** A launch gate: may the host start here? */
export type LaunchGate = (request: LaunchRequest) => boolean

export type LaunchDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly refusal: string }

/** The fingerprint the owner approves: one hash over every entry, in path order. */
export function fingerprintOf(entries: readonly ConfigEntry[]): string {
  const ordered = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex')
}

/** Whether this host may start here, and if not, the refusal to show the owner. */
export function decideLaunch({ host, entries, approved_fingerprints }: LaunchRequest): LaunchDecision {
  const refused = 'This coding tool is not started here'

  if (!Object.hasOwn(LAUNCH_FILES_OF_HOST, host)) {
    return { allow: false, refusal: `${refused}: Martha has no list of the files ${host} starts things from, so it cannot check them.` }
  }

  const unpinned = entries.find((entry) => entry.kind === 'symlink' || entry.kind === 'unreadable')
  if (unpinned !== undefined) {
    return {
      allow: false,
      refusal: `${refused}: ${unpinned.path} is ${unpinned.kind === 'symlink' ? 'a symlink' : 'unreadable'}, so its content cannot be approved. Replace it with a plain file.`,
    }
  }

  const names: readonly string[] = LAUNCH_FILES_OF_HOST[host as Host]
  const unread = names.find((name) => !entries.some((entry) => entry.path === name || name.startsWith(`${entry.path}/`)))
  if (unread !== undefined) {
    return { allow: false, refusal: `${refused}: ${unread} was not read, so the config cannot be checked.` }
  }

  if (entries.every((entry) => entry.kind === 'absent')) return { allow: true }

  const fingerprint = fingerprintOf(entries)
  if (approved_fingerprints.includes(fingerprint)) return { allow: true }

  const present = entries.filter((entry) => entry.kind !== 'absent').map((entry) => entry.path)
  return {
    allow: false,
    refusal: `${refused}: the checkout holds config that starts code by itself (${present.join(', ')}), and the owner has not approved this content. Read it, then approve fingerprint ${fingerprint} in this member's tab.`,
  }
}

/** The launch gate the registry names. */
export const admitsLaunch: LaunchGate = (request) => decideLaunch(request).allow

/**
 * Every file the host would read to start something, from the directory it
 * starts in and each directory above it, up to but not including `stop_dir`.
 * A start outside `stop_dir` is read all the way up to the filesystem root.
 * A host with no file list reads nothing, and `decideLaunch` refuses it.
 */
export function readLaunchConfig({
  host,
  launch_dir,
  stop_dir,
}: {
  readonly host: string
  readonly launch_dir: string
  readonly stop_dir: string
}): readonly ConfigEntry[] {
  if (!Object.hasOwn(LAUNCH_FILES_OF_HOST, host)) return []
  const names: readonly string[] = LAUNCH_FILES_OF_HOST[host as Host]

  const start = resolve(launch_dir)
  const found = directoriesUpFrom(start, resolve(stop_dir)).flatMap((dir) =>
    names.flatMap((name) => entriesAt(start, dir, name)),
  )
  // Two listed names share a parent (.claude/…): a parent that is not a
  // directory is reported once.
  return found.filter((entry, index) => found.findIndex((other) => other.path === entry.path) === index)
}

/** The start, then each directory above it, stopping below `stop` or at the root. */
function directoriesUpFrom(start: string, stop: string): readonly string[] {
  const dirs: string[] = [start]
  if (start === stop) return dirs
  for (let dir = dirname(start); dir !== stop && dir !== dirs[dirs.length - 1]; dir = dirname(dir)) {
    dirs.push(dir)
  }
  return dirs
}

/** The entries for one listed name in one directory, checking every component. */
function entriesAt(start: string, dir: string, name: string): readonly ConfigEntry[] {
  const parts = name.split('/')
  for (let depth = 1; depth < parts.length; depth++) {
    const parent = entryOf(start, join(dir, ...parts.slice(0, depth)))
    if (parent.kind === 'absent') return [{ path: pathFrom(start, join(dir, name)), kind: 'absent' }]
    if (parent.kind !== 'directory') return [parent]
  }
  return walk(start, join(dir, name))
}

/** One path, and everything under it when it is a directory. */
function walk(start: string, path: string): readonly ConfigEntry[] {
  const entry = entryOf(start, path)
  if (entry.kind !== 'directory') return [entry]

  let children: string[]
  try {
    children = readdirSync(path).sort()
  } catch (error) {
    return [{ path: entry.path, kind: 'unreadable', why: codeOf(error) }]
  }
  return [entry, ...children.flatMap((child) => walk(start, join(path, child)))]
}

function entryOf(start: string, path: string): ConfigEntry {
  const at = pathFrom(start, path)
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return { path: at, kind: 'symlink', target: readlinkSync(path) }
    if (stat.isDirectory()) return { path: at, kind: 'directory' }
    if (!stat.isFile()) return { path: at, kind: 'unreadable', why: 'not a regular file' }
    return { path: at, kind: 'file', sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
  } catch (error) {
    const code = codeOf(error)
    return code === 'ENOENT' ? { path: at, kind: 'absent' } : { path: at, kind: 'unreadable', why: code }
  }
}

function pathFrom(start: string, path: string): string {
  return relative(start, path).split(sep).join('/')
}

function codeOf(error: unknown): string {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : String(error)
}
