// What a handover must hold for a fresh session to carry on, ported from crew-code's core/handover_shape.ts at
// crew-code 6f353d51 (martha#999 package 2): for every package the member holds, one line with a branch, a tip
// sha (or the words "nothing committed") and a next step. Shape only: nothing about the content is judged.
//
// Why crew-code has it: four forced refreshes in one night on 2026-10-23, and each time the Supervisor had to ask the
// member for its branches, shas and next steps, because nothing made the handover hold them. Martha's first check
// asked only that the package's name appear somewhere, with `includes`: the bug crew-code's own review fixed on
// 23 Oct, where `synthetic-owner/repo#3` was answered by the `synthetic-owner/repo#37` line, and a heading naming the package hid a full answer under it.

/** The fields a package's line can be missing, in the words the member is told. */
const BRANCH = 'branch'
const SHA = 'sha'
const NEXT_STEP = 'next step'
export type Missing = typeof BRANCH | typeof SHA | typeof NEXT_STEP

/** One package a handover does not answer for, and what its line lacks. */
export interface AGap {
  readonly package: string
  readonly missing: readonly Missing[]
}

/** The line the prompt asks for and the check reads, crew-code's shapeLine. A placeholder is not an answer. */
export const theShapeLine = (named: string): string => `- ${named} · branch <branch> · sha <sha or "${NOTHING}"> · next <what you do next>`

/** The words that answer for a package whole: someone else's, or no open work left (crew-code's NOT_MINE). */
const SETTLED = /^(?:not mine|done|closed|landed)\.?$/i

/** A segment between the separators that is only one of these says the package is finished (crew-code's finishedLine). */
const A_FINISHED_SEGMENT = /^(?:done|closed|landed)$/i

const SEPARATORS = /[·,;|]/
const EDGES = /^[\s·,;:|-]+|[\s·,;:|-]+$/g
const A_PLACEHOLDER = /^<.*>$/
const NOTHING = 'nothing committed'
const NOTHING_COMMITTED = new RegExp(`^${NOTHING}\\b`, 'i')
const A_SHA = /^[0-9a-f]{7,40}$/i
const QUOTES = /^["'`]|["'`]$/g
const STOPS = /[.,;:!?]+$/
const SPECIAL = /[.*+?^${}()|[\]\\]/g

const escape = (text: string): string => text.replace(SPECIAL, '\\$&')

/** What follows a label on the line, up to the next separator; the label must start a field, so `a/sha-fix` is no sha. */
function field(line: string, label: string): string {
  const found = new RegExp(`(?:^|[\\s·,;|])${label}\\b\\s*:?\\s*([^·,;|]*)`, 'i').exec(line)
  return found === null ? '' : (found[1] ?? '').trim().replace(QUOTES, '')
}

/** A sha field's first word is the sha; the words after it are the reader's context. "nothing committed" is read whole. */
function shaFirstWord(value: string): string {
  return NOTHING_COMMITTED.test(value) ? NOTHING : (value.split(/\s+/)[0] ?? '').replace(STOPS, '')
}

const answersTheSha = (value: string): boolean => {
  const first = shaFirstWord(value)
  return NOTHING_COMMITTED.test(first) || A_SHA.test(first)
}

/** A line names a package only when no digit or letter follows the ref: `synthetic-owner/repo#3` is not answered by `synthetic-owner/repo#37`. */
const names = (line: string, named: string): boolean => new RegExp(`${escape(named)}(?![0-9A-Za-z_])`).test(line)

/** The line carries the fields the check reads, rather than only naming the package as a heading does. */
const carriesFields = (line: string): boolean => [BRANCH, SHA, 'next'].some((label) => field(line, label) !== '')

const finishedLine = (line: string): boolean => line.split(SEPARATORS).some((segment) => A_FINISHED_SEGMENT.test(segment.trim()))

/** A package the handover says is not the member's, or is finished, needs nothing more. */
const settlesItself = (named: string, lines: readonly string[]): boolean =>
  lines.some((line) => {
    const answer = line.replace(named, '')
    return SETTLED.test(answer.replace(EDGES, '')) || finishedLine(answer)
  })

function missingFields(line: string): Missing[] {
  const branch = field(line, BRANCH)
  const next = field(line, 'next')
  const missing: Missing[] = []
  if (branch === '' || A_PLACEHOLDER.test(branch)) missing.push(BRANCH)
  if (!answersTheSha(field(line, SHA))) missing.push(SHA)
  if (next === '' || A_PLACEHOLDER.test(next)) missing.push(NEXT_STEP)
  return missing
}

function gapsFor(named: string, lines: readonly string[]): AGap[] {
  const naming = lines.filter((line) => names(line, named))
  if (naming.length === 0) return [{ package: named, missing: [BRANCH, SHA, NEXT_STEP] }]
  if (settlesItself(named, naming)) return []
  // The line that answers: the first that carries the fields, else the first that names the package.
  const missing = missingFields(naming.find(carriesFields) ?? naming[0] ?? '')
  return missing.length > 0 ? [{ package: named, missing }] : []
}

/** What a handover is missing, per package, in the order the packages are given. */
export function handoverGaps(packages: readonly string[], handover: string): readonly AGap[] {
  const lines = handover.split('\n')
  return packages.flatMap((named) => gapsFor(named, lines))
}

/** One gap as the member and the row read it: crew-code's gapNote line. */
export const theGapLine = (gap: AGap): string => `${gap.package} is missing ${gap.missing.join(', ')}`
