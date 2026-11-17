// What the host itself recorded loading into a session (martha#223). Its transcript carries
// one `attachment` entry whose `files` name each file the host read in — the owner's
// instructions, the project's memory — with the file's path and text, written when the session
// starts. A row that reads that record does not depend on the model answering at all, which is
// what went wrong: asked for the codeword, the model sometimes spent every turn it was given
// and answered nothing, so a tree where nothing was wrong produced a red row.
//
// Two things keep the reading to THIS run: the caller reads only the session records under the
// run's own project folders, and this keeps only the entries whose session started in the
// folder the run started the host in. Another live session's transcript is neither.

import { isRecord } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** One file the host recorded reading into a session: where it is, and the text it read. */
export interface AFileTheHostLoaded {
  readonly path: string
  readonly text: string
}

/** The host's own name for a file the owner's auto-memory put in front of the session. */
const MEMORY_FILE_KIND = 'AutoMem'

/** One transcript line, as far as it says anything about what was loaded. */
interface AnEntry {
  /** The folder the session started in, as the host recorded it; absent when it did not say. */
  readonly startedIn: string | undefined
  readonly files: readonly unknown[]
}

/** One line, parsed, or undefined when it is not json. */
function parsedIn(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

/** One transcript line, as the entry it is: where the session started, and the files it read in. */
function entryOf(line: string): AnEntry {
  const entry = parsedIn(line)
  const attachment = isRecord(entry) && isRecord(entry['attachment']) ? entry['attachment'] : {}
  return {
    startedIn: isRecord(entry) && typeof entry['cwd'] === 'string' ? entry['cwd'] : undefined,
    files: Array.isArray(attachment['files']) ? attachment['files'] : [],
  }
}

/** One recorded file, when it is of the kind asked for. */
function loadedFileOf(file: unknown, kind: string): readonly AFileTheHostLoaded[] {
  if (!isRecord(file) || file['type'] !== kind) return []
  return [{ path: String(file['path'] ?? ''), text: String(file['content'] ?? '') }]
}

/** The files of one kind that one entry records. */
function loadedIn(entry: AnEntry, kind: string): readonly AFileTheHostLoaded[] {
  return entry.files.flatMap((file) => loadedFileOf(file, kind))
}

/** Every memory file the host recorded loading into the session, by the host's own name for it. */
export function memoryTheHostLoaded(transcript: string): readonly AFileTheHostLoaded[] {
  return transcript.split('\n').flatMap((line) => loadedIn(entryOf(line), MEMORY_FILE_KIND))
}

/**
 * The memory files one run's own session recorded: the entries whose session started in `cwd`,
 * the folder this run started the host in. An entry that does not say where its session started
 * is taken, since the caller has already read only this run's own project folder; an entry that
 * says another folder is another session, however it got into this file.
 */
export function memoryTheHostLoadedFor(transcript: string, cwd: string): readonly AFileTheHostLoaded[] {
  return transcript
    .split('\n')
    .map(entryOf)
    .filter((entry) => entry.startedIn === undefined || entry.startedIn === cwd)
    .flatMap((entry) => loadedIn(entry, MEMORY_FILE_KIND))
}
