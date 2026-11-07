// What the checkout's author can change, as one git tree id.
//
// A config the owner approves names commands, and those commands run files in
// the checkout: a hook `.claude/hooks/start.sh`, a server `node ./tools/server.js`,
// a plugin path. Fingerprinting the config alone lets a pull request change the
// script and keep the approval. So the approval also binds the work tree: the
// tree git would write if every tracked change and every untracked, unignored
// file were staged now. A pull, a merge, a checkout of another branch or an edit
// to any such file changes it.
//
// It is computed in a scratch index, never the checkout's own, so the member's
// staging area is untouched. Git writes the blobs it hashes into the repository's
// object store, as `git add` does; nothing else in the repository changes.
//
// A checkout whose top is the stop directory or above it (the owner's home kept
// in git, say) is no checkout here: hashing it would stage the whole home into
// the object store on every call, and a home is not what an author ships.
//
// The tree is read before every tool call, so the clean case is cheap: when git
// reports nothing modified, staged or untracked, the tree is HEAD's own, read
// without staging anything. Any change at all takes the full path.
//
// What it does not cover, stated rather than hidden: a file git ignores and does
// not track. Such a file is not shipped by the checkout's author (a commit
// cannot carry it untracked); it is written on this machine, by a command the
// member ran (A13). Nor the inside of a submodule beyond the commit its parent
// records. Nor a change the checkout's own index hides from git status
// (assume-unchanged, skip-worktree): those flags are the member's, set on this
// machine, and no commit carries them.
//
// Git runs here with every inherited GIT_ variable dropped, so the caller's
// environment cannot point it at another repository or index, and with
// fsmonitor off, the one setting that would make `git add` start a program.
//
// The machine is reached only through the host contract (martha#26): git runs
// through `processes.runNow`, the scratch index lives in `stores.scratch`, and
// links are resolved through `stores.files`.

import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { Processes, Stores } from '../host_contract/host_contract.ts'

/** The parts of the host contract the launch gate reads the machine through. */
export interface LaunchHost {
  readonly stores: Pick<Stores, 'files' | 'scratch'>
  readonly processes: Pick<Processes, 'runNow'>
}

/** The variables git would take a repository, an index or a config from; none is inherited. */
const GIT_VARIABLES = 'GIT_'

/**
 * The tree id of the checkout holding `dir`, with its uncommitted and untracked
 * (unignored) changes included, or `null` when `dir` is in no git checkout, the
 * checkout's top is `stop_dir` or a directory above it, or git cannot read it.
 */
export function readCheckoutTree(dir: string, stop_dir: string, host: LaunchHost): string | null {
  const top = git(host, dir, ['rev-parse', '--show-toplevel'])
  if (top === undefined || holds(realOrResolved(host, top), realOrResolved(host, stop_dir))) return null
  return cleanTree(host, top) ?? stagedTree(host, top)
}

/** HEAD's tree when git reports nothing changed and nothing untracked, else `undefined`. */
function cleanTree(host: LaunchHost, top: string): string | undefined {
  const changes = git(host, top, [
    '--no-optional-locks',
    'status',
    '--porcelain=v2',
    '--untracked-files=all',
    '--ignore-submodules=none',
  ])
  if (changes !== '') return undefined
  return git(host, top, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}'])
}

/** The tree git would write with every change staged, in a scratch index. */
function stagedTree(host: LaunchHost, top: string): string | null {
  const scratch = host.stores.scratch.make(null, 'martha-tree-')
  try {
    const index = { GIT_INDEX_FILE: join(scratch.path, 'index') }
    const seeded = git(host, top, ['read-tree', 'HEAD'], index) ?? git(host, top, ['read-tree', '--empty'], index)
    if (seeded === undefined) return null
    if (git(host, top, ['add', '--all', '--', '.'], index) === undefined) return null
    return git(host, top, ['write-tree'], index) ?? null
  } finally {
    scratch.remove()
  }
}

/** Whether `dir` is `path` or a directory above it. */
function holds(dir: string, path: string): boolean {
  const rest = relative(dir, path)
  return rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest)
}

/**
 * The path with every link resolved. A path not made yet is resolved through
 * the nearest directory above it that exists, so a stop directory not made yet
 * under a link (macOS's /var -> /private/var) still compares with the real path
 * git reports (martha#79); a path nothing of which resolves is given back
 * absolute.
 */
export function realOrResolved(host: LaunchHost, path: string): string {
  const absolute = resolve(path)
  const real = host.stores.files.realPathOf(absolute)
  if (real !== null) return real
  const parent = dirname(absolute)
  if (parent === absolute) return absolute
  return join(realOrResolved(host, parent), basename(absolute))
}

function git(host: LaunchHost, cwd: string, args: readonly string[], set: Readonly<Record<string, string>> = {}): string | undefined {
  const run = host.processes.runNow({
    command: 'git',
    args: ['-c', 'core.fsmonitor=false', ...args],
    cwd,
    environment: { drop_prefixes: [GIT_VARIABLES], set },
  })
  return run.exit_code === 0 ? run.stdout.trim() : undefined
}

/** What a read covers: one file, or every file under a path a search walks. */
export type ReadSpan = 'one_file' | 'every_file_below'

/**
 * Whether `path` is in the tree the owner approved for the checkout holding
 * `dir`, so that reading it grants nothing the approval does not already grant
 * (martha#127). The owner approved that exact tree to run as the owner's OS
 * user: its hooks and servers execute from it. Reading the same bytes adds
 * nothing to that.
 *
 * In the tree means: with every link resolved, the path sits under the
 * checkout's top, and git puts it in the fingerprinted tree, tracked or
 * untracked and not ignored. A search also walks everything below it, so for
 * `every_file_below` nothing below the path may be ignored, a link, or a
 * submodule: each of those is outside what the fingerprint pins. Pathspecs are
 * literal, so a path holding `*` names that file and nothing else.
 *
 * Whether the tree still matches the approval is not asked here: the launch is
 * read again before and after every call (../answer_a_tool_call), and a call
 * that changed it stops the member.
 */
export function isInTheCheckoutTree(dir: string, stop_dir: string, path: string, span: ReadSpan, host: LaunchHost): boolean {
  if (!isAbsolute(path)) return false
  const shown = git(host, dir, ['rev-parse', '--show-toplevel'])
  if (shown === undefined) return false
  const top = realOrResolved(host, shown)
  if (holds(top, realOrResolved(host, stop_dir))) return false
  const real = realOrResolved(host, path)
  if (!holds(top, real)) return false
  const at = relative(top, real) || '.'
  const listed = git(host, top, ['--literal-pathspecs', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', at])
  if (listed === undefined || listed === '') return false
  return span === 'one_file' || nothingBelowIsOutsideTheTree(host, top, at)
}

/** A git mode that is no plain file: a link (120000) or a submodule (160000). */
const NOT_A_PLAIN_FILE = /^(120000|160000) /

function nothingBelowIsOutsideTheTree(host: LaunchHost, top: string, at: string): boolean {
  const ignored = git(host, top, ['--literal-pathspecs', 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z', '--', at])
  if (ignored === undefined || ignored !== '') return false
  const staged = git(host, top, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', at])
  if (staged === undefined) return false
  if (staged.split('\0').some((entry) => NOT_A_PLAIN_FILE.test(entry))) return false
  return untrackedLinksBelow(host, top, at) === false
}

/** Whether an untracked, unignored entry below `at` is a link, which `ls-files --stage` does not show. */
function untrackedLinksBelow(host: LaunchHost, top: string, at: string): boolean | undefined {
  const untracked = git(host, top, ['--literal-pathspecs', 'ls-files', '--others', '--exclude-standard', '-z', '--', at])
  if (untracked === undefined) return undefined
  return untracked
    .split('\0')
    .filter((entry) => entry !== '')
    .some((entry) => host.stores.files.realPathOf(join(top, entry)) !== join(top, entry))
}
