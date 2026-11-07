// The settings that turn Martha's relay off, as the recorded host reads them
// (martha#122).
//
// Martha's gates run as a hooks module (../claude_code_relay). Claude Code
// builds a session's hook set in one function, which drops every hook, or every
// hook but managed ones, when a settings key it reads is true. A member runs as
// the owner's own OS user, so it can write such a key into the owner's user
// settings, and every member started after it runs with no gate.
//
// So:
//   - the keys are never typed here: the recorder cuts that one function out
//     of the host binary (recorded_claude_code_host.json, hooks_switches) and
//     `hookSwitchesOf` reads which keys it tests as `=== true`, and on which
//     settings: the managed ones alone, or the merged ones every file feeds;
//   - a launch is refused while a settings file the host reads sets one: the
//     owner's user settings, the approved --settings copy, and the managed file
//     and drop-in folder, whose place the recorder also takes from the host;
//   - a member's file tool call that names the owner's user settings file is
//     denied (`namesTheOwnersSettings`);
//   - a shell can write that file in ways its text does not show, so after
//     every call the files are read again (`hookSettingsWatch`) and the member
//     is stopped when one now sets a switch.
//
// Only `false` (or `null`) leaves a switch off here: the host reads some other
// values as on, and a value it would read as off costs the owner only a
// refusal that names the file and the key.

import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** The keys that turn Martha's relay off, by where the host honours them. */
export interface HookSwitches {
  /** Honoured from managed settings: what the policy settings are tested for, and what every source is. */
  readonly managed: readonly string[]
  /** Honoured from any settings file the session loaded. */
  readonly every_source: readonly string[]
}

/** Where the host reads managed settings on Linux: a folder, the file in it, and a drop-in folder in it. */
export interface ManagedSettingsPlace {
  readonly dir: string
  readonly file: string
  readonly drop_in: string
}

// The start of the host's hook-set function: it reads the policy settings into
// a local, and returns no hooks at all when the first key it tests is true. The
// minifier's names change between builds, so only their shape is matched.
const HOOK_SET_START = /function [\w$]+\(\)\{let ([\w$]+)=[\w$]+\("policySettings"\);if\(\1\?\.[\w$]+===!0\)return\{\};/g
const POLICY_LOCAL = /let ([\w$]+)=[\w$]+\("policySettings"\)/
const TESTED_TRUE = /([\w$]+)\??\.([\w$]+)===!0/g

/** The index just past the brace that closes the one opened at `open`, skipping string literals. */
function closingBrace(text: string, open: number): number {
  let depth = 0
  for (let at = open; at < text.length; at += 1) {
    const char = text[at]
    if (char === '"' || char === "'" || char === '`') {
      at = endOfString(text, at)
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return at + 1
  }
  throw new Error('The function that builds the hook set never closes in the host text.')
}

/** The index of the quote that ends the string literal opened at `open`. */
function endOfString(text: string, open: number): number {
  const quote = text[open]
  for (let at = open + 1; at < text.length; at += 1) {
    if (text[at] === '\\') at += 1
    else if (text[at] === quote) return at
  }
  return text.length
}

/** The one function in a host's text that builds the session's hook set, whole; refuses none, or two that differ. */
export function hookSwitchesSourceIn(text: string): string {
  const found = new Set<string>()
  for (const match of text.matchAll(HOOK_SET_START)) {
    const open = match.index + match[0].indexOf('{')
    found.add(text.slice(match.index, closingBrace(text, open)))
  }
  if (found.size === 0) throw new Error('No function that builds the hook set was found in the host: the settings that turn hooks off cannot be derived.')
  if (found.size > 1) throw new Error(`The host holds two different functions that build the hook set: ${[...found].join(' | ')}`)
  return [...found][0] ?? ''
}

const sortedUnique = (keys: Iterable<string>): string[] => [...new Set(keys)].sort()

/** The keys a recorded hook-set function tests as true, by the settings it reads them from. */
export function hookSwitchesOf(source: string): HookSwitches {
  const policy = POLICY_LOCAL.exec(source)?.[1]
  const onPolicy: string[] = []
  const onMerged: string[] = []
  for (const [, local, key] of source.matchAll(TESTED_TRUE)) {
    if (key === undefined) continue
    if (local === policy) onPolicy.push(key)
    else onMerged.push(key)
  }
  if (policy === undefined || onPolicy.length + onMerged.length === 0) {
    throw new Error(`The recorded hook-set function tests no settings key as true: ${source}`)
  }
  // The merged settings the host tests include the managed ones.
  return { managed: sortedUnique([...onPolicy, ...onMerged]), every_source: sortedUnique(onMerged) }
}

const escaped = (name: string): string => name.replaceAll('$', '\\$')

/** One match of `pattern` in the host text, its first group; refuses none, or two that differ. */
function onlyOne(text: string, pattern: RegExp, what: string): RegExpMatchArray {
  const found = [...text.matchAll(pattern)]
  const distinct = new Set(found.map((match) => match[0]))
  if (distinct.size !== 1) throw new Error(`The host text holds ${String(distinct.size)} of ${what}, not one: where it reads managed settings cannot be derived.`)
  const [first] = found
  if (first === undefined) throw new Error(`The host text holds no ${what}.`)
  return first
}

/** Where a host's text says it reads managed settings on Linux. */
export function managedSettingsPlaceIn(text: string): ManagedSettingsPlace {
  const dir = onlyOne(text, /case"windows":return"[^"]*";default:return"(\/[^"]+)"\}/g, 'the Linux managed settings folder')[1]
  const dropIn = onlyOne(text, /getDropInDir\(\)\{return this\.dropInDir\?\?=[\w$]+\(([\w$]+)\(\),"([^"]+)"\)/g, 'the managed drop-in folder')
  const [, folderOf, drop_in] = dropIn
  if (dir === undefined || folderOf === undefined || drop_in === undefined) throw new Error('The managed settings place cannot be read from the host.')
  const file = onlyOne(
    text,
    new RegExp(`function [\\w$]+\\(\\)\\{return [\\w$]+\\(${escaped(folderOf)}\\(\\),"([^"]*settings\\.json)"\\)\\}`, 'g'),
    'the managed settings file',
  )[1]
  if (file === undefined) throw new Error('The managed settings file cannot be read from the host.')
  return { dir, file, drop_in }
}

/** A settings file the host reads; `text` is undefined when there is no such file. */
export interface HookSettingsFile {
  readonly path: string
  readonly text: string | undefined
  /** A managed file, where the host honours every switch. */
  readonly managed: boolean
}

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
  const on = (file.managed ? switches.managed : switches.every_source).filter((key) => !isOff(parsed[key]))
  if (on.length === 0) return undefined
  return `${file.path} sets ${on.join(', ')}, which turns off the hooks Martha's gates run in, so a member would run ungated; remove it from that file`
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
function dropInFiles(folder: string): string[] {
  try {
    return readdirSync(folder)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => join(folder, name))
  } catch {
    return []
  }
}

/** The settings files a member's host reads, read again each time it is asked. */
export interface HookSettingsWatch {
  /** The owner's user settings file. */
  readonly owners_file: string
  /** Why the files now turn Martha's relay off, or undefined. */
  check(): string | undefined
}

export interface HookSettingsPlaces {
  /** The owner's user settings file (userSettingsPath). */
  readonly user: string
  /** The approved copy the host is given by --settings, if any. */
  readonly approved: string | undefined
  readonly managed: ManagedSettingsPlace
  readonly switches: HookSwitches
}

/** Watches the settings files a member's host reads for a switch that turns Martha's relay off. */
export function hookSettingsWatch({ user, approved, managed, switches }: HookSettingsPlaces): HookSettingsWatch {
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
    const reasons = [...unread, settingsTurningHooksOff(files, switches)].filter((reason) => reason !== undefined)
    return reasons.length > 0 ? reasons.join('; ') : undefined
  }
  return { owners_file: user, check }
}

/** A path as the file system resolves it: links followed as far as the path exists. */
function realPathOf(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPathOf(parent), basename(path))
  }
}

/** The tool call arguments that name the file a file tool reads or writes. */
const FILE_ARGUMENTS = ['file_path', 'notebook_path'] as const

/** Why a tool call names the owner's user settings file, or undefined. */
export function namesTheOwnersSettings(input: Readonly<Record<string, unknown>>, owners_file: string, cwd: string): string | undefined {
  const owners = realPathOf(owners_file)
  for (const argument of FILE_ARGUMENTS) {
    const value = input[argument]
    if (typeof value !== 'string' || value === '') continue
    if (realPathOf(resolve(cwd, value)) === owners) {
      return `${value} is the owner's Claude Code user settings file (${owners_file}), which a member does not touch: a key in it can turn off the hooks Martha's gates run in, for this member and every member after it`
    }
  }
  return undefined
}
