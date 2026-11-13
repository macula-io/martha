// The owner's own settings file, as a slice may see it: its bytes turned into what a decision needs (martha#359).
//
// The file itself is reached through the host contract (host_contract's TheOwnersSettingsStore, implemented by
// ../owners_settings_directory), because a slice reads no disk. What is here is the reading of it: whether it holds a
// `model` at all, a canonical hash of everything it holds besides `model` — so a record can say "nothing but the model
// has moved" without keeping a copy of a file that may hold the owner's environment and other secrets (R3) — and the
// one text a recovery writes.
//
// Two refusals live here, and both are the owner's file being the owner's: one that does not parse as a settings object
// is refused by name rather than replaced, and one whose model is not a string is refused the same way. A switch whose
// file cannot be read this way is a switch not made.

import { createHash } from 'node:crypto'

import type { Refused, TheOwnersSettingsRead } from '../host_contract/host_contract.ts'

/** The one key in it a restore may touch. Every other key is the owner's. */
export const THE_MODEL_KEY = 'model'

/** What a snapshot's `before` says when there was no file to read: nothing. */
export const NO_FILE_BEFORE = ''

/** The bytes of a file as a sha256, the only way a #359 record keeps them. */
export const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** The owner's settings file as it was found: no file at all, or one file read whole and parsed. */
export type TheOwnersSettingsSnapshot =
  | {
      readonly exists: false
      /** Nothing was read, so nothing is its hash. */
      readonly before: typeof NO_FILE_BEFORE
      readonly without_model: string
    }
  | {
      readonly exists: true
      readonly bytes: Uint8Array
      readonly mode: number
      readonly before: string
      readonly without_model: string
      readonly parsed: Record<string, unknown>
    }

/** The file the store handed over, as a snapshot: what it held, and everything it held besides the model. */
export function snapshotOf(read: TheOwnersSettingsRead): TheOwnersSettingsSnapshot | Refused {
  if ('refusal' in read) return read
  if (read.kind === 'missing') return { exists: false, before: NO_FILE_BEFORE, without_model: canonicalHashWithoutModel({}) }
  const parsed = parsedSettingsOf(read.bytes)
  if ('refusal' in parsed) return parsed
  return {
    exists: true,
    bytes: read.bytes,
    mode: read.mode,
    before: sha256Of(read.bytes),
    without_model: canonicalHashWithoutModel(parsed.parsed),
    parsed: parsed.parsed,
  }
}

/** The file's parse, or why it is nobody's settings this decision may touch: one that does not parse is the owner's. */
function parsedSettingsOf(bytes: Uint8Array): { readonly parsed: Record<string, unknown> } | Refused {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { refusal: 'the owner\'s settings file does not hold a settings object, so a switch could not put it back and none was made' }
    return { parsed: parsed as Record<string, unknown> }
  } catch {
    return { refusal: 'the owner\'s settings file could not be read as JSON, so a switch could not put it back and none was made' }
  }
}

/** Whether a settings file holds a `model`, and what it holds there: the owner's default as the file spells it. */
export function theModelIn(parsed: Readonly<Record<string, unknown>>): { readonly had_model: boolean; readonly owner_model: string } {
  const held = parsed[THE_MODEL_KEY]
  return typeof held === 'string' ? { had_model: true, owner_model: held } : { had_model: false, owner_model: '' }
}

/**
 * The sha256 of everything the file holds besides `model`, in one canonical spelling: keys sorted at every depth, so two
 * parses of the same settings hash alike whatever order their keys were written in.
 */
export function canonicalHashWithoutModel(parsed: Readonly<Record<string, unknown>>): string {
  const rest = Object.entries(parsed).filter(([key]) => key !== THE_MODEL_KEY)
  return sha256Of(new TextEncoder().encode(canonicalSpelling(Object.fromEntries(rest))))
}

/** One value's canonical spelling: keys sorted at every depth, so a hash of it never depends on their order. */
function canonicalSpelling(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSpelling).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${sortedEntries(value as Record<string, unknown>).map(([key, held]) => `${JSON.stringify(key)}:${canonicalSpelling(held)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

/** An object's entries, by key, in the one order a canonical spelling has. */
function sortedEntries(held: Readonly<Record<string, unknown>>): [string, unknown][] {
  return Object.entries(held).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
}

/**
 * The file's text with the owner's `model` put back, for the recovery a crash leaves: the key set to the owner's value,
 * or removed when they had none. It is never byte-identical — a recovery keeps no copy of the file to write back — and
 * it is only ever reached when nothing else in the file has moved (R3).
 */
export function settingsWithTheOwnerModelBack(parsed: Readonly<Record<string, unknown>>, had_model: boolean, owner_model: string): Uint8Array {
  const back: Record<string, unknown> = { ...parsed }
  if (had_model) back[THE_MODEL_KEY] = owner_model
  else delete back[THE_MODEL_KEY]
  return new TextEncoder().encode(`${JSON.stringify(back, null, 2)}\n`)
}
