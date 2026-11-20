// The work directory a digest reads, as this machine answers it (martha#985).
//
// Host glue, like ../row_streams_directory: a directory, not a coding tool's store, so every host adapter on such a
// machine composes this one. The core names a directory and asks what is in it; this opens it, reads a file's bits and
// bytes, and resolves a path's links, and the slice decides what any of that means.

import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'

import type { ATreeEntry, Refused, WorkDirectory } from '../host_contract/host_contract.ts'

/** The bits of a mode a subtree reading keeps: what `find -printf '%m'` prints. */
const THE_MODE_BITS = 0o7777

/** What an entry of a directory is, from the host's own word for it. */
const kindOf = (entry: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): ATreeEntry['kind'] =>
  entry.isSymbolicLink() ? 'link' : entry.isFile() ? 'file' : entry.isDirectory() ? 'directory' : 'other'

/** The error a refusal reads by, or `unknown` when the machine said nothing. */
const whyOf = (error: unknown): string => (error as NodeJS.ErrnoException).code ?? 'unknown'

/** This machine's answer to the host contract's WorkDirectory: every call names one path and opens it once. */
export const aWorkDirectoryOnThisMachine: WorkDirectory = {
  list: async (path: string): Promise<readonly ATreeEntry[] | Refused> => {
    const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => error)
    if (!Array.isArray(entries)) return { refusal: `${path} could not be listed (${whyOf(entries)}).` }
    return entries.map((entry) => ({ name: entry.name, kind: kindOf(entry) }))
  },
  modeOf: async (path: string): Promise<{ readonly mode: number } | Refused> => {
    const found: Stats | Error = await stat(path).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))
    if (found instanceof Error) return { refusal: `${path} could not be read (${whyOf(found)}).` }
    return { mode: found.mode & THE_MODE_BITS }
  },
  bytesOf: async (path: string): Promise<{ readonly bytes: Buffer } | Refused> => {
    const bytes = await readFile(path).catch((error: unknown) => error)
    if (!Buffer.isBuffer(bytes)) return { refusal: `${path} could not be read (${whyOf(bytes)}).` }
    return { bytes }
  },
  realOf: (path: string): Promise<string | undefined> => realpath(path).catch(() => undefined),
}
