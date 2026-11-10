// A file's blob, under a tree, without letting the checkout say what the file is (martha#129, #167).
//
// This exists once, so the run's tree rule and the launch gate judge a file the same way and neither can drift.
//
// A checkout's git configuration and its per-repository attributes are a member's to write; a clean filter named
// there is a program, and it would run here, outside the sandbox. A file could then be made to hash as an object it
// is not.
//
// So the order is fixed, and no step lets the checkout answer:
//
//   1. The bytes are hashed here, in this process, with no filter applied. That is exact and runs nothing.
//   2. When the caller recognises that id, it is the answer and no program runs.
//   3. Only a file whose bytes match nothing the caller knows is put to git, and it is put to git in a repository
//      the launcher owns, with the attributes of the tree the caller names. Never in the checkout.
//
// The bytes go to git through a scratch file the launcher writes and removes, never through the checkout's own file:
// what is judged is what was read, even if the checkout changes under it. The object git answers with is kept in that
// repository, so its bytes can be read back: a file that passes only this way must reach a run as the object that was
// judged, not as the bytes on disk.

import { createHash } from 'node:crypto'

import type { Processes, ScratchDirectories } from '../host_contract/host_contract.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'

/** The object formats git names a repository's objects in (`git rev-parse --show-object-format`). */
export const GIT_OBJECT_FORMATS = ['sha1', 'sha256'] as const
export type GitObjectFormat = (typeof GIT_OBJECT_FORMATS)[number]

/** The variables git would take a repository, an index or a config from; none is inherited. */
const GIT_VARIABLES = 'GIT_'
const NULL_CONFIG = '/dev/null'

/**
 * Where a file is hashed: a repository the launcher owns, the tree whose attributes apply, the object format of the
 * checkout it is judging, and the host's way of running a program and of making scratch.
 */
export interface LauncherStore {
  readonly repository: string
  readonly tree: string
  readonly format: GitObjectFormat
  readonly processes: Pick<Processes, 'runNow'>
  readonly scratch: ScratchDirectories
}

/** A file's blob under the tree, and whether its own bytes already gave that id. */
export interface BlobUnderTheTree {
  readonly blob: string
  /** True when the bytes themselves produced this id, so git was never asked and the bytes are the object. */
  readonly raw: boolean
}

/** The id git gives `bytes` with no filter applied, in `format`. */
export function rawBlobOf(bytes: Buffer, format: GitObjectFormat): string {
  return createHash(format).update(`blob ${bytes.length}\u0000`).update(bytes).digest('hex')
}

/**
 * The blob `bytes` at `path` are under, for judging a file against the tree the caller names; or undefined when git
 * cannot give one.
 *
 * `isKnown` says whether an id is one the caller already holds, such as the tree's entry at that path or one of the
 * member's own writes. It is asked of the raw id first, and only when it answers no is git asked at all.
 */
export function blobUnderTheTree(store: LauncherStore, path: string, bytes: Buffer, isKnown: (blob: string) => boolean): BlobUnderTheTree | undefined {
  const raw = rawBlobOf(bytes, store.format)
  if (isKnown(raw)) return { blob: raw, raw: true }
  const asked = askedOfGit(store, path, bytes)
  return asked === undefined ? undefined : { blob: asked, raw: false }
}

/** git's answer for these bytes under this tree, in the launcher's own repository; undefined when git cannot give one. */
function askedOfGit(store: LauncherStore, path: string, bytes: Buffer): string | undefined {
  const scratch = store.scratch.make(null, 'martha-hash-')
  try {
    const content = scratch.write('content', bytes)
    const run = store.processes.runNow({
      command: 'git',
      args: ['--git-dir', store.repository, ...marthasOwnGitArgs(['hash-object', '-w', `--path=${path}`, '--', content])],
      cwd: store.repository,
      environment: {
        drop_prefixes: [GIT_VARIABLES],
        set: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_CONFIG, GIT_ATTR_SOURCE: store.tree, GIT_TERMINAL_PROMPT: '0' },
      },
    })
    const blob = run.exit_code === 0 ? run.stdout.trim() : ''
    return blob === '' ? undefined : blob
  } finally {
    scratch.remove()
  }
}
