// The lab's machine families, kept as keyed digests (martha#731): what lets a
// member's machine judge the `lab_machine` rule without the plain list.
//
// CI holds the families in plain, as a secret. A member's machine holds a file of
// HMAC digests instead, one per family, under a random key kept beside them. The
// file's bytes spell no family, so an environment dump, a log or a quoted file
// shows only hex. That is all it does, said plainly (Raf, 2026-11-18, "Speed
// bumps, said plainly"):
// - The key sits beside the digests, readable by the same OS user. A family is a
//   short word, so whoever reads the file and tries words gets the families back.
// - The check itself is the oracle: a member can run it over `<word>07` lines and
//   see which ones it withholds. No placement of the key closes that.
// What it guards against is carrying the families by accident, never a member that
// sets out to learn them; members meet those names in their work anyway.
//
// A stale file: a family added to CI's secret without keeping the file again
// passes a member's check, and CI refuses the range. CI stays the backstop.
//
// This module is the decision, with no I/O: the shape of the file, the digest of
// a family, and the scan that finds a lab machine name in a line by digests alone.

import { createHmac } from 'node:crypto'

import { HEX_DIGIT } from './public_text.ts'

/** The digest every family is kept as. */
const DIGEST = 'sha256'
/** A key as long as the digest it keys, as RFC 2104 advises. */
export const KEY_BYTES = 32
const HEX_FIELD = new RegExp(`^${HEX_DIGIT}{${KEY_BYTES * 2}}$`)

/** A family, as CI's secret holds it: a plain lowercase name. */
export const FAMILY = /^[a-z][a-z0-9-]*$/
/**
 * The longest family kept. A machine's name is one DNS label, at most 63
 * characters (RFC 1035), and the rule reads two digits after the family. The
 * bound is what keeps the scan below linear in a line's length.
 */
const DNS_LABEL_MAX = 63
const MACHINE_DIGITS = 2
export const FAMILY_MAX = DNS_LABEL_MAX - MACHINE_DIGITS

/** The file's fields, exactly these and no other. */
const FIELDS = ['digests', 'key'] as const

export interface LabFamilyDigests {
  readonly key: Buffer
  readonly digests: ReadonlySet<string>
}

/**
 * One family's digest under a key, over its lowercase bytes. ASCII-only folding is
 * exact here: the rule's regex has `i` without `u`, and then JavaScript never maps
 * a non-ASCII character onto an ASCII one. FAMILY is ASCII, and the scan hands this
 * only spans of FAMILY's characters, so no other character can fold onto a family's.
 */
export const digestOf = (key: Buffer, family: string): string => createHmac(DIGEST, key).update(family.toLowerCase(), 'utf8').digest('hex')

/** The families a raw list names, or why they cannot be kept. The message never quotes the list. */
export const familiesToKeep = (raw: string): readonly string[] | string => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'the lab machine families must be a JSON array of plain lowercase names'
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((family) => typeof family === 'string' && FAMILY.test(family))) {
    return 'the lab machine families must be a JSON array of plain lowercase names'
  }
  if (parsed.some((family: string) => family.length > FAMILY_MAX)) return `a lab machine family is longer than ${FAMILY_MAX} characters`
  return parsed as string[]
}

/** The file's text for these families under this key: the key and the sorted digests, never a family. */
export const keptFileText = (families: readonly string[], key: Buffer): string =>
  `${JSON.stringify({ key: key.toString('hex'), digests: [...new Set(families.map((family) => digestOf(key, family)))].sort() }, null, 2)}\n`

/** The digests a file's text holds, or a throw naming what is wrong. No message quotes the file's bytes. */
export const labFamilyDigestsOf = (text: string): LabFamilyDigests => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('the lab families file is not JSON')
  }
  if (!hasExactlyTheFields(parsed)) throw new Error(`the lab families file must hold exactly the fields ${FIELDS.join(' and ')}`)
  const { key, digests } = parsed
  if (!isHex(key)) throw new Error('the lab families file\'s key is not a key')
  if (!Array.isArray(digests) || digests.length === 0 || !digests.every(isHex)) throw new Error('the lab families file\'s digests are not digests')
  return { key: Buffer.from(key, 'hex'), digests: new Set(digests as string[]) }
}

const hasExactlyTheFields = (parsed: unknown): parsed is Record<(typeof FIELDS)[number], unknown> =>
  parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).sort().join() === FIELDS.join()

const isHex = (value: unknown): value is string => typeof value === 'string' && HEX_FIELD.test(value)

/** A lab machine name found in a line: its text and where it starts. */
export interface LabName {
  readonly value: string
  readonly at: number
}

// The rule's own regex has flags `gi` and no `u` (PUBLIC_TEXT_PATTERNS.lab_machine),
// so a word character is exactly [A-Za-z0-9_] and \b is a change between word and
// not. The scan holds to that same set.
const WORD = /[A-Za-z0-9_]/
const FAMILY_CHARACTER = /[A-Za-z0-9-]/
const LETTER = /[A-Za-z]/
const DIGIT = /[0-9]/
const isWord = (text: string, at: number) => at >= 0 && at < text.length && WORD.test(text[at]!)
const isDigit = (text: string, at: number) => at < text.length && DIGIT.test(text[at]!)

/** The longest family that starts at `start` and the rule reads there, by its end; or undefined. */
const longestAt = (text: string, start: number, kept: LabFamilyDigests): number | undefined => {
  let found: number | undefined
  for (let end = start + 1; end <= Math.min(text.length, start + FAMILY_MAX); end += 1) {
    if (!FAMILY_CHARACTER.test(text[end - 1]!)) break
    const twoDigits = isDigit(text, end) && isDigit(text, end + 1) && !isWord(text, end + MACHINE_DIGITS)
    if (twoDigits && kept.digests.has(digestOf(kept.key, text.slice(start, end)))) found = end
  }
  return found
}

/**
 * Every lab machine name in a line, as the rule `\b(<families>)[0-9][0-9]\b`
 * with flags `gi` finds them, decided by digests alone. Matches are taken left
 * to right and never overlap; where two families start at one place, the longer
 * is taken, as the regex does with its families listed longest first.
 */
export const labNamesIn = (text: string, kept: LabFamilyDigests): LabName[] => {
  const names: LabName[] = []
  for (let start = 0; start < text.length; start += 1) {
    if (isWord(text, start - 1) || !LETTER.test(text[start]!)) continue
    const end = longestAt(text, start, kept)
    if (end === undefined) continue
    names.push({ value: text.slice(start, end + MACHINE_DIGITS), at: start })
    start = end + MACHINE_DIGITS - 1
  }
  return names
}
