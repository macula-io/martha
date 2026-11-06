// The core's sources, as every check on its code reads them.
//
// The check that the core imports nothing beyond its own slices, Node and the
// packages package.json allows reads imports from the syntax tree, in
// prove_the_core/imports_beyond_the_core.ts; it lives outside the core because it
// imports the TypeScript compiler, which the core may not.
//
// Every check that reads the core's code walks it with coreSources, which lives
// outside the core in prove_the_core/core_sources.ts (it reads the disk, which a
// slice may not), so no check walks fewer files than another.

export interface CoreSource {
  readonly path: string
  readonly text: string
}

/** Every kind of file that can hold script, and so can import. */
export const SCANNED_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const

export const isScannedSource = (path: string): boolean =>
  SCANNED_EXTENSIONS.some((extension) => path.endsWith(extension))
