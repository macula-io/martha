// The key a provider is reached with, read from the file the declaration names (martha#511 part B, martha#931; gap 4 of
// martha#957). Two launches read one: the crew's own endpoint for an engine member, and a member's declared provider for
// a Claude Code member, whose key goes into that member's own environment and nowhere else.
//
// Only this user's own plain file, closed to the group and to others, and never a link, since a link's own mode says
// nothing of its target (martha#511 part B). The key is trimmed of the line end a file ends with, and never named in a
// refusal: a refusal names the field of the declaration the file was named at, `engine.endpoint.key_file` for the
// engine's or `providers.<name>.key_file` for a member's, so the owner is told which line to look at and never what the
// key is.
//
// It reads no file of the repository's own but the path rule, and keeps nothing: the caller decides where the key goes.

import { lstatSync, readFileSync, type Stats } from 'node:fs'
import { isAbsolute } from 'node:path'
import process from 'node:process'

import { THE_HOMES_PREFIX, writtenOut } from '../bring_up_the_declared_crew/declare_the_engines_endpoint.ts'

/** The mode bits a key file must have clear: every right of its group and of others. */
export const THE_MODE_BITS_OF_GROUP_AND_OTHERS = 0o077

/** What was found at a key file's path, as the start found it: a plain file's own facts, never its contents. */
export interface WhatIsAtAKeyFilesPath {
  readonly plain_file: boolean
  readonly owner_is_this_user: boolean
  readonly mode: number
}

/**
 * Why a key file may not be read, from what the start found there (martha#511 part B): not a plain file, someone else's,
 * or open to the group or to others. Undefined when it is the owner's own file, closed to everyone else.
 */
export function whyAKeyFileIsNotTheOwners(named_as: string, at: string, found: WhatIsAtAKeyFilesPath): string | undefined {
  if (!found.plain_file) return `${named_as} ${at} is not a plain file`
  if (!found.owner_is_this_user) return `${named_as} ${at} is not this user's own file`
  if ((found.mode & THE_MODE_BITS_OF_GROUP_AND_OTHERS) !== 0) return `${named_as} ${at} is open to the group or to others: close it to its owner`
  return undefined
}

/**
 * The key in the file `key_file` names, named at `named_as` in the declaration, with a leading `~/` written out against
 * the owner's home first (martha#931): a provider's path as the owner typed it, then read as theKeyInAFile reads one.
 */
export const theKeyInTheOwnersFile = (key_file: string, home: string, named_as: string): { readonly key: string } | { readonly refusal: string } =>
  theKeyInAFile(writtenOut(key_file, home), named_as)

/**
 * The key in the key file at `at`, named at `named_as` in the declaration (martha#511 part B): only this user's own
 * plain file, closed to the group and to others, and never a link, since a link's own mode says nothing of its target.
 * The key is trimmed of the line end a file ends with and never named in a refusal; an empty file gives no key.
 */
export function theKeyInAFile(at: string, named_as: string): { readonly key: string } | { readonly refusal: string } {
  // A provider's key file is kept as the owner wrote it (martha#931); written out, it must be absolute, or it would be read against wherever the start runs.
  if (!isAbsolute(at)) return { refusal: `${named_as} ${at} is not an absolute path or one under ${THE_HOMES_PREFIX}` }
  let found: Stats
  try {
    found = lstatSync(at)
  } catch (error) {
    return { refusal: `${named_as} ${at} cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)})` }
  }
  const why = whyAKeyFileIsNotTheOwners(named_as, at, { plain_file: found.isFile(), owner_is_this_user: found.uid === process.getuid?.(), mode: found.mode })
  if (why !== undefined) return { refusal: why }
  const key = readFileSync(at, 'utf8').trim()
  return key === '' ? { refusal: `${named_as} ${at} is empty` } : { key }
}
