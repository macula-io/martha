// A launch's own read-only copy of the relay (martha#117).
//
// This exists so the installed relay folder, the tree checked byte for byte
// against its release (#84, #21), is never written by a launch, and a member
// cannot leave a file there for the next launch to load.
//
// The host writes its generated types (`tsconfig.json`, `.claude-plugin/types/`)
// into the folder --plugin-dir names on an interactive start: only the files that
// are missing, and it keeps whatever is already at those paths. `plugin validate`
// writes nothing, and the host loads the relay from a folder it cannot write
// (probe on #117, host 2.1.318). So each launch copies the relay's declared files
// into its own relay directory (relay_directory.ts), clears every write bit, and
// names that copy to the host. The copy goes with the relay directory.
//
// Integrity: only the declared files are carried. A file anything put into the
// installed folder (the host's types from a launch before this one, a planted
// `tsconfig.json`) is not carried, since the folder may hold files that are not
// the relay: its own test in a checkout, the types an earlier host wrote. A
// declared file that is missing, is not a regular file, or sits under a folder
// that is a link refuses the launch: copying it would carry something other than
// the relay. Whether the declared files hold the release's bytes is the installed
// tree's check (#84, #21), not this copy's.
//
// These checks are speed bumps, not a boundary: a process of the same OS user
// can still swap a file between the check and the read, or open up the copy's
// modes (the same limit relay_directory.ts states).

import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Where the relay keeps its plugin manifest, as the host reads it. */
export const RELAY_MANIFEST = '.claude-plugin/plugin.json'

/** The relay's files, relative to its folder: what a launch carries into its copy. */
export const RELAY_FILES = [
  RELAY_MANIFEST,
  'hooks/hooks.json',
  'hooks/register.ts',
  'hooks/relay_protocol.ts',
  // The crew's mod and the one rule it applies (martha#254): both are hooks files the host loads, so a copy of the
  // relay is not the relay without them.
  'hooks/crew.tsx',
  'hooks/pane_rule.ts',
] as const

/** The copy's name inside a launch's relay directory. */
export const RELAY_COPY_NAME = 'relay'

/** The owner may read a copied file; nobody may write it. */
export const RELAY_COPY_FILE_MODE = 0o400

/** The owner may enter and list a copied folder; nobody may write into it. */
export const RELAY_COPY_DIRECTORY_MODE = 0o500

/** A folder of the copy while it is being filled, and before it is removed. */
const OWNER_WRITABLE_DIRECTORY = 0o700

export type RelayCopy = { readonly made: true; readonly plugin_dir: string } | { readonly made: false; readonly refusal: string }

const REFUSED = 'The member is not started: the relay could not be copied for this launch'

/** Copies the declared relay files from `installed` into `plugin_dir`, which must not exist yet, read-only. */
export function copyTheRelay(installed: string, plugin_dir: string): RelayCopy {
  const read = declaredFilesIn(installed)
  if (typeof read === 'string') return { made: false, refusal: `${REFUSED}: ${read}` }
  try {
    writeTheCopy(plugin_dir, read)
  } catch (error) {
    removeTheTree(plugin_dir)
    return { made: false, refusal: `${REFUSED}: ${plugin_dir} could not be written (${codeOf(error)}).` }
  }
  return { made: true, plugin_dir }
}

/** Removes `directory` and everything under it, opening up folders a copy made read-only. */
export function removeTheTree(directory: string): void {
  openUpFolders(directory)
  rmSync(directory, { recursive: true, force: true })
}

/** Each declared file's bytes, read without following a link; or what refuses the copy. */
function declaredFilesIn(installed: string): ReadonlyMap<string, Buffer> | string {
  const files = new Map<string, Buffer>()
  for (const file of RELAY_FILES) {
    const folder = linkedFolderOn(installed, file)
    if (folder !== undefined) return `${folder} in ${installed} is not a real folder.`
    const bytes = regularFileBytes(join(installed, file))
    if (typeof bytes === 'string') return `${file} in ${installed} ${bytes}.`
    files.set(file, bytes)
  }
  return files
}

/** The first folder between `installed` and `file` that is not a real folder, or undefined. */
function linkedFolderOn(installed: string, file: string): string | undefined {
  const folders = dirname(file).split('/').filter((part) => part !== '.')
  for (let depth = 1; depth <= folders.length; depth++) {
    const folder = folders.slice(0, depth).join('/')
    const stat = lstatOrUndefined(join(installed, folder))
    if (stat !== undefined && !stat.isDirectory()) return folder
  }
  return undefined
}

function regularFileBytes(path: string): Buffer | string {
  let fd: number
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    return codeOf(error) === 'ELOOP' ? 'is a link' : `cannot be read (${codeOf(error)})`
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd) : 'is not a regular file'
  } finally {
    closeSync(fd)
  }
}

function writeTheCopy(plugin_dir: string, files: ReadonlyMap<string, Buffer>): void {
  mkdirSync(plugin_dir, { mode: OWNER_WRITABLE_DIRECTORY })
  const folders = new Set<string>()
  for (const [file, bytes] of files) {
    const folder = dirname(join(plugin_dir, file))
    mkdirSync(folder, { recursive: true, mode: OWNER_WRITABLE_DIRECTORY })
    folders.add(folder)
    writeFileSync(join(plugin_dir, file), bytes, { flag: 'wx', mode: RELAY_COPY_FILE_MODE })
  }
  // Deepest first, so no folder is closed before what is inside it.
  for (const folder of [...folders, plugin_dir].sort((a, b) => b.length - a.length)) {
    chmodSync(folder, RELAY_COPY_DIRECTORY_MODE)
  }
}

function openUpFolders(directory: string): void {
  if (lstatOrUndefined(directory)?.isDirectory() !== true) return
  // A folder can go between the check and either call below: a launcher that is
  // tearing this tree down at the same time (#124), whose sweep may meet it. What
  // is already gone needs no opening, and no other error is swallowed.
  try {
    chmodSync(directory, OWNER_WRITABLE_DIRECTORY)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return
    throw error
  }
  for (const name of namesIn(directory)) openUpFolders(join(directory, name))
}

function namesIn(directory: string): readonly string[] {
  try {
    return readdirSync(directory)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return []
    throw error
  }
}

function lstatOrUndefined(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch {
    return undefined
  }
}

function codeOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? String(error)
}
