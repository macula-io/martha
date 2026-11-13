// The ceilings a merge of two passed heads brings (martha#381).
//
// A landing that finds two heads clashing only in package.json's ceilings sums them: each is the base plus what each
// review added. What this pins is the whole judgement — the sum, the keys the sides already agree on, and the two
// clashes that are not the map's and so stop a batch rather than being settled here.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { theManifestOfAPlantedTree } from './a_tree_whose_ceilings_a_test_reads.ts'
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
