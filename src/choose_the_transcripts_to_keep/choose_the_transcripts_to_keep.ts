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
// The bounds are the product's own: one file past TRANSCRIPTS_FILE_BYTES_KEPT, and the files of one launch past
// TRANSCRIPTS_LAUNCH_BYTES_KEPT, are replaced by a line saying so. A truncated JSONL presented as a transcript is
// never what a reader should get.

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

/** How many launches' transcripts are kept: one directory per launch, pruned newest-first by the adapter. */
export const TRANSCRIPTS_LAUNCHES_KEPT = 64

/** One transcript's bound, and one launch's whole bound: what the product promises to keep of a single launch. */
export const TRANSCRIPTS_FILE_BYTES_KEPT = 16 * 1024 * 1024
export const TRANSCRIPTS_LAUNCH_BYTES_KEPT = 16 * 1024 * 1024

/** What stands where a token was. */
export const REDACTED = '[the token, redacted]'

/** What stands for a whole text that held a token across a line break or a terminal sequence. */
export const WITHHELD = '[withheld: a token was in this text across a line break or a terminal sequence, so none of it is kept]'

/** What stands for a line of a transcript that does not parse whole: nothing of it can be vouched for. */
export const WITHHELD_LINE = "[withheld: this line is not the host's own record, so none of it is kept]"

/** What stands for a transcript that could not be read: nothing of it is kept, and it is not silently an empty file. */
export const COULD_NOT_READ = '[not kept: this transcript could not be read]'

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

/** Each value of `record` redacted, its own keys as they were, and whether any held a token. */
function redactEveryStringInARecord(record: Readonly<Record<string, unknown>>, theLaunchKey: string): ARedactedValue {
  let found = false
  const value = Object.fromEntries(
    Object.entries(record).map(([key, one]) => {
      const redacted = redactEveryStringIn(one, theLaunchKey)
      found = found || redacted.found
      return [key, redacted.value]
    }),
  )
  return { value, found }
}

/**
 * One line of a transcript, kept: parsed as the host wrote it, every string in it redacted, and the record written out
 * whole again; or, for a line that does not parse, the line that says nothing of it was kept.
 */
function redactOneLine(line: string, theLaunchKey: string, found: { any: boolean }): string {
  if (line === '') return line
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return WITHHELD_LINE
  }
  const redacted = redactEveryStringIn(record, theLaunchKey)
  found.any = found.any || redacted.found
  return JSON.stringify(redacted.value)
}

/**
 * `text` as the host wrote it, kept: one JSON record a line, every string of it redacted on its decoded value, each
 * record written out whole again, and a line that does not parse whole withheld whole. Lines end where they ended, so a
 * kept transcript ends with the newline its own did.
 */
export function redactTheTranscript(text: string, theLaunchKey: string): { readonly text: string; readonly found: boolean } {
  const found = { any: false }
  const lines = text.split('\n').map((line) => redactOneLine(line, theLaunchKey, found))
  return { text: lines.join('\n'), found: found.any }
}

/**
 * What of the member's config folder is kept: the host's transcripts, redacted, inside the two bounds, with a file the
 * bounds leave no room for replaced by the line that says so. Read in path order, so the same folder always keeps the
 * same files. The launch's own bound is counted on the bytes actually kept, not on what `stat` said a file was.
 */
export function chooseTheTranscripts(holds: WhatTheConfigFolderHolds): TheTranscriptsToKeep {
  const kept: AKeptTranscript[] = []
  const marked: string[] = []
  let theLaunchesBytes = 0
  const transcripts = holds.files.filter((one) => isTheHostsTranscript(one.path)).sort((one, other) => one.path.localeCompare(other.path))
  for (const transcript of transcripts) {
    if (transcript.unread === 'file' || transcript.bytes > TRANSCRIPTS_FILE_BYTES_KEPT) {
      kept.push({ path: transcript.path, text: tooLargeToKeep(transcript.bytes, TRANSCRIPTS_FILE_BYTES_KEPT, 'file') })
      continue
    }
    if (transcript.unread === 'launch' || theLaunchesBytes + transcript.bytes > TRANSCRIPTS_LAUNCH_BYTES_KEPT) {
      kept.push({ path: transcript.path, text: tooLargeToKeep(transcript.bytes, TRANSCRIPTS_LAUNCH_BYTES_KEPT, 'launch') })
      continue
    }
    if (transcript.unread === 'could-not-read') {
      kept.push({ path: transcript.path, text: COULD_NOT_READ })
      continue
    }
    const redacted = redactTheTranscript(transcript.text ?? '', holds.theLaunchKey)
    theLaunchesBytes += Buffer.byteLength(redacted.text)
    kept.push({ path: transcript.path, text: redacted.text })
    if (redacted.found) marked.push(transcript.path)
  }
  return { kept, marked }
}

/** The sidecar mark kept beside one launch's transcripts: which of them a token was found in, and never the token. */
export const theMarkOf = (marked: readonly string[]): string => `${JSON.stringify({ token_found_in: [...marked] }, null, 2)}\n`

/** The file the mark is kept in, beside the transcripts under the same launch. */
export const THE_MARK_FILE = 'token-found.json'
