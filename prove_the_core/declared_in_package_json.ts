// What package.json declares about the core's files, read in one place.
//
// Every check on the core asks the same questions of package.json: which files
// are tests, and which programs its scripts run. The patterns that read the
// answers live here, once, so two checks can never disagree on what a test is.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The core's directory, relative to the repository. */
export const CORE = 'src'

export interface Manifest {
  readonly scripts: Readonly<Record<string, string>>
  readonly martha?: {
    readonly hostContract?: string
    readonly hostGlue?: readonly string[]
    readonly hostAdapters?: readonly string[]
    readonly packageImports?: Readonly<Record<string, string>>
  }
}

/** The repository's package.json. */
export const manifestOf = (repository: string): Manifest =>
  JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8')) as Manifest

/** Text as a regular expression matches it literally. */
export const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const TEST_SCRIPT = 'test'

/** The endings of the test files the test script runs under the core, such as `.node-test.ts`. */
export function testSuffixesOf(manifest: Manifest): string[] {
  const glob = new RegExp(`'${escaped(CORE)}/\\*\\*/\\*([^']+)'`, 'g')
  return [...(manifest.scripts[TEST_SCRIPT] ?? '').matchAll(glob)].map((match) => match[1] ?? '')
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
 * on it: the first segment of every file or glob it names, quoted or not. One
 * that names no folder (a file or glob at the repository's top) is thrown, by
 * name, rather than skipped.
 */
export function codeFoldersOf(manifest: Manifest): string[] {
  return (manifest.scripts[TEST_SCRIPT] ?? '')
    .split(/\s+/)
    .filter((word, index) => word !== '' && !(index === 0 && word === 'node') && !word.startsWith('-'))
    .map((word) => word.replace(/^(['"])(.*)\1$/, '$2'))
    .map((path) => {
      const folder = /^([^/*?[\]{}]+)\//.exec(path)?.[1]
      if (folder === undefined) throw new Error(`the test script runs '${path}', which names no folder to scan`)
      return folder
    })
}

/** Each package code may import, with the one folder whose files may import it. */
export const packageImportsOf = (manifest: Manifest): Readonly<Record<string, string>> =>
  manifest.martha?.packageImports ?? {}

/** Whether a path under the core is a test file the test script runs. */
export const isTestFile = (test_suffixes: readonly string[], path: string): boolean =>
  test_suffixes.some((suffix) => path.endsWith(suffix))
