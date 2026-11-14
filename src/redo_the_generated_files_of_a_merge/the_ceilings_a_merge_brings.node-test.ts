// The ceilings a merge of two passed heads brings (martha#381, martha#410).
//
// A landing that finds two heads clashing only in package.json's ceilings sums them: each is the base plus what each
// review added. What this pins is the whole judgement — the sum, the keys the sides already agree on, what a merge
// writes outside the map when only one head changed it (martha#410), and the two clashes that are not the map's and so
// stop a batch rather than being settled here.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { theManifestOfAPlantedTree } from '../check_a_host_directory_stays_under_its_ceiling/a_tree_whose_ceilings_a_test_reads.ts'
import { thePackageJsonOfAMerge } from './the_ceilings_a_merge_brings.ts'

/** Where the tests stand a manifest: the name the recorded words carry. */
const A_REPOSITORY = '/a/clone'

const aManifest = (ceilings: Readonly<Record<string, number>>): string =>
  theManifestOfAPlantedTree({ adapters: Object.keys(ceilings), ceilings })

const AN_ADAPTER = 'src/an_adapter'

/** `manifest` with the scripts a change outside the ceilings map made, in place of the scripts it carried. */
const withScripts = (manifest: string, scripts: Readonly<Record<string, string>>): string =>
  `${JSON.stringify({ ...(JSON.parse(manifest) as Record<string, unknown>), scripts }, null, 2)}\n`

/** `manifest` with `value` under `key` in front of every other key: a change outside the map, at the file's top. */
const withAKeyInFront = (manifest: string, key: string, value: unknown): string =>
  `${JSON.stringify({ [key]: value, ...(JSON.parse(manifest) as Record<string, unknown>) }, null, 2)}\n`

/** `manifest` with `value` under `key` after every other key: a change outside the map, at the file's end. */
const withAKeyAtTheEnd = (manifest: string, key: string, value: unknown): string =>
  `${JSON.stringify({ ...(JSON.parse(manifest) as Record<string, unknown>), [key]: value }, null, 2)}\n`

/** The manifest the merge writes, or a failure naming the refusal the landing would print instead. */
function theManifestOfTheMerge(base: string, ours: string, theirs: string): Record<string, unknown> {
  const merged = thePackageJsonOfAMerge(A_REPOSITORY, base, ours, theirs)
  assert.ok('ok' in merged, `the merge was refused: ${'refused' in merged ? merged.refused : ''}`)
  return JSON.parse(merged.ok.text) as Record<string, unknown>
}

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

test('#410: a script one head adds, which the other left alone, merges with the summed ceiling', () => {
  const refused = theMergeOf(
    aManifest({ [AN_ADAPTER]: 100 }),
    aManifest({ [AN_ADAPTER]: 111 }),
    withScripts(aManifest({ [AN_ADAPTER]: 105 }), { added: 'echo added' }),
  )
  assert.equal(refused, '116 package.json martha.hostCeilings (measured)', 'a change one head made outside the map stopped the merge')
})

test('#410: the script the head merged in added is written, not dropped for the head it is merged onto', () => {
  const manifest = theManifestOfTheMerge(
    aManifest({ [AN_ADAPTER]: 100 }),
    aManifest({ [AN_ADAPTER]: 111 }),
    withScripts(aManifest({ [AN_ADAPTER]: 105 }), { added: 'echo added' }),
  )
  assert.deepEqual(manifest.scripts, { added: 'echo added' }, "the merge writes the first head's scripts and not the second's")
  const martha = manifest.martha as { hostCeilings: Record<string, number> }
  assert.equal(martha.hostCeilings[AN_ADAPTER], 116, 'the summed ceiling is not what the merge writes')
})

test('#410: a script the head being merged onto adds, which the other left alone, merges too', () => {
  const manifest = theManifestOfTheMerge(
    aManifest({ [AN_ADAPTER]: 100 }),
    withScripts(aManifest({ [AN_ADAPTER]: 111 }), { added: 'echo added' }),
    aManifest({ [AN_ADAPTER]: 105 }),
  )
  assert.deepEqual(manifest.scripts, { added: 'echo added' }, 'the change the first head made outside the map is not written')
})

test('#381: a package.json the two sides change in the same part outside the ceilings is refused, not rewritten', () => {
  const refused = theMergeOf(
    aManifest({ [AN_ADAPTER]: 100 }),
    withScripts(aManifest({ [AN_ADAPTER]: 111 }), { ours: 'echo ours' }),
    withScripts(aManifest({ [AN_ADAPTER]: 105 }), { theirs: 'echo theirs' }),
  )
  assert.match(refused, /differs outside martha\.hostCeilings/, 'a clash outside the map was settled by the landing')
})

test('#410: a merge that settles one key twice is refused, because what it writes is not one manifest', () => {
  const refused = theMergeOf(
    aManifest({ [AN_ADAPTER]: 100 }),
    withAKeyInFront(aManifest({ [AN_ADAPTER]: 111 }), 'aKeyTwice', 'ours'),
    withAKeyAtTheEnd(aManifest({ [AN_ADAPTER]: 105 }), 'aKeyTwice', 'theirs'),
  )
  assert.match(refused, /is not one manifest outside martha\.hostCeilings/, 'a file no side wrote was handed to a landing to write')
})
