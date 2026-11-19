// The launcher of one Goose member: the root and home a launch gets, the config root written for it, the
// environment its engine runs in, the engine in a process group of its own, and the permission store
// checked to be still empty when the launch ends (martha#541, packages 7-8 part A).
//
// This exists so a member's Goose engine reads nothing but what Martha wrote for that one launch. The
// engine reaches its own places through one variable, `GOOSE_PATH_ROOT` (the recording's
// `path_root_variable`), and everything else through `dirs::home_dir()`, the owner's own home
// (`$HOME`): skills, recipes, user plugin settings and agent sources. So a launch writes both, per
// launch, and the owner's home is never read. Inside the root it writes the config the engine loads: the
// provider and the model the member's model declaration names, the mode that brings every tool call to
// Martha, slash commands off, one switch per platform extension the pinned build declares, every one
// of them off but the one a member keeps, and the crew's own tool server, the one server the root names
// (../serve_the_crews_tools_to_an_engine, martha#541 part C, C1). Summon stays off with the rest, so no
// delegate runs: a delegate call naming its own source or provider, and the model a delegated run reports,
// have nothing to reach (package 6, Neptunus's scope items 2 and 3). Turning Summon on reopens both, as a
// package of their own, before any member runs a delegate.
//
// The config root's text is §derive_the_config_of_a_goose_launch's decision, not this launch's: it reads the
// recording and holds Martha's own two values (the extension a member keeps, and the mode that asks). This
// launch writes it where the engine reads it and starts the engine with it.
//
// Two more names the recording does not carry are the engine's own config keys for the provider and the
// model (THE_PROVIDER_SETTING, THE_MODEL_SETTING), and the rest name what this launcher gives a launch:
// its root, its home and its config and permission folders, the narrow PATH it hands the engine, and the
// mode its folders are made with.
//
// The environment is built from nothing, never filtered from the owner's: the engine gets the root, the
// home, a narrow PATH and no other variable at all. That is what keeps GOOSE_SUBAGENT_MODEL and
// GOOSE_SUBAGENT_PROVIDER, which the engine reads before the session's own model (martha#541 package 6,
// Neptunus's scope item 1), out of a launch: a variable the launcher does not name cannot reach the
// engine, whatever the owner's shell holds. It also means no config key's environment variable can
// override the config root, which wins over the file. The same two keys cannot come in through the config
// either: the only settings written into the root are the ones the model declaration names for its
// provider, and a setting under the engine's own prefix — the prefix the root variable carries — is
// refused rather than written.
//
// A launch ends by killing the engine's process group, so the engine and every tool server it started
// go together (trial line 7), and then reading the permission store: the engine saves a permission under
// the root's own config folder, beside its config file, when a client answers `allow_always` or
// `reject_always`, and a later call then skips the client, so a launch that ends with anything saved is a
// launch Martha did not gate. A store in a shape this launcher does not know is not read as an empty one.
//
// The provider's secrets are written to the file the recording names beside the config file, 0600, never into the
// config itself (#541 package A, design r=2 R1): the config switches the keyring off, so that file is where the engine
// reads them. The read-back before the start holds both files to the bytes the launch wrote, and the secrets file to
// mode 0600 and this user. A launch's end removes the root, and the file with it.
//
// The launch is decided through `prepareLaunch` (../refuse_launch_of_unapproved_config), the same call every
// other host's launch goes through: a checkout holding any of the engine's own config files the owner has not
// approved starts nothing, and the gate's snapshot is removed whenever the launch ends. The checkout's own hint
// files, which the engine attaches to its prompt with no tool call, are recorded with the source they are
// (`theTextAStartLoads`), as ../inbound_paths' A25 and A26 say. The engine reads the same files again on every model
// request, so the record is the start's reading of them, not the last word on what the engine attaches.
//
// Skills are off: the config root writes both of the engine's skills switches off, read from the recording
// (martha#839), so `load_skill` and the compiled-in skills are offered to no session. Turning approved skills
// on is #614's (DECIDED 2026-11-18 "Approved skills on (Recommended)").
//
// One gap is named here rather than closed, and it is not silent:
//   - The mode a session reports back. The launcher pins the mode that asks in the config root, but the
//     engine also reports the mode a session actually runs in, over ACP, and there is no client here to
//     ask it: a session that reports any other mode must be refused when the client that opens it (part
//     B) hands the mode back, and that refusal lands with the wiring (martha#541, the gaps table).
// The launch gate's rows for Goose's own files, and the inbound-path rows, are the rest of packages 7-8.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getuid } from 'node:process'

import { killGroup } from '../end_a_launch_when_its_run_ends/the_run_lifeline.ts'
import type { RecordedEngine } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { theConfigOfALaunch, theRootReadBack, theSecretsOfALaunch, type TheModelALaunchRuns } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import { prepareLaunch, theRecordOfTheTextAStartLoads, type ATextAStartLoads, type PreparedLaunch, type SnapshotPlace } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { realOrResolved } from '../judge_a_checkouts_tree/checkout_tree.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { makeRelayDirectory } from '../serve_the_relay_to_a_launch/relay_directory.ts'
import { recordTheLauncher, recordTheMember, sweepLeftoverLaunchDirectories } from '../sweep_leftover_launch_directories/leftover_relay_directories.ts'
import { theToolServersEntry } from '../serve_the_crews_tools_to_an_engine/the_tool_servers_entry.ts'
import { THE_CREWS_TOOL_SERVER } from '../serve_the_crews_tools_to_an_engine/the_tool_servers_words.ts'
import { theFoldersReadBackWhole, theRootsWatch } from './the_roots_watch.ts'

/** The folder under the path root the engine keeps its config in. */
export const THE_CONFIG_FOLDER = 'config'

/** The config file the engine reads from that folder. */
export const THE_CONFIG_FILE = 'config.yaml'

/** The folder under the engine's config folder it keeps saved permissions in (the trial found the store there). */
export const THE_PERMISSION_FOLDER = 'permissions'

/** The store the engine saves a permission in, and reads one from before it asks the client. */
export const THE_PERMISSION_STORE = 'tool_permissions.json'

/** The one key the store's saved permissions sit under: the thing a store holding a rule has, and an empty one lacks. */
export const THE_STORES_PERMISSIONS_KEY = 'permissions'

/** The folder under the launch root a launch's own root is made as, and the one its home is. */
export const THE_ROOT_OF_A_LAUNCH = 'goose-root'
export const THE_HOME_OF_A_LAUNCH = 'goose-home'

/** Only the owner reads or writes a launch's root, its home and the config in it. */
export const A_LAUNCHS_FOLDERS_MODE = 0o700

const PERMISSION_BITS = 0o777
const FILE_MODE = 0o600

/** The PATH a launch gives its engine: the system's own, so the owner's shell cannot name its `bash`. */
export const THE_PATH_A_LAUNCH_GIVES = '/usr/bin:/bin'

/** The folders one launch gets, each its own, and the checkout the member works in. */
export interface ThePlacesOfALaunch {
  /** The engine's own path root: `GOOSE_PATH_ROOT`, which moves every folder it reads through its paths. */
  readonly root: string
  /** The engine's own home: `HOME`, which moves everything it reads through `dirs::home_dir()`. */
  readonly home: string
  /** The engine's working directory: the checkout the owner approved. */
  readonly checkout: string
}

export type ThePlacesMade = { readonly places: ThePlacesOfALaunch } | { readonly refusal: string }

/**
 * Makes `launch_root`'s two folders, a root and a home, for one launch of `checkout`: both new, both
 * 0700, and neither ever reused. The launch root is the caller's to choose and must already be there,
 * outside the owner's own home: a checkout under the home makes a search for a repository open every
 * ancestor on the way, which is a trespass on the home whatever the tree holds (trial record, 3).
 */
export function thePlacesOfALaunch(launch_root: string, checkout: string): ThePlacesMade {
  const refused = (why: string): ThePlacesMade => ({ refusal: `The member is not started: the places a Goose launch reads ${why}.` })
  if (!isDirectory(launch_root)) return refused(`could not be made in ${launch_root}, which is not a folder`)
  if (!isDirectory(checkout)) return refused(`could not be made for the checkout ${checkout}, which is not a folder`)
  const places = { root: join(launch_root, THE_ROOT_OF_A_LAUNCH), home: join(launch_root, THE_HOME_OF_A_LAUNCH), checkout }
  const made: string[] = []
  // A launch that could not be given both folders leaves neither behind.
  const andNothing: (why: string) => ThePlacesMade = (why) => {
    for (const one of made) removeTheTree(one)
    return refused(why)
  }
  for (const folder of [places.root, places.home]) {
    const why = madeNewForThisUser(folder)
    if (why !== undefined) return andNothing(why)
    made.push(folder)
  }
  return { places }
}

/** Makes `at` new, 0700, and says why not when it could not; a folder already there is never reused. */
function madeNewForThisUser(at: string): string | undefined {
  try {
    mkdirSync(at, { mode: A_LAUNCHS_FOLDERS_MODE })
  } catch (error) {
    return `could not be made new at ${at} (${(error as NodeJS.ErrnoException).code ?? String(error)})`
  }
  return isOnlyTheOwners(at) ? undefined : `at ${at} is not a folder only this user may read`
}

/** The environment a launch hands its engine, and the whole of it: nothing inherited reaches it. */
export function theEnvironmentOfALaunch(facts: RecordedEngine, places: ThePlacesOfALaunch): Readonly<Record<string, string>> {
  return { [facts.path_root_variable]: places.root, HOME: places.home, PATH: THE_PATH_A_LAUNCH_GIVES }
}

/** A launch's engine, as it runs: the group it leads, the way it is ended, and how its end is known. */
export interface TheEngineStarted {
  /** The engine's pid, which is also its process group's: one kill reaches it and every tool server it started. */
  readonly pid: number
  /** The engine, for its own pipes. */
  readonly child: ChildProcess
  /** SIGKILL to the engine's whole group; a group already gone is no error. */
  readonly stop: () => void
  /** Whether the engine's own process had already ended before anything asked it to. */
  readonly hadEnded: () => boolean
  /** Resolves when the engine's own process has ended, by itself or by the kill. */
  readonly exited: Promise<{ readonly byItself: boolean }>
}

export type TheEngineStart = TheEngineStarted | { readonly refusal: string }

/**
 * Starts the engine as `goose acp` in a process group of its own, in the approved checkout, on an
 * environment that is exactly `environment`. Its stdio is piped, since the ACP client on the other end
 * is Martha's own and there is no terminal in this. An environment with no PATH is refused here, by name:
 * the engine would run every tool on whatever its shell falls back to, and the next one to notice would be a
 * reader three layers away finding `undefined` (martha#781).
 */
export async function startTheEngine(facts: RecordedEngine, binary: string, places: ThePlacesOfALaunch, environment: Readonly<Record<string, string>>): Promise<TheEngineStart> {
  if (!environment['PATH']) return { refusal: `The member is not started: the environment a launch hands ${binary} holds no PATH.` }
  const child = spawn(binary, [facts.acp_command], { cwd: places.checkout, env: environment, detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const failed = await new Promise<Error | undefined>((resolve) => {
    child.once('spawn', () => resolve(undefined))
    child.once('error', resolve)
  })
  const pid = child.pid
  if (failed !== undefined || pid === undefined) {
    return { refusal: `The member is not started: ${binary} could not be started (${failed?.message ?? 'it gave no process'}).` }
  }
  let stopped = false
  let ended = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    child.stdin?.destroy()
    // The group, whatever is left of it: an engine that exited by itself may still have a tool server in it.
    killGroup(pid)
  }
  const exited = new Promise<{ readonly byItself: boolean }>((resolve) =>
    child.once('exit', () => {
      ended = true
      resolve({ byItself: !stopped })
    }),
  )
  return { pid, child, stop, hadEnded: () => ended, exited }
}

export type ThePermissionStoreRead = { readonly empty: true } | { readonly empty: false; readonly refusal: string }

/**
 * Whether the permission store of the launch at `root` is still empty: the file was never written, or it
 * holds no saved rule at all. The store sits under the engine's own config folder, beside its config file
 * (`config/permissions/tool_permissions.json`), as the trial found it. Anything else is a refusal naming
 * the store, since a saved permission lets a later call skip Martha entirely, and a store in a shape this
 * reader does not know is not read as empty.
 */
export function thePermissionStoreIsStillEmpty(root: string): ThePermissionStoreRead {
  const store = thePermissionStoreOf(root)
  const written = theStoresText(store)
  if ('absent' in written) return { empty: true }
  if ('why' in written) return aStoreRefusal(store, written.why)
  const value = theStoresValue(written.text)
  if ('why' in value) return aStoreRefusal(store, value.why)
  const saved = theSavedRulesIn(value.held)
  if ('why' in saved) return aStoreRefusal(store, saved.why)
  return saved.rules === 0 ? { empty: true } : aStoreRefusal(store, 'holds a saved permission')
}

/**
 * The store's text, nothing at all when the engine never wrote a store, or why it cannot be read. Only a
 * store that is not there is "never written": an unreadable file, a directory in its place, or any other
 * failure to read it is a store this launch cannot vouch for, so it is refused rather than read as empty.
 */
function theStoresText(store: string): { readonly text: string } | { readonly absent: true } | { readonly why: string } {
  try {
    return { text: readFileSync(store, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { absent: true }
    return { why: `cannot be read (${(error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))})` }
  }
}

/** What the store's text parses to, or why it cannot be read. */
function theStoresValue(written: string): { readonly held: unknown } | { readonly why: string } {
  try {
    return { held: JSON.parse(written) as unknown }
  } catch (error) {
    return { why: `cannot be read (${error instanceof Error ? error.message : String(error)})` }
  }
}

/**
 * How many saved rules the store's value holds, or why it is not a store this reader knows: a rule saved
 * under the engine's own key, in whatever lists the engine keeps it in, is a count; a value with no rules
 * is zero; anything else is not read as empty.
 */
function theSavedRulesIn(held: unknown): { readonly rules: number } | { readonly why: string } {
  if (!isAJsonObject(held)) return { why: 'is not an object' }
  const keys = Object.keys(held)
  if (keys.length === 0) return { rules: 0 }
  if (keys.length !== 1 || keys[0] !== THE_STORES_PERMISSIONS_KEY) return { why: 'holds what this reader does not know' }
  const saved = held[THE_STORES_PERMISSIONS_KEY]
  if (!isAJsonObject(saved)) return { why: 'holds what this reader does not know' }
  const counted = Object.values(saved).reduce<number>((count, entries) => count + (Array.isArray(entries) ? entries.length : 1), 0)
  return { rules: counted }
}

/** A JSON object, as parsed: an array and null are not one. */
function isAJsonObject(held: unknown): held is Record<string, unknown> {
  return held !== null && typeof held === 'object' && !Array.isArray(held)
}

/** A store that is not empty, and why, naming the store. */
function aStoreRefusal(store: string, why: string): ThePermissionStoreRead {
  return {
    empty: false,
    refusal: `The member's launch ended with a permission store that ${why} at ${store}, and a saved permission lets a later tool call skip the gate.`,
  }
}

/** The store of the launch whose path root is `root`: under the engine's config folder, beside its config file. */
export function thePermissionStoreOf(root: string): string {
  return join(root, THE_CONFIG_FOLDER, THE_PERMISSION_FOLDER, THE_PERMISSION_STORE)
}

/** The config file of the launch whose path root is `root`: the one the launcher writes for it. */
export function theConfigFileOf(root: string): string {
  return join(root, THE_CONFIG_FOLDER, THE_CONFIG_FILE)
}

/** The secrets file of the launch whose path root is `root`: beside its config file, by the name the recording gives it. */
export function theSecretsFileOf(facts: RecordedEngine, root: string): string {
  return join(root, THE_CONFIG_FOLDER, facts.secret_storage.file)
}

/** One launch's refusal, in the words every refusal of this launcher is given in. */
const refused = (why: string): { readonly refusal: string } => ({ refusal: `The member is not started: ${why}` })

/** One launch of a Goose member, as it runs. */
export interface AGooseLaunch {
  /** The launch's own directory in the relay root (design G2): its root, its home, its launcher record and the crew's socket. */
  readonly directory: string
  /** The socket the crew's tool server posts to, in the launch's directory; the caller serves it. */
  readonly socket_path: string
  readonly places: ThePlacesOfALaunch
  /** The config file written for this launch, under its own root. */
  readonly config_at: string
  /**
   * The checkout's own text the engine attaches to the prompt with no tool call, each with the source it is recorded as
   * (martha#541, the Supervisor's ruling on the `recorded-source` kind): the launch's record of where that text came
   * from, taken before the engine is started. The engine reads the same files again on every model request, so this is
   * the start's reading and a file changed later reaches the engine with no record naming it. A clean tree's approval
   * is the control on it (2026-11-07, martha#127 and martha#132), so the record refuses nothing; it is what
   * ../inbound_paths's A25 and A26 say the launcher makes.
   */
  readonly text_a_start_loads: readonly ATextAStartLoads[]
  /** The tool servers the config root named when it was read back just before the start: the crew's, and only it. */
  readonly servers: readonly string[]
  /**
   * The files the gate carried and hashed against the owner's approval, as `prepareLaunch` returned them: the crew's own
   * texts are composed from these bytes alone, never read live, as a Claude Code launch composes them (martha#306).
   */
  readonly carried_files: Extract<PreparedLaunch, { readonly allow: true }>['carried_files']
  readonly engine: TheEngineStarted
  /**
   * The re-check the launch runs after every result (design G1 row `checkTheSettingsStillHold`): the owner's settings
   * watch, the config root and secrets file as written, then the root's `config/` and `.agents/` against the snapshot
   * taken before the engine started. Why the member must stop, or undefined.
   */
  readonly settings_still_hold: () => string | undefined
  /** Stops the engine whole, reads the permission store, then removes the launch's directory; says whether the engine had to be stopped and what it saved. */
  readonly end: () => Promise<TheEndOfALaunch>
}


export interface TheEndOfALaunch {
  /** Whether the engine was still running when the launch was ended. */
  readonly stopped: boolean
  readonly permissions: ThePermissionStoreRead
}

/** What one launch is asked for: the engine, the place the owner approved, and the model the member's declaration names. */
export interface AGooseLaunchAsked {
  readonly facts: RecordedEngine
  /** The engine's own binary, built from the recorded commit. */
  readonly binary: string
  /**
   * Where the member starts and what the owner approved there, for `prepareLaunch`: the same call every host's launch
   * goes through, so a Goose checkout is decided on by content with the checkout's tree before anything starts
   * (martha#541, C2's residual on C3 to C9).
   */
  readonly place: SnapshotPlace
  /**
   * This user's relay root, outside the owner's home (design G2): the launch's own directory is made in it, the same way a
   * Claude Code launch makes its own, so one sweep clears what a launcher killed hard left of either.
   */
  readonly relay_root: string
  readonly model: TheModelALaunchRuns
  /** The token the crew's tool server carries: the launch's own, minted for it. Its socket is in the launch's directory. */
  readonly tool_server: { readonly token: string }
  /** The owner's Claude Code settings watch (`hookSettingsWatch(...).check`), run first in every re-check: why the owner's settings now turn hooks off, or undefined. */
  readonly owners_settings: () => string | undefined
  /** A test's hand on the config root (and the secrets file beside it) between their write and the engine's start; a real launch gives none. */
  readonly before_the_start?: (config_at: string) => void
  /** A test's hand right after the launcher is recorded, before anything else of the launch is written; a real launch gives none. */
  readonly when_the_launcher_is_recorded?: (directory: string) => void
  /** A test's hand between the engine's spawn and its record; a real launch gives none. */
  readonly before_the_member_is_recorded?: (pid: number) => Promise<void>
}

/**
 * One launch, whole: decides on the place through `prepareLaunch`, sweeps what launches killed hard left in the relay
 * root, makes the launch's own directory there and records the launcher in it, makes the places, writes the config root,
 * records the checkout's text the engine will attach, starts the engine and records it. `end()` stops it, reads the
 * permission store and removes the gate's snapshot and the launch's directory. A refusal, at any step, leaves nothing of
 * the launch's own — nor the snapshot — behind and starts nothing.
 *
 * The order is design G2's: the launcher is recorded before any key is written, so a directory a sweep leaves alone (one
 * with no record) never holds one, and a launcher killed hard after that leaves a record whose processes are gone, which
 * the next start of any member sweeps, key included. Between the spawn and the engine's record the record names only the
 * launcher; a launcher that dies there closes the engine's stdin, and the engine ends on it.
 */
export async function launchTheGooseEngine(asked: AGooseLaunchAsked): Promise<AGooseLaunch | { readonly refusal: string }> {
  if (asked.place.host !== asked.facts.engine_name) {
    return refused(`${asked.place.host} is not the engine this launcher starts (${asked.facts.engine_name}).`)
  }
  // The gate, before anything is made: `prepareLaunch` decides on the checkout by content and by the owner's approval
  // of this checkout's tree, and copies what the gate carries. Nothing is carried for the engine, because the launcher
  // writes the config root its engine reads; what the call gives this launch is the decision and the snapshot's life.
  // The switches it returns drop what a host inherits, and this launcher inherits nothing at all: the environment it
  // hands the engine is built from the three names in `theEnvironmentOfALaunch`, never filtered from the owner's, so
  // there is no inherited value for them to drop.
  const prepared = prepareLaunch(asked.place, thisMachine)
  if (!prepared.allow) return { refusal: prepared.refusal }
  sweepLeftoverLaunchDirectories(asked.relay_root)
  const directory = makeRelayDirectory(join(asked.relay_root, randomUUID()))
  if (!directory.made) {
    removeTheTree(prepared.snapshot_dir)
    return { refusal: directory.refusal }
  }
  const notStarted = (why: string): { readonly refusal: string } => {
    directory.remove()
    removeTheTree(prepared.snapshot_dir)
    return refused(why)
  }
  const recorded = recordTheLauncher(directory.directory)
  if (recorded !== undefined) return notStarted(recorded)
  asked.when_the_launcher_is_recorded?.(directory.directory)
  const made = theLaunchMadeBy(asked, prepared, directory)
  if ('refusal' in made) {
    directory.remove()
    return made
  }
  const { places, config_at, text_a_start_loads } = made
  // The root read back just before the engine reads it (martha#541 C1, guard row 3): the servers it names are a fact of
  // this launch, and a root that names any server but the crew's, or is not the text this launch wrote, starts nothing.
  asked.before_the_start?.(config_at)
  const secrets = { at: theSecretsFileOf(asked.facts, places.root), written: made.secrets }
  const readBack = theRootAsItWasWritten(asked.facts, config_at, made.config, secrets)
  const whole = theFoldersReadBackWhole(asked.facts, places.root)
  if ('refusal' in readBack) return notStarted(readBack.refusal)
  if ('refusal' in whole) return notStarted(whole.refusal)
  // The snapshot is taken here, after the read-back and before the spawn, so nothing of the engine's is in it.
  const settings_still_hold = theRootsWatch({
    owners_settings: asked.owners_settings,
    the_files_as_written: () => {
      const again = theRootAsItWasWritten(asked.facts, config_at, made.config, secrets)
      return 'refusal' in again ? again.refusal : undefined
    },
    folders: whole.folders,
  })

  const started = await startTheEngine(asked.facts, asked.binary, places, theEnvironmentOfALaunch(asked.facts, places))
  if ('refusal' in started) {
    directory.remove()
    removeTheTree(prepared.snapshot_dir)
    return started
  }
  await asked.before_the_member_is_recorded?.(started.pid)
  const member = recordTheMember(directory.directory, started.pid)
  if (member !== undefined) {
    const ended = started.exited
    started.stop()
    await ended
    return notStarted(member)
  }

  const end = async (): Promise<TheEndOfALaunch> => {
    const stopped = !started.hadEnded()
    const ended = started.exited
    started.stop()
    await ended
    removeTheTree(prepared.snapshot_dir)
    const permissions = thePermissionStoreIsStillEmpty(places.root)
    directory.remove()
    return { stopped, permissions }
  }
  return { directory: directory.directory, socket_path: directory.socket_path, places, config_at, text_a_start_loads, servers: readBack.servers, carried_files: prepared.carried_files, engine: started, settings_still_hold, end }
}

/**
 * The config root as the engine is about to read it, judged by ../derive_the_config_of_a_goose_launch, and the secrets
 * file beside it: this user's, mode 0600 exactly, and the bytes the launch wrote; or why the engine is not started.
 */
function theRootAsItWasWritten(facts: RecordedEngine, config_at: string, written: string, secrets: { readonly at: string; readonly written: string }): { readonly servers: readonly string[] } | { readonly refusal: string } {
  try {
    const root = theRootReadBack(facts, { at: config_at, text: readFileSync(config_at, 'utf8'), written }, THE_CREWS_TOOL_SERVER)
    if ('refusal' in root) return root
    const why = whyTheSecretsFileIsNotAsWritten(secrets)
    return why === undefined ? root : { refusal: `the secrets file at ${secrets.at} ${why}.` }
  } catch (error) {
    return { refusal: `the config root at ${config_at} could not be read back (${(error as NodeJS.ErrnoException).code ?? String(error)})` }
  }
}

/** Why the secrets file is not this user's own 0600 file holding the bytes the launch wrote, or nothing when it is. */
function whyTheSecretsFileIsNotAsWritten(secrets: { readonly at: string; readonly written: string }): string | undefined {
  const held = lstatSync(secrets.at)
  if (!held.isFile() || held.uid !== (getuid?.() ?? -1) || (held.mode & PERMISSION_BITS) !== FILE_MODE) return 'is not a file only this user may read and write'
  return readFileSync(secrets.at, 'utf8') === secrets.written ? undefined : 'is not the text this launch wrote'
}

/**
 * What a launch makes once the gate has decided: the checkout's text the engine will attach, read before anything of
 * the launch's is made and so before the engine starts, its places and the config root written inside them, or the
 * refusal. A read that fails is a refusal like any other: nothing of the launch's is left, and no engine starts.
 *
 * That order is the code's own and no test pins it: a stand-in engine's first instruction races the line after `spawn`,
 * which promises that the engine was exec'd and not that it has run, so a record read after the start cannot be made to
 * differ on purpose. It matters little: the engine reads the same files again on every model request (A25 and A26).
 */
function theLaunchMadeBy(asked: AGooseLaunchAsked, prepared: Extract<PreparedLaunch, { readonly allow: true }>, directory: { readonly directory: string; readonly socket_path: string }): { readonly places: ThePlacesOfALaunch; readonly config_at: string; readonly config: string; readonly secrets: string; readonly text_a_start_loads: readonly ATextAStartLoads[] } | { readonly refusal: string } {
  const leaveNothingBehind = (why: string, folders: readonly string[] = []): { readonly refusal: string } => {
    for (const folder of folders) removeTheTree(folder)
    removeTheTree(prepared.snapshot_dir)
    return refused(why)
  }
  try {
    accessSync(asked.binary, constants.X_OK)
  } catch {
    return leaveNothingBehind(`${asked.binary} is not a program this user may run.`)
  }
  const recorded = theRecordOfTheTextAStartLoads(asked.place, thisMachine)
  if ('refusal' in recorded) return leaveNothingBehind(recorded.refusal)
  const made = thePlacesOfALaunch(directory.directory, realOrResolved(thisMachine, asked.place.launch_dir))
  if ('refusal' in made) return leaveNothingBehind(made.refusal)
  const { places } = made

  let config: string
  let secrets: string
  try {
    const entry = theToolServersEntry(asked.facts.stdio_extension, { socket_path: directory.socket_path, token: asked.tool_server.token, checkout: places.checkout })
    config = theConfigOfALaunch(asked.facts, asked.model, { key: THE_CREWS_TOOL_SERVER, entry })
    secrets = theSecretsOfALaunch(asked.facts, asked.model)
  } catch (error) {
    return leaveNothingBehind(error instanceof Error ? error.message : String(error), [places.root, places.home])
  }
  const config_at = theConfigFileOf(places.root)
  try {
    mkdirSync(join(places.root, THE_CONFIG_FOLDER), { mode: A_LAUNCHS_FOLDERS_MODE })
    writeFileSync(config_at, config, { mode: FILE_MODE, flag: 'wx' })
    writeFileSync(theSecretsFileOf(asked.facts, places.root), secrets, { mode: FILE_MODE, flag: 'wx' })
  } catch (error) {
    return leaveNothingBehind(`the config root could not be written at ${config_at} (${error instanceof Error ? error.message : String(error)})`, [places.root, places.home])
  }
  return { places, config_at, config, secrets, text_a_start_loads: recorded.loads }
}

/** Whether `at` is a real directory: a link is not one, and neither is a path that is not there. */
function isDirectory(at: string): boolean {
  try {
    return lstatSync(at).isDirectory()
  } catch {
    return false
  }
}

/** A real directory, owned by this user, mode 0700 exactly. */
function isOnlyTheOwners(at: string): boolean {
  const made = lstatSync(at)
  return made.isDirectory() && made.uid === (getuid?.() ?? -1) && (made.mode & PERMISSION_BITS) === A_LAUNCHS_FOLDERS_MODE
}
