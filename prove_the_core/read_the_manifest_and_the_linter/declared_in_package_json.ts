// What package.json declares about the core's files, read in one place.
//
// Every check on the core asks the same questions of package.json: which files
// are tests, and which programs its scripts run. The patterns that read the
// answers live here, once, so two checks can never disagree on what a test is.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'

/** The core's directory, relative to the repository. */
export const CORE = 'src'

/** Every package in martha whose tests npm test runs, by folder: the repository's and the installer's. */
export const PACKAGES: readonly string[] = ['.', 'installer']

/** The script package.json runs the host ceiling check by: the words a landing runs and a failure prints come from here. */
export const HOST_CEILINGS_SCRIPT = 'check:host-ceilings'

export interface Manifest {
  readonly scripts: Readonly<Record<string, string>>
  readonly martha?: {
    readonly hostContract?: string
    readonly hostGlue?: readonly string[]
    readonly hostAdapters?: readonly string[]
    /** Files inside a host adapter that are decisions, not the adapter's machinery (martha#158). */
    readonly decisionFiles?: readonly string[]
    /** How many code lines each host directory may hold, by the directory package.json declares (martha#322). */
    readonly hostCeilings?: Readonly<Record<string, number>>
    /** How many code lines any core slice may hold (martha#415). */
    readonly sliceCap?: number
    /** The core slices measured above the cap, each at its own ceiling (martha#415). */
    readonly sliceCeilings?: Readonly<Record<string, number>>
    /** The directories only one program loads, each mapped to that program's directory, both as <core>/<directory> (martha#443). */
    readonly programParts?: Readonly<Record<string, string>>
    readonly packageImports?: Readonly<Record<string, string>>
    readonly loaderImports?: Readonly<Record<string, string>>
  }
}

/**
 * Where a repository's manifest is: the path a check reads, or writes, without naming the file itself (martha#256
 * r=3). The name stays private to the module that reads the manifest, so a check gets the path where the manifest is
 * read rather than reaching into an unrelated slice for a name, and no new exported constant asks the tree's other
 * literals to import it.
 */
export const manifestPathOf = (repository: string): string => join(repository, MANIFEST)

const MANIFEST = 'package.json'

/** The repository's package.json, as the text on disk: what a reader that must see every declaration reads (martha#753). */
export const manifestTextOf = (repository: string): string => readFileSync(manifestPathOf(repository), 'utf8')

/** The repository's package.json. */
export const manifestOf = (repository: string): Manifest => JSON.parse(manifestTextOf(repository)) as Manifest

/**
 * A key one object of the manifest declares more than once (martha#753): its path from the root, dotted, with an
 * array's index in brackets, and each declaration's line and spelling, in the order the file holds them.
 */
export interface KeyDeclaredTwice {
  readonly key: string
  readonly lines: readonly number[]
  readonly spellings: readonly string[]
}

/**
 * Every key some object of `text` declares more than once, at any depth, arrays included (martha#753). `JSON.parse`
 * keeps the last declaration and drops the others without a word, so this reads the text with the compiler's own JSON
 * parser, which keeps them all. Names are compared decoded, as `JSON.parse` compares them: `"a"` and `"\u0061"` are one.
 */
export function keysDeclaredTwice(text: string): KeyDeclaredTwice[] {
  const file = ts.parseJsonText(MANIFEST, text)
  const root = file.statements[0]?.expression
  return root === undefined ? [] : twiceUnder(root, '', file)
}

/** The keys declared twice in `node` and everything under it, `path` being where `node` stands. */
function twiceUnder(node: ts.Expression, path: string, file: ts.JsonSourceFile): KeyDeclaredTwice[] {
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((element, at) => twiceUnder(element, `${path}[${String(at)}]`, file))
  }
  if (!ts.isObjectLiteralExpression(node)) return []
  const named = node.properties.filter(ts.isPropertyAssignment)
  const under = named.flatMap((property) => twiceUnder(property.initializer, keyAt(path, nameOf(property, file)), file))
  return [...twiceIn(named, path, file), ...under]
}

/** The keys one object declares twice, each with every line and spelling it is declared at. */
function twiceIn(named: readonly ts.PropertyAssignment[], path: string, file: ts.JsonSourceFile): KeyDeclaredTwice[] {
  const by_name = new Map<string, ts.PropertyAssignment[]>()
  for (const property of named) by_name.set(nameOf(property, file), [...(by_name.get(nameOf(property, file)) ?? []), property])
  return [...by_name]
    .filter(([, declared]) => declared.length > 1)
    .map(([name, declared]) => ({
      key: keyAt(path, name),
      lines: declared.map((property) => file.getLineAndCharacterOfPosition(property.name.getStart(file)).line + 1),
      spellings: declared.map((property) => property.name.getText(file)),
    }))
}

/** A property's name decoded, as `JSON.parse` reads it; a name JSON cannot hold is kept as written. */
const nameOf = (property: ts.PropertyAssignment, file: ts.JsonSourceFile): string =>
  ts.isStringLiteral(property.name) || ts.isIdentifier(property.name) || ts.isNumericLiteral(property.name)
    ? property.name.text
    : property.name.getText(file)

/** The dotted path of `name` inside the object at `path`. */
const keyAt = (path: string, name: string): string => (path === '' ? name : `${path}.${name}`)

/** One key declared twice, in the words a check prints and a writer refuses with. */
export const aKeyDeclaredTwiceInWords = (twice: KeyDeclaredTwice): string =>
  `${MANIFEST} declares ${twice.key} ${String(twice.lines.length)} times, at ` +
  `${twice.lines.map((line, at) => `line ${String(line)} (${twice.spellings[at] ?? ''})`).join(' and ')}: ` +
  'JSON.parse keeps the last and hides the rest'

/** Refuses a manifest text that declares a key twice, naming each one: a writer that parsed it would drop one unseen. */
export function refuseKeysDeclaredTwice(text: string): void {
  const twice = keysDeclaredTwice(text)
  if (twice.length > 0) throw new Error(twice.map(aKeyDeclaredTwiceInWords).join('\n'))
}

/** Text as a regular expression matches it literally. */
export const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const TEST_SCRIPT = 'test'

/** A named path is a glob when it holds a wildcard; the runner and its flags name no paths. */
const GLOB = /\*/

/**
 * Every glob the test script names, as written, such as `src/**\/*.node-test.ts`
 * and `rehearse_a_release/**\/*.node-test.mjs` (martha#274). A glob is quoted in
 * the script; the program `node` and its flags are not, so only quoted words are
 * read. The one definition the other readers below are built on.
 */
export function testGlobsOf(manifest: Manifest): string[] {
  const quoted = /'([^']+)'/g
  return [...(manifest.scripts[TEST_SCRIPT] ?? '').matchAll(quoted)]
    .map((match) => match[1] ?? '')
    .filter((named) => GLOB.test(named))
}

/** The endings of the test files the test script runs under the core, such as `.node-test.ts`. */
export function testSuffixesOf(manifest: Manifest): string[] {
  const underCore = new RegExp(`^${escaped(CORE)}/\\*\\*/\\*([^*]+)$`)
  return testGlobsOf(manifest).flatMap((glob) => {
    const suffix = underCore.exec(glob)?.[1]
    return suffix === undefined ? [] : [suffix]
  })
}

/** The directories under the core holding a program another script runs with node. */
export function programsRunByScriptsOf(manifest: Manifest): string[] {
  const run = new RegExp(`\\bnode\\s+${escaped(CORE)}/([^/\\s]+)/`, 'g')
  return Object.entries(manifest.scripts)
    .filter(([name]) => name !== TEST_SCRIPT)
    .flatMap(([, command]) => [...command.matchAll(run)].map((match) => match[1] ?? ''))
}

/** A <core>/<directory> entry of the manifest's martha section, as the directory alone. */
const directoryOf = (entry: string): string => entry.replace(new RegExp(`^${escaped(CORE)}/`), '')

/**
 * The parts of the programs the scripts run, each part's directory mapped to its program's (martha#443): directories
 * only that program loads, which the core's rules treat like the program itself.
 */
export function programPartsOf(manifest: Manifest): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(manifest.martha?.programParts ?? {}).map(([part, program]) => [directoryOf(part), directoryOf(program)]))
}

/** The directories the core's rules treat as programs: those a script runs with node, and every declared part of one. */
export function programsAndTheirPartsOf(manifest: Manifest): string[] {
  return [...programsRunByScriptsOf(manifest), ...Object.keys(programPartsOf(manifest))]
}

/** The word that runs the next command only when the one before it passed: the test script's commands' separator. */
export const THEN = '&&'
/** The words that start a command with a variable unset: `env -u <name>`. */
const UNSET = ['env', '-u'] as const

/**
 * The test script's commands, each as its words, in the order they run (martha#383): split on THEN, with each
 * command's leading `env -u <name>` taken off and its name kept in `unsets`.
 */
export function testCommandsOf(manifest: Manifest): { readonly unsets: readonly string[]; readonly words: readonly string[] }[] {
  const words = (manifest.scripts[TEST_SCRIPT] ?? '').split(/\s+/).filter((word) => word !== '')
  const commands: string[][] = [[]]
  for (const word of words) {
    if (word === THEN) commands.push([])
    else commands.at(-1)?.push(word)
  }
  return commands.map((command) => {
    const unsets: string[] = []
    while (command[0] === UNSET[0] && command[1] === UNSET[1] && command[2] !== undefined) unsets.push(command.splice(0, 3)[2] ?? '')
    return { unsets, words: command }
  })
}

/**
 * The folders whose code the test script runs, such as the core and the checks
 * on it: the first segment of every file or glob it names, quoted or not, the
 * runner node --test is started through included (martha#92). The word `node`
 * is the program, wherever it stands, and a leading ./ is the repository's top.
 * One that names no folder (a file or glob at the repository's top) is thrown,
 * by name, rather than skipped. Each folder is named once. THEN between commands
 * and an `env -u <name>` before one name no folder (testCommandsOf).
 */
export function codeFoldersOf(manifest: Manifest): string[] {
  const folders = testCommandsOf(manifest)
    .flatMap((command) => command.words)
    .filter((word) => word !== 'node' && !word.startsWith('-'))
    .map((word) => word.replace(/^(['"])(.*)\1$/, '$2').replace(/^\.\//, ''))
    .map((path) => {
      const folder = /^([^/*?[\]{}]+)\//.exec(path)?.[1]
      if (folder === undefined) throw new Error(`the test script runs '${path}', which names no folder to scan`)
      return folder
    })
  return [...new Set(folders)]
}

/**
 * Each file that may import one of Node's modules that load others by name,
 * with that module: a reviewed decision per file, never per folder.
 */
export const loaderImportsOf = (manifest: Manifest): Readonly<Record<string, string>> =>
  manifest.martha?.loaderImports ?? {}

/** Each package code may import, with the one folder whose files may import it. */
export const packageImportsOf = (manifest: Manifest): Readonly<Record<string, string>> =>
  manifest.martha?.packageImports ?? {}

/** Whether a path under the core is a test file the test script runs. */
export const isTestFile = (test_suffixes: readonly string[], path: string): boolean =>
  test_suffixes.some((suffix) => path.endsWith(suffix))
