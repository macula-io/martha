// The ceilings a merge of two passed heads brings (martha#381, martha#410).
//
// A batch lands one passed head, then the next, and two heads that both moved the same host directory's ceiling clash in
// package.json. That file is not wholly generated: only martha.hostCeilings is. So the map is merged here rather than
// taken from one side — each ceiling stands at the base plus what each review added to it, `base + (ours - base) +
// (theirs - base)`, read from the three stages a conflicted merge keeps. A ceiling equals its own directory's count
// exactly (../check_a_host_directory_stays_under_its_ceiling/record_the_ceilings.ts), so the sum is what the two
// reviewed changes amount to, and no number a review did not see is ever written.
//
// Outside the map the file is what git's own merge of the three stages writes (./the_merge_of_three_texts): a part one
// head changed and the other left alone merges, and only a file the merge itself clashes in outside the map was never
// generated. What that merge writes must read back as one manifest before it is written anywhere — a merge of lines can
// settle the same key twice, which JSON reads as the last of them.
//
// A key that is not a number on all three stages has no sum, and a file the merge clashes in outside the map was never
// generated: both are refused, in the words a landing prints when it stops.

import { basename } from 'node:path'

import { manifestPathOf, type Manifest } from '../../prove_the_core/declared_in_package_json.ts'
import { ceilingsOf, CEILINGS_NAME, THE_CEILINGS_KEY, withCeilings } from '../../prove_the_core/the_host_ceilings.ts'
import { theMergeOfThreeTexts } from './the_merge_of_three_texts.ts'

/** What a merge's ceilings come to: the package.json to write, and the words a landing's commit records of it. */
export interface ThePackageJsonAMergeBrings {
  readonly text: string
  readonly recorded: string
}

type Step<T> = { readonly ok: T } | { readonly refused: string }

/**
 * The manifest with its ceilings map taken out, as one text: the file the two sides hold outside the map, one key to a
 * line so a merge of the two finds what each side changed there.
 */
function withoutTheCeilings(manifest: Manifest): string {
  const martha = Object.fromEntries(Object.entries(manifest.martha ?? {}).filter(([key]) => key !== THE_CEILINGS_KEY))
  return `${JSON.stringify({ ...manifest, martha }, null, 2)}\n`
}

/** The manifest a stage holds, or why the stage is not one this can read. */
function aManifestIn(text: string, stage: string): Step<Manifest> {
  try {
    return { ok: JSON.parse(text) as Manifest }
  } catch {
    return { refused: `${stage} is not JSON a merge can read` }
  }
}

/**
 * Whether two package.json texts are the same file once the ceilings map is taken out of each (martha#339): what the
 * range gate's judge asks of a landed manifest against what the merge of the reviewed heads writes. Refused when either
 * is not JSON.
 */
export function theSameOutsideTheCeilings(one: string, other: string): Step<boolean> {
  const first = aManifestIn(one, 'the landed manifest')
  if ('refused' in first) return first
  const second = aManifestIn(other, 'the merged manifest')
  if ('refused' in second) return second
  return { ok: withoutTheCeilings(first.ok) === withoutTheCeilings(second.ok) }
}

/** One directory's ceiling in the merged map: both sides' number when they agree, and their sum from the base when not. */
function theCeilingOnOneDirectory(
  directory: string,
  base: Readonly<Record<string, number>>,
  ours: Readonly<Record<string, number>>,
  theirs: Readonly<Record<string, number>>,
): Step<number | undefined> {
  const mine = ours[directory]
  const other = theirs[directory]
  if (mine === other) return { ok: mine }
  const from = base[directory]
  if (from === undefined || mine === undefined || other === undefined) {
    return {
      refused: `${CEILINGS_NAME} has no ceiling for ${directory} on every side of the merge: a directory was added or removed, which is a change to the file and not to the map`,
    }
  }
  return { ok: from + (mine - from) + (other - from) }
}

/** Each ceiling the merged map takes, in the order the two sides name them. */
function theCeilingsTheThreeBring(
  base: Readonly<Record<string, number>>,
  ours: Readonly<Record<string, number>>,
  theirs: Readonly<Record<string, number>>,
): Step<Record<string, number>> {
  const next: Record<string, number> = {}
  for (const directory of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const taken = theCeilingOnOneDirectory(directory, base, ours, theirs)
    if ('refused' in taken) return taken
    if (taken.ok !== undefined) next[directory] = taken.ok
  }
  return { ok: next }
}

/** What the merge wrote, read back: the manifest it is, or why it is not one a landing may write. */
function aManifestThatReadsBackAsItself(text: string, the_manifest: string): Step<Manifest> {
  try {
    const manifest = JSON.parse(text) as Manifest
    if (`${JSON.stringify(manifest, null, 2)}\n` === text) return { ok: manifest }
  } catch {
    // the text is not JSON at all, which the refusal below already says
  }
  return {
    refused: `${the_manifest} is not one manifest outside ${CEILINGS_NAME} once the two sides are merged, so the clash is not one this redoes`,
  }
}

/** The manifest the merge writes outside the ceilings map, or why there is none. */
function theManifestOutsideTheCeilingsAMergeWrites(
  the_manifest: string,
  base: Manifest,
  ours: Manifest,
  theirs: Manifest,
): Step<string> {
  const merged = theMergeOfThreeTexts([withoutTheCeilings(ours), withoutTheCeilings(base), withoutTheCeilings(theirs)])
  if ('refused' in merged) return merged
  if ('clashed' in merged) {
    return { refused: `${the_manifest} differs outside ${CEILINGS_NAME}, so the clash is not one this redoes` }
  }
  const read = aManifestThatReadsBackAsItself(merged.ok, the_manifest)
  return 'refused' in read ? read : { ok: merged.ok }
}

/**
 * package.json as the merge of `theirs` into `ours`, with the ceilings summed, or why this clash is not one a landing
 * redoes. `repository` is where the manifest's own name is read from, never spelled here.
 */
export function thePackageJsonOfAMerge(
  repository: string,
  base: string,
  ours: string,
  theirs: string,
): Step<ThePackageJsonAMergeBrings> {
  const the_manifest = basename(manifestPathOf(repository))
  const stages = [base, ours, theirs].map((text, at) => aManifestIn(text, `stage ${String(at + 1)} of ${the_manifest}`))
  const unreadable = stages.find((stage) => 'refused' in stage)
  if (unreadable !== undefined && 'refused' in unreadable) return unreadable
  const [base_manifest, ours_manifest, theirs_manifest] = stages.map((stage) => ('ok' in stage ? stage.ok : undefined))
  if (base_manifest === undefined || ours_manifest === undefined || theirs_manifest === undefined) {
    return { refused: `${the_manifest} could not be read at all three stages of the merge` }
  }
  const outside = theManifestOutsideTheCeilingsAMergeWrites(the_manifest, base_manifest, ours_manifest, theirs_manifest)
  if ('refused' in outside) return outside
  const summed = theCeilingsTheThreeBring(ceilingsOf(base_manifest), ceilingsOf(ours_manifest), ceilingsOf(theirs_manifest))
  if ('refused' in summed) return summed
  return { ok: { text: withCeilings(outside.ok, summed.ok), recorded: `${the_manifest} ${CEILINGS_NAME} (measured)` } }
}
