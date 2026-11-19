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
//      absent, and the checkout's work tree (../judge_a_checkouts_tree/checkout_tree.ts): a pull that
//      changes only the script an approved hook runs changes the fingerprint.
//      Claude Code's own approval is a list of server names, which is why it
//      cannot be this control.
//
//   3. THE CHECKOUT IS THE BOUND. A config inside the checkout is fingerprinted
//      with it, from the directory the host starts in up to the checkout's top, and
//      never above it. Nothing above the top is read: it is not the checkout
//      author's, the launch never carries it, and a planned launch loads none of it
//      (martha#766). The stop bounds the walk when the start is in no checkout, or
//      in one whose top is the stop or above it.
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
// runs git through `processes.runNow` (../judge_a_checkouts_tree/checkout_tree.ts). Every reader takes
// the host it reads through.

import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'

import { checkoutTheGateReads, readCheckoutTree, realOrResolved, type LaunchHost, type TreeChange } from '../judge_a_checkouts_tree/checkout_tree.ts'
import type { OwnWritesStore } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { DEPENDENCIES } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { CLAUDE_AUTO_UPDATER_OFF, CLAUDE_CODE, CLAUDE_FOLDER, MCP_CONFIG_SWITCH, MEMORY_FOLDER_OVERRIDE, REMOTE_MEMORY_ROOT } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { CLAUDE_CODE_BARE_MODE_VARIABLE, CLAUDE_CODE_HOST_SKILL_CATALOG_VARIABLE } from '../load_the_hosts_markdown/the_skills_loader.ts'
import { aSkillWithAReservedName, CLAUDE_SKILLS, isBelowACarriedFolder } from './carry_the_approved_skills.ts'


export type { LaunchHost }

/** What a launcher changes when it starts a host: arguments and environment it adds, and inherited variables it drops. */
export interface HostSwitches {
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  /** Inherited variables that would bring config back in; the launcher removes them. */
  readonly env_dropped: readonly string[]
}

/**
 * The environment to start `host` with: `inherited` without the dropped
 * variables, with the switches' own on top, so no inherited value can switch
 * project config back on, and the host's own `env_last` last, so nothing above it
 * can undo it (martha#460: the host's auto-updater stays off). Another host's
 * variables never reach it (martha#474).
 */
export function launchEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  switches: HostSwitches,
  host: Host,
): Record<string, string> {
  const kept = Object.entries(inherited).filter(
    (entry): entry is [string, string] => entry[1] !== undefined && !switches.env_dropped.includes(entry[0]),
  )
  return { ...Object.fromEntries(kept), ...switches.env, ...theRowOfHost(host).env_last }
}

/**
 * The files and folders each host reads from a project directory, either to start something by itself (issue #16), or,
 * for Claude Code's skills folder, to hand the model as instructions (martha#747), which Martha carries into the
 * member's own config folder. Each is one the host was seen to read, never a guess. The table is keyed by the name a declaration writes, which is a
 * string the recording holds, so it is a string-keyed table with a guard at each read rather than a union the compiler
 * checks (martha#541's ruling on G1); this slice's own test holds the two tables to the same hosts.
 */
export const CLAUDE_CODE_FILES = [
  '.mcp.json',
  `${CLAUDE_FOLDER}/settings.json`,
  // The last one Claude Code writes itself: a member's own permission answers.
  `${CLAUDE_FOLDER}/settings.local.json`,
  // Last, so a reader that takes the rows by position reads the same names (martha#747): the skills the host would
  // read with project settings on, which a launch carries into the member's own config folder instead.
  CLAUDE_SKILLS,
] as const

/** OpenCode's: the last one holds a checkout's plugins and their installed packages. */
export const OPENCODE_FILES = ['opencode.json', 'opencode.jsonc', '.opencode'] as const

/**
 * Where the engine keeps its own settings, under the home a launch gives it (`../launch_a_goose_member`), named for the
 * test that pins the families against the design as the design spells them: the trial
 * planted a file in every place the engine reads a home, and both of these under `.config` were found by it
 * (../../trial_the_goose_host/a_launch_the_trial_writes.ts).
 */
export const ENGINE_FOLDER = '.config/goose'

/**
 * The engine's own hints file (martha#541): its source names it (`GOOSE_HINTS_FILENAME`, crates/goose/src/hints/load_hints.rs)
 * and reads it from the directory the engine starts in, so it is text a checkout puts into every prompt. It starts no
 * code, so this gate does not list it and never refuses a checkout for holding one; a row that says what such text does
 * is the send path's (martha#541 packages 7-8 part C, C3's wiring), not this gate's.
 */
export const ENGINE_HINTS_FILE = '.goosehints'

/**
 * The engine's own files, in the families the design lists them by (martha#541, B1.3): the folders it reads skills,
 * agents, recipes, checks and plugins from in the checkout it starts in, its settings under the home of its own, and the
 * review file it reads. Both a checkout's and a launch's root move these, so `.claude`'s skills and agents are listed
 * beside `.goose`'s: the engine reads all three names (the trial above planted one marker in each, on the checkout and on
 * the home). A family is one inbound row of its own (C3 to C9), and each row names its family through this table rather
 * than typing the files again.
 */
export const ENGINE_FAMILIES = {
  plugins: ['.agents/plugins'],
  settings: [`${ENGINE_FOLDER}/settings.json`, `${ENGINE_FOLDER}/settings.local.json`],
  skills: ['.agents/skills', '.goose/skills', `${CLAUDE_FOLDER}/skills`],
  agents: ['.agents/agents', `${CLAUDE_FOLDER}/agents`, '.goose/agents'],
  recipes: ['.goose/recipes', '.agents/recipes'],
  checks: ['.agents/checks'],
  review: ['.agents/REVIEW.md'],
} as const

/**
 * Every file the engine starts something from, family by family. `ENGINE_HINTS_FILE` and `AGENTS.md` are not here: they
 * start nothing but a prompt, so no gate stands in front of them, and their rows belong to the launch's wiring (C3).
 */
export const ENGINE_FILES: readonly string[] = Object.values(ENGINE_FAMILIES).flat()

export const LAUNCH_FILES_OF_HOST: Readonly<Record<string, readonly string[]>> = {
  [CLAUDE_CODE]: CLAUDE_CODE_FILES,
  opencode: OPENCODE_FILES,
  // The name the recording holds, so the gate and the engine's own facts can never spell it differently.
  [RECORDED_GOOSE_ENGINE.engine_name]: ENGINE_FILES,
}

export type Host = string

/** What Martha knows about starting one host on approved config. */
export interface HostLaunch {
  /** What keeps the host from reading the checkout's own config. */
  readonly project_config_off: HostSwitches
  /** How the approved copy of a listed file is passed. A file not named here is never carried. */
  readonly carried: Readonly<Record<string, (path: string) => HostSwitches>>
  /**
   * Set on this host's environment after everything else, so neither an inherited value nor a switch can undo it
   * (martha#460). It holds the host's own auto-updater switch: a launch hands the host a home of its own, where the
   * owner's answer to updating is not read, and an update the host then runs installs over the owner's own copy.
   * It is spread rather than written into each builder, so a launch path added later carries it or fails the test
   * that names it (every_launch_switches_the_hosts_auto_updater_off.node-test.ts). A host with nothing to switch off
   * names its reason in NO_AUTO_UPDATER instead, and the same test holds both halves.
   */
  readonly env_last: Readonly<Record<string, string>>
  /**
   * The listed folders whose files are carried with no switch of their own, into a place the launcher writes
   * (martha#747): their bytes are the approved ones, they are never reported as not loaded, and a skill in them may not
   * take a name the host keeps for itself.
   */
  readonly carried_folders: readonly string[]
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
 * OpenCode's own auto-updater switch (martha#474). OpenCode 2.2.7 skips its update check when this is 1 or true,
 * before it reads any config (measured in the 2.2.7 binary). With no config of its own its policy is only to notify,
 * but an owner's config may say auto, and an npm-installed OpenCode then updates with `npm install --global`, which
 * lands on the owner's own copy as Claude Code's did (martha#460).
 */
const OPENCODE_AUTO_UPDATER_OFF: Readonly<Record<string, string>> = { OPENCODE_DISABLE_AUTOUPDATE: '1' }

/**
 * Each brings skills in that no approval read (martha#747): bare mode, in which the host loads none of the skills a
 * launch copies and reads added folders' skills unguarded, and the host skill catalog, a mount of skills named by an
 * inherited variable. Both names are read from the recorded host, never typed.
 */
const CLAUDE_SKILLS_ELSEWHERE = [CLAUDE_CODE_BARE_MODE_VARIABLE, CLAUDE_CODE_HOST_SKILL_CATALOG_VARIABLE] as const

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
  MEMORY_FOLDER_OVERRIDE,
  REMOTE_MEMORY_ROOT,
] as const

export const [CLAUDE_SERVERS, CLAUDE_SETTINGS] = CLAUDE_CODE_FILES
const [OPENCODE_CONFIG, OPENCODE_CONFIG_WITH_COMMENTS] = OPENCODE_FILES

/** The switches that hand Claude Code a settings file: the carried copy, or the one a launch writes (martha#136). */
export const claudeSettingsSwitches = (path: string): HostSwitches => ({ args: ['--settings', path], env: NO_ENV, env_dropped: NOTHING_DROPPED })

/**
 * Why a host's row needs no auto-updater switch in its `env_last`, in words the owner could check (martha#541's ruling on
 * the engine): a host is either switched or has a reason here, never both and never neither, and
 * every_launch_switches_the_hosts_auto_updater_off.node-test.ts holds both halves.
 *
 * The engine's reason: what the pinned engine runs on its own is read from its source at the recorded commit, not
 * guessed. It has no update at startup, so a launch of it holds no install over the owner's copy; the two updatings it
 * has are a command the member's model would have to ask for, which reaches the gate as a tool call like any other, and
 * a plugin's, which needs an installed plugin and a launch root holds none.
 */
export const NO_AUTO_UPDATER: Readonly<Record<string, string>> = {
  [RECORDED_GOOSE_ENGINE.engine_name]:
    `The pinned engine (${RECORDED_GOOSE_ENGINE.engine_commit}) runs no update of its own at startup: the only updating it has is an explicit command (crates/goose-cli/src/cli.rs:1053-1061), which a member's model would have to ask for and the gate sees as a tool call, and one a plugin runs (crates/goose/src/plugins/mod.rs:190-236), which needs an installed plugin and a launch root holds none.`,
}

/**
 * The switches that keep Claude Code from reading the checkout's own config: `--strict-mcp-config`, so only the servers
 * passed by `--mcp-config` start, and the memory switches below. It is a name of its own because a reader that must
 * compare with it and never copy it refers to it (../claude_code_host, martha#135), and a change to it is then a change
 * to what a read is exempt on.
 */
export const CLAUDE_PROJECT_CONFIG_OFF: HostSwitches = {
  args: ['--setting-sources', 'user', '--strict-mcp-config'],
  env: CLAUDE_MEMORY_OFF,
  env_dropped: [...CLAUDE_COMMAND_ELSEWHERE, ...CLAUDE_MEMORY_ELSEWHERE, ...CLAUDE_SKILLS_ELSEWHERE],
}

export const HOSTS: Readonly<Record<string, HostLaunch>> = {
  [CLAUDE_CODE]: {
    project_config_off: CLAUDE_PROJECT_CONFIG_OFF,
    carried: {
      [CLAUDE_SERVERS]: (path) => ({ args: [MCP_CONFIG_SWITCH, path], env: NO_ENV, env_dropped: NOTHING_DROPPED }),
      [CLAUDE_SETTINGS]: claudeSettingsSwitches,
    },
    env_last: CLAUDE_AUTO_UPDATER_OFF,
    carried_folders: [CLAUDE_SKILLS],
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
    env_last: OPENCODE_AUTO_UPDATER_OFF,
    carried_folders: [],
  },
  [RECORDED_GOOSE_ENGINE.engine_name]: {
    // The engine reaches its own folders through the one variable the recording names, and everything else through the
    // home it is given, so both are kept out of everything it inherits: a launch makes both for itself and names them
    // (../launch_a_goose_member's theEnvironmentOfALaunch), so a value inherited from the owner's shell could only
    // move the engine onto a root or a home no owner approved. Nothing is carried: the launcher writes the config root
    // its engine reads, so the checkout's own copies are never the ones it loads, and each family is approved and
    // refused by content like any other host's (martha#541, packages 7-8 part C).
    project_config_off: {
      args: NO_ARGS,
      env: NO_ENV,
      env_dropped: [RECORDED_GOOSE_ENGINE.path_root_variable, 'HOME'],
    },
    carried: {},
    env_last: NO_ENV,
    carried_folders: [],
  },
}


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
  /** The checkout's work tree (../judge_a_checkouts_tree/checkout_tree.ts), or `null` outside any checkout below the stop. */
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

/**
 * The launch row of `host`, or the failure that is Martha's own: the tables are keyed by the name a declaration writes,
 * which is a string, so a reader that names a host it means gets the row here or a refusal naming it — never a value
 * that might be missing, read on as an empty one (martha#541's ruling on G1). `decideLaunch` refuses a host with no row
 * before anything starts, so a launch that reaches this with none is a code path that skipped the gate.
 */
export function theRowOfHost(host: Host): HostLaunch {
  const launch = HOSTS[host]
  if (launch === undefined) throw new Error(`${REFUSED}: ${host} has no launch row, so nothing says how to start it`)
  return launch
}

/**
 * Whether this release knows both halves of a host: the files it starts something from, and how to start it without the
 * checkout's own config. A host with either half missing is refused by name (rule 4).
 */
const theGateCanCheck = (host: Host): boolean => LAUNCH_FILES_OF_HOST[host] !== undefined && Object.hasOwn(HOSTS, host)

/** The refusal a host this release knows nothing of is shown, naming the host as the declaration wrote it. */
const theUnknownHost = (host: Host): string =>
  `${REFUSED}: Martha does not know which files ${host} starts things from, so it cannot check them.`

/**
 * The files `host` starts something from. After `theGateCanCheck` this is one of the hosts this release lists, so a
 * reader that has not checked is refused by name here rather than reading an unlisted host as a checkout with no config.
 */
export function theFilesOf(host: Host): readonly string[] {
  const names = LAUNCH_FILES_OF_HOST[host]
  if (names === undefined) throw new Error(`${REFUSED}: ${host} is no host this release lists files for`)
  return names
}

/** Whether this host may start here, and if not, the refusal to show the owner. */
export function decideLaunch({ host, entries, tree, approved_fingerprints, refusal }: LaunchRequest): LaunchDecision {
  if (!theGateCanCheck(host)) return { allow: false, refusal: theUnknownHost(host) }

  const unapprovable = whatNoApprovalCovers(host, entries)
  if (unapprovable !== undefined) return { allow: false, refusal: `${REFUSED}: ${unapprovable}` }

  const unread = theFilesOf(host).find(
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

/**
 * Why no approval can cover these entries, or undefined: a link or an unreadable path, whose content cannot be pinned
 * (rule 4), or a carried skill named like a folder the host or Martha's scan reads as its own (martha#747).
 */
function whatNoApprovalCovers(host: Host, entries: readonly ConfigEntry[]): string | undefined {
  const unpinned = entries.find((entry) => entry.kind === 'symlink' || entry.kind === 'unreadable')
  if (unpinned !== undefined) {
    return `${unpinned.path} is ${unpinned.kind === 'symlink' ? 'a symlink' : 'unreadable'}, so its content cannot be approved. Replace it with a plain file or a plain directory.`
  }
  return aSkillWithAReservedName(entries.map((entry) => entry.path), theRowOfHost(host).carried_folders)
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
  /** Read only when the host starts in it: the owner's home. The whole bound when the start is in no checkout the gate reads (martha#766). */
  readonly stop_dir: string
  /**
   * The tree the owner approved, whose attributes the checkout is read under (martha#167). Omitted, the checkout's
   * own HEAD tree is used: the attributes an approval is first read against, before there is an approval.
   */
  readonly approved_tree?: string
  /**
   * The crew's own text files, as absolute paths (martha#306): the role and mode texts it writes for itself, and the
   * conventions file its declaration names. They are read as entries of their own, so the approval names and
   * fingerprints them whether git ignores them or not, and the text a member is handed is the text the owner
   * approved. Omitted, the launch reads no crew text and this slice is as it was before it.
   */
  readonly crew_text_files?: readonly string[]
}

/**
 * Every file the host would read to start something, from the directory it
 * starts in and each directory above it: up to the checkout's top when the start
 * is in a checkout whose top is not the stop or above it, and otherwise up to but
 * not including `stop_dir`, or as far as the filesystem root when the stop is no
 * ancestor of the start. Both the start and the stop are resolved through symlinks
 * first. A host with no entry reads nothing.
 *
 * The top is the bound because the checkout's own config is the only config its
 * author ships, and the launch carries none above it (martha#766).
 */
export function readLaunchConfig({ host, launch_dir, stop_dir }: LaunchPlace, machine: LaunchHost): readonly ConfigEntry[] {
  const names = LAUNCH_FILES_OF_HOST[host]
  if (names === undefined) return []

  const start = realOrResolved(machine, launch_dir)
  const stop = realOrResolved(machine, stop_dir)
  const top = checkoutTheGateReads(start, stop, machine)?.top
  const found = directoriesUpFrom(start, stop, top).flatMap((dir) =>
    names.flatMap((name) => entriesAt(machine, start, dir, name)),
  )
  // Two listed names share a parent (.claude/…): a parent that is not a
  // directory is reported once.
  return found.filter((entry, index) => found.findIndex((other) => other.path === entry.path) === index)
}

/** The config and the work tree, as the gate reads them. */
/**
 * The checkout's tree as it is now, before the host starts, when the owner approved this start state; `null` otherwise.
 * A checkout with no config is launched whatever it holds and approves nothing, so it gets `null`, and every read in it
 * counts (decided 2026-11-07, martha#127). It lives here because what a launch approves is this slice's subject; the
 * relay that asks it holds the host it reads through.
 */
export function approvedStartTreeOf(launch: ApprovedLaunch, host: LaunchHost): string | null {
  const state = readLaunchState(launch, host, launch.approved_tree)
  return launch.approved_fingerprints.includes(fingerprintOf(state)) ? state.tree : null
}

export function readLaunchState(place: LaunchPlace, machine: LaunchHost, approved_tree?: string): LaunchState {
  const read = readCheckoutTree(realOrResolved(machine, place.launch_dir), place.stop_dir, machine, approved_tree ?? place.approved_tree)
  const crewText = readCrewText(place, machine)
  // One refusal, whichever half of the state refuses first: the checkout's tree, or a crew text that is a directory.
  const refusal = read.kind === 'refused' ? read.refusal : crewTextDirectoryIn(crewText)
  return {
    entries: [...readLaunchConfig(place, machine), ...crewText],
    tree: read.kind === 'tree' ? read.tree : null,
    ...(refusal === undefined ? {} : { refusal }),
    ...(read.kind === 'refused' && read.the_approved_tree === true ? { the_approved_tree_is_gone: true as const } : {}),
    ...(read.kind === 'tree' && read.changes !== undefined ? { changes: read.changes } : {}),
  }
}

/**
 * The crew text path that is a directory, or undefined when every one of them is a file or absent: a directory here
 * cannot be approved as a text, and reading it as absent would quietly hand the shipped text instead (martha#306).
 */
function crewTextDirectoryIn(crewText: readonly ConfigEntry[]): string | undefined {
  const found = crewText.find((entry) => entry.kind === 'directory')
  return found === undefined ? undefined : `${REFUSED}: ${found.path} is a directory, and a crew text is one file. Write the text there, or remove the directory.`
}

/**
 * The crew's own text files as entries, read from the checkout the same way a host config is (martha#306): whether
 * git ignores one or not, the approval names it and its bytes are in the fingerprint. A path is written relative to
 * the directory the host starts in, as `/`, so an approval names a file the owner can find. A link anywhere between
 * that start and the text — the text itself, or any directory above it — is the entry, so the decision refuses it by
 * name rather than following it to a file under a name the crew never wrote (martha#306 r=4).
 */
export function readCrewText(place: LaunchPlace, machine: LaunchHost): readonly ConfigEntry[] {
  const start = realOrResolved(machine, place.launch_dir)
  return (place.crew_text_files ?? []).map((file) => {
    const at = join(start, crewTextAt(place, file))
    return linkOnTheWayTo(machine, start, at) ?? entryOf(machine, start, at)
  })
}

/**
 * Where a crew text stands for the approval, the launch and the compose (martha#306 r=4): its path below the project
 * root, spelled as the crew names it, with nothing below the root resolved. This is the one rule for a crew text's
 * name: the approval's entry, the bytes the launch carries (keyed by that entry) and the compose that looks them up
 * all spell the text this way, so no two of them can come to name the same file differently — whether the crew wrote a
 * plain file, a link at the file, or a directory of theirs reached through a link.
 */
function crewTextAt(place: LaunchPlace, file: string): string {
  return pathFrom(resolve(place.launch_dir), resolve(file))
}

/**
 * The first link on the way from the launch's start down to `at`, the text itself included, or undefined: a crew text
 * is what stands where the crew put it, and a link is refused by name (martha#306 r=4). Two rounds tried approving
 * what a link pointed at, and each time the launch and the compose then spelled the file differently — resolving the
 * file, then the directories above it — and the member was quietly handed Martha's shipped text instead.
 */
function linkOnTheWayTo(machine: LaunchHost, start: string, at: string): ConfigEntry | undefined {
  let walked = start
  for (const part of pathFrom(start, at).split('/')) {
    walked = join(walked, part)
    const entry = entryOf(machine, start, walked)
    if (entry.kind === 'symlink') return entry
  }
  return undefined
}

/**
 * The crew's own text files as `readCrewText` names them: the entries whose bytes a launch carries into its snapshot
 * and hands to every session it starts, rather than passing them over as config it does not load (martha#306). It reads
 * its paths through `crewTextAt`, the same way `readCrewText` does, so the two can never come to name a file
 * differently.
 */
function crewTextPathsOf(place: LaunchPlace): ReadonlySet<string> {
  return new Set((place.crew_text_files ?? []).map((file) => crewTextAt(place, file)))
}

export type PreparedLaunch =
  | {
      readonly allow: true
      /** Add these to the host's command line, and start it with `launchEnvironment(process.env, switches, host)`. */
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

  const launch = theRowOfHost(place.host)
  const start = realOrResolved(machine, place.launch_dir)
  const snapshot = machine.stores.scratch.make(place.snapshot_root, 'launch-')
  const snapshot_dir = snapshot.path

  const carrying: Carrying = { carried: [launch.project_config_off], carried_files: {}, not_carried: [] }
  const crewText = crewTextPathsOf(place)
  const changed = carryApproved(state.entries, { launch, start, snapshot, machine, crewText }, carrying)
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
  /** The crew's own text files, as the entries name them: carried for their bytes, with no switch of their own. */
  readonly crewText: ReadonlySet<string>
}

/**
 * Copy each carried entry into the snapshot, in order, and note the rest. Stops
 * at the first file whose bytes no longer hash as approved and returns its path.
 *
 * The crew's own text files are carried the same way (martha#306): they start no
 * code, so they carry no switch, but they are handed to every session this
 * launch starts, so their bytes have to be the bytes the approval read and
 * hashed, and they are never reported to the owner as "not loaded".
 */
function carryApproved(entries: readonly ConfigEntry[], place: CopyPlace, carrying: Carrying): string | undefined {
  const { start, snapshot, machine } = place
  for (const entry of entries) {
    const carrier = carrierOf(entry, place)
    if (carrier === 'passed over') continue
    if (carrier === 'left behind') {
      noteNotCarried(carrying.not_carried, entry.path)
      continue
    }

    const content = machine.stores.files.bytesOf(join(start, entry.path))
    if (entry.kind !== 'file' || createHash('sha256').update(content).digest('hex') !== entry.sha256) return entry.path
    const copied = snapshot.write(entry.path, content)
    if (carrier.switchesFor !== undefined) carrying.carried.push(carrier.switchesFor(copied))
    carrying.carried_files[entry.path] = content
  }
  return undefined
}

/**
 * How one entry is carried: passed over (absent, or a carried folder's own directory), left behind and told to the
 * owner, or copied, with the switch that passes it when it has one. A file is copied when a switch passes it, or when
 * it is a crew text or under a carried folder, which carry no switch of their own.
 */
function carrierOf(entry: ConfigEntry, place: CopyPlace): 'passed over' | 'left behind' | { readonly switchesFor: ((path: string) => HostSwitches) | undefined } {
  const { launch, crewText } = place
  if (entry.kind === 'absent' || aFolderCarriedWhole(entry, launch.carried_folders)) return 'passed over'
  const switchesFor = Object.hasOwn(launch.carried, entry.path) ? launch.carried[entry.path] : undefined
  const noSwitch = crewText.has(entry.path) || isBelowACarriedFolder(entry.path, launch.carried_folders)
  if (entry.kind !== 'file' || (switchesFor === undefined && !noSwitch)) return 'left behind'
  return { switchesFor }
}

/**
 * Whether `entry` is a carried folder itself, or a directory inside one, whose files are carried one by one: it is not
 * left behind. Installed packages inside one are, like anywhere else, never walked, so they are left behind.
 */
function aFolderCarriedWhole(entry: ConfigEntry, folders: readonly string[]): boolean {
  if (entry.kind !== 'directory' || entry.path.split('/').at(-1) === DEPENDENCIES) return false
  return folders.includes(entry.path) || isBelowACarriedFolder(entry.path, folders)
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

/**
 * The start, then each directory above it, ending at whichever comes first: the
 * directory before `stop`, or `top` itself once it has been pushed. `top` is the
 * checkout's top when the gate reads that checkout (martha#766). Without one the
 * walk is the stop's alone, and it runs to the root when the stop is no ancestor
 * of the start.
 */
function directoriesUpFrom(start: string, stop: string, top: string | undefined): readonly string[] {
  const dirs: string[] = [start]
  if (start === stop || start === top) return dirs
  for (let dir = dirname(start); dir !== stop && dir !== dirs[dirs.length - 1]; dir = dirname(dir)) {
    dirs.push(dir)
    if (dir === top) break
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
  if (path.split(sep).at(-1) === DEPENDENCIES) return [entry]

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
