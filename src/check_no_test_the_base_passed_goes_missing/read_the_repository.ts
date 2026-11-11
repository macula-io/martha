// What the dropped-test check reads from a repository (martha#274): the merge base of the branch and its base,
// the test files the base's own manifests name, both sides of every such file, and the claims the commits in the
// range make.
//
// Nothing here is a written list of files or tests: the file set comes from the globs the two test scripts name
// in package.json at the merge base, and the titles come from the files themselves.

import { spawnSync } from 'node:child_process'

import { PACKAGES, testGlobsOf, type Manifest } from '../../prove_the_core/declared_in_package_json.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import {
  claimsIn,
  testsTheBasePassedThatWentMissing,
  type Comparison,
  type Sources,
} from './check_no_test_the_base_passed_goes_missing.ts'

export type Scan =
  | { readonly verdict: 'compared'; readonly comparison: Comparison; readonly skipped: readonly string[] }
  /** The check could not be made, which is never a pass. */
  | { readonly verdict: 'unreadable'; readonly reason: string }

interface Patterns {
  readonly matchers: readonly RegExp[]
  /** The package folders whose manifest the merge base does not hold, so their tests could not have been there. */
  readonly skipped: readonly string[]
}

interface Unreadable {
  readonly reason: string
}

const unreadable = (reason: string): Unreadable => ({ reason })

/** What git answered, or undefined when it refused; a refusal is never read as an empty answer. */
const git = (repository: string, args: readonly string[]): string | undefined => {
  const answer = spawnSync('git', ['-C', repository, ...marthasOwnGitArgs(args)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return answer.status === 0 ? answer.stdout : undefined
}

const commitAt = (repository: string, revision: string): string | undefined => {
  const resolved = git(repository, ['rev-parse', '--verify', '--quiet', `${revision}^{commit}`])
  return resolved === undefined ? undefined : resolved.trim()
}

const mergeBaseBetween = (repository: string, base: string, head: string): string | undefined => {
  const answered = git(repository, ['merge-base', base, head])
  return answered === undefined ? undefined : answered.trim()
}

const pathsAt = (repository: string, revision: string): readonly string[] | undefined => {
  const listed = git(repository, ['ls-tree', '-r', '--name-only', '-z', revision])
  return listed === undefined ? undefined : listed.split('\0').filter((path) => path !== '')
}

const textAt = (repository: string, revision: string, path: string): string | undefined =>
  git(repository, ['show', `${revision}:${path}`])

/** The globs of a test script as matchers for a repository path; a package's globs are relative to it. */
const matchersFor = (folder: string, globs: readonly string[]): RegExp[] => {
  const prefix = folder === '.' ? '' : `${folder}/`
  return globs.map((glob) => new RegExp(`^${prefix}${globAsRegex(glob)}$`))
}

/** A glob as a regular expression for one path: `**` crosses a folder, `*` and `?` do not. */
const globAsRegex = (glob: string): string =>
  glob
    .split('**')
    .map((part) =>
      part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'),
    )
    .join('.*')

/** The test patterns of every package's manifest at the merge base, and the packages that have none there. */
const patternsAt = (repository: string, mergeBase: string, paths: readonly string[]): Patterns | Unreadable => {
  const matchers: RegExp[] = []
  const skipped: string[] = []
  for (const folder of PACKAGES) {
    const manifestPath = folder === '.' ? 'package.json' : `${folder}/package.json`
    if (!paths.includes(manifestPath)) {
      skipped.push(folder)
      continue
    }
    const read = readingManifestAt(repository, mergeBase, manifestPath)
    if ('reason' in read) return read
    matchers.push(...matchersFor(folder, testGlobsOf(read.manifest)))
  }
  return matchers.length === 0 ? unreadable(`no test script at ${mergeBase} names a glob`) : { matchers, skipped }
}

const readingManifestAt = (
  repository: string,
  revision: string,
  path: string,
): { readonly manifest: Manifest } | Unreadable => {
  const text = textAt(repository, revision, path)
  if (text === undefined) return unreadable(`${path} at ${revision} could not be read`)
  try {
    return { manifest: JSON.parse(text) as Manifest }
  } catch {
    return unreadable(`${path} at ${revision} is not JSON`)
  }
}

/** A base path whose file moved, mapped to where the head holds it. */
const renamedToIn = (repository: string, mergeBase: string, head: string): ReadonlyMap<string, string> => {
  const renamed = new Map<string, string>()
  const parts = (git(repository, ['diff', '--find-renames', '--name-status', '-z', mergeBase, head]) ?? '')
    .split('\0')
    .filter((part) => part !== '')
  let at = 0
  while (at < parts.length) {
    const status = parts[at++] ?? ''
    const from = parts[at++] ?? ''
    if (!status.startsWith('R')) continue
    renamed.set(from, parts[at++] ?? '')
  }
  return renamed
}

const messagesBetween = (repository: string, mergeBase: string, head: string): readonly string[] =>
  (git(repository, ['log', '-z', '--format=%B', `${mergeBase}..${head}`]) ?? '').split('\0')

/** Both sides of every file the check judges, and the claims the commits in the range make. */
const comparisonOf = (
  repository: string,
  mergeBase: string,
  head: string,
  testFiles: readonly string[],
  headPaths: readonly string[],
): Comparison | Unreadable => {
  const renamedTo = renamedToIn(repository, mergeBase, head)
  const atBase = new Map<string, string>()
  const atTip = new Map<string, string>()
  for (const path of testFiles) {
    const baseText = textAt(repository, mergeBase, path)
    if (baseText === undefined) return unreadable(`${path} at ${mergeBase} could not be read`)
    atBase.set(path, baseText)
    const tipPath = renamedTo.get(path) ?? path
    const tipText = headPaths.includes(tipPath) ? textAt(repository, head, tipPath) : undefined
    if (tipText !== undefined) atTip.set(tipPath, tipText)
  }
  const sources: Sources = { atBase, atTip, renamedTo }
  return testsTheBasePassedThatWentMissing(sources, claimsIn(messagesBetween(repository, mergeBase, head)))
}

export function scan(repository: string, base: string, head: string): Scan {
  const baseCommit = commitAt(repository, base)
  const headCommit = commitAt(repository, head)
  if (baseCommit === undefined) return { verdict: 'unreadable', reason: `the base ${base} is not a commit in ${repository}` }
  if (headCommit === undefined) return { verdict: 'unreadable', reason: `the head ${head} is not a commit in ${repository}` }
  const mergeBase = mergeBaseBetween(repository, baseCommit, headCommit)
  if (mergeBase === undefined) return { verdict: 'unreadable', reason: `the base and the head share no commit, so there is no merge base` }
  const basePaths = pathsAt(repository, mergeBase)
  const headPaths = pathsAt(repository, headCommit)
  if (basePaths === undefined) return { verdict: 'unreadable', reason: `the tree at ${mergeBase} could not be read` }
  if (headPaths === undefined) return { verdict: 'unreadable', reason: `the tree at ${headCommit} could not be read` }
  const patterns = patternsAt(repository, mergeBase, basePaths)
  if ('reason' in patterns) return { verdict: 'unreadable', reason: patterns.reason }
  const testFiles = basePaths.filter((path) => patterns.matchers.some((matcher) => matcher.test(path)))
  if (testFiles.length === 0) return { verdict: 'unreadable', reason: `the base holds no file the test scripts name, so nothing was compared` }
  const comparison = comparisonOf(repository, mergeBase, headCommit, testFiles, headPaths)
  if ('reason' in comparison) return { verdict: 'unreadable', reason: comparison.reason }
  return { verdict: 'compared', comparison, skipped: patterns.skipped }
}
