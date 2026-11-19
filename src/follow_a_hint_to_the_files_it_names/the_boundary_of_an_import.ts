// Where a hint's references may reach, and the git metadata an `@reference` may never name (martha#801).
//
// The engine builds an import boundary from the checkout's git root (`ImportBoundary::new`, `import_files.rs:196`),
// canonicalised once, with the repository's own git directories read out of it: `.git` as a directory, or as a git
// pointer file (`gitdir: …`) resolved from the boundary, and the `commondir` inside that git directory when it names a
// different one. Each reference is then held to three refusals (`validate_canonical_path`, `:202`):
//
//   - the resolved path must be under the boundary (a component-wise prefix, never a string one);
//   - no part of it under the boundary may be a component named `.git`, case aside;
//   - it may not be inside one of the git directories above, nor under a directory that is a repository of its own
//     (a `HEAD` file or link with `objects` and `refs`, or with a `commondir`), which is `has_structural_git_ancestor`.
//
// A path the machine cannot resolve is treated as absent, which is what the engine's `NotFound` arm does: the reference
// is not attached either way, and the record names no file. The host face does not report why a path could not be
// resolved, and the engine's other arms end at the same place.

import { dirname, isAbsolute, join, relative, sep } from 'node:path'

import { isADirectory, isAFile, isAFileOrALink, isAPlainFile, realPathOrNone, type TheFiles } from './the_files_a_hint_is_read_through.ts'

/** The name git's own directory has under a working tree. */
const GIT_DIRECTORY = '.git'

/** The file a git directory (or a link file) shares its refs through. */
const COMMONDIR_FILE = 'commondir'

/** The prefix a `.git` pointer file names its git directory with. */
const GITDIR_PREFIX = 'gitdir:'

/** The longest a git pointer file may be (`MAX_GIT_POINTER_BYTES`, `import_files.rs:22`). */
const THE_MOST_A_GIT_POINTER_HOLDS = 4096

/** A canonicalised import boundary, and the git directories it must keep a reference out of. */
export interface TheImportBoundary {
  /** The boundary itself, every link resolved. */
  readonly canonical: string
  /** The repository's git directory and its common directory, resolved, when the boundary is in a repository. */
  readonly gitMetadataDirectories: readonly string[]
}

/** The boundary at `path`, every link resolved, or undefined when the engine's `canonicalize` would fail. */
export function theImportBoundaryAt(path: string, machine: TheFiles): TheImportBoundary | undefined {
  const canonical = realPathOrNone(machine, path)
  return canonical === null ? undefined : { canonical, gitMetadataDirectories: theGitMetadataDirectoriesOf(canonical, machine) }
}
/** A file the engine has already resolved and must still exist, held to the boundary (`sanitize_existing_path`). */
export function sanitizedExisting(path: string, boundary: TheImportBoundary, machine: TheFiles): string | undefined {
  if (!theParentIsHeldToTheBoundary(path, boundary, machine)) return undefined
  const canonical = realPathOrNone(machine, path)
  return canonical === null ? undefined : validated(canonical, boundary, machine)
}

/**
 * The path a reference names, held to the boundary (`sanitize_reference_path`): the resolved path when it exists, and
 * the joined path when it does not, which the engine's later `is_file` question then answers no to.
 */
export function sanitizedReference(reference: string, includingDirectory: string, boundary: TheImportBoundary, machine: TheFiles): string | undefined {
  if (isAbsolute(reference) || holdsAGitComponent(reference)) return undefined
  const resolved = join(includingDirectory, reference)
  const parent = realPathOrNone(machine, dirname(resolved))
  if (parent === null) return resolved
  if (validated(parent, boundary, machine) === undefined) return undefined
  const canonical = realPathOrNone(machine, resolved)
  return canonical === null ? resolved : validated(canonical, boundary, machine)
}

/** The path held to the boundary: under it, out of git metadata, and never under a repository of its own. */
function validated(canonical: string, boundary: TheImportBoundary, machine: TheFiles): string | undefined {
  const under = thePartUnder(boundary.canonical, canonical)
  if (under === undefined || holdsAGitComponent(under)) return undefined
  if (boundary.gitMetadataDirectories.some((directory) => isUnderThe(directory, canonical))) return undefined
  return holdsAStructuralGitAncestor(canonical, boundary.canonical, machine) ? undefined : canonical
}

/** Whether the path's own parent resolves and is held to the boundary. */
function theParentIsHeldToTheBoundary(path: string, boundary: TheImportBoundary, machine: TheFiles): boolean {
  const parent = dirname(path)
  if (parent === path) return true
  const canonical = realPathOrNone(machine, parent)
  return canonical !== null && validated(canonical, boundary, machine) !== undefined
}

/** The part of `path` under `root`, or undefined when it is not under it (`strip_prefix`). */
function thePartUnder(root: string, path: string): string | undefined {
  const part = relative(root, path)
  return part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part) ? undefined : part
}

/** Whether `path` is `root` or under it, component by component (`Path::starts_with`). */
export function isUnderThe(root: string, path: string): boolean { return thePartUnder(root, path) !== undefined }

/** Whether any component of `path` is `.git`, which no reference may name (`contains_git_metadata_component`). */
function holdsAGitComponent(path: string): boolean { return path.split('/').some((component) => component.toLowerCase() === GIT_DIRECTORY) }

/** The repository's git directories under `boundary`, from `.git` and the `commondir` inside it. */
function theGitMetadataDirectoriesOf(boundary: string, machine: TheFiles): readonly string[] {
  const gitDirectory = theGitDirectoryUnder(boundary, machine)
  if (gitDirectory === undefined) return []
  const common = theCommonDirectoryOf(gitDirectory, machine)
  return common === undefined || common === gitDirectory ? [gitDirectory] : [gitDirectory, common]
}

/** The git directory `.git` names: the pointer it holds when it is a file, and itself when it is a directory. */
function theGitDirectoryUnder(boundary: string, machine: TheFiles): string | undefined {
  const dotGit = join(boundary, GIT_DIRECTORY)
  if (!isAPlainFile(machine, dotGit)) return theDirectoryAt(dotGit, machine)
  const pointer = theGitPointerAt(dotGit, machine)
  if (pointer === undefined || !pointer.startsWith(GITDIR_PREFIX)) return undefined
  return theDirectoryThat(thePointerValueOf(pointer.slice(GITDIR_PREFIX.length)), boundary, machine)
}

/** What a git pointer file names: its first line, trimmed (`resolve_git_path`, `:71`). */
function thePointerValueOf(contents: string): string {
  return (contents.split('\n')[0] ?? '').trim()
}

/** The directory a git directory's `commondir` file names, when it names one. */
function theCommonDirectoryOf(gitDirectory: string, machine: TheFiles): string | undefined {
  const contents = theGitPointerAt(join(gitDirectory, COMMONDIR_FILE), machine)
  const value = contents === undefined ? '' : thePointerValueOf(contents)
  return value === '' ? undefined : theDirectoryThat(value, gitDirectory, machine)
}

/** What a git pointer file holds, or undefined when it is too long or not text (`read_git_pointer`, `:86`). */
function theGitPointerAt(path: string, machine: TheFiles): string | undefined {
  if (!isAPlainFile(machine, path)) return undefined
  try {
    const bytes = machine.bytesOf(path)
    return bytes.length > THE_MOST_A_GIT_POINTER_HOLDS ? undefined : new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** The directory `value` names, resolved from `base`, or undefined when it is not a directory (`resolve_git_path`, `:71`). */
function theDirectoryThat(value: string, base: string, machine: TheFiles): string | undefined {
  return theDirectoryAt(isAbsolute(value) ? value : join(base, value), machine)
}

/** `path` resolved and followed to a directory (`canonical_git_directory`, `:67`). */
function theDirectoryAt(path: string, machine: TheFiles): string | undefined {
  const canonical = realPathOrNone(machine, path)
  return canonical !== null && isADirectory(machine, canonical) ? canonical : undefined
}

/** Whether a directory above `canonical` is a repository of its own (`has_structural_git_ancestor`, `:176`). */
function holdsAStructuralGitAncestor(canonical: string, boundary: string, machine: TheFiles): boolean {
  for (let directory = canonical; isUnderThe(boundary, directory); directory = dirname(directory)) {
    if (isAStructuralGitDirectory(directory, machine)) return true
    if (dirname(directory) === directory) return false
  }
  return false
}

/** Whether `directory` holds a `HEAD` file or link and the objects and refs, or a `commondir`, of a repository (`:159`). */
function isAStructuralGitDirectory(directory: string, machine: TheFiles): boolean {
  const held = isAFileOrALink(machine, join(directory, 'HEAD'))
  const objects = isADirectory(machine, join(directory, 'objects')) && isADirectory(machine, join(directory, 'refs'))
  return held && (objects || isAFile(machine, join(directory, COMMONDIR_FILE)))
}
