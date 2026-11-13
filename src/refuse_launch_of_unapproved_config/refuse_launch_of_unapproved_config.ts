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
// The approvals are the owner's, given with `martha approve` at their own
// terminal and logged, which no model can mint (martha#1, decision 4). They are a same-user file like the
// roster, which martha#1 decision 2 accepts for now.
//
// The gate reaches the machine only through the host contract (martha#26): it
// reads files through `stores.files`, writes snapshots into `stores.scratch` and
// runs git through `processes.runNow` (./checkout_tree.ts). Every reader takes
// the host it reads through.

import { createHash } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'

import { readCheckoutTree, realOrResolved, type LaunchHost, type TreeChange } from './checkout_tree.ts'
import type { OwnWritesStore } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'

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

/**
 * Claude Code 2.1 reads this from its own environment and starts every tool
 * server as `<prefix> "<command>"`: the prefix runs first, so it would decide
 * what a server is, whatever the approved config says (martha#65 r=3).
 */
const CLAUDE_COMMAND_ELSEWHERE = ['CLAUDE_CODE_SHELL_PREFIX'] as const

/**
 * Turns Claude Code's auto-memory off: the host then loads no memory folder into
 * a member's session and runs no memory pass of its own in file mode. Set by the
 * launcher, so an inherited 0, which beats a settings file's off, never reaches
 * the member (martha#136; Claude Code 2.1.318 and 2.1.319, measured).
 */
export const CLAUDE_MEMORY_OFF: Readonly<Record<string, string>> = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }

/**
 * Each moves Claude Code's memory, or writes it on a path the off switch does
 * not hold, so none reaches a member (martha#136 r=2): the hosted ("mcp") mode
 * of the memory pass, which skips the off switch; team memory sync; and the two
 * folders that override where memory lives, which would move a member's memory
 * out of the folders the publish gate denies.
 */
export const CLAUDE_MEMORY_ELSEWHERE = [
  'CLAUDE_CODE_POST_TURN_MEMORY',
  'CLAUDE_MEMORY_STORES',
  'CLAUDE_COWORK_MEMORY_PATH_OVERRIDE',
  'CLAUDE_CODE_REMOTE_MEMORY_DIR',
] as const

export const [CLAUDE_SERVERS, CLAUDE_SETTINGS] = LAUNCH_FILES_OF_HOST['claude-code']
const [OPENCODE_CONFIG, OPENCODE_CONFIG_WITH_COMMENTS] = LAUNCH_FILES_OF_HOST.opencode

/** The switches that hand Claude Code a settings file: the carried copy, or the one a launch writes (martha#136). */
export const claudeSettingsSwitches = (path: string): HostSwitches => ({ args: ['--settings', path], env: NO_ENV, env_dropped: NOTHING_DROPPED })

export const HOSTS: Readonly<Record<Host, HostLaunch>> = {
  'claude-code': {
    // --strict-mcp-config: only the servers passed by --mcp-config start.
    project_config_off: {
      args: ['--setting-sources', 'user', '--strict-mcp-config'],
      env: CLAUDE_MEMORY_OFF,
      env_dropped: [...CLAUDE_COMMAND_ELSEWHERE, ...CLAUDE_MEMORY_ELSEWHERE],
    },
    carried: {
      [CLAUDE_SERVERS]: (path) => ({ args: ['--mcp-config', path], env: NO_ENV, env_dropped: NOTHING_DROPPED }),
      [CLAUDE_SETTINGS]: claudeSettingsSwitches,
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
 * What a launch started the host with, down to the names a host's declaration lists (martha#135): its arguments,
 * and for each name under `env` or `env_dropped`, the value it was started with, or `null` when it was not there at
 * all. No other name is kept, so the owner's keys and tokens never reach Martha's state, a record or a log.
 */
export interface StartedWith {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string | null>>
}

/**
 * Reads the arguments and environment a host is spawned with down to what `switches` names (martha#135); a start with
 * no declaration to measure against keeps only its arguments. This is what the launcher records beside the start
 * tree, so the read exemption can ask what really started the host rather than what was meant to.
 */
export function startedWithOf(
  switches: HostSwitches | undefined,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): StartedWith {
  const names = switches === undefined ? [] : [...new Set([...Object.keys(switches.env), ...switches.env_dropped])]
  return { args: [...args], env: Object.fromEntries(names.map((name) => [name, env[name] ?? null])) }
}

/**
 * True when a launch really started the host with `switches` (martha#135): every declared argument sequence appears in
 * its arguments as one unbroken run, every declared environment value is the declared one, every dropped name is
 * absent, and no name outside the declaration was kept. A host whose adapter declares no switches holds none.
 *
 * It reads the arguments, it does not read the host's mind. The owner's own arguments go before Martha's (a launch's
 * `args`), so an owner argument that takes a value and ends them would have the first declared switch read as its
 * value; that is the owner's own path, on the owner's terminal, not a member's.
 */
export function startedWithTheSwitches(started_with: StartedWith | undefined, switches: HostSwitches | undefined): boolean {
  if (started_with === undefined || switches === undefined) return false
  const declared = new Set([...Object.keys(switches.env), ...switches.env_dropped])
  if (!Object.keys(started_with.env).every((name) => declared.has(name))) return false
  if (!appearsAsOneRun(started_with.args, switches.args)) return false
  const values = Object.entries(switches.env).every(([name, value]) => started_with.env[name] === value)
  return values && switches.env_dropped.every((name) => started_with.env[name] === null)
}

/** True when `run` appears in `args` as one unbroken run, in order. */
function appearsAsOneRun(args: readonly string[], run: readonly string[]): boolean {
  return args.some((_, at) => run.every((arg, offset) => args[at + offset] === arg))
}

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
  /**
   * Set when the work tree could not be read at all, or was read and is not the tree the owner approved: the words to
   * show the owner. A launch with a refusal never passes, whatever any fingerprint says (martha#167).
   */
  readonly refusal?: string
  /** True when the refusal is that the tree the owner approved can no longer be read from the checkout. */
  readonly the_approved_tree_is_gone?: true
  /**
   * Every path that differs between the tree the checkout was read under and the live one, as the launcher's own read
   * computed them. Empty when they are the same tree.
   */
  readonly changes?: readonly TreeChange[]
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
export function decideLaunch({ host, entries, tree, approved_fingerprints, refusal }: LaunchRequest): LaunchDecision {
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

  // No config needs no approval (rule 5), and a checkout it does not ask about cannot refuse it: nothing approved is
  // at risk there. Every other launch must have read the tree it would run.
  if (entries.every((entry) => entry.kind === 'absent')) return { allow: true }

  if (refusal !== undefined) return { allow: false, refusal }

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
    refusal: `${REFUSED}: the checkout holds config that starts code by itself (${present.join(', ')}), and the owner has not approved this config with this checkout's files (fingerprint ${fingerprint}). Run martha approve, read what it shows, and answer yes.`,
  }
}

/** What a member started on an approval checks its own writes against (./pass_a_members_own_writes.ts, martha#132). */
export interface SinceApproval {
  /** The config and the tree the owner approved, as the member was started on them. */
  readonly approved: LaunchState
  /** The member's name, so a stop says which member to start again. */
  readonly member: string
  /** Where the member's own writes are kept: the host's store, handed in by the adapter that starts it. */
  readonly own_writes: OwnWritesStore
  /** This launch, as its own writes name it. */
  readonly launch_id: string
}

/** Where a member was started and what the owner approved there, as `prepareLaunch` was given it. */
export interface ApprovedLaunch extends LaunchPlace {
  readonly approved_fingerprints: readonly string[]
  /** Set when the member was started on an owner's approval: its own writes then pass the recheck. */
  readonly since_approval?: SinceApproval
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
  return decideLaunch({ ...readLaunchState(launch, host, launch.approved_tree), host: launch.host, approved_fingerprints: launch.approved_fingerprints })
}

/** The launch gate the registry names. */
export const admitsLaunch: LaunchGate = (request) => decideLaunch(request).allow

/** Where the host starts, where the walk up stops, and the host. */
export interface LaunchPlace {
  readonly host: string
  readonly launch_dir: string
  /** Not read, nor anything above it: the owner's home. */
  readonly stop_dir: string
  /**
   * The tree the owner approved, whose attributes the checkout is read under (martha#167). Omitted, the checkout's
   * own HEAD tree is used: the attributes an approval is first read against, before there is an approval.
   */
  readonly approved_tree?: string
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
export function readLaunchState(place: LaunchPlace, machine: LaunchHost, approved_tree?: string): LaunchState {
  const read = readCheckoutTree(realOrResolved(machine, place.launch_dir), place.stop_dir, machine, approved_tree ?? place.approved_tree)
  return {
    entries: readLaunchConfig(place, machine),
    tree: read.kind === 'tree' ? read.tree : null,
    ...(read.kind === 'refused' ? { refusal: read.refusal } : {}),
    ...(read.kind === 'refused' && read.the_approved_tree === true ? { the_approved_tree_is_gone: true as const } : {}),
    ...(read.kind === 'tree' && read.changes !== undefined ? { changes: read.changes } : {}),
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
  return snapshotApproved(place, readLaunchState(place, machine, place.approved_tree), machine)
}

/** A launch place, where its snapshots go, and what the owner approved. */
export type SnapshotPlace = LaunchPlace & {
  readonly snapshot_root: string
  readonly approved_fingerprints: readonly string[]
  /** Set when the member is started on an owner's approval: its own writes then pass the recheck (martha#132). */
  readonly since_approval?: SinceApproval
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

  const carrying: Carrying = { carried: [launch.project_config_off], carried_files: {}, not_carried: [] }
  const changed = carryApproved(state.entries, { launch, start, snapshot, machine }, carrying)
  if (changed !== undefined) {
    snapshot.remove()
    return { allow: false, refusal: `${REFUSED}: ${changed} changed while it was being approved. Start again.` }
  }

  const env = envOf(carrying.carried)
  if (typeof env === 'string') {
    snapshot.remove()
    return { allow: false, refusal: `${REFUSED}: two of its config files would be passed through ${env}, which carries one. Keep one.` }
  }

  const { carried, carried_files, not_carried } = carrying
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

/** What `snapshotApproved` gathers as it copies: the switches, the copied bytes, and what it left behind. */
interface Carrying {
  readonly carried: HostSwitches[]
  readonly carried_files: Record<string, Uint8Array>
  readonly not_carried: string[]
}

/** Where `snapshotApproved` copies from and to. */
interface CopyPlace {
  readonly launch: HostLaunch
  readonly start: string
  readonly snapshot: ReturnType<LaunchHost['stores']['scratch']['make']>
  readonly machine: LaunchHost
}

/**
 * Copy each carried entry into the snapshot, in order, and note the rest. Stops
 * at the first file whose bytes no longer hash as approved and returns its path.
 */
function carryApproved(entries: readonly ConfigEntry[], place: CopyPlace, carrying: Carrying): string | undefined {
  const { launch, start, snapshot, machine } = place
  for (const entry of entries) {
    if (entry.kind === 'absent') continue
    const carry = Object.hasOwn(launch.carried, entry.path) ? launch.carried[entry.path] : undefined
    if (carry === undefined || entry.kind !== 'file') {
      noteNotCarried(carrying.not_carried, entry.path)
      continue
    }

    const content = machine.stores.files.bytesOf(join(start, entry.path))
    if (createHash('sha256').update(content).digest('hex') !== entry.sha256) return entry.path
    carrying.carried.push(carry(snapshot.write(entry.path, content)))
    carrying.carried_files[entry.path] = content
  }
  return undefined
}

/** Note a path left behind, unless a directory above it is already noted. */
function noteNotCarried(not_carried: string[], path: string): void {
  if (!not_carried.some((noted) => path.startsWith(`${noted}/`))) not_carried.push(path)
}

/** The environment every switch adds, or the name of the first variable two of them would set. */
function envOf(carried: readonly HostSwitches[]): Record<string, string> | string {
  const env: Record<string, string> = {}
  for (const [name, value] of carried.flatMap((switches) => Object.entries(switches.env))) {
    if (Object.hasOwn(env, name)) return name
    env[name] = value
  }
  return env
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

/**
 * What a launch's approval comes to (martha#98): the approval it runs under (or none, where the checkout needs none),
 * or the config entries that still need approving. The three are told apart by which field is there, so a caller that
 * formats a sentence for the owner cannot mistake one for another.
 */
export type TheApproval<A> =
  | { readonly approval: A | undefined }
  | { readonly needs_approval: readonly string[] }

/**
 * The approval a launch is on, as `TheApproval` (martha#98, moved out of `start_a_member` under martha#255). Which
 * approval a start runs under is a decision about the checkout: the command that starts a member has no part in it,
 * so the entries still needing approval are answered, and the caller owns the words the owner reads.
 *
 * Each approval is read under the tree it approved, which is the only source of the attributes a checkout is read
 * with (martha#167): a checkout whose attributes changed since an approval reads back as another tree.
 */
export function theApprovalInUse<A extends { readonly tree: string | null; readonly fingerprint: string }>(
  place: LaunchPlace,
  approvals: readonly A[],
  machine: LaunchHost,
): TheApproval<A> {
  for (const approval of approvals) {
    const under = readLaunchState(place, machine, approval.tree ?? undefined)
    if (decideLaunch({ ...under, host: place.host, approved_fingerprints: [approval.fingerprint] }).allow) return { approval }
  }
  const launch = readLaunchState(place, machine)
  const fingerprint = fingerprintOf(launch)
  if (decideLaunch({ ...launch, host: place.host, approved_fingerprints: [] }).allow) return { approval: undefined }
  if (!decideLaunch({ ...launch, host: place.host, approved_fingerprints: [fingerprint] }).allow) return { approval: undefined }
  return { needs_approval: launch.entries.filter((entry) => entry.kind !== 'absent').map((entry) => entry.path) }
}
