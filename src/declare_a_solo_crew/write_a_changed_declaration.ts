// The owner's change to the crew written over its declaration (martha#307): `martha crew add`, `remove`, `set-model`
// and `set-host` hand this the text before and after their change (../declare_crew/change_a_member.ts).
//
// The changed text goes to a file of its own in the declaration's directory, and is renamed over the declaration, so a
// reader sees the old file or the new one, never half of one. Before the rename the declaration is read again: when it
// no longer holds the bytes the change was made from, the change is refused and the file is left as it is. That is a
// speed bump, not a lock: a crew has one owner, and the window between the read and the rename stays open.
//
// As `martha init` declares only in a directory of the checkout's own, a declaration directory that is a link is
// refused by name, so a change is never written through one to a place outside the checkout.

import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { join } from 'node:path'

import { DECLARATION_DIRECTORY, DECLARATION_FILE } from '../declare_crew/declare_crew.ts'

/** The bytes of the random part of the file the changed text is written to before the rename. */
const PENDING_NAME_BYTES = 6

/** Why `directory` may not hold a changed declaration, or undefined. */
function whyNotIn(directory: string): string | undefined {
  const found = fs.lstatSync(directory, { throwIfNoEntry: false })
  if (found === undefined) return `${directory} is missing, so there is no crew to change.`
  if (found.isSymbolicLink()) return `${directory} is a link, and Martha changes a crew only in a directory of the checkout's own.`
  return found.isDirectory() ? undefined : `${directory} is not a directory, so there is no crew to change in it.`
}

/** The declaration's text now, or undefined when it cannot be read. */
const textNow = (declaration: string): string | undefined => {
  try {
    return fs.readFileSync(declaration, 'utf8')
  } catch {
    return undefined
  }
}

/**
 * Writes `change.after` over the declaration under `root`, only while it still holds `change.before`; why not, or
 * undefined once it is written.
 */
export function writeAChangedDeclaration(root: string, change: { readonly before: string; readonly after: string }): string | undefined {
  const directory = join(root, DECLARATION_DIRECTORY), declaration = join(directory, DECLARATION_FILE)
  const unfit = whyNotIn(directory)
  if (unfit !== undefined) return unfit
  const pending = join(directory, `.${DECLARATION_FILE}.${randomBytes(PENDING_NAME_BYTES).toString('hex')}`)
  try {
    fs.writeFileSync(pending, change.after, { flag: 'wx' })
    if (textNow(declaration) !== change.before) return `${declaration} changed while this ran, so the change was not written. Run it again.`
    fs.renameSync(pending, declaration)
    return undefined
  } catch (error) {
    return `${declaration} could not be written (${(error as NodeJS.ErrnoException).code ?? String(error)}).`
  } finally {
    fs.rmSync(pending, { force: true })
  }
}
