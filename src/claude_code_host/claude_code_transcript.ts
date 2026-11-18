// The one transcript a launch reads, held by its descriptor (martha#658).
//
// The path is the host's SessionStart input, so it is the host's to name, but the file is the member's user's to
// write. It is used only when it names `<session id>.jsonl` one folder down in the launch's own host config `projects`
// tree, and every bound is checked on what was opened, never on the name before the open:
//   - each folder from the config folder down is opened with O_DIRECTORY|O_NOFOLLOW and fstat'ed as a folder of the
//     launch's uid. Node has no openat, so each one is reopened by its full path, and a race won between two of those
//     opens can point the walk elsewhere. What closes that is below: the dev/ino compare and the typed-only read. A
//     won race gains nothing beyond forging one's own transcript, which a shell call does anyway;
//   - the file is opened O_RDONLY|O_NOFOLLOW|O_NONBLOCK (a symlink fails the open; a FIFO cannot hang the beat) and
//     fstat'ed as a regular file of the launch's uid;
//   - the descriptor is kept, and every later read goes through it by offset, so the name is never opened again. The
//     name is only lstat'ed to see that it still names the inode that was opened: when it does not, the host rotated
//     the file or someone swapped it, and the session reads unknown.
// Anything else is refused by name, and the session stays unknown.

import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

/** What a launch knows of the transcript it may read. */
export interface WhereTheTranscriptIs {
  /** The host config folder the launch gave the member (its CLAUDE_CONFIG_DIR). */
  readonly config_dir: string
  /** The session id the host reported in the same SessionStart input. */
  readonly session_id: string
  /** The host's `transcript_path` from that input. */
  readonly transcript_path: string
  readonly uid: number
}

/** A transcript held open: its descriptor, the inode it is, and how far it was read. */
export interface AHeldTranscript {
  readonly fd: number
  readonly path: string
  readonly dev: number
  readonly ino: number
  offset: number
  /** The bytes after the last newline read, kept until the line ends. */
  rest: string
  /** Set while an over-long line is being passed over, up to its newline. */
  skipping: boolean
}

/** The folder under the host config folder that holds every project's session transcripts. */
export const PROJECTS_FOLDER = 'projects'

/** The longest line kept whole; a longer one is skipped, never buffered (martha#658's size bound). */
export const LONGEST_TRANSCRIPT_LINE = 1024 * 1024

/** How much one read takes at most. */
const READ_CHUNK = 64 * 1024

/** How much one beat reads at most; the rest waits for the next beat, so a burst never sits in memory whole. */
export const MOST_READ_PER_BEAT = 4 * 1024 * 1024

export type Refused = { readonly refused: string }

const REFUSED = (why: string): Refused => ({ refused: `transcript path refused: ${why}` })

/** The folders from the config folder down to the file, or why the path is not one this launch may read. */
function foldersTo(where: WhereTheTranscriptIs): readonly string[] | Refused {
  const projects = join(where.config_dir, PROJECTS_FOLDER)
  const below = relative(projects, where.transcript_path).split(sep)
  if (below.length !== 2 || below[0] === '' || below[0] === '..' || below[0] === '.') return REFUSED('it is not one folder below the launch config folder\'s projects folder')
  if (basename(where.transcript_path) !== `${where.session_id}.jsonl`) return REFUSED('it does not name the session the host reported')
  return [where.config_dir, projects, dirname(join(projects, ...below))]
}

/** Opens one path with `flags`, fstat's it, and closes it unless `keep`; or why it is not what it must be. */
function openedAs(path: string, flags: number, kind: 'folder' | 'file', uid: number): { fd: number; dev: number; ino: number } | Refused {
  let fd: number
  try {
    fd = openSync(path, flags)
  } catch (error) {
    return REFUSED(`${path} could not be opened as a ${kind} without following a link (${(error as NodeJS.ErrnoException).code ?? 'error'})`)
  }
  const stat = fstatSync(fd)
  const right = kind === 'folder' ? stat.isDirectory() : stat.isFile()
  if (right && stat.uid === uid) return { fd, dev: stat.dev, ino: stat.ino }
  closeSync(fd)
  return REFUSED(`${path} is not a ${kind} of the launch's user`)
}

const FOLDER_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

/** Opens the transcript under every bound, or refuses it by name. */
export function openTheTranscript(where: WhereTheTranscriptIs): AHeldTranscript | Refused {
  const folders = foldersTo(where)
  if ('refused' in folders) return folders
  for (const folder of folders) {
    const opened = openedAs(folder, FOLDER_FLAGS, 'folder', where.uid)
    if ('refused' in opened) return opened
    closeSync(opened.fd)
  }
  const file = openedAs(where.transcript_path, FILE_FLAGS, 'file', where.uid)
  if ('refused' in file) return file
  return { ...file, path: where.transcript_path, offset: 0, rest: '', skipping: false }
}

/** Whether the name still names the inode that was opened. */
function stillTheSame(held: AHeldTranscript): boolean {
  try {
    const now = lstatSync(held.path)
    return now.dev === held.dev && now.ino === held.ino
  } catch {
    return false
  }
}

/** What one read gave: the whole lines since the last, how many over-long ones were skipped, or that the file moved. */
export type NewLines = { readonly lines: readonly string[]; readonly skipped: number } | { readonly moved: true }

/** The bytes after the offset, through the held descriptor. */
function bytesAfter(held: AHeldTranscript): string {
  const chunks: Buffer[] = []
  for (;;) {
    const buffer = Buffer.alloc(READ_CHUNK)
    const read = readSync(held.fd, buffer, 0, READ_CHUNK, held.offset)
    if (read > 0) chunks.push(buffer.subarray(0, read))
    held.offset += read
    if (read === 0 || chunks.length * READ_CHUNK >= MOST_READ_PER_BEAT) return Buffer.concat(chunks).toString('utf8')
  }
}

/** The text after an over-long line's newline, when one is being passed over; all of it otherwise. */
function pastAnySkip(held: AHeldTranscript, text: string): { readonly text: string; readonly ended: boolean } {
  if (!held.skipping) return { text, ended: false }
  const newline = text.indexOf('\n')
  if (newline === -1) return { text: '', ended: false }
  held.skipping = false
  return { text: text.slice(newline + 1), ended: true }
}

/** The whole lines written since the last read, through the held descriptor; over-long ones are counted, not kept. */
export function readTheNewLines(held: AHeldTranscript): NewLines {
  if (!stillTheSame(held)) return { moved: true }
  const past = pastAnySkip(held, bytesAfter(held))
  if (held.skipping) return { lines: [], skipped: 0 }
  const parts = (held.rest + past.text).split('\n')
  const tail = parts.pop() ?? ''
  held.skipping = tail.length > LONGEST_TRANSCRIPT_LINE
  held.rest = held.skipping ? '' : tail
  const lines = parts.filter((line) => line.length <= LONGEST_TRANSCRIPT_LINE)
  return { lines, skipped: parts.length - lines.length + (past.ended ? 1 : 0) }
}

/** Lets the descriptor go, once the session ended. */
export function letTheTranscriptGo(held: AHeldTranscript): void {
  closeSync(held.fd)
}
