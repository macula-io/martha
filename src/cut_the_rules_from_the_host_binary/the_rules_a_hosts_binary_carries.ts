// The rules a host binary carries for turning Martha's relay off, cut out of it
// (martha#122, martha#443).
//
// Martha's gates run as a hooks module (../claude_code_relay). Claude Code
// builds a session's hook set in one function, which drops every hook, or every
// hook but managed ones, when a settings key it reads is true. A member runs as
// the owner's own OS user, so it can write such a key into the owner's user
// settings, and every member started after it runs with no gate.
//
// So nothing here is typed from the host's words: the recorder cuts that one
// function out of the host binary (recorded_claude_code_host.json,
// hooks_switches), and every function an exit of it calls (hooks_switch_calls).
// `hookSwitchesOf` reads which keys it tests as `=== true`, and on which
// settings: the managed ones alone, or the merged ones every file feeds; and
// what each called function tests: safe mode (a variable or a flag), or a key of
// the policy settings. Every statement and every exit of the function must have
// a shape this module knows, so a host that adds a way to drop hooks fails the
// recording instead of passing it (Pluto's r=1).
//
// Where the host reads managed settings on Linux — the folder, the file in it,
// and the drop-in folder in it — is read from its own text the same way, so the
// refusal in ../refuse_settings_that_turn_hooks_off names places a host that
// moves them cannot leave behind.
//
// An exit that fires only when the host runs with no terminal (2.1.319:
// CLAUDE_CODE_IGNORE_PERSISTED_TRUST set in print mode; 2.1.323: that variable
// or the --ignore-persisted-trust argument) is recorded and refuses nothing: a
// member always has a terminal, and the relay's hooks ran on that exit in a live
// probe (`outside_a_terminal`).
//
// `protected_config_places.ts` holds the other places the recorder cuts out of
// the binary: the config the host protects from being rewritten.

/** How safe mode is switched on: by a variable in the host's environment, or by a flag on its command line. */
export interface SafeMode {
  readonly variables: readonly string[]
  readonly flags: readonly string[]
}

/** How the exit for a host with no terminal narrows the hook set: a variable of its environment, or an argument of its command line. */
export interface OutsideATerminal {
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
   * The variable and the argument that narrow the hook set only when the host
   * runs with no terminal: it then keeps the user, --settings and policy
   * hooks. A member always has one (martha start refuses without it, and
   * passes no -p), and a live probe on 2.1.319 showed the relay's hooks run on
   * this exit anyway (martha#122 r=3), so nothing is refused for them; they
   * are recorded so a host that changes the exit fails the recording.
   */
  readonly outside_a_terminal: OutsideATerminal
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
// host's environment, or a flag of its command line. 2.1.323 appends a
// constant false (`||!1`), which is false whatever the rest says, so the
// expression means what 2.1.322's did; a constant true, which would switch
// safe mode on for everyone, is no shape here.
const SAFE_MODE_SHAPE = /^function ([\w$]+)\(\)\{return [\w$]+\(process\.env\.([A-Z0-9_]+)\)\|\|[\w$]+\("(--[a-z-]+)"\)(?:\|\|!1)?\}$/
// A key of the policy settings: true, or a list naming what was asked for.
const POLICY_KEY_SHAPE =
  /^function ([\w$]+)\(([\w$]+)\)\{let ([\w$]+)=[\w$]+\("policySettings"\)\?\.([\w$]+);if\(\3===!0\)return!0;if\(Array\.isArray\(\3\)\)return \3\.includes\(\2\);return!1\}$/
// Two calls that must both be true (2.1.319): the host has no terminal, and a
// variable of its environment is set.
const BOTH_SHAPE = /^function ([\w$]+)\(\)\{return ([\w$]+)\(\)&&([\w$]+)\(\)\}$/
const NO_TERMINAL_SHAPE = /^function ([\w$]+)\(\)\{return![\w$]+\(\)\.host\.launchOptions\.isInteractive\(\)\}$/
// The second of them, and what 2.1.323 added to it: the variable of its
// environment is set, or an argument of its command line is (a switch of its
// own, 2.1.323). A recording holds the argument as the flag it stands for,
// so every way into the exit can be read without the minifier's names.
const VARIABLE_SET_SHAPE = /^function ([\w$]+)\(\)\{return [\w$]+\(\(\)=>[\w$]+\.([A-Z0-9_]+)\)(?:\|\|process\.argv\.includes\("(--[a-z][a-z0-9-]*)"\))?\}$/
// The same function in a host's own text, where 2.1.323 names that argument
// through a constant; the recorder writes that constant as the flag it is
// defined as, so this shape takes the flag written whole as well. A recording
// rebuilt into a host text holds the flag itself, and `VARIABLE_SET_SHAPE` is
// what both a recording and a reader then hold.
const VARIABLE_OR_ARGUMENT_SHAPE =
  /^function ([\w$]+)\(\)\{return [\w$]+\(\(\)=>[\w$]+\.([A-Z0-9_]+)\)(?:\|\|process\.argv\.includes\((?:"(--[a-z][a-z0-9-]*)"|[\w$]+)\))?\}$/

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
type ExitCall = { readonly name: string; readonly safe_mode?: SafeMode; readonly policy_key?: string; readonly outside_a_terminal?: OutsideATerminal }

/** The variable and argument an exit of both shapes tests, its parts found among `calls`; undefined for no known shape. */
function noTerminalExitOf(definition: string, calls: readonly string[]): ExitCall | undefined {
  const [, name, first, second] = BOTH_SHAPE.exec(definition) ?? []
  if (name === undefined) return undefined
  const noTerminal = calls.some((call) => NO_TERMINAL_SHAPE.exec(call)?.[1] === first)
  const variable = calls.map((call) => VARIABLE_SET_SHAPE.exec(call)).find((match) => match?.[1] === second)
  if (!noTerminal || variable?.[2] === undefined) return undefined
  const flags = variable[3] === undefined ? [] : [variable[3]]
  return { name, outside_a_terminal: { variables: [variable[2]], flags } }
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
  const noTerminal = onlyShaped(text, first, (definition) => NO_TERMINAL_SHAPE.test(definition))
  const variable = onlyShaped(text, second, (definition) => VARIABLE_OR_ARGUMENT_SHAPE.test(definition))
  if (noTerminal === undefined || variable === undefined) return undefined
  return [both, noTerminal, withTheArgumentWrittenAsItsFlag(text, variable)]
}

/** A constant an argv test names, in a definition cut from a host's text. */
const ARGUMENT_CONSTANT = /process\.argv\.includes\(([\w$]+)\)/

/** The flag string a host's text defines a constant as; refuses none, or two that differ. */
function flagTheHostDefines(text: string, name: string): string {
  const found = text.matchAll(new RegExp(`(?<![\\w$])${escaped(name)}\\s*=\\s*"(--[a-z][a-z0-9-]*)"`, 'g'))
  const defined = [...new Set([...found].flatMap((match) => match[1] ?? []))]
  const [flag] = defined
  if (flag === undefined || defined.length !== 1) {
    throw new Error(`An exit of the hook-set function tests process.argv.includes(${name}), and the host text defines ${name} as ${String(defined.length)} command-line arguments, not one, so which switch it stands for cannot be told.`)
  }
  return flag
}

/**
 * A definition cut from a host's text with an argv test's constant written as
 * the flag string the host defines that constant as, so a recording names the
 * switch rather than a name the minifier picks, and a reader needs no host
 * text to tell what it is (`VARIABLE_SET_SHAPE`); a definition without such a
 * test is returned as it was cut.
 */
function withTheArgumentWrittenAsItsFlag(text: string, definition: string): string {
  return definition.replace(ARGUMENT_CONSTANT, (_test, name: string) => `process.argv.includes(${JSON.stringify(flagTheHostDefines(text, name))})`)
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

/** What the functions the exits call switch on: keys of the policy settings, safe mode, and what is read only with no terminal. */
function switchedByCalls(
  tested: readonly Tested[],
  calls: readonly string[],
): { readonly policy_keys: string[]; readonly safe_mode: SafeMode; readonly outside_a_terminal: OutsideATerminal } {
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
    outside_a_terminal: {
      variables: sortedUnique(shaped.flatMap((call) => call.outside_a_terminal?.variables ?? [])),
      flags: sortedUnique(shaped.flatMap((call) => call.outside_a_terminal?.flags ?? [])),
    },
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
