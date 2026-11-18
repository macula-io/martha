// The owner's act that keeps the lab families' digests on this machine (martha#731):
// `npm run keep:lab-families`, run once by the owner, again when a family changes.
//
// It takes the families as CI's secret holds them, makes a fresh random key, and
// writes the key and the families' digests to the file ../check_nothing_private_gets_in/read_lab_family_digests.ts
// reads, mode 0600, in a folder only this user may enter. Keeping it again replaces
// the key and the digests together. The plain list is never written.
//
// Only the owner, at a terminal, keeps it: a member's shell tool has no terminal.
// That is a speed bump, not a wall: a member that sets out to can make a terminal
// of its own. What the file is, and what it is not: ../check_nothing_private_gets_in/lab_family_digests.ts.

import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { familiesToKeep, keptFileText } from '../check_nothing_private_gets_in/lab_family_digests.ts'
import { labFamiliesFileIn, type AnEnvironment } from '../check_nothing_private_gets_in/read_lab_family_digests.ts'

/** The folder and the file: only this user may read either. */
const FOLDER_MODE = 0o700
const FILE_MODE = 0o600

export type Kept = { readonly kept: string; readonly families: number } | { readonly refusal: string }

/** Keeps the digests of the families `raw` names under `key`, at the place `env` names. */
export const keepLabFamilies = (env: AnEnvironment, raw: string, key: Buffer): Kept => {
  const file = labFamiliesFileIn(env)
  if (file === undefined) return { refusal: 'neither XDG_CONFIG_HOME nor HOME is an absolute path, so there is no place to keep the lab families' }
  const families = familiesToKeep(raw)
  if (typeof families === 'string') return { refusal: families }
  // Written beside the file and renamed over it, so a reader never meets half a file.
  const writing = `${file}.${process.pid}.writing`
  try {
    mkdirSync(dirname(file), { recursive: true, mode: FOLDER_MODE })
    writeFileSync(writing, keptFileText(families, key), { mode: FILE_MODE, flag: 'wx' })
    renameSync(writing, file)
  } catch (error) {
    rmSync(writing, { force: true })
    return { refusal: `the lab families could not be kept (${(error as NodeJS.ErrnoException).code ?? 'unknown'})` }
  }
  return { kept: file, families: families.length }
}
