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
// records.
//
// A change the checkout's own index hides from git status IS covered
// (martha#127 r=1). An index entry flagged assume-unchanged or skip-worktree
// (a sparse checkout sets the second by itself) makes git status skip that
// file, so a rewrite under the flag would leave the clean tree equal to HEAD's
// and the approval standing over a stranger's bytes. A checkout with any such
// entry therefore never takes the clean path: its tree is staged in a scratch
// index that carries no flags, from the bytes on disk, with sparse checkout
// off for that one `git add`.
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
import { judgeTheCheckout, objectFormatOf } from './the_launcher_judges_the_tree.ts'

/** The parts of the host contract the launch gate reads the machine through. */
export interface LaunchHost {
  readonly stores: Pick<Stores, 'files' | 'scratch'>
  readonly processes: Pick<Processes, 'runNow'>
}

/** The variables git would take a repository, an index or a config from; none is inherited. */
const GIT_VARIABLES = 'GIT_'

/** What a read of the checkout's tree came to. */
export type TreeRead =
  | { readonly kind: 'tree'; readonly tree: string; readonly changes?: readonly TreeChange[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly refusal: string; readonly the_approved_tree?: true }

/**
 * The tree id of the checkout holding `dir`, with its uncommitted and untracked (unignored) changes included, read as
 * the launcher runs git and not as the checkout configures it (./the_launcher_judges_the_tree.ts).
 *
 * `none` when `dir` is in no git checkout on disk, the checkout's top is `stop_dir` or a directory above it, or the
 * checkout names no object format. `refused`, with the words to show the owner, when the checkout cannot be read, or
 * when a file on disk is not the file the owner approved: the bytes differ from the approved blob and the only reason
 * they still hash to it is a conversion.
 *
 * `attribute_tree` is the tree whose attributes the read obeys — the tree the owner approved. Omitted, HEAD's own
 * tree is used, which is what an approval is read against while there is no approval yet.
 */
export function readCheckoutTree(dir: string, stop_dir: string, host: LaunchHost, attribute_tree?: string): TreeRead {
  const found = checkoutOnDisk(dir, host)
  if (found === undefined) return { kind: 'none' }
  if (holds(realOrResolved(host, found.top), realOrResolved(host, stop_dir))) return { kind: 'none' }
  const format = objectFormatOf(found.git_dir, host)
  if (format === undefined) {
    return { kind: 'refused', refusal: `The checkout at ${found.top} does not say which object format it holds, so the files a member would run cannot be judged (martha#167); approve the checkout again.` }
  }
  const read = judgeTheCheckout({ top: realOrResolved(host, found.top), git_dir: found.git_dir, attribute_tree: attribute_tree ?? null }, format, host)
  return read.kind === 'refused' ? { kind: 'refused', refusal: read.refusal, ...(read.the_approved_tree === true ? { the_approved_tree: true as const } : {}) } : { kind: 'tree', tree: read.tree, changes: read.changes }
}

/**
 * The checkout holding `dir`, found by walking up for a `.git` entry on disk: a directory, or a file naming the git
 * dir of a worktree. Never `rev-parse --show-toplevel`, whose answer the checkout's own `core.worktree` decides.
 *
 * The member's write guard reads its git dir from here too (../refuse_a_member_writing_owner_memory, martha#168),
 * so the checkout's git dir is found one way in both places.
 */
export function checkoutOnDisk(dir: string, host: LaunchHost): { readonly top: string; readonly git_dir: string } | undefined {
  for (let here = realOrResolved(host, dir); ; here = dirname(here)) {
    const found = entryOrAbsent(host, join(here, '.git'))
    if (found !== undefined && found.kind === 'directory') return { top: here, git_dir: join(here, '.git') }
    const named = found !== undefined && found.kind === 'file' ? gitDirNamedIn(join(here, '.git'), host) : undefined
    if (named !== undefined) return { top: here, git_dir: named }
    const up = dirname(here)
    if (up === here) return undefined
  }
}

/** What is at a path, or undefined when nothing is or it cannot be read. */
function entryOrAbsent(host: LaunchHost, path: string): ReturnType<LaunchHost['stores']['files']['kindOf']> | undefined {
  try {
    const found = host.stores.files.kindOf(path)
    return found.kind === 'absent' ? undefined : found
  } catch {
    return undefined
  }
}

/** The git dir a `.git` file names (`gitdir: <path>`), with every link resolved. */
function gitDirNamedIn(dotGit: string, host: LaunchHost): string | undefined {
  try {
    const text = Buffer.from(host.stores.files.bytesOf(dotGit)).toString('utf8')
    const named = text.startsWith(GITDIR_PREFIX) ? text.slice(GITDIR_PREFIX.length).trim() : ''
    return named === '' ? undefined : realOrResolved(host, resolve(dirname(dotGit), named))
  } catch {
    return undefined
  }
}

/** What the file a worktree has in place of a `.git` directory starts with. */
const GITDIR_PREFIX = 'gitdir: '

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
  return gitRaw(host, cwd, args, set)?.trim()
}

/** Git's output as it wrote it, or `undefined` when git failed. */
function gitRaw(host: LaunchHost, cwd: string, args: readonly string[], set: Readonly<Record<string, string>> = {}): string | undefined {
  const run = host.processes.runNow({
    command: 'git',
    args: ['-c', 'core.fsmonitor=false', ...args],
    cwd,
    environment: { drop_prefixes: [GIT_VARIABLES], set },
  })
  return run.exit_code === 0 ? run.stdout : undefined
}

/** One path that differs between two trees, as `git diff-tree` names it: its new mode and blob, or deleted. */
export type TreeChange =
  | { readonly path: string; readonly deleted: true }
  | { readonly path: string; readonly deleted: false; readonly mode: string; readonly blob: string }

/** What `git diff-tree --raw` writes for a deleted path. */
const DELETED = 'D'

/** The top of the checkout holding `dir`, as git reports it, or `undefined` outside any checkout. */
export function checkoutTopOf(dir: string, host: LaunchHost): string | undefined {
  return git(host, dir, ['rev-parse', '--show-toplevel'])
}

/**
 * The blob id `git add` would give the file at `path` now, in the checkout whose top is `top`: its attributes, clean
 * filters and line-end settings applied as they are when the tree is read, by the same git. `undefined` when git
 * cannot hash it.
 */
export function blobAsGitAdds(top: string, path: string, host: LaunchHost): string | undefined {
  return git(host, top, ['hash-object', `--path=${relative(top, path)}`, '--', path])
}

/**
 * Every path that differs between the trees `from` and `to` in the checkout holding `dir`, relative to its top,
 * with no rename paired up: a rename is a deletion and a new path. `undefined` when git cannot read either tree,
 * an object the store no longer holds among them.
 */
export function changesBetween(dir: string, from: string, to: string, host: LaunchHost): readonly TreeChange[] | undefined {
  const raw = gitRaw(host, dir, ['diff-tree', '-r', '-z', '--no-renames', '--no-abbrev', from, to])
  if (raw === undefined) return undefined
  const fields = raw.split('\0')
  const changes: TreeChange[] = []
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const [, mode = '', , blob = '', status = ''] = (fields[at] ?? '').split(' ')
    const path = fields[at + 1] ?? ''
    changes.push(status === DELETED ? { path, deleted: true } : { path, deleted: false, mode, blob })
  }
  return changes
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
