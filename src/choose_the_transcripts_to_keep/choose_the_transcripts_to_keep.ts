// The member's host transcripts, chosen for keeping once its launch ends (martha#646).
//
// The host writes the member's whole session as JSON lines under its config folder, `projects/<key>/<session>.jsonl`,
// and that folder is a snapshot removed when the launch ends. This slice decides what of it is worth keeping, and what
// a kept file may say: it reads no file and writes none, so everything a token's shape and the bounds need is here.
//
// A transcript can hold a token the member printed or the owner pasted, in the clear. So each kept text is read as the
// host wrote it — one JSON record a line — and every string in it is redacted on its decoded value against the one list
// of token shapes the repo defines (TOKEN_PREFIXES) and the key this launch handed its member; a file that held either
// is marked. It is the DECODED value that matters: a line break in a value is the two characters `\n` and a terminal
// escape is `\u001b`, so a reading of the file's bytes never sees the break a token was split by (martha#646 r=1 R1). A
// token split by a line break or a terminal sequence cannot be cut out in place, since no piece of the value is the
// token, so that whole value is withheld rather than kept in part; a line that does not parse whole is withheld whole
// too, since nothing of it can be vouched for.
//
// A token can stand in a record's own KEY as well as in a value, and a key is as readable as a value is, so keys are
// redacted too (martha#646 r=3 R7). A line that can be shown clean is kept exactly as the host wrote it: writing it out
// again would change the numbers past 2^53 and the spacing the host chose, and a reader would be reading the host's
// transcript no longer (martha#646 r=3 R8). Shown clean means its own bytes hold no token and it holds no escape at all:
// `JSON.parse` keeps only the last value of a repeated key, so a token in a dropped value is in neither the parse nor a
// reading of the bytes, and a token written `ghp_…` is in the bytes only in a form no shape list names. A line that
// cannot be shown clean is written out again from the parse — losing the value the parse dropped, never the token
// (martha#646 r=4 R9).
//
// The bounds are the product's own, and they are counted on the bytes actually KEPT: one file past
// the crew's declared transcripts.megabytes_kept and the files of one launch past the same bound are replaced by a line
// saying so. On what was read, the bound would not be a bound: redaction can make a file longer than it was, and a run
// of lines that do not parse is kept as one line naming how many rather than one withheld line each, so a small file of
// them would otherwise be kept tens of times its own size — enough for a joined string to throw and take the launch's
// every transcript with it (martha#646 r=3 R6). A truncated JSONL presented as a transcript is never what a reader
// should get, and one file that cannot be kept is kept as its own line saying so, never at the launch's other files'
// expense.

import { join } from 'node:path'

import { TOKEN_PREFIXES } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'

/**
 * The host's own directory for a project's transcripts, inside the member's config folder. Private on purpose, as the
 * host's other readers keep it: the word is the host's own and is spelled all over the host's tests, so exporting it
 * would turn every one of them into a restatement (martha#289). What the adapter needs is the path below.
 */
const HOST_PROJECTS_PLACE = 'projects'

/** The host's own place for every project's transcripts, inside the member's config folder. */
export const theHostsProjectsPlace = (configFolder: string): string => join(configFolder, HOST_PROJECTS_PLACE)

/** One transcript's path under the member's config folder: what the adapter reads and what is kept. */
export const theHostsTranscriptPath = (key: string, name: string): string => [HOST_PROJECTS_PLACE, key, name].join('/')

/** What ends one transcript's name. */
export const TRANSCRIPTS_SUFFIX = '.jsonl'


/** What stands where a token was. */
export const REDACTED = '[the token, redacted]'

/** What stands for a whole text that held a token across a line break or a terminal sequence. */
export const WITHHELD = '[withheld: a token was in this text across a line break or a terminal sequence, so none of it is kept]'

/** What stands for a line of a transcript that does not parse whole: nothing of it can be vouched for. */
export const WITHHELD_LINE = "[withheld: this line is not the host's own record, so none of it is kept]"

/**
 * What stands for a run of `count` such lines, kept as one line: a file of lines that do not parse would otherwise grow
 * the kept text by a whole withheld line each, which is far more than the file itself was (martha#646 r=3 R6). One line
 * is spelled as it always was, so a transcript with one bad line reads as it did.
 */
export const theWithheldLines = (count: number): string =>
  count === 1 ? WITHHELD_LINE : `[withheld: ${String(count)} lines of this transcript are not the host's own records, so none of them is kept]`

/** What stands for a transcript that could not be read: nothing of it is kept, and it is not silently an empty file. */
export const COULD_NOT_READ = '[not kept: this transcript could not be read]'

/**
 * What stands for a transcript that was read and whose redaction threw: it is not that nothing could be read of it, and
 * saying so would send a reader looking for a broken file (martha#646 r=4).
 */
export const COULD_NOT_KEEP = '[not kept: this transcript was read, but its redaction threw, so none of it is kept]'

/**
 * Which bound a note speaks for. The two bounds are equal numbers today, so a note that read the bound's own value to
 * say which one it was could not tell them apart; it is told, never guessed from the number.
 */
export type TheBound = 'file' | 'launch'

/** What stands for a transcript the bound leaves no room for, naming the bound it passed. */
export const tooLargeToKeep = (bytes: number, bound: number, of: TheBound): string =>
  `[too large to keep: this transcript is ${String(bytes)} bytes, past the ${String(bound)} bytes Martha keeps of one ${of}]`

/**
 * How short a run after a token's prefix may be and still be a token: a prefix alone is a word, and a secret runs on.
 * A tolerance with a reason, like the count's, so nothing is typed here that the bounds already say.
 */
const TOKEN_BODY = 8

/** A word that starts with a known prefix and runs on long enough to be a secret, wherever it starts. */
const THE_TOKEN_SHAPE = new RegExp(
  `(?<![A-Za-z0-9])(?:${TOKEN_PREFIXES.map((prefix) => prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[A-Za-z0-9_-]{${String(TOKEN_BODY)},}`,
  'g',
)

/** A terminal's control sequences, which can split a token the member's screen held whole. */
const TERMINAL_SEQUENCES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** `text` as one line of what it shows: its terminal sequences and line breaks taken out. */
export const flattened = (text: string): string => text.replace(TERMINAL_SEQUENCES, '').replace(/[\r\n]/g, '')

/** One file the member's config folder holds: its path under the folder, its size, and its text when it was read. */
export interface AConfigFile {
  readonly path: string
  readonly bytes: number
  /** The file's text, which a file past the per-file bound is never read for. */
  readonly text?: string
  /**
   * Why the file was not read whole, when it was not: the bound it passed, or that it could not be read. The reader is
   * told, never guessed from the bytes, since the two bounds are equal numbers.
   */
  readonly unread?: 'file' | 'launch' | 'could-not-read'
}

/** What the member's config folder holds, and the key this launch handed its member. */
export interface WhatTheConfigFolderHolds {
  readonly files: readonly AConfigFile[]
  readonly theLaunchKey: string
  /**
   * One transcript's bound, and one launch's whole bound, in bytes: the crew's declared transcripts.megabytes_kept
   * (martha#931 B, ../declare_crew/the_crews_transcripts's bytesKeptOf). The two bounds are one number, as they were.
   */
  readonly bytes_kept: number
}

/** One kept transcript: the host's path under the config folder, and what is written there. */
export interface AKeptTranscript {
  readonly path: string
  readonly text: string
}

/** What is kept, and which of them held a token, for the sidecar mark beside them. */
export interface TheTranscriptsToKeep {
  readonly kept: readonly AKeptTranscript[]
  readonly marked: readonly string[]
}

/** Whether `path` is the host's own transcript: exactly `projects/<key>/<session>.jsonl`, never anything else. */
export const isTheHostsTranscript = (path: string): boolean => {
  const parts = path.split('/')
  const name = parts[2] ?? ''
  return parts.length === 3 && parts[0] === HOST_PROJECTS_PLACE && (parts[1] ?? '') !== '' && name.length > TRANSCRIPTS_SUFFIX.length && name.endsWith(TRANSCRIPTS_SUFFIX)
}

/**
 * One string as the host wrote it, DECODED, with every token shape and the launch's own key replaced by REDACTED, and
 * whether either was there. A string whose flattened form holds a token it does not hold whole is withheld whole: no
 * single piece of it is the token. It is handed decoded values only, so a break in one is a break and not `\n`.
 */
export function redactTheTokens(text: string, theLaunchKey: string): { readonly text: string; readonly found: boolean } {
  const flat = flattened(text)
  const shapes = [...flat.matchAll(THE_TOKEN_SHAPE)].map((found) => found[0])
  const tokens = [theLaunchKey, ...shapes].filter((one) => one !== '')
  const split = tokens.some((token) => flat.split(token).length > text.split(token).length)
  if (split) return { text: WITHHELD, found: true }
  const withoutTheKey = theLaunchKey === '' ? text : text.split(theLaunchKey).join(REDACTED)
  const kept = withoutTheKey.replace(THE_TOKEN_SHAPE, REDACTED)
  return { text: kept, found: kept !== text }
}

/** What redacting one value of a parsed record gave: the value as it is kept, and whether a token was in it. */
interface ARedactedValue {
  readonly value: unknown
  readonly found: boolean
}

/**
 * `value` with every string in it redacted, however deep, and whether any held a token. Its structure and its non-string
 * scalars are kept as they were: only what a person can read is redacted.
 */
function redactEveryStringIn(value: unknown, theLaunchKey: string): ARedactedValue {
  if (typeof value === 'string') {
    const redacted = redactTheTokens(value, theLaunchKey)
    return { value: redacted.text, found: redacted.found }
  }
  if (Array.isArray(value)) return redactEveryStringInAList(value, theLaunchKey)
  if (typeof value !== 'object' || value === null) return { value, found: false }
  return redactEveryStringInARecord(value as Readonly<Record<string, unknown>>, theLaunchKey)
}

/** Each element of `list` redacted, and whether any of them held a token. */
function redactEveryStringInAList(list: readonly unknown[], theLaunchKey: string): ARedactedValue {
  let found = false
  const value = list.map((one) => {
    const redacted = redactEveryStringIn(one, theLaunchKey)
    found = found || redacted.found
    return redacted.value
  })
  return { value, found }
}

/**
 * Each value of `record` redacted, its own keys redacted too, and whether any of them held a token. A key is a string
 * a reader of the transcript can read, so a token the member put in one is a token kept in the clear (martha#646 r=3
 * R7). Two keys that redact alike become one, the later value standing: a value is lost, never the token.
 */
function redactEveryStringInARecord(record: Readonly<Record<string, unknown>>, theLaunchKey: string): ARedactedValue {
  let found = false
  const value = Object.fromEntries(
    Object.entries(record).map(([key, one]) => {
      const theKey = redactTheTokens(key, theLaunchKey)
      const redacted = redactEveryStringIn(one, theLaunchKey)
      found = found || theKey.found || redacted.found
      return [theKey.text, redacted.value]
    }),
  )
  return { value, found }
}

/** One line of a transcript as it is kept, and whether it was withheld whole, so it joins a run of the same. */
interface AKeptLine {
  readonly text: string
  readonly withheld: boolean
}

/** Whether `line`'s own bytes hold a token shape or the launch's own key: exact only for a line with no escape in it. */
const theLinesOwnBytesHoldAToken = (line: string, theLaunchKey: string): boolean =>
  (theLaunchKey !== '' && line.includes(theLaunchKey)) || [...line.matchAll(THE_TOKEN_SHAPE)].length > 0

/**
 * Whether a line may be kept exactly as the host wrote it. It must hold no token of its own bytes, and no escape at all:
 * a token written `ghp_…` is not in the bytes, and a value a repeated key hid is in neither the bytes nor the
 * parse, since `JSON.parse` keeps only the last value of a repeated key. A line that cannot be shown clean is written
 * out again from the parse — it loses the value the parse dropped, and never the token (martha#646 r=4 R9).
 */
const mayBeKeptAsWritten = (line: string, theLaunchKey: string): boolean =>
  !line.includes('\\') && !theLinesOwnBytesHoldAToken(line, theLaunchKey)

/**
 * One line of a transcript, kept: parsed as the host wrote it, every string in it — and every key — redacted, and the
 * record written out whole again when a redaction applied to it; a line that can be shown clean is kept exactly as the
 * host wrote it, since writing it out again would change the numbers and the spacing the host wrote (martha#646 r=3
 * R8). A line that does not parse is withheld whole.
 *
 * A line the host wrote is one JSON object or array, so a line that begins with neither is not one of its records and is
 * withheld without being parsed: parsing every line of a file of junk means throwing on every one, which cost the exit
 * handler twenty seconds for a file the bound should turn into one line (martha#646 r=3 R6). Such a line is withheld,
 * never kept, so nothing of it can reach a reader.
 */
function redactOneLine(line: string, theLaunchKey: string, found: { any: boolean }): AKeptLine {
  if (line === '') return { text: line, withheld: false }
  const begins = line.trimStart().charAt(0)
  if (begins !== '{' && begins !== '[') return { text: WITHHELD_LINE, withheld: true }
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return { text: WITHHELD_LINE, withheld: true }
  }
  const redacted = redactEveryStringIn(record, theLaunchKey)
  if (!redacted.found && mayBeKeptAsWritten(line, theLaunchKey)) return { text: line, withheld: false }
  found.any = found.any || redacted.found || theLinesOwnBytesHoldAToken(line, theLaunchKey)
  return { text: JSON.stringify(redacted.value), withheld: false }
}

/** What a transcript kept within a cap came to: the host's own lines, whether a token was kept out of any, and its size. */
export interface ATranscriptWithinItsBound {
  readonly text: string
  readonly found: boolean
  /** The kept bytes counted when the walk stopped, when they would pass the cap; the caller keeps a note in its place. */
  readonly over: number | null
}

/**
 * `text` as the host wrote it, kept within `cap` bytes: one line a line, a line no redaction applied to kept byte for
 * byte, every other written out again, a line that does not parse withheld whole, and a run of those kept as one line
 * naming how many. The walk stops as soon as the kept text would pass `cap`, so a file the bound leaves no room for
 * costs its own size and not a string grown past what the engine can hold (martha#646 r=3 R6): a transcript past a
 * bound is kept as its note, never in part. `over` is the size counted by then, the crossing line's own included.
 */
export function redactTheTranscriptWithin(text: string, theLaunchKey: string, cap: number): ATranscriptWithinItsBound {
  const found = { any: false }
  const lines: string[] = []
  let bytes = 0
  let over: number | null = null
  let withheld = 0
  /** `line` kept after the ones already kept, counting the newline before it, or the walk stopped when it does not fit. */
  const keep = (line: string): boolean => {
    const add = Buffer.byteLength(line) + (lines.length === 0 ? 0 : 1)
    bytes += add
    if (bytes > cap) {
      over = bytes
      return false
    }
    lines.push(line)
    return true
  }
  /** The run of withheld lines so far kept as the one line it is, before a line that is kept in full. */
  const theRunKept = (): boolean => {
    if (withheld === 0) return true
    const one = theWithheldLines(withheld)
    withheld = 0
    return keep(one)
  }
  for (const line of text.split('\n')) {
    const kept = redactOneLine(line, theLaunchKey, found)
    if (kept.withheld) {
      withheld += 1
      continue
    }
    if (!theRunKept() || !keep(kept.text)) break
  }
  if (over === null) theRunKept()
  return { text: over === null ? lines.join('\n') : '', found: found.any, over }
}

/**
 * What one transcript is kept as, given the room left of the launch's bound: its redacted text when the room holds it,
 * and otherwise the note naming the launch's bound. The file's bound is the same number (martha#931 B), so the room left
 * is never more than it and the launch's is the bound a kept text passes. A redaction that throws is this file's note
 * and no other file's business, since one transcript never costs a launch the rest.
 */
function theKeptTextOf(transcript: AConfigFile, theLaunchKey: string, room: number, bytes_kept: number): { readonly text: string; readonly found: boolean } {
  try {
    const redacted = redactTheTranscriptWithin(transcript.text ?? '', theLaunchKey, room)
    if (redacted.over === null) return { text: redacted.text, found: redacted.found }
    return { text: tooLargeToKeep(redacted.over, bytes_kept, 'launch'), found: false }
  } catch {
    return { text: COULD_NOT_KEEP, found: false }
  }
}

/**
 * What of the member's config folder is kept: the host's transcripts, redacted, inside the two bounds, with a file the
 * bounds leave no room for replaced by the line that says so. Read in path order, so the same folder always keeps the
 * same files.
 *
 * Both bounds are counted on the bytes actually KEPT, never on what `stat` said a file was: redaction can grow a file
 * (a withheld value is longer than the value it replaces), so the per-file bound is the kept text's own size and the
 * launch's room is what is left of its bound (martha#646 r=3 R6). A note is kept bytes too and is counted. Nothing here
 * can leave a file's entry out: a file whose kept text passes either bound, or whose redaction throws, is kept as its
 * own line saying so, so one file never costs the launch its others.
 */
export function chooseTheTranscripts(holds: WhatTheConfigFolderHolds): TheTranscriptsToKeep {
  const kept: AKeptTranscript[] = []
  const marked: string[] = []
  let theLaunchesBytes = 0
  const noteKept = (path: string, text: string): void => {
    kept.push({ path, text })
    theLaunchesBytes += Buffer.byteLength(text)
  }
  const transcripts = holds.files.filter((one) => isTheHostsTranscript(one.path)).sort((one, other) => one.path.localeCompare(other.path))
  for (const transcript of transcripts) {
    if (transcript.unread === 'file' || transcript.bytes > holds.bytes_kept) {
      noteKept(transcript.path, tooLargeToKeep(transcript.bytes, holds.bytes_kept, 'file'))
      continue
    }
    if (transcript.unread === 'launch') {
      noteKept(transcript.path, tooLargeToKeep(transcript.bytes, holds.bytes_kept, 'launch'))
      continue
    }
    if (transcript.unread === 'could-not-read') {
      noteKept(transcript.path, COULD_NOT_READ)
      continue
    }
    const keptText = theKeptTextOf(transcript, holds.theLaunchKey, holds.bytes_kept - theLaunchesBytes, holds.bytes_kept)
    noteKept(transcript.path, keptText.text)
    if (keptText.found) marked.push(transcript.path)
  }
  return { kept, marked }
}

/** The sidecar mark kept beside one launch's transcripts: which of them a token was found in, and never the token. */
export const theMarkOf = (marked: readonly string[]): string => `${JSON.stringify({ token_found_in: [...marked] }, null, 2)}\n`

/** The file the mark is kept in, beside the transcripts under the same launch. */
export const THE_MARK_FILE = 'token-found.json'
