// A checkout cannot get a process started on a member's machine through config
// that the host launches by itself.
//
// A coding tool reads files from the directory it starts in and starts what they
// name: a project's tool servers, its hooks, its plugins. No tool is called and
// no model runs, so the shell gate has nothing to refuse and no sender exists for
// a delivery gate to check. Whoever last wrote those files — the author of a pull
// request a reviewer checks out, the author of a repository a member clones —
// runs code as the owner's OS user. Issue #16 has the threat model.
//
// So the gate stands before the host starts. Five rules carry it.
//
//   1. THE HOST NEVER READS THE CHECKOUT'S OWN CONFIG. Martha starts it with
//      project config switched off and passes the approved copy by path, from a
//      snapshot outside the checkout (`prepareLaunch`). A pull that rewrites the
//      config while the host runs changes a file the host is not reading, so a
//      host that reloads its config live reloads the snapshot. Both switches and
//      both carriers were seen to work on each host (`npm run probe:launch`).
//
//   2. APPROVAL IS BY CONTENT, NEVER BY NAME, AND COVERS WHAT THE CONFIG RUNS.
//      The fingerprint holds every listed file's content hash, which of them are
//      absent, and the checkout's work tree (./checkout_tree.ts): a pull that
//      changes only the script an approved hook runs changes the fingerprint.
//      Claude Code's own approval is a list of server names, which is why it
//      cannot be this control.
//
//   3. THE DIRECTORIES ABOVE COUNT. A config above the checkout is fingerprinted
//      with it, up to (not including) the directory the launcher names as the
//      stop, the owner's home. This is for a host started by hand, which walks up
//      (OpenCode with no stop at all); a planned launch reads none of them.
//
//   4. WHAT THE GATE CANNOT PIN DOWN IS REFUSED: a symlink, even an approved one;
//      a path that is not a plain file or directory; config in a directory that
//      is no git checkout, or in one whose top is the owner's home or above it,
//      where nothing pins what it runs; a request that does
//      not show every listed file as read; and a host with no entry here.
//
//   5. NO CONFIG NEEDS NO APPROVAL. A checkout holding none of the files starts
//      — still with project config off.
//
// The approvals are the owner's, typed in that member's tab and logged, which no
// model can mint (martha#1, decision 4). They are a same-user file like the
// roster, which martha#1 decision 2 accepts for now.
//
// The gate reaches the machine only through the host contract (martha#26): it
// reads files through `stores.files`, writes snapshots into `stores.scratch` and
// runs git through `processes.runNow` (./checkout_tree.ts). Every reader takes
// the host it reads through.

import { createHash } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'

import { readCheckoutTree, realOrResolved, type LaunchHost } from './checkout_tree.ts'

export type { LaunchHost }

/** What a launcher changes when it starts a host: arguments and environment it adds, and inherited variables it drops. */
export interface HostSwitches {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  /** Inherited variables that would bring config back in; the launcher removes them. */
  readonly env_dropped: readonly string[]
}

/**
 * The environment to start the host with: `inherited` without the dropped
 * variables, with the switches' own on top, so no inherited value can switch
 * project config back on.
 */
export function launchEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  switches: HostSwitches,
): Record<string, string> {
  const kept = Object.entries(inherited).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !switches.env_dropped.includes(entry[0]),
  )
  return { ...Object.fromEntries(kept), ...switches.env }
}

/**
 * The files and directories each host reads from a project directory to start
 * something by itself. Each is one the host was seen to start something from
 * (issue #16), never a guess.
 */
export const LAUNCH_FILES_OF_HOST = {
  // The last one Claude Code writes itself: a member's own permission answers.
  'claude-code': ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json'],
  // The last one holds a checkout's plugins and their installed packages.
  opencode: ['opencode.json', 'opencode.jsonc', '.opencode'],
} as const

export type Host = keyof typeof LAUNCH_FILES_OF_HOST

/** What Martha knows about starting one host on approved config. */
export interface HostLaunch {
  /** What keeps the host from reading the checkout's own config. */
  readonly project_config_off: HostSwitches
  /** How the approved copy of a listed file is passed. A file not named here is never carried. */
  readonly carried: Readonly<Record<string, (path: string) => HostSwitches>>
}

const NO_ENV: Readonly<Record<string, string>> = {}
const NO_ARGS: readonly string[] = []
const NOTHING_DROPPED: readonly string[] = []

/**
 * OpenCode 2.2.5 reads the first of these that is set, so both are set: an
 * inherited OPENCODE_CONFIG_PROJECT_DISABLE=0 would otherwise win over the
 * fallback name.
 */
const OPENCODE_PROJECT_CONFIG_OFF = ['OPENCODE_CONFIG_PROJECT_DISABLE', 'OPENCODE_DISABLE_PROJECT_CONFIG'] as const
/** Each brings config in that is no listed file: inline content, and a whole config directory. */
const OPENCODE_CONFIG_ELSEWHERE = ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR'] as const

export const [CLAUDE_SERVERS, CLAUDE_SETTINGS] = LAUNCH_FILES_OF_HOST['claude-code']
const [OPENCODE_CONFIG, OPENCODE_CONFIG_WITH_COMMENTS] = LAUNCH_FILES_OF_HOST.opencode

export const HOSTS: Readonly<Record<Host, HostLaunch>> = {
  'claude-code': {
    // --strict-mcp-config: only the servers passed by --mcp-config start.
    project_config_off: { args: ['--setting-sources', 'user', '--strict-mcp-config'], env: NO_ENV, env_dropped: NOTHING_DROPPED },
    carried: {
      [CLAUDE_SERVERS]: (path) => ({ args: ['--mcp-config', path], env: NO_ENV, env_dropped: NOTHING_DROPPED }),
      [CLAUDE_SETTINGS]: (path) => ({ args: ['--settings', path], env: NO_ENV, env_dropped: NOTHING_DROPPED }),
    },
  },
  opencode: {
    // The background service ignores a client's environment, so the host runs
    // its own server.
    project_config_off: {
      args: ['--standalone'],
      env: Object.fromEntries(OPENCODE_PROJECT_CONFIG_OFF.map((name) => [name, '1'])),
      env_dropped: OPENCODE_CONFIG_ELSEWHERE,
    },
    carried: {
      [OPENCODE_CONFIG]: (path) => ({ args: NO_ARGS, env: { OPENCODE_CONFIG: path }, env_dropped: NOTHING_DROPPED }),
      [OPENCODE_CONFIG_WITH_COMMENTS]: (path) => ({ args: NO_ARGS, env: { OPENCODE_CONFIG: path }, env_dropped: NOTHING_DROPPED }),
    },
  },
}

/** A directory a host keeps installed packages in; its presence counts, its contents do not. */
const INSTALLED_PACKAGES = 'node_modules'

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

/** Everything an approval binds: the config, and the work tree the config runs. */
export interface LaunchState {
  readonly entries: readonly ConfigEntry[]
  /** The checkout's work tree (./checkout_tree.ts), or `null` outside any checkout below the stop. */
  readonly tree: string | null
}

/** What a launcher asks before it starts a host, and what every tool call asks after (../answer_a_tool_call). */
export interface LaunchRequest extends LaunchState {
  /** The host about to start, by its name in HOSTS. */
  readonly host: string
  /** The fingerprints the owner has approved. */
  readonly approved_fingerprints: readonly string[]
}

/** A launch gate: may the host start here? */
export type LaunchGate = (request: LaunchRequest) => boolean

export type LaunchDecision =
  | { readonly allow: true }
  | { readonly allow: false; readonly refusal: string }

/** The fingerprint the owner approves: one hash over every entry, in path order, and the tree. */
export function fingerprintOf({ entries, tree }: LaunchState): string {
  const ordered = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return createHash('sha256').update(JSON.stringify({ entries: ordered, tree })).digest('hex')
}

const REFUSED = 'This coding tool is not started here'

/** Whether this host may start here, and if not, the refusal to show the owner. */
export function decideLaunch({ host, entries, tree, approved_fingerprints }: LaunchRequest): LaunchDecision {
  if (!Object.hasOwn(HOSTS, host)) {
    return { allow: false, refusal: `${REFUSED}: Martha does not know which files ${host} starts things from, so it cannot check them.` }
  }

  const unpinned = entries.find((entry) => entry.kind === 'symlink' || entry.kind === 'unreadable')
  if (unpinned !== undefined) {
    return {
      allow: false,
      refusal: `${REFUSED}: ${unpinned.path} is ${unpinned.kind === 'symlink' ? 'a symlink' : 'unreadable'}, so its content cannot be approved. Replace it with a plain file.`,
    }
  }

  const names: readonly string[] = LAUNCH_FILES_OF_HOST[host as Host]
  const unread = names.find(
    (name) => !entries.some((entry) => entry.path === name || name.startsWith(`${entry.path}/`)),
  )
  if (unread !== undefined) {
    return { allow: false, refusal: `${REFUSED}: ${unread} was not read, so the config cannot be checked.` }
  }

  if (entries.every((entry) => entry.kind === 'absent')) return { allow: true }

  const present = entries.filter((entry) => entry.kind !== 'absent').map((entry) => entry.path)

  if (tree === null) {
    return {
      allow: false,
      refusal: `${REFUSED}: it holds config that starts code by itself (${present.join(', ')}) outside any git checkout below the owner's home, so nothing pins what that config runs.`,
    }
  }

  const fingerprint = fingerprintOf({ entries, tree })
  if (approved_fingerprints.includes(fingerprint)) return { allow: true }

  return {
    allow: false,
    refusal: `${REFUSED}: the checkout holds config that starts code by itself (${present.join(', ')}), and the owner has not approved this config with this checkout's files. Read them, then approve fingerprint ${fingerprint} in this member's tab.`,
  }
}

/** Where a member was started and what the owner approved there, as `prepareLaunch` was given it. */
export interface ApprovedLaunch extends LaunchPlace {
  readonly approved_fingerprints: readonly string[]
}

/**
 * The launch, checked again on a running member: before every tool call
 * (../answer_a_tool_call) and after it. The approved hooks and servers run
 * scripts from the live checkout, so a call that changes the tree is refused
 * from then on. On a refusal after a call, the hook asking does not return
 * until the launcher has sent SIGKILL to the member's whole process group: a
 * hook that returned would let the host fire its Stop hook, and a SIGTERM or a
 * normal exit fires SessionEnd (npm run probe:launch).
 */
export function recheckLaunch(launch: ApprovedLaunch, host: LaunchHost): LaunchDecision {
  return decideLaunch({ ...readLaunchState(launch, host), host: launch.host, approved_fingerprints: launch.approved_fingerprints })
}

/** The launch gate the registry names. */
export const admitsLaunch: LaunchGate = (request) => decideLaunch(request).allow

/** Where the host starts, where the walk up stops, and the host. */
export interface LaunchPlace {
  readonly host: string
  readonly launch_dir: string
  /** Not read, nor anything above it: the owner's home. */
  readonly stop_dir: string
}

/**
 * Every file the host would read to start something, from the directory it
 * starts in and each directory above it, up to but not including `stop_dir`.
 * Both are resolved through symlinks first. A start outside `stop_dir` is read
 * all the way up to the filesystem root. A host with no entry reads nothing.
 */
export function readLaunchConfig({ host, launch_dir, stop_dir }: LaunchPlace, machine: LaunchHost): readonly ConfigEntry[] {
  if (!Object.hasOwn(HOSTS, host)) return []
  const names: readonly string[] = LAUNCH_FILES_OF_HOST[host as Host]

  const start = realOrResolved(machine, launch_dir)
  const found = directoriesUpFrom(start, realOrResolved(machine, stop_dir)).flatMap((dir) =>
    names.flatMap((name) => entriesAt(machine, start, dir, name)),
  )
  // Two listed names share a parent (.claude/…): a parent that is not a
  // directory is reported once.
  return found.filter((entry, index) => found.findIndex((other) => other.path === entry.path) === index)
}

/** The config and the work tree, as the gate reads them. */
export function readLaunchState(place: LaunchPlace, machine: LaunchHost): LaunchState {
  return {
    entries: readLaunchConfig(place, machine),
    tree: readCheckoutTree(realOrResolved(machine, place.launch_dir), place.stop_dir, machine),
  }
}

export type PreparedLaunch =
  | {
      readonly allow: true
      /** Add these to the host's command line, and start it with `launchEnvironment(process.env, switches)`. */
      readonly switches: HostSwitches
      /** Where the approved copies are. The launcher removes it when the member stops. */
      readonly snapshot_dir: string
      /** Files the checkout holds that this launch does not load, to tell the owner. */
      readonly not_carried: readonly string[]
      /** The approved bytes of each carried file, by its listed name: what the host reads, hashed as approved. */
      readonly carried_files: Readonly<Record<string, Uint8Array>>
    }
  | { readonly allow: false; readonly refusal: string }

/**
 * Decide, and on a yes, copy the approved config out of the checkout into a new
 * directory under `snapshot_root` and return the switches that start the host on
 * that copy with its own project config off.
 *
 * Each copied file is hashed again as it is copied and must match what was
 * approved, so a file rewritten between the decision and the copy is refused
 * rather than carried.
 */
export function prepareLaunch(place: SnapshotPlace, machine: LaunchHost): PreparedLaunch {
  return snapshotApproved(place, readLaunchState(place, machine), machine)
}

/** A launch place, where its snapshots go, and what the owner approved. */
export type SnapshotPlace = LaunchPlace & {
  readonly snapshot_root: string
  readonly approved_fingerprints: readonly string[]
}

/**
 * The second half of `prepareLaunch`: decide on `state`, as read a moment ago,
 * and copy what it approved. Every byte copied must hash to `state`, so a file
 * rewritten after `state` was read is refused, and no snapshot is left behind
 * on any refusal.
 */
export function snapshotApproved(place: SnapshotPlace, state: LaunchState, machine: LaunchHost): PreparedLaunch {
  const decision = decideLaunch({ host: place.host, ...state, approved_fingerprints: place.approved_fingerprints })
  if (!decision.allow) return decision

  const launch = HOSTS[place.host as Host]
  const start = realOrResolved(machine, place.launch_dir)
  const snapshot = machine.stores.scratch.make(place.snapshot_root, 'launch-')
  const snapshot_dir = snapshot.path

  const carried: HostSwitches[] = [launch.project_config_off]
  const carried_files: Record<string, Uint8Array> = {}
  const not_carried: string[] = []

  for (const entry of state.entries) {
    if (entry.kind === 'absent') continue
    const carry = Object.hasOwn(launch.carried, entry.path) ? launch.carried[entry.path] : undefined
    if (carry === undefined || entry.kind !== 'file') {
      if (!not_carried.some((path) => entry.path.startsWith(`${path}/`))) not_carried.push(entry.path)
      continue
    }

    const content = machine.stores.files.bytesOf(join(start, entry.path))
    if (createHash('sha256').update(content).digest('hex') !== entry.sha256) {
      snapshot.remove()
      return { allow: false, refusal: `${REFUSED}: ${entry.path} changed while it was being approved. Start again.` }
    }
    carried.push(carry(snapshot.write(entry.path, content)))
    carried_files[entry.path] = content
  }

  const env: Record<string, string> = {}
  for (const switches of carried) {
    for (const [name, value] of Object.entries(switches.env)) {
      if (Object.hasOwn(env, name)) {
        snapshot.remove()
        return { allow: false, refusal: `${REFUSED}: two of its config files would be passed through ${name}, which carries one. Keep one.` }
      }
      env[name] = value
    }
  }

  return {
    allow: true,
    switches: {
      args: carried.flatMap((switches) => switches.args),
      env,
      env_dropped: carried.flatMap((switches) => switches.env_dropped),
    },
    snapshot_dir,
    carried_files,
    not_carried,
  }
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
function entriesAt(machine: LaunchHost, start: string, dir: string, name: string): readonly ConfigEntry[] {
  const parts = name.split('/')
  for (let depth = 1; depth < parts.length; depth++) {
    const parent = entryOf(machine, start, join(dir, ...parts.slice(0, depth)))
    if (parent.kind === 'absent') return [{ path: pathFrom(start, join(dir, name)), kind: 'absent' }]
    if (parent.kind !== 'directory') return [parent]
  }
  return walk(machine, start, join(dir, name))
}

/** One path, and everything under it when it is a directory other than installed packages. */
function walk(machine: LaunchHost, start: string, path: string): readonly ConfigEntry[] {
  const entry = entryOf(machine, start, path)
  if (entry.kind !== 'directory') return [entry]
  if (path.split(sep).at(-1) === INSTALLED_PACKAGES) return [entry]

  let children: string[]
  try {
    children = [...machine.stores.files.childrenOf(path)].sort()
  } catch (error) {
    return [{ path: entry.path, kind: 'unreadable', why: codeOf(error) }]
  }
  return [entry, ...children.flatMap((child) => walk(machine, start, join(path, child)))]
}

function entryOf(machine: LaunchHost, start: string, path: string): ConfigEntry {
  const at = pathFrom(start, path)
  const files = machine.stores.files
  try {
    const found = files.kindOf(path)
    if (found.kind === 'absent') return { path: at, kind: 'absent' }
    if (found.kind === 'symlink') return { path: at, kind: 'symlink', target: found.target }
    if (found.kind === 'directory') return { path: at, kind: 'directory' }
    if (found.kind === 'other') return { path: at, kind: 'unreadable', why: 'not a regular file' }
    return { path: at, kind: 'file', sha256: createHash('sha256').update(files.bytesOf(path)).digest('hex') }
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
