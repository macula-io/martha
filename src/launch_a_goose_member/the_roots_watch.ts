// The re-check after every result of an engine member (#541 package A, design G1 row `checkTheSettingsStillHold`, PASS
// r=7 issuecomment-7010033523). Three checks, in this order, and the first that fails stops the member:
//   1. the owner's Claude Code settings watch, the same one a Claude Code launch runs: a `shell` call of this member can
//      edit the owner's settings, and a key there turns hooks off for every Claude Code member after it;
//   2. the config root and the secrets file read back as the launch wrote them (C1's `theRootReadBack`, R1's read-back);
//   3. the root's folders the engine reads its gates, prompt and providers from, compared whole against the snapshot
//      taken when the launch wrote them, before the engine started: no entry added or removed, every file the same
//      bytes, every entry the same kind, mode, owner and (for a link) target.
//
// Which folders are compared whole is the design's choice, by the kinds the engine's paths module names them with:
// `config` and `agents_home` (`config/` and `.agents/`). In a launch's session the engine writes neither by itself (the
// design's paragraph under "The launch's own engine root"); `data/` and `state/` it writes every turn, so they are not.
//
// What stays open, said plainly (a speed bump, DECIDED 2026-11-18 "Speed bumps, said plainly"): a change written and
// restored between two results is not seen here. The gate on the calls that could rely on that is rule (a), in the ACP
// client, not this watch.

import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

import type { EngineFacts } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'

/** The kinds of the engine's folders a launch compares whole after every result (design G1, r=4 R1). */
export const THE_KINDS_READ_BACK_WHOLE = ['config', 'agents_home'] as const

/** One entry of a folder as it was read: its kind, mode and owner, and its bytes' hash or its link's target. */
type AnEntry = string

/** A folder as it was read: each entry by its path under the folder; absent when the folder is not there. */
export type AFolderRead = { readonly absent: true } | { readonly entries: ReadonlyMap<string, AnEntry> } | { readonly why: string }

/** The bits of a mode the watch compares: permissions, set-id and sticky. */
const MODE_BITS = 0o7777

/** One entry, said in one line, so two reads compare as text. */
function anEntryOf(at: string): { readonly entry: AnEntry; readonly folder: boolean } {
  const held = lstatSync(at)
  const owned = `${(held.mode & MODE_BITS).toString(8)} ${held.uid}`
  if (held.isSymbolicLink()) return { entry: `link ${owned} ${readlinkSync(at)}`, folder: false }
  if (held.isDirectory()) return { entry: `folder ${owned}`, folder: true }
  if (held.isFile()) return { entry: `file ${owned} ${createHash('sha256').update(readFileSync(at)).digest('hex')}`, folder: false }
  return { entry: `other ${owned}`, folder: false }
}

/** Reads `folder` whole, following no link, or says why it cannot be read. */
export function aFolderRead(folder: string): AFolderRead {
  try {
    lstatSync(folder)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { absent: true }
    return { why: `${folder} cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)})` }
  }
  const entries = new Map<string, AnEntry>()
  const walk = (under: string): void => {
    const one = anEntryOf(join(folder, under))
    entries.set(under, one.entry)
    if (!one.folder) return
    for (const name of readdirSync(join(folder, under)).sort()) walk(under === '' ? name : join(under, name))
  }
  try {
    walk('')
  } catch (error) {
    return { why: `${folder} cannot be read whole (${(error as NodeJS.ErrnoException).code ?? String(error)})` }
  }
  return { entries }
}

/** The first difference between two reads of one folder, or undefined when there is none. */
export function theFirstDifference(folder: string, before: AFolderRead, now: AFolderRead): string | undefined {
  if ('why' in before) return before.why
  if ('why' in now) return now.why
  if ('absent' in before) return 'absent' in now ? undefined : `${folder} was made after the launch wrote its root`
  if ('absent' in now) return `${folder} was removed after the launch wrote its root`
  return theFirstEntryDifference(folder, before.entries, now.entries)
}

/** The first entry of a folder read twice that was removed, changed or added between the reads, or undefined. */
function theFirstEntryDifference(folder: string, before: ReadonlyMap<string, string>, now: ReadonlyMap<string, string>): string | undefined {
  for (const [path, entry] of before) {
    const held = now.get(path)
    if (held === undefined) return `${join(folder, path)} was removed after the launch wrote its root`
    if (held !== entry) return `${join(folder, path)} was changed after the launch wrote its root`
  }
  const added = [...now.keys()].find((path) => !before.has(path))
  return added === undefined ? undefined : `${join(folder, added)} was added after the launch wrote its root`
}

/** The folders of `root` compared whole, by the kinds above, or why the recording does not name one. */
export function theFoldersReadBackWhole(facts: Pick<EngineFacts, 'engine_folders'>, root: string): { readonly folders: readonly string[] } | { readonly refusal: string } {
  const folders: string[] = []
  for (const kind of THE_KINDS_READ_BACK_WHOLE) {
    const segments = facts.engine_folders.under_root[kind]
    if (segments === undefined || segments.length === 0) return { refusal: `the recorded engine names no ${kind} folder under its root, so the launch cannot read it back` }
    folders.push(join(root, ...segments))
  }
  return { folders }
}

/** What the watch is given: the read-back of the files the launch wrote, and the folders it compares whole. */
export interface TheRootsWatchAsked {
  /** The config root and the secrets file read back as written: why not, or undefined. */
  readonly the_files_as_written: () => string | undefined
  /** The folders compared whole. */
  readonly folders: readonly string[]
}

/**
 * Takes the snapshot of `folders` now, and returns the re-check: the two checks, in order, the first that fails saying
 * why. Called right after the launch writes its root and before the engine is spawned. The owner's Claude Code settings
 * are not watched here (martha#601 row 174): the engine reads no file of Claude Code's.
 */
export function theRootsWatch(asked: TheRootsWatchAsked): () => string | undefined {
  const snapshot = asked.folders.map((folder) => ({ folder, read: aFolderRead(folder) }))
  return () => {
    const files = asked.the_files_as_written()
    if (files !== undefined) return files
    for (const { folder, read } of snapshot) {
      const why = theFirstDifference(folder, read, aFolderRead(folder))
      if (why !== undefined) return `the launch's engine root no longer holds what it wrote: ${why}, and the engine reads its gates, prompt and providers from there`
    }
    return undefined
  }
}
