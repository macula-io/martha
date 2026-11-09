// The checkout's tree, read by git as the launcher runs it (martha#167, design r=2 §1, §2 and §4).
//
// A checkout's `.git/config` and `.git/info/attributes` are a member's to write, and no tree rule covers them. But
// they were what decided which blob the gate judged: `git add` in the checkout read a clean filter named there and
// started it, outside the sandbox, and the file it converted then hashed as the object the owner approved.
//
// So the tree is not read in the checkout. This module makes a git dir the launcher writes, in its own scratch space,
// and reads the checkout from there through a work tree named on disk:
//
//   - the config holds no filter, no fsmonitor, no hooks path, no attributes file, no excludes file and no work tree,
//     so nothing the checkout's config says can start a program or move a read;
//   - `info/attributes` and `info/exclude` are empty, so the checkout's own are never consulted;
//   - the attributes a file is converted under come from ONE tree, the one passed in: the tree the owner approved, or
//     HEAD's own while there is no approval yet. `GIT_ATTR_SOURCE` names it;
//   - every inherited `GIT_*` variable is dropped, so the caller cannot point git at another repository or index.
//
// The checkout's object store is offered read-only, through the alternates file of the git dir the launcher makes, and
// nothing else of the checkout is. Before either tree is used it is read into an index and written back: `write-tree`
// recomputes every tree id from that index, so when the id git computes is not the id it was asked to read, the object
// under that id was not the object its name says it is, and the launch is refused rather than judged against it. The
// live tree is then written into the checkout's own object store, as `git add` left it, because the id the owner
// approves has to be readable again by a later process.
//
// Every file is then judged once, by `blobUnderTheTree` (../hash_a_file_under_a_tree): its own bytes are hashed in this
// process first, and when that id is the approved tree's blob at that path, no program runs and the file is the object
// the owner approved. Only a file that matches nothing is put to git, under the approved tree's attributes. A file
// that matches the approved blob ONLY after a conversion is one whose bytes on disk are not the bytes the owner
// approved, and which conversion it was decides: line endings pass, and ident, working-tree-encoding and a filter are
// refused by name (./conversions_a_launch_passes.ts, DECIDED 2026-11-09 "Yes, allow line endings only").

import { join } from 'node:path'

import { blobUnderTheTree, type GitObjectFormat, type LauncherStore } from '../hash_a_file_under_a_tree/hash_a_file_under_a_tree.ts'
import type { FileTree, Processes, ScratchDirectories, ScratchDirectory } from '../host_contract/host_contract.ts'
import { whyAConvertedFileIsRefused } from './conversions_a_launch_passes.ts'

/** The parts of the host contract this read goes through. */
export interface JudgeHost {
  readonly stores: { readonly files: FileTree; readonly scratch: ScratchDirectories }
  readonly processes: Pick<Processes, 'runNow'>
}

/** Where the checkout is, and the tree whose attributes the read obeys. */
export interface JudgePlace {
  /** The checkout's top, with every link resolved. */
  readonly top: string
  /** The checkout's git dir, found on disk beside its top, never through the checkout's own config. */
  readonly git_dir: string
  /** The tree the owner approved; HEAD's own tree when there is no approval yet. */
  readonly attribute_tree: string | null
}

/** One path that differs between two trees: its new mode and blob, or that it is gone. */
export type TreeDifference =
  | { readonly path: string; readonly deleted: true }
  | { readonly path: string; readonly deleted: false; readonly mode: string; readonly blob: string }

/** What a read of the checkout came to. */
export type JudgedTree =
  | { readonly kind: 'tree'; readonly tree: string; readonly changes: readonly TreeDifference[] }
  | { readonly kind: 'refused'; readonly refusal: string; readonly the_approved_tree?: true }

/** One path of a tree, as git lists it. */
interface TreeEntry {
  readonly mode: string
  readonly blob: string
}

/** A git mode that is a plain file, executable or not; the only modes whose bytes the gate reads. */
const REGULAR_MODES = ['100644', '100755']
/** A git mode that holds a link's target, which is the blob's bytes with nothing converted. */
const LINK_MODE = '120000'

const NOTHING_DROPPED = ['GIT_']
const NULL_CONFIG = '/dev/null'
const RECORD = '\u0000'
const THE_TREE_CANNOT_BE_JUDGED =
  'so what a member would run cannot be judged (martha#167); approve the checkout again once git can read it'

/** The config the launcher's git dir is made with: the object format, and nothing that can start a program. */
function configOf(format: GitObjectFormat): string {
  const sha256 = format === 'sha256'
  const extension = sha256 ? '[extensions]\n\tobjectFormat = sha256\n' : ''
  return `[core]\n\trepositoryformatversion = ${sha256 ? '1' : '0'}\n\tbare = true\n\tfsmonitor = false\n\tlogallrefupdates = false\n${extension}`
}

/**
 * Read the checkout's live tree as the launcher runs git, or why the launch is refused.
 *
 * Refuses rather than guesses when git cannot list, hash or write what it is asked: a tree nobody could read is a
 * tree nobody approved.
 */
export function judgeTheCheckout(place: JudgePlace, format: GitObjectFormat, host: JudgeHost): JudgedTree {
  const scratch = host.stores.scratch.make(null, 'martha-judge-')
  try {
    return readInTheLaunchersGitDir(place, format, host, scratch)
  } finally {
    scratch.remove()
  }
}

function readInTheLaunchersGitDir(place: JudgePlace, format: GitObjectFormat, host: JudgeHost, scratch: ScratchDirectory): JudgedTree {
  const judge = join(scratch.path, 'judge.git')
  const made = makeTheLaunchersGitDir(host, scratch, judge, format, place.git_dir)
  if (made !== undefined) return { kind: 'refused', refusal: made }

  const head = headTreeOf(place.git_dir, host)
  const attribute_tree = place.attribute_tree ?? head ?? emptyTree(host, judge)
  if (attribute_tree === undefined) return { kind: 'refused', refusal: `the checkout's attributes cannot be named, ${THE_TREE_CANNOT_BE_JUDGED}` }
  const attributed: JudgePlace = { ...place, attribute_tree }

  const index = join(scratch.path, 'index')
  const unkept = keepBothTrees(attributed, head, host, judge, index)
  if (unkept !== undefined) return { kind: 'refused', refusal: unkept, ...(place.attribute_tree === null ? {} : { the_approved_tree: true as const }) }
  return readTheLiveTree(attributed, format, host, judge, index)
}

/** Keeps the tree whose attributes apply, and HEAD's own tree beside it, refusing when either does not read back. */
function keepBothTrees(place: JudgePlace, head: string | undefined, host: JudgeHost, judge: string, index: string): string | undefined {
  const approved = keepTheTree(place.attribute_tree as string, host, judge, index, 'the tree whose attributes apply')
  if (approved !== undefined || place.attribute_tree === head) return approved
  return seedTheLiveTree(head, host, judge, index)
}

/** Seeds the index the live tree is written from: HEAD's tree, or an empty one in a checkout with no commit yet. */
function seedTheLiveTree(head: string | undefined, host: JudgeHost, judge: string, index: string): string | undefined {
  if (head !== undefined) return keepTheTree(head, host, judge, index, "the checkout's own tree")
  const seeded = gitIn(host, judge, ['read-tree', '--empty'], { GIT_INDEX_FILE: index })
  return seeded === undefined ? `the checkout cannot be seeded as a tree, ${THE_TREE_CANNOT_BE_JUDGED}` : undefined
}

/** Writes the live tree and judges every file of it against the tree whose attributes apply. */
function readTheLiveTree(place: JudgePlace, format: GitObjectFormat, host: JudgeHost, judge: string, index: string): JudgedTree {
  const live = writeTheLiveTree(place, place.attribute_tree as string, judge, index, host)
  if (typeof live !== 'string') return live

  const approved = entriesOf(place.attribute_tree as string, host, judge)
  if (typeof approved === 'string') return { kind: 'refused', refusal: approved }
  const entries = entriesOf(live, host, judge)
  if (typeof entries === 'string') return { kind: 'refused', refusal: entries }

  const refusal = judgeEveryFile(place, place.attribute_tree as string, entries, approved, format, host, judge)
  return refusal === undefined ? { kind: 'tree', tree: live, changes: differencesBetween(approved, entries) } : { kind: 'refused', refusal }
}

/**
 * A git dir the launcher owns: a config that names no program, no attributes file and no work tree, and empty
 * attribute and exclude files. Nothing in it is copied from the checkout but its object format.
 */
function makeTheLaunchersGitDir(host: JudgeHost, scratch: ScratchDirectory, judge: string, format: GitObjectFormat, checkout_git_dir: string): string | undefined {
  const made = host.processes.runNow({
    command: 'git',
    args: ['init', '-q', '--bare', judge],
    cwd: scratch.path,
    environment: { drop_prefixes: NOTHING_DROPPED, set: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_CONFIG, GIT_TERMINAL_PROMPT: '0' } },
  })
  if (made.exit_code !== 0) return `the launcher cannot make a git dir of its own, ${THE_TREE_CANNOT_BE_JUDGED}`
  scratch.write('judge.git/config', Buffer.from(configOf(format)))
  scratch.write('judge.git/HEAD', Buffer.from('ref: refs/heads/martha\n'))
  scratch.write('judge.git/info/attributes', Buffer.from(''))
  scratch.write('judge.git/info/exclude', Buffer.from(''))
  // The checkout's objects, read-only behind every judgement: it serves blobs and the trees it is asked for by the id
  // the launcher verified, and never a config, an attribute file or an ignore file of its own.
  scratch.write('judge.git/objects/info/alternates', Buffer.from(`${join(checkout_git_dir, 'objects')}\n`))
  return undefined
}

/**
 * HEAD's tree id, read from the checkout's git dir: it hashes no file and starts nothing. A tree that cannot be
 * named is refused, since there is then nothing to compare the live tree against.
 */
/** HEAD's tree id, or undefined in a checkout with no commit yet: a tree that cannot be read was never approved. */
function headTreeOf(git_dir: string, host: JudgeHost): string | undefined {
  return gitIn(host, git_dir, ['rev-parse', '--verify', '--quiet', 'HEAD^{tree}'])
}

/** The id of an empty tree in this repository, asked of git so the launcher never spells an object id itself. */
function emptyTree(host: JudgeHost, judge: string): string | undefined {
  return gitIn(host, judge, ['hash-object', '-t', 'tree', '--', NULL_CONFIG])
}

/**
 * Reads `tree` into the index with the checkout's objects offered, then writes it back WITHOUT them: the objects the
 * write produces are written in the launcher's git dir, recomputed from the index. The read is kept only when the id
 * git computes is the id asked for; anything else means the object under that name is not what its name says.
 */
function keepTheTree(
  tree: string,
  host: JudgeHost,
  judge: string,
  index: string,
  what: string,
): string | undefined {
  const read = gitIn(host, judge, ['read-tree', tree], { GIT_INDEX_FILE: index })
  if (read === undefined) return `${what} (${tree}) cannot be read, ${THE_TREE_CANNOT_BE_JUDGED}`
  const written = gitIn(host, judge, ['write-tree'], { GIT_INDEX_FILE: index })
  if (written === undefined) return `${what} (${tree}) cannot be written back from what was read, so it cannot be trusted (martha#167); approve the checkout again`
  if (written !== tree) {
    return `${what} (${tree}) does not read back as itself (it reads back as ${written}), so the object under that name is not the tree it names (martha#167); approve the checkout again`
  }
  return undefined
}

/**
 * Every path that differs between two trees the launcher read itself, in path order. Renames are not paired up: a path
 * that moved is a deletion and a new path, as `git diff-tree --no-renames` names it.
 */
export function differencesBetween(from: ReadonlyMap<string, TreeEntry>, to: ReadonlyMap<string, TreeEntry>): readonly TreeDifference[] {
  const paths = [...new Set([...from.keys(), ...to.keys()])].sort()
  const changes: TreeDifference[] = []
  for (const path of paths) {
    const was = from.get(path)
    const is = to.get(path)
    if (was?.mode === is?.mode && was?.blob === is?.blob) continue
    changes.push(is === undefined ? { path, deleted: true } : { path, deleted: false, mode: is.mode, blob: is.blob })
  }
  return changes
}

/** Every path under `tree`, as git lists it from the launcher's git dir. */
function entriesOf(tree: string, host: JudgeHost, judge: string): ReadonlyMap<string, TreeEntry> | string {
  const listed = gitRawIn(host, judge, ['ls-tree', '-r', '-z', '--full-tree', tree])
  if (listed === undefined) return `the tree ${tree} cannot be listed, ${THE_TREE_CANNOT_BE_JUDGED}`
  const entries = new Map<string, TreeEntry>()
  for (const record of listed.split(RECORD)) {
    const tab = record.indexOf('\t')
    if (tab < 0) continue
    const [mode = '', , blob = ''] = record.slice(0, tab).split(' ')
    entries.set(record.slice(tab + 1), { mode, blob })
  }
  return entries
}

/** The tree git would write with the checkout's files as they are, hashed under the tree whose attributes apply. */
function writeTheLiveTree(place: JudgePlace, attribute_tree: string, judge: string, index: string, host: JudgeHost): string | JudgedTree {
  const added = gitIn(host, judge, ['-c', 'core.sparseCheckout=false', 'add', '--all', '--', '.'], {
    GIT_WORK_TREE: place.top,
    GIT_INDEX_FILE: index,
    GIT_ATTR_SOURCE: attribute_tree,
  })
  if (added === undefined) return { kind: 'refused', refusal: `the checkout cannot be read as a working tree, ${THE_TREE_CANNOT_BE_JUDGED}` }
  // The live tree is written into the checkout's own object store, as `git add` used to leave it: the owner approves
  // that id, and a later read uses it again as the tree whose attributes apply, so it has to outlive this scratch.
  const written = gitIn(host, judge, ['write-tree'], {
    GIT_INDEX_FILE: index,
    GIT_OBJECT_DIRECTORY: join(place.git_dir, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(judge, 'objects'),
  })
  return written ?? { kind: 'refused', refusal: `the checkout cannot be written as a tree, ${THE_TREE_CANNOT_BE_JUDGED}` }
}

/**
 * Judges every file of the live tree against the approved one: its own bytes first, then git only for a file those
 * bytes do not explain. A file that matches the approved blob only through a conversion is refused when the
 * conversion is more than a line ending.
 */
function judgeEveryFile(
  place: JudgePlace,
  attribute_tree: string,
  entries: ReadonlyMap<string, TreeEntry>,
  approved: ReadonlyMap<string, TreeEntry>,
  format: GitObjectFormat,
  host: JudgeHost,
  judge: string,
): string | undefined {
  const store: LauncherStore = { repository: judge, tree: attribute_tree, format, processes: host.processes, scratch: host.stores.scratch }
  const attributes = { repository: judge, tree: attribute_tree, processes: host.processes }

  for (const [path, entry] of entries) {
    const bytes = bytesOnDisk(place.top, path, entry.mode, host)
    if (bytes === undefined) continue
    const approved_blob = approved.get(path)?.blob
    const judged = blobUnderTheTree(store, path, bytes, (blob) => blob === approved_blob)
    if (judged === undefined) return `${path} cannot be hashed the way git would store it, ${THE_TREE_CANNOT_BE_JUDGED}`
    if (judged.raw || judged.blob !== approved_blob) continue
    const refused = whyAConvertedFileIsRefused(attributes, path)
    if (refused !== undefined) return refused
  }
  return undefined
}

/**
 * The bytes git hashed for `path`: a link stores its target, a plain file its content. `undefined` for anything else,
 * which the tree itself already judges by mode.
 */
function bytesOnDisk(top: string, path: string, mode: string, host: JudgeHost): Buffer | undefined {
  const full = join(top, path)
  if (mode === LINK_MODE) {
    const found = host.stores.files.kindOf(full)
    return found.kind === 'symlink' ? Buffer.from(found.target) : undefined
  }
  if (!REGULAR_MODES.includes(mode)) return undefined
  try {
    return Buffer.from(host.stores.files.bytesOf(full))
  } catch {
    return undefined
  }
}

/** git, in the repository the launcher names, with every inherited `GIT_*` variable dropped and no global or system config. */
function gitIn(host: JudgeHost, git_dir: string, args: readonly string[], set: Readonly<Record<string, string>> = {}): string | undefined {
  return gitRawIn(host, git_dir, args, set)?.trim()
}

function gitRawIn(host: JudgeHost, git_dir: string, args: readonly string[], set: Readonly<Record<string, string>> = {}): string | undefined {
  const run = host.processes.runNow({
    command: 'git',
    args: ['--git-dir', git_dir, '-c', 'core.fsmonitor=false', ...args],
    cwd: git_dir,
    environment: {
      drop_prefixes: NOTHING_DROPPED,
      set: { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULL_CONFIG, GIT_TERMINAL_PROMPT: '0', ...set },
    },
  })
  return run.exit_code === 0 ? run.stdout : undefined
}

/** The object format of the checkout the launcher is judging, so the launcher's own git dir names the same one. */
export function objectFormatOf(git_dir: string, host: JudgeHost): GitObjectFormat | undefined {
  const named = gitIn(host, git_dir, ['rev-parse', '--show-object-format'])
  return named === 'sha1' || named === 'sha256' ? named : undefined
}
