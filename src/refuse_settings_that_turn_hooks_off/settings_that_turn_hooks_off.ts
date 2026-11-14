// The settings that turn Martha's relay off, and the refusal of a launch that
// reads one (martha#122, martha#443).
//
// The keys themselves, and where the host reads managed settings, are the rules
// ../cut_the_rules_from_the_host_binary reads out of the host's own text: this
// file never types one. What it decides:
//
//   - a launch is refused while a settings file the host reads sets a switch:
//     the owner's user settings, the approved --settings copy, and the managed
//     file and drop-in folder the recorder takes the place of from the host;
//   - a launch is refused while safe mode is on: its variable in the launcher's
//     environment or in a settings file's env, or its flag among the owner's
//     arguments (`safeModeIn`, `switchesSetIn`);
//   - a launch is refused, and a running member stopped, while the owner's user
//     settings or the managed settings declare a hook or enable a plugin, which
//     would print into the member's session with nothing recorded (martha#121,
//     ../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts);
//   - a member's file tool call that names the owner's user settings file is
//     denied, the path resolved the way the host resolves it: trimmed, with a
//     leading `~` against the host's home (`namesTheOwnersSettings`). Reads are
//     denied too; that is no secrecy control, since a shell can still read it;
//   - a shell can write that file in ways its text does not show, and the host
//     may drop its hooks as soon as it reloads the file, so the launcher reads
//     the files again on a timer of its own for the member's whole life, as well
//     as after every call (`hookSettingsWatch`), and stops the member when one
//     now sets a switch.
//
// Only `false` (or `null`) leaves a switch off here: the host reads some other
// values as on, and a value it would read as off costs the owner only a refusal
// that names the file and the key.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { FILE_PATH_ARGUMENT, NOTEBOOK_PATH_ARGUMENT, asTheHostResolves } from '../claude_code_host/claude_code_file_tools.ts'
import type { HookSwitches, ManagedSettingsPlace, SafeMode } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import {
  hooksAndPluginsDeclaredIn,
  hooksInFrontmatterOf,
  SKILLS_KIND,
  SYNCED_SKILLS_FOLDER,
  SYNC_OFF_SETTING,
  TRASH_FOLDER,
  type HookSettingsFile,
  type OwnersMarkdown,
} from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { CLAUDE_FOLDER } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isOff = (value: unknown): boolean => value === undefined || value === false || value === null

/** Why one file turns Martha's relay off, or undefined. */
function switchesSetIn(file: HookSettingsFile, switches: HookSwitches): string | undefined {
  if (file.text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(file.text)
  } catch {
    return `${file.path} is not JSON, so whether it turns off the hooks Martha's gates run in cannot be told`
  }
  if (!isObject(parsed)) return `${file.path} is not a JSON object, so whether it turns off the hooks Martha's gates run in cannot be told`
  const env = parsed.env
  const safe = isObject(env) ? switches.safe_mode.variables.filter((name) => env[name] !== undefined) : []
  const on = [...(file.managed ? switches.managed : switches.every_source).filter((key) => !isOff(parsed[key])), ...safe.map((name) => `env.${name}`)]
  if (on.length === 0) return undefined
  return `${file.path} sets ${on.join(', ')}, which turns off the hooks Martha's gates run in, so a member would run ungated; remove it from that file`
}

/**
 * Why the host's environment or the owner's arguments switch safe mode on,
 * which keeps managed hooks only; or undefined. Any value of the variable
 * counts: the host reads some as on, and the cost is a refusal naming it.
 */
export function safeModeIn(environment: Readonly<Record<string, string | undefined>>, args: readonly string[], safe: SafeMode): string | undefined {
  const variables = safe.variables.filter((name) => environment[name] !== undefined)
  const flags = args.filter((arg) => safe.flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)))
  const on = [...variables.map((name) => `the launcher's environment sets ${name}`), ...flags.map((flag) => `the owner's arguments carry ${flag}`)]
  if (on.length === 0) return undefined
  return `${on.join(' and ')}, which switches the host's safe mode on and turns off the hooks Martha's gates run in, so a member would run ungated; remove it`
}

/** Why the settings files the host reads turn Martha's relay off, each file and key named; or undefined. */
export function settingsTurningHooksOff(files: readonly HookSettingsFile[], switches: HookSwitches): string | undefined {
  const reasons = files.map((file) => switchesSetIn(file, switches)).filter((reason) => reason !== undefined)
  return reasons.length > 0 ? reasons.join('; ') : undefined
}

/** A file's text, undefined when there is none; a refusal when it cannot be read. */
function textOf(path: string): { readonly text: string | undefined } | { readonly refusal: string } {
  try {
    return { text: readFileSync(path, 'utf8') }
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { text: undefined }
    return { refusal: `${path} cannot be read (${typeof code === 'string' ? code : String(error)}), so whether it turns off the hooks Martha's gates run in cannot be told` }
  }
}

/** The files of the managed drop-in folder the host may read: every .json in it, a superset of the host's own choice. */
export function dropInFiles(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(folder, name))
  } catch {
    return []
  }
}

/** What a folder walk found: the markdown files, and why a part of it could not be read. */
interface Walked {
  readonly files: readonly string[]
  readonly unread: readonly string[]
}

const NOTHING: Walked = { files: [], unread: [] }

/** Nothing for a path that is not there; why it cannot be read for any other failure. */
function missingOr(path: string, error: unknown): Walked {
  const code = (error as { code?: unknown }).code
  if (code === 'ENOENT' || code === 'ENOTDIR') return NOTHING
  return { files: [], unread: [`${path} cannot be read (${typeof code === 'string' ? code : String(error)}), so whether an agent, skill or command in it declares hooks cannot be told`] }
}

/**
 * One entry of a folder: a markdown file, a folder to walk, or nothing; links
 * followed as the host follows them. A folder the host does not descend into is
 * read at its top level only (martha#243).
 */
function entryUnder(path: string, seen: Set<string>, notBelow: boolean): Walked {
  try {
    const stat = statSync(path)
    if (stat.isDirectory()) return notBelow ? markdownAtTop(path) : markdownUnder(path, seen)
    return stat.isFile() && path.endsWith('.md') ? { files: [path], unread: [] } : NOTHING
  } catch (error) {
    return missingOr(path, error)
  }
}

/**
 * Every .md file under a folder at any depth, each folder walked once: a superset
 * of what the host loads from it, except for the one folder named as one the host
 * reads at its top level only (martha#243).
 */
function markdownUnder(folder: string, seen: Set<string>, notBelow?: string): Walked {
  let real: string
  let names: string[]
  try {
    real = realpathSync(folder)
    names = readdirSync(folder).sort()
  } catch (error) {
    return missingOr(folder, error)
  }
  if (seen.has(real)) return NOTHING
  seen.add(real)
  const found = names.map((name) => entryUnder(join(folder, name), seen, name === notBelow))
  return { files: found.flatMap((one) => one.files), unread: found.flatMap((one) => one.unread) }
}

/** The .md files directly in a folder, the folders below it not read: what the host loads of a folder it does not descend (martha#243). */
function markdownAtTop(folder: string): Walked {
  let names: string[]
  try {
    names = readdirSync(folder).sort()
  } catch (error) {
    return missingOr(folder, error)
  }
  const found = names.map((name): Walked => {
    const path = join(folder, name)
    try {
      return statSync(path).isFile() && path.endsWith('.md') ? { files: [path], unread: [] } : NOTHING
    } catch (error) {
      return missingOr(path, error)
    }
  })
  return { files: found.flatMap((one) => one.files), unread: found.flatMap((one) => one.unread) }
}

/** A markdown file's text, undefined when it went away; why it cannot be read otherwise. */
function markdownTextOf(path: string): { readonly path: string; readonly text: string | undefined } | Walked {
  try {
    return { path, text: readFileSync(path, 'utf8') }
  } catch (error) {
    const missing = missingOr(path, error)
    return missing.unread.length === 0 ? { path, text: undefined } : missing
  }
}

/** The markdown folders the host loads in the user and managed scopes: each kind under the user config folder and under the managed folder. */
export function markdownFolders(user: string, managed: ManagedSettingsPlace, kinds: readonly string[]): string[] {
  return kinds.flatMap((kind) => [join(dirname(user), kind), join(managed.dir, CLAUDE_FOLDER, kind)])
}

/** Whether a path is at or below a folder. */
const isUnder = (path: string, folder: string): boolean => path === folder || path.startsWith(`${folder}/`)

/**
 * Why an agent, skill or command the host loads from the user or managed scope
 * brings hooks in, each file named; and every part that cannot be read.
 *
 * Two places are read as the host reads them (martha#243): the trash under the
 * owner's skills folder, which the host loads at its top level only, and the
 * folder the host syncs from the owner's account, which it hides and will not
 * run once the owner or the admin turns that sync off with a real false.
 */
function hooksInMarkdown(user: string, managed: ManagedSettingsPlace, markdown: OwnersMarkdown, syncedOff: boolean): string[] {
  const syncedFolder = join(dirname(user), SKILLS_KIND, SYNCED_SKILLS_FOLDER)
  const skillsFolders = new Set([join(dirname(user), SKILLS_KIND), join(managed.dir, CLAUDE_FOLDER, SKILLS_KIND)])
  const walked = markdownFolders(user, managed, markdown.kinds).map((folder) => markdownUnder(folder, new Set(), skillsFolders.has(folder) ? TRASH_FOLDER : undefined))
  const read = walked
    .flatMap((one) => one.files)
    .filter((path) => !(syncedOff && isUnder(path, syncedFolder)))
    .map((path) => markdownTextOf(path))
  const declared = read.flatMap((one): Array<string | undefined> =>
    'path' in one ? [hooksInFrontmatterOf({ ...one, managed: false, synced: isUnder(one.path, syncedFolder) }, markdown.frontmatter_pattern)] : [...one.unread],
  )
  return [...walked.flatMap((one) => one.unread), ...declared].filter((reason) => reason !== undefined)
}

/** The settings files a member's host reads, read again each time it is asked. */
export interface HookSettingsWatch {
  /** The owner's user settings file. */
  readonly owners_file: string
  /** The host's home, which a leading `~` in a path the host is given resolves against. */
  readonly home: string
  /** Why the files now turn Martha's relay off, or undefined. */
  check(): string | undefined
}

export interface HookSettingsPlaces {
  /** The owner's user settings file (userSettingsPath). */
  readonly user: string
  /** The host's home: its HOME, as userSettingsPath reads it. */
  readonly home: string
  /** The approved copy the host is given by --settings, if any. */
  readonly approved: string | undefined
  readonly managed: ManagedSettingsPlace
  readonly switches: HookSwitches
  /** The host's frontmatter pattern and the markdown folders it loads in the user and managed scopes (martha#146). */
  readonly markdown: OwnersMarkdown
}

/** Watches the settings files a member's host reads for a switch that turns Martha's relay off. */
export function hookSettingsWatch({ user, home, approved, managed, switches, markdown }: HookSettingsPlaces): HookSettingsWatch {
  const check = (): string | undefined => {
    const places = [
      { path: user, managed: false },
      ...(approved === undefined ? [] : [{ path: approved, managed: false }]),
      { path: join(managed.dir, managed.file), managed: true },
      ...dropInFiles(join(managed.dir, managed.drop_in)).map((path) => ({ path, managed: true })),
    ]
    const files: HookSettingsFile[] = []
    const unread: string[] = []
    for (const place of places) {
      const read = textOf(place.path)
      if ('refusal' in read) unread.push(read.refusal)
      else files.push({ ...place, text: read.text })
    }
    // The approved copy carries the relay's own hooks, and what else it declares (hooks, enabled plugins, a plugin
    // folder in its env) is recorded at session start by sourcesALaunchHandsTheModel; every other file is the
    // owner's or the admin's (martha#121).
    const owners = files.filter((file) => file.path !== approved).map(hooksAndPluginsDeclaredIn)
    const reasons = [...unread, settingsTurningHooksOff(files, switches), ...owners, ...hooksInMarkdown(user, managed, markdown, accountSyncOff(files, approved))].filter((reason) => reason !== undefined)
    return reasons.length > 0 ? reasons.join('; ') : undefined
  }
  return { owners_file: user, home, check }
}

/**
 * Whether the host hides the skills it syncs from the owner's account: any
 * settings file it reads there holds the setting as a real `false`, which is how
 * the host turns it off (a `true` elsewhere cannot win, and a string `"false"`
 * or a `0` is not the false it reads). The approved copy is Martha's own and is
 * not a source: putting the key there would take the owner's account skills from
 * every member without the owner choosing it (martha#243).
 */
function accountSyncOff(files: readonly HookSettingsFile[], approved: string | undefined): boolean {
  return files
    .filter((file) => file.path !== approved && file.text !== undefined)
    .some((file) => {
      try {
        const settings: unknown = JSON.parse(file.text ?? '')
        return isObject(settings) && settings[SYNC_OFF_SETTING] === false
      } catch {
        return false
      }
    })
}

/** A path as the file system resolves it: links followed as far as the path exists. */
export function realPathOf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPathOf(parent), basename(path))
  }
}

/** The tool call arguments that name the file a file tool reads or writes. */
export const FILE_ARGUMENTS = [FILE_PATH_ARGUMENT, NOTEBOOK_PATH_ARGUMENT] as const

/** Why a tool call names the owner's user settings file, or undefined. */
export function namesTheOwnersSettings(input: Readonly<Record<string, unknown>>, owners_file: string, cwd: string, home: string): string | undefined {
  const owners = realPathOf(owners_file)
  for (const argument of FILE_ARGUMENTS) {
    const value = input[argument]
    if (typeof value !== 'string' || value.trim() === '') continue
    if (realPathOf(asTheHostResolves(value, cwd, home)) === owners) {
      return `${value} is the owner's Claude Code user settings file (${owners_file}), which a member does not touch: a key in it can turn off the hooks Martha's gates run in, for this member and every member after it`
    }
  }
  return undefined
}
