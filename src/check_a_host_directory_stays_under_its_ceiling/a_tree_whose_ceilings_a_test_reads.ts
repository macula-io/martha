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
  /** The cap on every core slice (martha#415): A_PLANTED_SLICE_CAP when left out, and none at all when null. */
  readonly slice_cap?: number | null
  readonly slice_ceilings?: Readonly<Record<string, number>>
  /** The host contract's directory, as package.json declares it in martha.hostContract. */
  readonly host_contract?: string
}

/** The cap a planted tree holds its core slices to unless a test says otherwise: far above any slice a plant writes. */
export const A_PLANTED_SLICE_CAP = 600

/** The linter's config the linter itself reads: code by extension, as the repository's own does. */
export const LINTER_CONFIG = "export default [{ files: ['**/*.{ts,tsx}'], rules: { 'max-depth': ['error', { max: 2 }] } }]\n"

/** The package.json of a planted tree: what a package that runs its own .ts files declares, its lists and its ceilings. */
export const theManifestOfAPlantedTree = (planted: Planted): string =>
  `${JSON.stringify(
    {
      type: 'module',
      martha: {
        ...(planted.host_contract === undefined ? {} : { hostContract: planted.host_contract }),
        hostAdapters: planted.adapters ?? [],
        hostGlue: planted.glue ?? [],
        hostCeilings: planted.ceilings ?? {},
        ...(planted.slice_cap === null ? {} : { sliceCap: planted.slice_cap ?? A_PLANTED_SLICE_CAP }),
        ...(planted.slice_ceilings === undefined ? {} : { sliceCeilings: planted.slice_ceilings }),
      },
    },
    null,
    2,
  )}\n`
