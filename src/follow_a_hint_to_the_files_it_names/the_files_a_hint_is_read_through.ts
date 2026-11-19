// The file questions a hint's expansion asks, each answered the way the engine's own `std::fs` answers it (martha#801).
//
// The engine walks a hint with `metadata` (which follows a link), `symlink_metadata` (which does not) and
// `canonicalize`; the host face hands the same three answers through `kindOf`, `realPathOf` and `bytesOf`. What the
// engine swallows with `.ok()` is answered here the same way — false, or nothing — because the reference is then simply
// not attached, which is also what the engine's own `is_file()` answers for a path it cannot read.

import type { FileTree } from '../host_contract/host_contract.ts'

/** The file questions the engine asks of the machine: it reads, and it writes nothing. */
export type TheFiles = Pick<FileTree, 'kindOf' | 'bytesOf' | 'realPathOf'>

/** Whether `path` is a plain file, a link to one followed (`metadata(...).is_file()`). */
export function isAFile(machine: TheFiles, path: string): boolean { return kindFollowingLinks(machine, path) === 'file' }

/** Whether `path` is a directory, a link to one followed (`metadata(...).is_dir()`). */
export function isADirectory(machine: TheFiles, path: string): boolean { return kindFollowingLinks(machine, path) === 'directory' }

/** Whether `path` itself is a plain file or a link, never followed (`symlink_metadata(...)`). */
export function isAFileOrALink(machine: TheFiles, path: string): boolean {
  const kind = kindOrNone(machine, path)
  return kind === 'file' || kind === 'symlink'
}

/** Whether `path` itself is a plain file, never followed: a link to a file is not one (`symlink_metadata(...).is_file()`). */
export function isAPlainFile(machine: TheFiles, path: string): boolean { return kindOrNone(machine, path) === 'file' }

/** Whether anything is at `path`, a link followed (`Path::exists`): a link that points nowhere is not there. */
export function anythingIsAt(machine: TheFiles, path: string): boolean { return realPathOrNone(machine, path) !== null }

/** `path` with every link resolved, or null where the engine's `canonicalize` would fail. */
export function realPathOrNone(machine: TheFiles, path: string): string | null {
  try { return machine.realPathOf(path) } catch { return null }
}

/** The bytes at `path`, or null where the engine's read would fail. */
export function bytesOrNone(machine: TheFiles, path: string): Uint8Array | null {
  try { return machine.bytesOf(path) } catch { return null }
}

/** What is at `path` with every link resolved, or undefined where nothing is or it cannot be read. */
function kindFollowingLinks(machine: TheFiles, path: string): string | undefined {
  const real = realPathOrNone(machine, path)
  return real === null ? undefined : kindOrNone(machine, real)
}

/** What is at `path` itself, a link not followed, or undefined where the question cannot be answered. */
function kindOrNone(machine: TheFiles, path: string): string | undefined {
  try { return machine.kindOf(path).kind } catch { return undefined }
}
