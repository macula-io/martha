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
//     of the host binary (recorded_claude_code_host.json, hooks_switches), and
//     every function an exit of it calls (hooks_switch_calls).
//     `hookSwitchesOf` reads which keys it tests as `=== true`, and on which
//     settings: the managed ones alone, or the merged ones every file feeds;
//     and what each called function tests: safe mode (a variable or a flag),
//     or a key of the policy settings. Every statement and every exit of the
//     function must have a shape this module knows, so a host that adds a way
//     to drop hooks fails the recording instead of passing it (Pluto's r=1);
//   - a launch is refused while a settings file the host reads sets one: the
//     owner's user settings, the approved --settings copy, and the managed file
//     and drop-in folder, whose place the recorder also takes from the host;
//   - an exit that fires only when the host runs with no terminal (2.1.319:
//     CLAUDE_CODE_IGNORE_PERSISTED_TRUST set in print mode) is recorded and
//     refused nothing: a member always has a terminal, and the relay's hooks
//     ran on that exit in a live probe (`outside_a_terminal`);
//   - a launch is refused while safe mode is on: its variable in the
//     launcher's environment or in a settings file's env, or its flag among
//     the owner's arguments (`safeModeIn`, `switchesSetIn`);
//   - a launch is refused, and a running member stopped, while the owner's
//     user settings or the managed settings declare a hook or enable a plugin,
//     which would print into the member's session with nothing recorded
//     (martha#121, ./hooks_and_plugins_the_owner_declares.ts);
//   - a member's file tool call that names the owner's user settings file is
//     denied, the path resolved the way the host resolves it: trimmed, with a
//     leading `~` against the host's home (`namesTheOwnersSettings`). Reads are
//     denied too; that is no secrecy control, since a shell can still read it;
//   - a shell can write that file in ways its text does not show, and the host
//     may drop its hooks as soon as it reloads the file, so the launcher reads
//     the files again on a timer of its own for the member's whole life, as
//     well as after every call (`hookSettingsWatch`), and stops the member when
//     one now sets a switch.
//
// Only `false` (or `null`) leaves a switch off here: the host reads some other
// values as on, and a value it would read as off costs the owner only a
// refusal that names the file and the key.

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { asTheHostResolves } from './claude_code_file_tools.ts'

import { hooksAndPluginsDeclaredIn, hooksInFrontmatterOf, MANAGED_MARKDOWN_FOLDER, SKILLS_KIND, SYNCED_SKILLS_FOLDER, SYNC_OFF_SETTING, TRASH_FOLDER, type OwnersMarkdown } from './hooks_and_plugins_the_owner_declares.ts'

/** How safe mode is switched on: by a variable in the host's environment, or by a flag on its command line. */
export interface SafeMode {
  readonly variables: readonly string[]
  readonly flags: readonly string[]
}

/** The keys that turn Martha's relay off, by where the host honours them, and safe mode. */
export interface HookSwitches {
  /** Honoured from managed settings: what the policy settings are tested for, and what every source is. */
  readonly managed: readonly string[]
  /** Honoured from any settings file the session loaded. */
  readonly every_source: readonly string[]
  /** Safe mode, which keeps managed hooks only. */
  readonly safe_mode: SafeMode
  /**
   * Variables that narrow the hook set only when the host runs with no
   * terminal: it then keeps the user, --settings and policy hooks. A member
   * always has one (martha start refuses without it, and passes no -p), and a
   * live probe on 2.1.319 showed the relay's hooks run on this exit anyway
   * (martha#122 r=3), so nothing is refused for them; they are recorded so a
   * host that changes the exit fails the recording.
   */
  readonly outside_a_terminal: readonly string[]
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

// The statements the hook-set function is made of, by shape: it reads the
// policy settings and the merged settings into locals, tests them, and returns
// the merged hooks through one function.
const POLICY_READ = /^let ([\w$]+)=[\w$]+\("policySettings"\)$/
const MERGED_READ = /^let ([\w$]+)=[\w$]+\(\)$/
const MERGED_RETURN = /^return [\w$]+\(([\w$]+)\.hooks\?\?\{\}\)$/
// What an exit's condition may test: a settings key as true, or a call.
const TESTED_TRUE = /^([\w$]+)\??\.([\w$]+)===!0$/
const CALLED = /^([\w$]+)\((?:"[^"]*")?\)$/

// The functions an exit may call, by shape. Safe mode: a variable of the
// host's environment, or a flag of its command line.
const SAFE_MODE_SHAPE = /^function ([\w$]+)\(\)\{return [\w$]+\(process\.env\.([A-Z0-9_]+)\)\|\|[\w$]+\("(--[a-z-]+)"\)\}$/
// A key of the policy settings: true, or a list naming what was asked for.
const POLICY_KEY_SHAPE =
  /^function ([\w$]+)\(([\w$]+)\)\{let ([\w$]+)=[\w$]+\("policySettings"\)\?\.([\w$]+);if\(\3===!0\)return!0;if\(Array\.isArray\(\3\)\)return \3\.includes\(\2\);return!1\}$/
// Two calls that must both be true (2.1.319): the host has no terminal, and a
// variable of its environment is set.
const BOTH_SHAPE = /^function ([\w$]+)\(\)\{return ([\w$]+)\(\)&&([\w$]+)\(\)\}$/
const NO_TERMINAL_SHAPE = /^function ([\w$]+)\(\)\{return![\w$]+\(\)\.host\.launchOptions\.isInteractive\(\)\}$/
const VARIABLE_SET_SHAPE = /^function ([\w$]+)\(\)\{return [\w$]+\(\(\)=>[\w$]+\.([A-Z0-9_]+)\)\}$/

const CLOSER: Readonly<Record<string, string>> = { '{': '}', '(': ')', '[': ']' }

/** The index just past the bracket that closes the one opened at `open`, skipping string literals. */
export function closingBrace(text: string, open: number): number {
  const opener = text[open] ?? ''
  const closer = CLOSER[opener]
  let depth = 0
  for (let at = open; at < text.length; at += 1) {
    const char = text[at]
    if (char === '"' || char === "'" || char === '`') {
      at = endOfString(text, at)
      continue
    }
    if (char === opener) depth += 1
    if (char === closer) depth -= 1
    if (depth === 0) return at + 1
  }
  throw new Error('A function of the hook set never closes in the host text.')
}

/** How a character changes the bracket depth: an opener deepens it, a closer lifts it. */
function depthChangeOf(char: string): number {
  if (char in CLOSER) return 1
  return char === ')' || char === '}' || char === ']' ? -1 : 0
}

/** The index of the first `;` at `at` or after it, outside brackets and strings; or the end. */
function endOfStatement(text: string, at: number): number {
  let depth = 0
  for (let next = at; next < text.length; next += 1) {
    const char = text[next] ?? ''
    if (char === '"' || char === "'" || char === '`') next = endOfString(text, next)
    else if (char === ';' && depth === 0) return next
    else depth += depthChangeOf(char)
  }
  return text.length
}

/** One top-level statement of a function's body; an `if` keeps the condition apart from what it guards. */
type Statement = { readonly text: string; readonly condition?: string }

/** The statement that starts at `at`, and the index just past it. */
function statementAt(body: string, at: number): { readonly statement: Statement; readonly end: number } {
  if (!body.startsWith('if(', at)) {
    const end = endOfStatement(body, at)
    return { statement: { text: body.slice(at, end) }, end }
  }
  const closed = closingBrace(body, at + 2)
  const end = body[closed] === '{' ? closingBrace(body, closed) : endOfStatement(body, closed)
  return { statement: { text: body.slice(at, end), condition: body.slice(at + 3, closed - 1) }, end }
}

/** The top-level statements of a function's body, in order. */
function statementsOf(source: string): Statement[] {
  const open = source.indexOf('{')
  const body = source.slice(open + 1, closingBrace(source, open) - 1)
  const statements: Statement[] = []
  for (let at = 0; at < body.length; ) {
    const { statement, end } = statementAt(body, at)
    statements.push(statement)
    at = end
    while (body[at] === ';') at += 1
  }
  return statements
}

/** The parts of a condition joined by `||` or `&&` outside brackets. */
function partsOf(condition: string): string[] {
  const parts: string[] = []
  let start = 0
  for (let at = 0; at < condition.length; at += 1) {
    const char = condition[at] ?? ''
    if (char in CLOSER) at = closingBrace(condition, at) - 1
    else if ((char === '|' || char === '&') && condition[at + 1] === char) {
      parts.push(condition.slice(start, at))
      start = at + 2
      at += 1
    }
  }
  return [...parts, condition.slice(start)]
}

/** What one part of an exit's condition tests: a key of a local as true, or a call. */
type Tested = { readonly local: string; readonly key: string } | { readonly call: string }

/** The tests of the hook-set function's exits; refuses a statement or a test of no known shape. */
function exitsOf(source: string): { readonly policy: string; readonly tested: readonly Tested[] } {
  let policy: string | undefined
  const tested: Tested[] = []
  for (const { text, condition } of statementsOf(source)) {
    if (condition !== undefined) tested.push(...partsOf(condition).map(testedBy))
    else if (POLICY_READ.test(text)) policy = POLICY_READ.exec(text)?.[1]
    else if (!MERGED_READ.test(text) && !MERGED_RETURN.test(text)) {
      throw new Error(`The hook-set function holds a statement of no known shape, so what it drops hooks on cannot be told: ${text}`)
    }
  }
  if (policy === undefined) throw new Error(`The hook-set function reads no policy settings: ${source}`)
  return { policy, tested }
}

/** One part of an exit's condition, by its shape; refuses any other. */
function testedBy(part: string): Tested {
  const key = TESTED_TRUE.exec(part)
  if (key?.[1] !== undefined && key[2] !== undefined) return { local: key[1], key: key[2] }
  const call = CALLED.exec(part)?.[1]
  if (call !== undefined) return { call }
  throw new Error(`An exit of the hook-set function tests ${part}, of no known shape, so when it drops hooks cannot be told.`)
}

/** What a function an exit calls switches hooks by. */
type ExitCall = { readonly name: string; readonly safe_mode?: SafeMode; readonly policy_key?: string; readonly outside_a_terminal?: string }

/** The variable an exit of both shapes tests, its parts found among `calls`; undefined for no known shape. */
function noTerminalExitOf(definition: string, calls: readonly string[]): ExitCall | undefined {
  const [, name, first, second] = BOTH_SHAPE.exec(definition) ?? []
  if (name === undefined) return undefined
  const noTerminal = calls.some((call) => NO_TERMINAL_SHAPE.exec(call)?.[1] === first)
  const variable = calls.map((call) => VARIABLE_SET_SHAPE.exec(call)).find((match) => match?.[1] === second)?.[2]
  return noTerminal && variable !== undefined ? { name, outside_a_terminal: variable } : undefined
}

/** What a function an exit calls switches hooks by, from its definition and the parts it calls; undefined for no known shape. */
function exitCallOf(definition: string, calls: readonly string[]): ExitCall | undefined {
  const safe = SAFE_MODE_SHAPE.exec(definition)
  if (safe?.[1] !== undefined && safe[2] !== undefined && safe[3] !== undefined) {
    return { name: safe[1], safe_mode: { variables: [safe[2]], flags: [safe[3]] } }
  }
  const key = POLICY_KEY_SHAPE.exec(definition)
  if (key?.[1] !== undefined && key[4] !== undefined) return { name: key[1], policy_key: key[4] }
  return noTerminalExitOf(definition, calls)
}

const callsOf = (tested: readonly Tested[]): string[] => [...new Set(tested.flatMap((test) => ('call' in test ? [test.call] : [])))]

const noKnownShape = (call: string): Error =>
  new Error(`An exit of the hook-set function calls ${call}(), a function of no known shape, so when it drops hooks cannot be told.`)

/** The one definition of `name` in the host text that `shaped` accepts; undefined for none, or two that differ. */
function onlyShaped(text: string, name: string, shaped: (definition: string) => boolean): string | undefined {
  const known = new Set<string>()
  for (const match of text.matchAll(new RegExp(`function ${escaped(name)}\\(`, 'g'))) {
    const definition = text.slice(match.index, closingBrace(text, text.indexOf('{', match.index)))
    if (shaped(definition)) known.add(definition)
  }
  return known.size === 1 ? [...known][0] : undefined
}

/** An exit of both shapes and its two parts, cut whole from the host text; undefined for no known shape. */
function noTerminalExitIn(text: string, call: string): string[] | undefined {
  const both = onlyShaped(text, call, (definition) => BOTH_SHAPE.exec(definition)?.[1] === call)
  const [, , first, second] = BOTH_SHAPE.exec(both ?? '') ?? []
  if (both === undefined || first === undefined || second === undefined) return undefined
  const parts = [onlyShaped(text, first, (definition) => NO_TERMINAL_SHAPE.test(definition)), onlyShaped(text, second, (definition) => VARIABLE_SET_SHAPE.test(definition))]
  const found = parts.filter((part) => part !== undefined)
  return found.length === parts.length ? [both, ...found] : undefined
}

/**
 * Each function the hook-set function's exits call, cut whole from the host
 * text, in the order first called, an exit of both shapes followed by its two
 * parts; refuses one of no known shape.
 */
export function hookExitCallsIn(text: string, source: string): string[] {
  return callsOf(exitsOf(source).tested).flatMap((call) => {
    const direct = onlyShaped(text, call, (definition) => exitCallOf(definition, [])?.name === call)
    if (direct !== undefined) return [direct]
    const both = noTerminalExitIn(text, call)
    if (both === undefined) throw noKnownShape(call)
    return both
  })
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

/** What the functions the exits call switch on: keys of the policy settings, safe mode, and variables read only with no terminal. */
function switchedByCalls(
  tested: readonly Tested[],
  calls: readonly string[],
): { readonly policy_keys: string[]; readonly safe_mode: SafeMode; readonly outside_a_terminal: string[] } {
  const known = calls.map((call) => exitCallOf(call, calls))
  const found = callsOf(tested).map((call) => known.find((candidate) => candidate?.name === call) ?? call)
  const unknown = found.find((call) => typeof call === 'string')
  if (unknown !== undefined) throw noKnownShape(unknown)
  const shaped = found.filter((call) => typeof call !== 'string')
  return {
    policy_keys: shaped.flatMap((call) => (call.policy_key === undefined ? [] : [call.policy_key])),
    safe_mode: {
      variables: sortedUnique(shaped.flatMap((call) => call.safe_mode?.variables ?? [])),
      flags: sortedUnique(shaped.flatMap((call) => call.safe_mode?.flags ?? [])),
    },
    outside_a_terminal: sortedUnique(shaped.flatMap((call) => (call.outside_a_terminal === undefined ? [] : [call.outside_a_terminal]))),
  }
}

/** The keys a recorded hook-set function tests as true, by the settings it reads them from, and what the functions its exits call switch on. */
export function hookSwitchesOf(source: string, calls: readonly string[]): HookSwitches {
  const { policy, tested } = exitsOf(source)
  const keys = tested.flatMap((test) => ('key' in test ? [test] : []))
  const { policy_keys, safe_mode, outside_a_terminal } = switchedByCalls(tested, calls)
  const onPolicy = [...keys.filter((test) => test.local === policy).map((test) => test.key), ...policy_keys]
  const onMerged = keys.filter((test) => test.local !== policy).map((test) => test.key)
  if (onPolicy.length + onMerged.length === 0) {
    throw new Error(`The recorded hook-set function tests no settings key as true: ${source}`)
  }
  // The merged settings the host tests include the managed ones.
  return { managed: sortedUnique([...onPolicy, ...onMerged]), every_source: sortedUnique(onMerged), safe_mode, outside_a_terminal }
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

const DROP_IN_GETTER = /getDropInDir\(\)\{return this\.dropInDir\?\?=[\w$]+\(([\w$]+)\(\),"([^"]+)"\)/g

/** The name of the host's function that returns its managed folder: the one its managed drop-in folder is joined to (martha#146). */
export function managedFolderFunctionIn(text: string): string {
  const folderOf = onlyOne(text, DROP_IN_GETTER, 'the managed drop-in folder')[1]
  if (folderOf === undefined) throw new Error('The function that returns the managed folder cannot be read from the host.')
  return folderOf
}

/** Where a host's text says it reads managed settings on Linux. */
export function managedSettingsPlaceIn(text: string): ManagedSettingsPlace {
  const dir = onlyOne(text, /case"windows":return"[^"]*";default:return"(\/[^"]+)"\}/g, 'the Linux managed settings folder')[1]
  const dropIn = onlyOne(text, DROP_IN_GETTER, 'the managed drop-in folder')
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
  /** A skill the host synced from the owner's Claude account, which it writes again at every start (martha#243). */
  readonly synced?: boolean
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
  return kinds.flatMap((kind) => [join(dirname(user), kind), join(managed.dir, MANAGED_MARKDOWN_FOLDER, kind)])
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
  const skillsFolders = new Set([join(dirname(user), SKILLS_KIND), join(managed.dir, MANAGED_MARKDOWN_FOLDER, SKILLS_KIND)])
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
export const FILE_ARGUMENTS = ['file_path', 'notebook_path'] as const

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
