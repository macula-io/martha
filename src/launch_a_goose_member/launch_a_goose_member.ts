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
// Everything written here is read from the recording (`../know_the_goose_engines_facts`, package 10):
// the variable that moves the root, the mode's setting and the values it takes, the slash-commands
// setting and what it does when unset, and every platform extension's key and default. Two values the
// recording cannot supply are Martha's own decisions, and they are declared once, here, and read from
// here everywhere:
//
//   - THE_EXTENSION_A_MEMBER_KEEPS, the one extension whose tools a member's model is offered;
//   - THE_MODE_THAT_ASKS_THE_CLIENT, the mode in which the engine brings a tool call to its client
//     rather than running it, which is the whole of Martha's gate over the engine.
//
// The test beside this file holds both to the recording, so a renamed extension key or a dropped mode
// fails a test instead of writing a switch the engine ignores. That matters more than it looks: a
// malformed mode falls back to `auto` in the engine, which runs every call with nothing asking.
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
// Two gaps are named here rather than closed, and neither is silent:
//   - Skills. On the pinned build `load_skill` is offered to every session and is not a platform
//     extension, so no switch in this config root reaches it (trial line 9 failed on exactly this).
//     Saturnus's port of the fork's skills switch (#614) closes it, and until it lands a session is
//     offered one tool beyond the allow-list, which Martha still gates as a tool call like any other.
//   - The mode a session reports back. The launcher pins the mode that asks in the config root, but the
//     engine also reports the mode a session actually runs in, over ACP, and there is no client here to
//     ask it: a session that reports any other mode must be refused when the client that opens it (part
//     B) hands the mode back, and that refusal lands with the wiring (martha#541, the gaps table).
// The launch gate's rows for Goose's own files, and the inbound-path rows, are the rest of packages 7-8.

import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getuid } from 'node:process'

import { killGroup } from '../end_a_launch_when_its_run_ends/the_run_lifeline.ts'
import type { RecordedEngine } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { removeTheTree } from '../serve_the_relay_to_a_launch/relay_copy.ts'
import { theToolServersEntry, type TheToolServersEntry } from '../serve_the_crews_tools_to_an_engine/the_tool_servers_entry.ts'
import { THE_CREWS_TOOL_SERVER } from '../serve_the_crews_tools_to_an_engine/the_tool_servers_words.ts'

/** The one platform extension a member's model is offered: Developer, whose shell and file edits are gated. */
export const THE_EXTENSION_A_MEMBER_KEEPS = 'developer'

/** The mode in which the engine brings every tool call to its client instead of running it. */
export const THE_MODE_THAT_ASKS_THE_CLIENT = 'approve'

/**
 * What the engine's slash-commands switch is set to: the setting turns them on, so off is `false` in every
 * recording, whatever the engine would do with a config that does not name it (martha#541, shape 2 and 3).
 */
export const SLASH_COMMANDS_OFF = false

/** The config key the engine reads the provider from. */
export const THE_PROVIDER_SETTING = 'GOOSE_PROVIDER'

/** The config key the engine reads the model from. */
export const THE_MODEL_SETTING = 'GOOSE_MODEL'

/** The config key every extension's switch sits under. */
export const THE_EXTENSIONS_SETTING = 'extensions'

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

/** What the member's model is, as the crew's declaration for that member names it. */
export interface TheModelALaunchRuns {
  /** The provider the engine reaches the model through, by the name the engine knows it by. */
  readonly provider: string
  /** The model, by the name that provider accepts. */
  readonly model: string
  /** The settings that provider needs to reach its endpoint, written into the config root, never inherited. */
  readonly settings: Readonly<Record<string, string>>
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

/**
 * The config root's text for one launch: the provider, the model, the provider's own settings, the mode
 * that asks the client, slash commands off, one switch for every platform extension the pinned build
 * declares, and the crew's tool server, switched on. Throws when the recording does not name the mode or
 * the extension a member keeps, because a config naming a mode the engine does not know runs every call
 * with nothing asking, and when the server's key is a platform extension's, which would switch that one.
 */
export function theConfigOfALaunch(facts: RecordedEngine, model: TheModelALaunchRuns, server: TheToolServersEntry): string {
  if (!facts.mode.values.includes(THE_MODE_THAT_ASKS_THE_CLIENT)) {
    throw new Error(`the recorded engine names no mode ${THE_MODE_THAT_ASKS_THE_CLIENT}, so a launch cannot pin it to one that asks`)
  }
  if (!facts.platform_extensions.some((extension) => extension.key === THE_EXTENSION_A_MEMBER_KEEPS)) {
    throw new Error(`the recorded engine names no platform extension ${THE_EXTENSION_A_MEMBER_KEEPS}, so a launch cannot keep one`)
  }
  if (facts.platform_extensions.some((extension) => extension.key === THE_CREWS_TOOL_SERVER)) {
    throw new Error(`the crew's tool server is keyed ${THE_CREWS_TOOL_SERVER}, which is a platform extension's key in the recorded engine`)
  }
  const switches = facts.platform_extensions.flatMap((extension) => [
    aLine(`  ${extension.key}`, ''),
    aLine('    enabled', extension.key === THE_EXTENSION_A_MEMBER_KEEPS),
  ])
  // A provider's own settings are what the model declaration names for its endpoint. A setting under the
  // engine's own prefix is the engine's, read before the session's model: the subagent model and provider
  // live there, and either one set in this root moves a delegate's model without Martha naming it
  // (martha#541 package 6, Neptunus's scope item 1). The launch's environment is built from nothing, so
  // no such variable can reach the engine either; this closes the config root the same way.
  const enginePrefix = theEnginesOwnPrefix(facts)
  const borrowed = Object.keys(model.settings).find((setting) => setting.startsWith(enginePrefix))
  if (borrowed !== undefined) {
    throw new Error(`a provider setting ${borrowed} carries the engine's own prefix ${enginePrefix}, and only the engine's settings the launcher derives are written to its config root`)
  }
  return [
    aLine(THE_PROVIDER_SETTING, model.provider),
    aLine(THE_MODEL_SETTING, model.model),
    aLine(facts.mode.setting, THE_MODE_THAT_ASKS_THE_CLIENT),
    // Not the opposite of the engine's default: the setting turns slash commands ON, so off is `false`
    // whether the engine would have them on or off in a config that does not name it.
    aLine(facts.slash_commands.setting, SLASH_COMMANDS_OFF),
    ...Object.entries(model.settings).map(([setting, value]) => aLine(setting, value)),
    aLine(THE_EXTENSIONS_SETTING, ''),
    ...switches,
    aLine(`  ${THE_CREWS_TOOL_SERVER}`, ''),
    aLine('    enabled', true),
    ...server.flatMap(([key, value]) => theEntrysLines(`    ${key}`, value)),
    '',
  ].join('\n')
}

/** A key of the config, indentation included: a word, so no key can start a line of its own. */
const A_WORD_OF_A_KEY = /^[A-Za-z0-9_-]+$/

/** The prefix the engine's own settings carry, from the variable that moves its root: `GOOSE_` from `GOOSE_PATH_ROOT`. */
function theEnginesOwnPrefix(facts: RecordedEngine): string {
  const variable = facts.path_root_variable
  return variable.slice(0, variable.indexOf('_') + 1)
}

/** One line of the config: a key and its value, a string quoted so no character of it starts a new one. */
function aLine(key: string, value: string | boolean | number): string {
  if (!A_WORD_OF_A_KEY.test(key.trim())) throw new Error(`a config key ${JSON.stringify(key)} is not a word, and no key may carry a line of its own`)
  if (typeof value !== 'string') return `${key}: ${String(value)}`
  if (value === '') return `${key}:`
  return `${key}: ${quoted(value)}`
}

/** A string as the config writes it: quoted, so no character of it starts a new line or ends the value. */
function quoted(value: string): string {
  if (/[\n\r]/.test(value)) throw new Error(`a value written to the config root holds a line break, which no config key may carry`)
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The lines of one key of the server's entry: a value on its own line, a list as items, a mapping as keys under it. */
function theEntrysLines(key: string, value: TheToolServersEntry[number][1]): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [aLine(key, value)]
  const under = `${' '.repeat(key.length - key.trimStart().length)}  `
  if (Array.isArray(value)) return [aLine(key, ''), ...(value as readonly string[]).map((item) => `${under}- ${quoted(item)}`)]
  return [aLine(key, ''), ...Object.entries(value).map(([name, text]) => aLine(`${under}${name}`, text))]
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

/** One launch of a Goose member, as it runs. */
export interface AGooseLaunch {
  readonly places: ThePlacesOfALaunch
  /** The config file written for this launch, under its own root. */
  readonly config_at: string
  readonly engine: TheEngineStarted
  /** Stops the engine whole and reads the permission store; says whether the engine had to be stopped and what it saved. */
  readonly end: () => Promise<TheEndOfALaunch>
}

export interface TheEndOfALaunch {
  /** Whether the engine was still running when the launch was ended. */
  readonly stopped: boolean
  readonly permissions: ThePermissionStoreRead
}

/** What one launch is asked for: the engine, the places, and the model the member's declaration names. */
export interface AGooseLaunchAsked {
  readonly facts: RecordedEngine
  /** The engine's own binary, built from the recorded commit. */
  readonly binary: string
  /** The folder a launch's root and home are made in, outside the owner's home. */
  readonly launch_root: string
  /** The approved checkout the member works in, and the engine's working directory. */
  readonly checkout: string
  readonly model: TheModelALaunchRuns
  /** The relay socket the crew's tool server posts to, and the token it carries: the launch's own, minted for it. */
  readonly tool_server: { readonly socket_path: string; readonly token: string }
}

/**
 * One launch, whole: makes the places, writes the config root, and starts the engine. `end()` stops it
 * and reads the permission store. A refusal, at any step, leaves nothing of the launch's own behind and
 * starts nothing.
 */
export async function launchTheGooseEngine(asked: AGooseLaunchAsked): Promise<AGooseLaunch | { readonly refusal: string }> {
  const refused = (why: string): { readonly refusal: string } => ({ refusal: `The member is not started: ${why}` })
  try {
    accessSync(asked.binary, constants.X_OK)
  } catch {
    return refused(`${asked.binary} is not a program this user may run.`)
  }
  const made = thePlacesOfALaunch(asked.launch_root, asked.checkout)
  if ('refusal' in made) return made
  const { places } = made
  const leaveNothingBehind = (why: string): { readonly refusal: string } => {
    for (const folder of [places.root, places.home]) removeTheTree(folder)
    return refused(why)
  }

  let config: string
  try {
    const server = theToolServersEntry(asked.facts.stdio_extension, { ...asked.tool_server, checkout: asked.checkout })
    config = theConfigOfALaunch(asked.facts, asked.model, server)
  } catch (error) {
    return leaveNothingBehind(error instanceof Error ? error.message : String(error))
  }
  const config_at = theConfigFileOf(places.root)
  try {
    mkdirSync(join(places.root, THE_CONFIG_FOLDER), { mode: A_LAUNCHS_FOLDERS_MODE })
    writeFileSync(config_at, config, { mode: FILE_MODE, flag: 'wx' })
  } catch (error) {
    return leaveNothingBehind(`the config root could not be written at ${config_at} (${error instanceof Error ? error.message : String(error)})`)
  }

  const started = await startTheEngine(asked.facts, asked.binary, places, theEnvironmentOfALaunch(asked.facts, places))
  if ('refusal' in started) {
    for (const folder of [places.root, places.home]) removeTheTree(folder)
    return started
  }

  const end = async (): Promise<TheEndOfALaunch> => {
    const stopped = !started.hadEnded()
    const ended = started.exited
    started.stop()
    await ended
    return { stopped, permissions: thePermissionStoreIsStillEmpty(places.root) }
  }
  return { places, config_at, engine: started, end }
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
