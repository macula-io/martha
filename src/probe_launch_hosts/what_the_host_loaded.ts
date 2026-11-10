// What the host itself recorded loading into a session (martha#223). Its transcript carries
// one `attachment` entry whose `files` name each file the host read in — the owner's
// instructions, the project's memory — with the file's path and text, written when the session
// starts. A row that reads that record does not depend on the model answering at all, which is
// what went wrong: asked for the codeword, the model sometimes spent every turn it was given
// and answered nothing, so a tree where nothing was wrong produced a red row.

import { isRecord } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** One file the host recorded reading into a session: where it is, and the text it read. */
export interface AFileTheHostLoaded {
  readonly path: string
  readonly text: string
}

/** The host's own name for a file the owner's auto-memory put in front of the session. */
const MEMORY_FILE_KIND = 'AutoMem'

/** The files one transcript line records, if it records any. */
function filesIn(line: string): readonly unknown[] {
  const entry: unknown = (() => {
    try {
      return JSON.parse(line)
    } catch {
      return undefined
    }
  })()
  const attachment = isRecord(entry) && isRecord(entry['attachment']) ? entry['attachment'] : {}
  return Array.isArray(attachment['files']) ? attachment['files'] : []
}

/** One recorded file, when it is of the kind asked for. */
function loadedFileOf(file: unknown, kind: string): readonly AFileTheHostLoaded[] {
  if (!isRecord(file) || file['type'] !== kind) return []
  return [{ path: String(file['path'] ?? ''), text: String(file['content'] ?? '') }]
}

/**
 * Every file of one kind the host recorded loading, read from the transcript it wrote. A line
 * that is not json is skipped: the transcript is the host's, and this reads what it holds of a
 * known shape rather than trusting the whole file to be one.
 */
function filesOfKind(transcript: string, kind: string): readonly AFileTheHostLoaded[] {
  return transcript
    .split('\n')
    .flatMap(filesIn)
    .flatMap((file) => loadedFileOf(file, kind))
}

/** Every memory file the host recorded loading into the session, by the host's own name for it. */
export function memoryTheHostLoaded(transcript: string): readonly AFileTheHostLoaded[] {
  return filesOfKind(transcript, MEMORY_FILE_KIND)
}
