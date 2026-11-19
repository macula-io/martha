// The files a hint's text pulls in, and the text with each one spliced into it where its `@reference` stood (martha#801).
//
// This is `read_referenced_files` and the walk under it (`import_files.rs:294`-`549` at the pin eff9a75e), ported
// decision for decision:
//
//   - the hint's own text is not wrapped; its references are replaced, from the first to the last, with the file's text
//     wrapped in `--- Content from X ---` and `--- End of X ---`;
//   - a reference is followed four levels at most (`MAX_DEPTH`), and each attempt spends one of 64 operations and its
//     output counts against 1 MiB — the wrapper counted with TWO newlines, one more byte than the splice uses, and a
//     budget that runs out stays out;
//   - a reference is skipped when it is absolute, names a `.git` part, resolves outside the boundary or into git
//     metadata, matches the checkout's gitignore, is not a file, or is on the stack of references already being
//     expanded (compared as written, so `./a` and `a` are two spellings);
//   - a file is read only up to what the output budget has left, and a read that is not whole text — invalid UTF-8, or a
//     file that grew past the read's limit — attaches nothing, as the engine's own read fails;
//   - a nested reference resolves against the canonical parent of the file that named it.
//
// The walk answers with every file it read, in the order it read them, so a record can name each one. The hint file
// itself is not among them: its caller read the name and the bytes to take the hint, and an entry here is a file the
// hint's text pulled in.

import { dirname } from 'node:path'

import { isAFile, bytesOrNone, type TheFiles } from './the_files_a_hint_is_read_through.ts'
import { isIgnoredBy, type TheGitignoreChain } from './the_gitignore_chain.ts'
import { theImportBoundaryAt, sanitizedExisting, sanitizedReference, type TheImportBoundary } from './the_boundary_of_an_import.ts'
import { theReferencesIn, type AReferenceInAHint } from './the_references_a_hint_names.ts'

/** How many references one hint's expansion may try (`MAX_REFERENCE_OPERATIONS`, `import_files.rs:20`). */
export const THE_MOST_REFERENCES_FOLLOWED = 64

/** How many bytes one hint's expansion may attach (`MAX_EXPANDED_OUTPUT_BYTES`, `import_files.rs:21`). */
export const THE_MOST_EXPANDED_BYTES = 1024 * 1024

/** How many references deep the walk follows (`MAX_DEPTH`, `import_files.rs:19`). */
export const THE_MOST_LEVELS_FOLLOWED = 3

/** One file a hint's expansion read. */
export interface AFileAHintNames {
  /** The reference as written, after the `@`: the name the record carries for it. */
  readonly asWritten: string
  /** The file read, every link resolved: the path the engine opened. */
  readonly at: string
  /** The file whose text named it: the hint itself, or the file a nested reference was written in. */
  readonly from: string
  /** The bytes the engine read, as it read them: a file grown past the output budget is read only part way. */
  readonly bytes: Uint8Array
}

/** What one hint's expansion read, and the text the engine attaches for it. */
export interface TheFilesAHintNames {
  /** The hint's text with every reference it follows spliced in, as the engine attaches it. */
  readonly text: string
  /** Every file the expansion read, in the order it read them. */
  readonly files: readonly AFileAHintNames[]
}

/** The expansion's account of what it has left to spend. */
interface AReadBudget {
  operationsLeft: number
  bytesLeft: number
  exhausted: boolean
}

/** Everything one expansion carries as it walks. */
interface AReading {
  readonly boundary: TheImportBoundary
  readonly chain: TheGitignoreChain
  readonly machine: TheFiles
  readonly budget: AReadBudget
  readonly visited: Set<string>
  readonly files: AFileAHintNames[]
}

/** What a hint attaches when it has nothing, or nothing it may read: the engine's empty answer. */
const NOTHING_ATTACHED: TheFilesAHintNames = { text: '', files: [] }

/**
 * The files the hint at `hint` pulls in, and the text they make, with `boundary` as the reach and `chain` as the
 * checkout's gitignore — the engine's `read_referenced_files(hint, boundary, visited, 0, chain)`.
 *
 * A hint the engine could not read — outside the boundary, gone, not text — attaches nothing, and that is the empty
 * answer, not a refusal: the engine attaches nothing there either, and the record names no file.
 */
export function theExpansionOfAHint(hint: string, boundary: string, chain: TheGitignoreChain, machine: TheFiles): TheFilesAHintNames {
  const reach = theImportBoundaryAt(boundary, machine)
  if (reach === undefined) return NOTHING_ATTACHED
  const safeHint = sanitizedExisting(hint, reach, machine)
  if (safeHint === undefined) return NOTHING_ATTACHED
  const content = theTextOf(safeHint, machine, undefined)
  if (content === undefined) return NOTHING_ATTACHED
  const reading: AReading = { boundary: reach, chain, machine, budget: { operationsLeft: THE_MOST_REFERENCES_FOLLOWED, bytesLeft: THE_MOST_EXPANDED_BYTES, exhausted: false }, visited: new Set(), files: [] }
  return { text: theExpansionOf(content, hint, reading, 0), files: reading.files }
}

/** The text of one file, every reference in it replaced, or the text as it stands where one is not followed. */
function theExpansionOf(content: string, filePath: string, reading: AReading, depth: number): string {
  const pieces: string[] = []
  let cursor = 0
  for (const reference of theReferencesIn(content)) {
    pieces.push(content.slice(cursor, reference.start))
    cursor = reference.end
    pieces.push(theReplacementFor(reference, dirname(filePath), filePath, reading, depth) ?? content.slice(reference.start, reference.end))
  }
  pieces.push(content.slice(cursor))
  return pieces.join('')
}

/** What one reference stands for: the file spliced in and wrapped, or undefined when it is left as written. */
function theReplacementFor(reference: AReferenceInAHint, including: string, from: string, reading: AReading, depth: number): string | undefined {
  if (depth >= THE_MOST_LEVELS_FOLLOWED) return undefined
  if (!consumeAnOperation(reading.budget)) return undefined
  const safe = theSafeReference(reference.path, including, reading)
  return safe === undefined ? undefined : theFileSplicedIn(reference.path, safe, from, reading, depth)
}

/** The path a reference may be read at, or undefined when it is skipped — in the engine's own order of questions. */
function theSafeReference(reference: string, including: string, reading: AReading): string | undefined {
  if (reading.visited.has(asAPathKey(reference))) return undefined
  const safe = sanitizedReference(reference, including, reading.boundary, reading.machine)
  if (safe === undefined || isIgnoredBy(reading.chain, safe)) return undefined
  return isAFile(reading.machine, safe) ? safe : undefined
}

/** One referenced file read and wrapped, or undefined when the budget or the read does not allow it. */
function theFileSplicedIn(reference: string, safe: string, from: string, reading: AReading, depth: number): string | undefined {
  const wrapper = Buffer.byteLength(aWrapperOf(reference, '\n\n'), 'utf8')
  if (!canFitOutput(reading.budget, wrapper)) return undefined
  const bytes = bytesOrNone(reading.machine, safe)
  if (bytes === null || !canFitOutput(reading.budget, wrapper + bytes.length)) return undefined
  const read = bytes.subarray(0, reading.budget.bytesLeft - wrapper + 1)
  const content = theTextOf(safe, reading.machine, read)
  if (content === undefined) return undefined
  if (!reserveOutput(reading.budget, wrapper + Buffer.byteLength(content, 'utf8'))) return undefined
  const key = asAPathKey(reference)
  reading.files.push({ asWritten: reference, at: safe, from, bytes: read })
  reading.visited.add(key)
  const expanded = theExpansionOf(content, safe, reading, depth + 1)
  reading.visited.delete(key)
  return aWrapperOf(reference, `\n${expanded}\n`)
}

/** The text around an attached file, with `between` sitting between the opening and the closing line. */
function aWrapperOf(reference: string, between: string): string { return `--- Content from ${reference} ---${between}--- End of ${reference} ---` }

/** The text of a file, whole or as far as `read` took it, or undefined when it is not valid UTF-8. */
function theTextOf(path: string, machine: TheFiles, read: Uint8Array | undefined): string | undefined {
  const bytes = read ?? bytesOrNone(machine, path)
  if (bytes === undefined || bytes === null) return undefined
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return undefined }
}

/** One attempt spent, or false once the budget is out — which it then stays (`consume_operation`, `:52`). */
function consumeAnOperation(budget: AReadBudget): boolean {
  if (budget.exhausted || budget.operationsLeft === 0) {
    budget.exhausted = true
    return false
  }
  budget.operationsLeft -= 1
  return true
}

/** Whether `bytes` still fit, without spending them; a fit that fails empties the budget for good (`can_fit_output`, `:64`). */
function canFitOutput(budget: AReadBudget, bytes: number): boolean {
  if (!budget.exhausted && bytes <= budget.bytesLeft) return true
  budget.exhausted = true
  return false
}

/** `bytes` spent, or false once the budget is out — and a budget spent to nothing is out (`reserve_output`, `:57`). */
function reserveOutput(budget: AReadBudget, bytes: number): boolean {
  if (!canFitOutput(budget, bytes)) return false
  budget.bytesLeft -= bytes
  if (budget.bytesLeft === 0) budget.exhausted = true
  return true
}

/**
 * A reference as the stack of references being expanded compares it, component by component as `PathBuf` does: empty
 * parts and interior `.` parts are the same, and a leading `./`, a leading `/` and a `..` are not.
 */
function asAPathKey(reference: string): string {
  const rooted = reference.startsWith('/') ? '/' : reference.startsWith('./') ? './' : ''
  return rooted + reference.split('/').filter((part) => part !== '' && part !== '.').join('/')
}
