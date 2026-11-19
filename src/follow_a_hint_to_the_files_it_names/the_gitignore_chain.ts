// The chain of `.gitignore` files a hint's references are judged against (martha#801).
//
// The engine builds ONE matcher for the checkout (`load_hints.rs`'s `build_gitignore` at the pin eff9a75e): the
// `.gitignore` of every directory from the git root down to the working directory, added in that order — git root
// first, working directory last — into a builder rooted at the working directory (`GitignoreBuilder::new(cwd)`). It is
// not git's per-directory chain: one matcher holds every line, a line with no slash matches at any depth, and a later
// line wins over an earlier one. Every reference is matched relative to the working directory with `is_dir = false`
// (`import_files.rs:358`), so a directory-only line never matches one.
//
// The git root is the first directory at or above the working directory where `.git` EXISTS (`load_hints.rs:170`,
// `check_dir.join(".git").exists()`): a link pointing nowhere is not one, which is the difference from a walk that stops
// at a name being present.

import { dirname, join } from 'node:path'

import { aGitignoreLine, type AGitignorePattern } from './a_gitignore_pattern.ts'
import { anythingIsAt, bytesOrNone, isAFile, type TheFiles } from './the_files_a_hint_is_read_through.ts'

/** The name the engine reads a directory's ignore lines from (`build_gitignore`'s `.join(".gitignore")`). */
const GITIGNORE_FILE = '.gitignore'

/** A newline and a carriage return, as the engine's line reader splits and trims them. */
const A_NEWLINE = 0x0a
const A_CARRIAGE_RETURN = 0x0d

/**
 * One matcher over the checkout's `.gitignore` lines, root first, as the engine builds it: the working directory it
 * matches relative to, and every line in the order they were read.
 */
export interface TheGitignoreChain {
  /** The directory paths are matched relative to: the engine's working directory. */
  readonly root: string
  /** Every line of every `.gitignore` from the git root down to `root`, root first. */
  readonly patterns: readonly AGitignorePattern[]
}

/** An empty matcher: what the engine hands a subdirectory's or a global hint (`Gitignore::empty()`). */
export const NO_GITIGNORE: TheGitignoreChain = { root: '.', patterns: [] }

/** The chain a working directory's `.gitignore` files make, or the refusal for a line this port cannot reproduce. */
export type TheGitignoreChainRead = { readonly chain: TheGitignoreChain } | { readonly refusal: string }

/**
 * The chain the engine matches a checkout's references against (`build_gitignore(cwd)`), from the `.gitignore` files of
 * the git root down to `workingDir`.
 */
export function theGitignoreChainOf(workingDir: string, machine: TheFiles): TheGitignoreChainRead {
  const patterns: AGitignorePattern[] = []
  for (const directory of theDirectoriesFromTheGitRoot(theGitRootOf(workingDir, machine), workingDir)) {
    const file = join(directory, GITIGNORE_FILE)
    if (!isAFile(machine, file)) continue
    const added = thePatternsOfAGitignore(machine, file)
    if ('refusal' in added) return added
    patterns.push(...added.patterns)
  }
  return { chain: { root: workingDir, patterns } }
}

/**
 * The first directory at or above `start` where `.git` exists, which is the engine's `find_git_root`; null when nothing
 * above holds one, and the working directory alone is then the boundary.
 */
export function theGitRootOf(start: string, machine: TheFiles): string | null {
  for (let directory = start; ; directory = dirname(directory)) {
    if (anythingIsAt(machine, join(directory, '.git'))) return directory
    if (dirname(directory) === directory) return null
  }
}

/** Whether `path` is ignored by the chain: the last line that matches it decides, and a `!` line takes it back out. */
export function isIgnoredBy(chain: TheGitignoreChain, path: string): boolean {
  const candidate = Buffer.from(relativeToTheChainRoot(chain.root, path), 'utf8').toString('latin1')
  for (let at = chain.patterns.length - 1; at >= 0; at -= 1) {
    const pattern = chain.patterns[at]
    if (pattern === undefined || pattern.isOnlyDirectory) continue
    if (pattern.matchesBytes(candidate)) return !pattern.isWhitelist
  }
  return false
}

/** The patterns of one `.gitignore`, in the order the engine's builder takes them, or the refusal for a line. */
function thePatternsOfAGitignore(machine: TheFiles, file: string): { readonly patterns: readonly AGitignorePattern[] } | { readonly refusal: string } {
  const patterns: AGitignorePattern[] = []
  for (const line of theLinesOf(bytesOrNone(machine, file) ?? new Uint8Array())) {
    const parsed = aGitignoreLine(line)
    if (parsed.kind === 'refused') return { refusal: `the .gitignore at ${file} holds a line this port cannot reproduce: ${parsed.refusal}` }
    if (parsed.kind === 'pattern') patterns.push(parsed.pattern)
  }
  return { patterns }
}

/**
 * The lines of a `.gitignore` as the engine's reader takes them: split at a newline, a carriage return before it
 * dropped, the first line's byte-order mark removed, and nothing after a line that is not valid UTF-8 (the engine's
 * reader stops at the line it cannot read and keeps the lines before it).
 */
function theLinesOf(bytes: Uint8Array): readonly string[] {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const lines: string[] = []
  let from = 0
  while (from < bytes.length) {
    const newline = bytes.indexOf(A_NEWLINE, from)
    const to = newline === -1 ? bytes.length : newline
    const end = to > from && bytes[to - 1] === A_CARRIAGE_RETURN ? to - 1 : to
    try {
      const line = decoder.decode(bytes.subarray(from, end))
      lines.push(lines.length === 0 ? line.replace(/^﻿+/, '') : line)
    } catch {
      return lines
    }
    from = to + 1
  }
  return lines
}

/** The working directory and each directory above it up to the git root, the git root first, as `get_local_directories`. */
function theDirectoriesFromTheGitRoot(gitRoot: string | null, workingDir: string): readonly string[] {
  if (gitRoot === null) return [workingDir]
  const fromHere: string[] = []
  for (let directory = workingDir; ; directory = dirname(directory)) {
    fromHere.push(directory)
    if (directory === gitRoot || dirname(directory) === directory) break
  }
  return fromHere.reverse()
}

/**
 * `path` as the engine's matcher sees it (`Gitignore::strip`): a leading `./` dropped, and the chain's root — a plain
 * prefix, not a component-wise one — dropped from anything that is more than a bare name, with the slash after it.
 */
function relativeToTheChainRoot(root: string, path: string): string {
  const withoutADot = path.startsWith('./') ? path.slice(2) : path
  if (root === '.' || !withoutADot.includes('/') || !withoutADot.startsWith(root)) return withoutADot
  const remainder = withoutADot.slice(root.length)
  return remainder.startsWith('/') ? remainder.slice(1) : remainder
}
