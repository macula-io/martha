// What the gate hashed last time, so a read of an unchanged checkout reads no file's bytes (martha#177).
//
// A launch and every recheck read the checkout's tree. git's own index, kept, answers which blob the add would record
// for a file whose stat has not moved; what it cannot answer is whether those bytes are that blob or only became it
// through a conversion. So the gate keeps, for each path, what its own hashing of those bytes came to:
//
//   - `blob`, the blob git recorded for them, so an entry is used only for the very bytes it was made from;
//   - `raw`, the id the bytes themselves hashed to, before any conversion was applied.
//
// With `raw` the gate decides exactly as it did when it read the file: the bytes are the approved blob when `raw` is
// the approved blob, and when `raw` is not but `blob` is, a conversion stood between the two and
// `whyAConvertedFileIsRefused` says whether that conversion is allowed (../judge_a_checkouts_tree/conversions_a_launch_passes.ts).
//
// What it is trusted under:
//
//   - THE BYTES MUST BE THE ONES IT WAS MADE FROM. `blob` is git's blob for those bytes, so an entry is used only when
//     git's blob for this path now is the one the entry names. Any other content, and the file is read.
//   - GIT MUST HAVE LEFT THE FILE ALONE THIS RUN. `git diff-files` names every path whose stat no longer matches its
//     index entry, which is exactly the set the add re-hashes; an entry for a path in that set is not used, so a file
//     changed inside the index's own tick, or with its mtime put back, is read as it always was and the change is
//     caught. That is git's racy-clean rule, and this file does not restate it: it asks git.
//
// The record never says what is approved. What it helps build is the live tree, and the live tree is compared with the
// approved tree id path by path as it always was, so an entry can only save a read: it cannot make a changed file pass.
// The worst a wrong entry can do is name a raw id no file's bytes produce, which refuses the launch rather than letting
// it through. It lives in Martha's state, outside the checkout (../keep_what_the_launcher_hashed), where the approvals
// live and under the same residual (martha#1 decision 2): whoever can write it can already append an approval.

/** What the record is, so a file that is not one is refused whole rather than read in part. */
export const RECORD_MAGIC = 'martha tree read 2'

/** What the gate's own hashing of one path's bytes came to. */
export interface RecordedBytes {
  /** The blob git recorded for those bytes: the entry is used only for this content. */
  readonly blob: string
  /** The id the bytes themselves hashed to, before any conversion. */
  readonly raw: string
}

const NOTHING = '\u0000'
const ENTRY = 'entry'
const END = 'end'

/** The fields one entry holds after its own name: the blob, the raw id, and the path. */
const ENTRY_FIELDS = 3

/** A git object id in either format, as the checkout names its blobs. */
const AN_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

/**
 * The record's bytes: one entry for each path, each field ended by a NUL, and `end` to close it. A path may hold
 * anything but a NUL, so no field needs escaping and nothing a path holds can end an entry early.
 */
export function recordBytesOf(files: ReadonlyMap<string, RecordedBytes>): Uint8Array {
  const parts = [RECORD_MAGIC]
  for (const [path, { blob, raw }] of files) parts.push(ENTRY, blob, raw, path)
  parts.push(END, '')
  return Buffer.from(parts.join(NOTHING))
}

/**
 * What the record holds, by path, or undefined when these bytes are not one whole: a wrong first field, an entry short
 * of its fields or naming something that is not an object id, a path twice, or no `end` to close it. A record that does
 * not read whole is refused whole, never read in part.
 */
export function recordOf(bytes: Uint8Array): ReadonlyMap<string, RecordedBytes> | undefined {
  const fields = Buffer.from(bytes).toString('utf8').split(NOTHING)
  if (fields[0] !== RECORD_MAGIC || !isEnded(fields)) return undefined
  const files = new Map<string, RecordedBytes>()
  for (let at = 1; at < fields.length - 2; at += ENTRY_FIELDS + 1) {
    const entry = entryIn(fields.slice(at, at + ENTRY_FIELDS + 1))
    if (entry === undefined || files.has(entry.path)) return undefined
    files.set(entry.path, entry.bytes)
  }
  return files
}

/** One entry, when its fields are one whole: its name, two object ids and a path that is not empty. */
function entryIn(fields: readonly string[]): { readonly path: string; readonly bytes: RecordedBytes } | undefined {
  const [name, blob, raw, path] = fields
  if (name !== ENTRY || blob === undefined || raw === undefined || path === undefined) return undefined
  return AN_OBJECT_ID.test(blob) && AN_OBJECT_ID.test(raw) ? { path, bytes: { blob, raw } } : undefined
}

/** Whether the bytes end as a record does: `end`, then the NUL that ends its last field. */
const isEnded = (fields: readonly string[]): boolean => fields.at(-1) === '' && fields.at(-2) === END

/**
 * The id `path`'s bytes had before any conversion, when the record holds it for exactly the blob git recorded now; and
 * undefined when it does not, so the file is read as it always was.
 */
export function recordedRawIn(record: ReadonlyMap<string, RecordedBytes> | undefined, path: string, blob: string): string | undefined {
  const kept = record?.get(path)
  return kept !== undefined && kept.blob === blob ? kept.raw : undefined
}
