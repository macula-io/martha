// The ceilings a merge of two passed heads brings (martha#381).
//
// A landing that finds two heads clashing only in package.json's ceilings sums them: each is the base plus what each
// review added. What this pins is the whole judgement — the sum, the keys the sides already agree on, and the two
// clashes that are not the map's and so stop a batch rather than being settled here.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { theManifestOfAPlantedTree } from '../check_a_host_directory_stays_under_its_ceiling/a_tree_whose_ceilings_a_test_reads.ts'
import { thePackageJsonOfAMerge } from './the_ceilings_a_merge_brings.ts'

/** Where the tests stand a manifest: the name the recorded words carry. */
const A_REPOSITORY = '/a/clone'

const aManifest = (ceilings: Readonly<Record<string, number>>): string =>
  theManifestOfAPlantedTree({ adapters: Object.keys(ceilings), ceilings })

const AN_ADAPTER = 'src/an_adapter'

/** What the merge came to, or the refusal the landing would print instead. */
function theMergeOf(base: string, ours: string, theirs: string): string {
  const merged = thePackageJsonOfAMerge(A_REPOSITORY, base, ours, theirs)
  if ('refused' in merged) return merged.refused
  const ceilings = (JSON.parse(merged.ok.text) as { martha: { hostCeilings: Record<string, number> } }).martha.hostCeilings
  return `${String(ceilings[AN_ADAPTER])} ${merged.ok.recorded}`
}

test('#381: two heads that move one ceiling give the base plus both raises, and the commit records it', () => {
  assert.equal(
    theMergeOf(aManifest({ [AN_ADAPTER]: 100 }), aManifest({ [AN_ADAPTER]: 111 }), aManifest({ [AN_ADAPTER]: 105 })),
    '116 package.json martha.hostCeilings (measured)',
    'the merged ceiling is not 100 + 11 + 5',
  )
})

test('#381: a ceiling both heads left at the same number is taken once, not counted twice', () => {
  assert.equal(
    theMergeOf(aManifest({ [AN_ADAPTER]: 100 }), aManifest({ [AN_ADAPTER]: 120 }), aManifest({ [AN_ADAPTER]: 120 })),
    '120 package.json martha.hostCeilings (measured)',
    'a ceiling both sides agree on was summed with itself',
  )
})

test('#381: a ceiling one side has no number for is not merged, because the file changed and not only the map', () => {
  const refused = theMergeOf(aManifest({}), aManifest({ [AN_ADAPTER]: 111 }), aManifest({ [AN_ADAPTER]: 105 }))
  assert.match(refused, /no ceiling for src\/an_adapter on every side/, 'a key without three numbers was summed anyway')
})

test('#381: a package.json the sides differ in outside the ceilings is refused, not rewritten', () => {
  const with_scripts = `${JSON.stringify(
    {
      ...(JSON.parse(aManifest({ [AN_ADAPTER]: 111 })) as Record<string, unknown>),
      scripts: { ours: 'echo ours' },
    },
    null,
    2,
  )}\n`
  const refused = theMergeOf(aManifest({ [AN_ADAPTER]: 100 }), with_scripts, aManifest({ [AN_ADAPTER]: 105 }))
  assert.match(refused, /differs outside martha\.hostCeilings/, 'a clash outside the map was settled by the landing')
})

// --- #415: the core slices' exceptions, where a key appearing or disappearing is routine ---------------------------

const A_SLICE = 'src/a_crews_tools'
const THE_CAP = 600

/** A manifest whose core slices above the cap are these, under THE_CAP. */
const sliced = (ceilings: Readonly<Record<string, number>>): string => theManifestOfAPlantedTree({ slice_cap: THE_CAP, slice_ceilings: ceilings })

/** What the merge made of the slices' exceptions, with the words its commit records, or the refusal. */
function theSlicesOf(base: string, ours: string, theirs: string): string {
  const merged = thePackageJsonOfAMerge(A_REPOSITORY, base, ours, theirs)
  if ('refused' in merged) return merged.refused
  const slices = (JSON.parse(merged.ok.text) as { martha: { sliceCeilings: Record<string, number> } }).martha.sliceCeilings
  return `${JSON.stringify(slices)} ${merged.ok.recorded}`
}

test('#415: two heads that each shrink a slice above the cap give the base less both shrinks', () => {
  assert.equal(
    theSlicesOf(sliced({ [A_SLICE]: 1287 }), sliced({ [A_SLICE]: 1280 }), sliced({ [A_SLICE]: 1270 })),
    `{"${A_SLICE}":1263} package.json martha.sliceCeilings (measured)`,
  )
})

test('#415: a key one side has no number for stands at the cap there, so a slice that grew past the cap is summed, not refused', () => {
  assert.equal(
    theSlicesOf(sliced({}), sliced({ [A_SLICE]: 650 }), sliced({})),
    `{"${A_SLICE}":650} package.json martha.sliceCeilings (measured)`,
    'a head that took a slice past the cap clashed by hand with a head that never touched it',
  )
})

test('#415: a merged value at or under the cap is no exception, so the key is dropped', () => {
  assert.equal(theSlicesOf(sliced({ [A_SLICE]: 615 }), sliced({}), sliced({ [A_SLICE]: 615 })), '{} package.json martha.sliceCeilings (measured)', 'one head shrank it under the cap')
  assert.equal(theSlicesOf(sliced({ [A_SLICE]: 615 }), sliced({ [A_SLICE]: 610 }), sliced({ [A_SLICE]: 605 })), '{} package.json martha.sliceCeilings (measured)', 'two shrinks sum to the cap')
})

test('#415: the rare merge where one side shrank a slice under the cap and the other grew it past keeps an upper bound', () => {
  // 615 + (600 - 615) + (700 - 615): the landed count is 675, so the check names the headroom and a record run fixes it.
  assert.equal(theSlicesOf(sliced({ [A_SLICE]: 615 }), sliced({}), sliced({ [A_SLICE]: 700 })), `{"${A_SLICE}":685} package.json martha.sliceCeilings (measured)`)
})

test('#415: a merge that moves both maps names both in the words its commit records', () => {
  const both = (host: number, slice: number): string =>
    theManifestOfAPlantedTree({ adapters: [AN_ADAPTER], ceilings: { [AN_ADAPTER]: host }, slice_cap: THE_CAP, slice_ceilings: { [A_SLICE]: slice } })
  const merged = thePackageJsonOfAMerge(A_REPOSITORY, both(100, 1287), both(110, 1280), both(105, 1270))
  assert.ok('ok' in merged, `the merge was refused: ${'refused' in merged ? merged.refused : ''}`)
  assert.equal(merged.ok.recorded, 'package.json martha.hostCeilings, martha.sliceCeilings (measured)')
})
