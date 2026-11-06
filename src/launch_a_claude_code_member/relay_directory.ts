// The directory that holds one launch's relay socket (#41).
//
// This exists so the socket a member's relay talks to is one the launcher made
// for that launch alone, in a place nobody else can write, and gone when the
// launcher exits (the Supervisor's condition 2).
//
// The directory is made exclusively: a path that already exists, a link
// included, refuses the launch rather than being reused. Its parent must be a
// real directory owned by this user that nobody else may write into, so no one
// else can swap the new directory out. The new directory is checked after it is
// made: a real directory, owned by this user, mode 0700 exactly.
//
// These checks are speed bumps, not a boundary: a process of the same OS user
// can still connect to the socket and claim any origin (T13, under A13, closed
// by the signed roster, martha#24).

import { type Stats, lstatSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process, { getuid } from 'node:process'

/** Only the owner may enter, list or write the directory. */
export const RELAY_DIRECTORY_MODE = 0o700

/** The socket's name inside the directory. */
export const RELAY_SOCKET_NAME = 'relay.sock'

/** sizeof(sun_path) in <sys/un.h>: 108 bytes on Linux, 104 on macOS and the BSDs. */
const SUN_PATH_LINUX = 108
const SUN_PATH_BSD = 104
/** The byte sun_path keeps for the terminating NUL. */
const SUN_PATH_NUL = 1

/**
 * The longest socket path a Unix socket address holds on `platform`, in bytes.
 * A root under a long TMPDIR (macOS's default is about 49 bytes, behind a link)
 * can leave no room for `<root>/<launch>/relay.sock` (martha#79).
 */
export function longestSocketPath(platform: NodeJS.Platform = process.platform): number {
  return (platform === 'linux' ? SUN_PATH_LINUX : SUN_PATH_BSD) - SUN_PATH_NUL
}

const PERMISSION_BITS = 0o777
const WRITABLE_BY_OTHERS = 0o022

export type RelayDirectory =
  | { readonly made: true; readonly directory: string; readonly socket_path: string; remove(): void }
  | { readonly made: false; readonly refusal: string }

const REFUSED = 'The member is not started: its relay socket has no safe place'

/** Makes `directory`, which must not exist yet, for one launch's relay socket. */
export function makeRelayDirectory(directory: string, owner_uid: number = getuid?.() ?? -1): RelayDirectory {
  const socket_path = join(directory, RELAY_SOCKET_NAME)
  const tooLong = problemWithSocketLength(socket_path)
  if (tooLong !== undefined) return { made: false, refusal: tooLong }

  const parent = dirname(directory)
  const parentProblem = problemWithParent(parent, owner_uid)
  if (parentProblem !== undefined) return { made: false, refusal: `${REFUSED}: ${parentProblem}` }

  try {
    mkdirSync(directory, { mode: RELAY_DIRECTORY_MODE })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { made: false, refusal: `${REFUSED}: ${directory} could not be made new (${code ?? String(error)}).` }
  }

  const made = lstatSync(directory)
  const remove = (): void => rmSync(directory, { recursive: true, force: true })
  if (!isOnlyTheOwners(made, owner_uid)) {
    remove()
    return { made: false, refusal: `${REFUSED}: ${directory} was not made as a directory only this user may enter.` }
  }
  return { made: true, directory, socket_path, remove }
}

function problemWithSocketLength(socket_path: string): string | undefined {
  const bytes = Buffer.byteLength(socket_path)
  const longest = longestSocketPath()
  if (bytes <= longest) return undefined
  return (
    `${REFUSED}: ${socket_path} is ${String(bytes)} bytes, longer than the ${String(longest)} a socket address holds ` +
    `on ${process.platform}; give the launcher a shorter relay root.`
  )
}

/** A real directory, owned by `owner_uid`, mode 0700 exactly. */
function isOnlyTheOwners(made: Stats, owner_uid: number): boolean {
  return made.isDirectory() && made.uid === owner_uid && (made.mode & PERMISSION_BITS) === RELAY_DIRECTORY_MODE
}

function problemWithParent(parent: string, owner_uid: number): string | undefined {
  let stat
  try {
    stat = lstatSync(parent)
  } catch (error) {
    return `${parent} cannot be read (${(error as NodeJS.ErrnoException).code ?? String(error)}).`
  }
  if (stat.isSymbolicLink()) return `${parent} is a link.`
  if (!stat.isDirectory()) return `${parent} is not a directory.`
  if (stat.uid !== owner_uid) return `${parent} is not owned by this user.`
  if ((stat.mode & WRITABLE_BY_OTHERS) !== 0) return `${parent} may be written by others.`
  return undefined
}
