// Whose text a signed command may see (martha#129, design step 5): the files of the live tree that are the
// owner's base or the member's own writes, and nothing else.
//
// Every path git would see in the checkout (tracked, plus untracked and unignored) is judged by its entry: its
// mode and its blob id, computed from the bytes the launcher read once. A regular file passes when its entry is
// the base tree's at that path, or one the member wrote there itself, in any session (the "all" window of the one
// own-writes registry, ../remember_a_members_own_writes). A deletion adds no text and passes. Anything that is not
// a regular file, in the base or in the live tree, is refused: a symlink or a gitlink has no blob, and a symlink
// can resolve to a file no rule looked at. A refusal names the path, so the owner can see what took the shell.

import type { BlobUnderTheTree } from '../hash_a_file_under_a_tree/hash_a_file_under_a_tree.ts'
import { ownWriteMatches, type OwnWriteLeft } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import type { TreeChange } from '../judge_a_checkouts_tree/checkout_tree.ts'
import { OWN_WRITE_MODES } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'

/** The modes of a regular file, as git writes them: the only entries a run sees, as the only own writes. */
const REGULAR_MODES: ReadonlySet<string> = new Set(OWN_WRITE_MODES)

/** One entry of the base tree, as `ls-tree -r` lists it. */
export interface BaseEntry {
  readonly path: string
  readonly mode: string
  readonly blob: string
}

/** One path of the live tree: a regular file with its mode and blob id, or something that is not one. */
export type LiveEntry = { readonly path: string; readonly regular: true; readonly mode: string; readonly blob: string } | { readonly path: string; readonly regular: false }

/** What a run may see of the member's own writes: the path, blob id and mode each one left. */
export interface OwnWriteSeen {
  readonly path: string
  readonly blob: string
  readonly mode: string
}

/** A regular file the run may see. */
export interface FileTheRunMaySee {
  readonly path: string
  readonly mode: string
  readonly blob: string
  /**
   * True when the file passes only as git normalises it, so the run must be written from that object's bytes rather
   * than the bytes read from the checkout: those two differ, and only the object was judged.
   */
  readonly from_object: boolean
}

export interface PathRefused {
  readonly path: string
  readonly why: string
}

export interface TreeTheRunMaySee {
  readonly files: readonly FileTheRunMaySee[]
  readonly refusals: readonly PathRefused[]
}

export interface TreeToJudge {
  readonly base: readonly BaseEntry[]
  readonly own_writes: readonly OwnWriteSeen[]
  readonly live: readonly LiveEntry[]
  /**
   * The blob git would give a file whose own bytes vouched for nothing, asked with the attributes the base commit
   * sets (../hash_a_file_under_a_tree). Omitted where nothing may be asked, as in a test of the rule alone.
   */
  readonly blobUnderTheTreeOf?: (regular: { readonly path: string; readonly mode: string; readonly blob: string }, isKnown: (blob: string) => boolean) => BlobUnderTheTree | undefined
}

const entryKey = (mode: string, blob: string) => `${mode} ${blob}`

/** The files a run may see, and every path that takes the exemption away. */
export function treeTheRunMaySee(tree: TreeToJudge): TreeTheRunMaySee {
  const base = new Map(tree.base.map((entry) => [entry.path, entryKey(entry.mode, entry.blob)]))
  const own = new Map<string, OwnWriteLeft[]>()
  for (const write of tree.own_writes.filter((w) => REGULAR_MODES.has(w.mode))) {
    own.set(write.path, [...(own.get(write.path) ?? []), write])
  }
  const base_refusals = tree.base
    .filter((entry) => !REGULAR_MODES.has(entry.mode))
    .map((entry) => ({ path: entry.path, why: `the base holds ${entry.path} as mode ${entry.mode}, not a regular file` }))
  const judged = tree.live.map((entry) => judgeLive(entry, base, own, tree.blobUnderTheTreeOf))
  return {
    files: judged.flatMap((j) => ('file' in j ? [j.file] : [])),
    refusals: [...base_refusals, ...judged.flatMap((j) => ('refusal' in j ? [j.refusal] : []))],
  }
}

function judgeLive(
  entry: LiveEntry,
  base: ReadonlyMap<string, string>,
  own: ReadonlyMap<string, readonly OwnWriteLeft[]>,
  blobUnderTheTreeOf: TreeToJudge['blobUnderTheTreeOf'],
): { file: FileTheRunMaySee } | { refusal: PathRefused } {
  if (!entry.regular) return { refusal: { path: entry.path, why: `${entry.path} is not a regular file` } }
  if (!REGULAR_MODES.has(entry.mode)) return { refusal: { path: entry.path, why: `${entry.path} is neither the base's nor the member's own write` } }
  const ownHere = own.get(entry.path) ?? []
  const vouched = (blob: string): boolean => {
    const asChange: TreeChange = { path: entry.path, deleted: false, mode: entry.mode, blob }
    return base.get(entry.path) === entryKey(entry.mode, blob) || ownHere.some((write) => ownWriteMatches(write, asChange))
  }
  if (vouched(entry.blob)) return { file: { path: entry.path, mode: entry.mode, blob: entry.blob, from_object: false } }
  const asked = blobUnderTheTreeOf?.(entry, vouched)
  if (asked !== undefined && vouched(asked.blob)) return { file: { path: entry.path, mode: entry.mode, blob: asked.blob, from_object: !asked.raw } }
  return { refusal: { path: entry.path, why: `${entry.path} is neither the base's nor the member's own write` } }
}
