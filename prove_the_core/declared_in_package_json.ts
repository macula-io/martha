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
  readonly martha?: { readonly hostContract?: string; readonly hostGlue?: readonly string[] }
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

/** Whether a path under the core is a test file the test script runs. */
export const isTestFile = (test_suffixes: readonly string[], path: string): boolean =>
  test_suffixes.some((suffix) => path.endsWith(suffix))
