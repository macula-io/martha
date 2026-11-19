// The `@references` a hint's own text makes, found as the engine's scanner finds them (martha#801).
//
// The engine scans a hint with `FILE_REFERENCE_REGEX` (`import_files.rs:9` at the pin eff9a75e):
//
//   (?:^|\s)@([a-zA-Z0-9_\-./]+(?:\.[a-zA-Z0-9]+)+|[A-Z][a-zA-Z0-9_\-]*|[a-zA-Z0-9_\-./]*[./][a-zA-Z0-9_\-./]*)
//
// and splices by the byte offsets of the `@`, so a match that starts at a whitespace keeps that whitespace in the text
// before it. A text longer than 128 KiB (`content.len()` in bytes) yields no reference at all.
//
// The whitespace is Rust's: Unicode `White_Space`, which counts U+0085 and does not count U+FEFF — the reverse of
// JavaScript's `\s`. So the class is spelled out here rather than left to the engine's own `\s`.

/** The longest text the engine scans for references, in UTF-8 bytes (`import_files.rs:296`, `MAX_CONTENT_LENGTH`). */
export const THE_MOST_A_HINT_SCANS = 131_072

/** The characters Rust's `\s` counts (Unicode `White_Space`), as a regex class body. */
const RUST_WHITESPACE_CLASS = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'

/** The engine's reference pattern, with the whitespace class spelled for Rust rather than for JavaScript. */
const A_REFERENCE = new RegExp(
  `(?:^|[${RUST_WHITESPACE_CLASS}])@([a-zA-Z0-9_\\-./]+(?:\\.[a-zA-Z0-9]+)+|[A-Z][a-zA-Z0-9_\\-]*|[a-zA-Z0-9_\\-./]*[./][a-zA-Z0-9_\\-./]*)`,
  'g',
)

/** One reference in a hint's text: the path as written, and where its `@` starts and its path ends. */
export interface AReferenceInAHint {
  /** The path as written, after the `@`. */
  readonly path: string
  /** The index of the `@` itself, which is where the text is spliced. */
  readonly start: number
  /** The index just past the path: the reference's own text is `start`-`end`. */
  readonly end: number
}

/** Every reference the text makes, in the order the engine's scanner finds them. */
export function theReferencesIn(text: string): readonly AReferenceInAHint[] {
  if (Buffer.byteLength(text, 'utf8') > THE_MOST_A_HINT_SCANS) return []
  const references: AReferenceInAHint[] = []
  for (const found of text.matchAll(A_REFERENCE)) {
    const path = found[1]
    if (path === undefined) continue
    const start = found.index + found[0].length - path.length - 1
    references.push({ path, start, end: start + path.length + 1 })
  }
  return references
}
