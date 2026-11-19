// The member's host transcripts, chosen for keeping once its launch ends (martha#646).
//
// The host writes the member's whole session as JSON lines under its config folder, `projects/<key>/<session>.jsonl`,
// and that folder is a snapshot removed when the launch ends. This slice decides what of it is worth keeping, and what
// a kept file may say: it reads no file and writes none, so everything a token's shape and the bounds need is here.
//
// A transcript can hold a token the member printed or the owner pasted, in the clear. So each kept text goes through
// the one list of token shapes the repo defines (TOKEN_PREFIXES) and the key this launch handed its member, and a file
// that held either is marked. A token split by a line break or a terminal sequence cannot be cut out in place, since
// no piece of the text is the token, so that whole text is withheld rather than kept in part.
//
// The bounds are the product's own: one file past TRANSCRIPTS_FILE_BYTES_KEPT, and the files of one launch past
// TRANSCRIPTS_LAUNCH_BYTES_KEPT, are replaced by a line saying so. A truncated JSONL presented as a transcript is
// never what a reader should get.

import { TOKEN_PREFIXES } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'

/** The host's own directory for a project's transcripts, inside the member's config folder. */
export const HOST_PROJECTS_PLACE = 'projects'

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
 * `text` with every token shape and the launch's own key replaced by REDACTED, and whether either was there. A text
 * whose flattened form holds a token it does not hold whole is withheld whole: no single piece of it is the token.
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

/**
 * What of the member's config folder is kept: the host's transcripts, redacted, inside the two bounds, with a file the
 * bounds leave no room for replaced by the line that says so. Read in path order, so the same folder always keeps the
 * same files.
 */
export function chooseTheTranscripts(holds: WhatTheConfigFolderHolds): TheTranscriptsToKeep {
  const kept: AKeptTranscript[] = []
  const marked: string[] = []
  let theLaunchesBytes = 0
  const transcripts = holds.files.filter((one) => isTheHostsTranscript(one.path)).sort((one, other) => one.path.localeCompare(other.path))
  for (const transcript of transcripts) {
    if (transcript.bytes > TRANSCRIPTS_FILE_BYTES_KEPT) {
      kept.push({ path: transcript.path, text: tooLargeToKeep(transcript.bytes, TRANSCRIPTS_FILE_BYTES_KEPT, 'file') })
      continue
    }
    if (theLaunchesBytes + transcript.bytes > TRANSCRIPTS_LAUNCH_BYTES_KEPT) {
      kept.push({ path: transcript.path, text: tooLargeToKeep(transcript.bytes, TRANSCRIPTS_LAUNCH_BYTES_KEPT, 'launch') })
      continue
    }
    const redacted = redactTheTokens(transcript.text ?? '', holds.theLaunchKey)
    theLaunchesBytes += transcript.bytes
    kept.push({ path: transcript.path, text: redacted.text })
    if (redacted.found) marked.push(transcript.path)
  }
  return { kept, marked }
}

/** The sidecar mark kept beside one launch's transcripts: which of them a token was found in, and never the token. */
export const theMarkOf = (marked: readonly string[]): string => `${JSON.stringify({ token_found_in: [...marked] }, null, 2)}\n`

/** The file the mark is kept in, beside the transcripts under the same launch. */
export const THE_MARK_FILE = 'token-found.json'
