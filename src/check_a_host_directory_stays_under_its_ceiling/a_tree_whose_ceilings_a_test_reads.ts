// The tree a test plants when it wants ceilings a check can read (martha#322, martha#381).
//
// A ceiling is counted by the linter and judged by the compiler, so a plant needs both: the linter's own config, and a
// package.json declaring the directories under their ceilings. Two tests read ceilings — the check's own, over a tree
// it planted, and a landing's, over the clone it merges in — and one home for the config is what keeps them counting the
// same lines. The linter answers from the tree's own eslint config, so this is the config a plant carries, not a
// second reading of what code is.

/** A tree to judge: the two lists, the ceilings, and the files under it. */
export interface Planted {
  readonly adapters?: readonly string[]
  readonly glue?: readonly string[]
  readonly ceilings?: Readonly<Record<string, number>>
  readonly files?: Readonly<Record<string, string>>
}

/** The linter's config the linter itself reads: code by extension, as the repository's own does. */
export const LINTER_CONFIG = "export default [{ files: ['**/*.{ts,tsx}'], rules: { 'max-depth': ['error', { max: 2 }] } }]\n"

/** The package.json of a planted tree: the lists, and the ceiling each declared directory carries. */
export const theManifestOfAPlantedTree = (planted: Planted): string =>
  `${JSON.stringify(
    {
      martha: {
        hostAdapters: planted.adapters ?? [],
        hostGlue: planted.glue ?? [],
        hostCeilings: planted.ceilings ?? {},
      },
    },
    null,
    2,
  )}\n`
