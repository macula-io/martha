// A slice excuses only its own files (martha#289 part b, r=3).
//
// An entry says "in this file, this spelling is not that constant", and only the file's own slice knows why. So a
// slice's coincidence file may name only files inside that slice: an entry about another slice's file is the list
// growing back into one slice that knows every other slice's words, and it is named.

import type { DeclaredCoincidence } from '../../prove_the_core/the_coincidences_a_slice_declares.ts'

/** The slice a path under the core belongs to: its first folder. */
const sliceOf = (path: string): string => path.split(/[\\/]/)[0] ?? ''

/** The entries that name a file outside the slice that declares them. */
export const entriesOutsideTheirSlice = (entries: readonly DeclaredCoincidence[]): DeclaredCoincidence[] =>
  entries.filter((entry) => !entry.file.startsWith(`${sliceOf(entry.declared_in)}/`))

/** One such entry, as the gate prints it. */
export const lineOfAnEntryOutsideItsSlice = (entry: DeclaredCoincidence): string =>
  `${entry.declared_in}:${entry.line}: excuses ${entry.file}, which lies outside ${sliceOf(entry.declared_in)}; declare it in that file's own slice`
