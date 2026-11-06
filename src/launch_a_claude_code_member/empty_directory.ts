// The empty directory a launch points git's hooks and direnv's config at
// (martha#24, option 3; ../refuse_code_a_checkout_runs_itself).
//
// This exists so the place git looks for hooks and direnv for its config holds
// nothing, and nothing can be put there: made new for this launch, owned by
// this user, mode 0500, inside the launch's own relay directory, and gone with
// it. A path that already exists, a link included, refuses the launch.

import { lstatSync, mkdirSync, readdirSync } from 'node:fs'
import { getuid } from 'node:process'

/** Only the owner may enter or list it, and nobody may write into it. */
export const EMPTY_DIRECTORY_MODE = 0o500

const PERMISSION_BITS = 0o777

export type EmptyDirectory = { readonly made: true } | { readonly made: false; readonly refusal: string }

/**
 * Makes `directory`, which must not exist yet, as the empty directory git looks
 * for hooks in and direnv for its config: a real directory, owned by this user,
 * mode 0500 exactly, holding nothing.
 */
export function makeEmptyDirectory(directory: string, owner_uid: number = getuid?.() ?? -1): EmptyDirectory {
  const refused = (why: string): EmptyDirectory => ({
    made: false,
    refusal: `The member is not started: the empty directory that switches off a checkout's hooks ${why}.`,
  })
  try {
    mkdirSync(directory, { mode: EMPTY_DIRECTORY_MODE })
  } catch (error) {
    return refused(`could not be made new at ${directory} (${(error as NodeJS.ErrnoException).code ?? String(error)})`)
  }
  const made = lstatSync(directory)
  if (!made.isDirectory() || made.uid !== owner_uid || (made.mode & PERMISSION_BITS) !== EMPTY_DIRECTORY_MODE) {
    return refused(`at ${directory} is not a directory only this user may read`)
  }
  if (readdirSync(directory).length !== 0) return refused(`at ${directory} is not empty`)
  return { made: true }
}
