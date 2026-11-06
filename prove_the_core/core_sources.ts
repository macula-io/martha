// The core's sources, read from disk.
//
// Every check on the core walks it with this one function, so no check reads
// fewer files than another. It lives outside src/ because it reads the disk,
// which a slice of the core may not do.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { isScannedSource, type CoreSource } from '../src/host_contract/imports_beyond_the_core.ts'

/** Every script file under `root`, with its path relative to `root`. */
export function coreSources(root: string): CoreSource[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && isScannedSource(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }))
}
