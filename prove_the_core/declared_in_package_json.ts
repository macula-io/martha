// What package.json declares about the core's files, read in one place.
//
// Every check on the core asks the same questions of package.json: which files
// are tests, and which programs its scripts run. The patterns that read the
// answers live here, once, so two checks can never disagree on what a test is.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The core's directory, relative to the repository. */
export const CORE = 'src'

/** Every package in martha whose tests npm test runs, by folder: the repository's and the installer's. */
export const PACKAGES: readonly string[] = ['.', 'installer']

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
    readonly packageImports?: Readonly<Record<string, string>>
    readonly loaderImports?: Readonly<Record<string, string>>
  }
}

/**
 * The manifest's own file name, named where the manifest is read (martha#256 r=3). Every check that writes or reads
 * one takes the name from here, so none of them reaches into an unrelated slice for it, and a change of name lands
 * once.
 */
export const MANIFEST = 'package.json'

/** The repository's package.json. */
export const manifestOf = (repository: string): Manifest =>
  JSON.parse(readFileSync(join(repository, MANIFEST), 'utf8')) as Manifest

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

/**
 * The folders whose code the test script runs, such as the core and the checks
 * on it: the first segment of every file or glob it names, quoted or not, the
 * runner node --test is started through included (martha#92). The word `node`
 * is the program, wherever it stands, and a leading ./ is the repository's top.
 * One that names no folder (a file or glob at the repository's top) is thrown,
 * by name, rather than skipped. Each folder is named once.
 */
export function codeFoldersOf(manifest: Manifest): string[] {
  const folders = (manifest.scripts[TEST_SCRIPT] ?? '')
    .split(/\s+/)
    .filter((word) => word !== '' && word !== 'node' && !word.startsWith('-'))
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
