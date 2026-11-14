// The ceilings a merge of two passed heads brings (martha#381).
//
// A batch lands one passed head, then the next, and two heads that both moved the
// same host directory's ceiling clash in package.json. That file is not wholly
// generated: only martha.hostCeilings is. So a clash counts as generated when the
// two sides are the same file with that map taken out, and the map is then merged
// here rather than taken from one side — each ceiling stands at the base plus what
// each review added to it, `base + (ours - base) + (theirs - base)`, read from the
// three stages a conflicted merge keeps. A ceiling equals its own directory's count
// exactly (../check_a_host_directory_stays_under_its_ceiling/record_the_ceilings.ts), so the sum is what the two reviewed changes
// amount to, and no number a review did not see is ever written.
//
// A key that is not a number on all three stages has no sum, and a file the two
// sides differ in anywhere outside the map was never generated: both are refused,
// in the words a landing prints when it stops.
//
// martha.sliceCeilings is summed the same way (martha#415), with two more rules,
// because there an exception appearing or disappearing is routine: a slice that
// shrinks under martha.sliceCap loses its exception, and one that grows past it
// gains one. So a key absent on a side stands at the cap on that side, which keeps
// the sum defined, and a merged value at or under the cap drops the key. The cap
// is an upper bound for the absent side, so a merge where one side shrank a slice
// under the cap and the other grew it past can leave the ceiling above the landed
// count; the check names that headroom, and a record run on the branch fixes it.

import { basename } from 'node:path'

import { manifestPathOf, type Manifest } from '../../prove_the_core/declared_in_package_json.ts'
import {
  ceilingsOf,
  CEILINGS_NAME,
  SLICE_CEILINGS_NAME,
  sliceCapOf,
  sliceCeilingsOf,
  THE_CEILINGS_KEY,
  THE_SLICE_CEILINGS_KEY,
  withCeilings,
  withTheMap,
} from '../../prove_the_core/the_host_ceilings.ts'

/** What a merge's ceilings come to: the package.json to write, and the words a landing's commit records of it. */
export interface ThePackageJsonAMergeBrings {
  readonly text: string
  readonly recorded: string
}

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** The two maps a merge sums: the host directories' ceilings, and the core slices' above the cap (martha#415). */
const THE_SUMMED_KEYS: readonly string[] = [THE_CEILINGS_KEY, THE_SLICE_CEILINGS_KEY]

/** The manifest with its ceilings maps taken out, as one text: what the two sides agree on when only the maps clashed. */
function withoutTheCeilings(manifest: Manifest): string {
  const martha = Object.fromEntries(Object.entries(manifest.martha ?? {}).filter(([key]) => !THE_SUMMED_KEYS.includes(key)))
  return JSON.stringify({ ...manifest, martha })
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
 * range gate's judge asks of a landed manifest against a reviewed head. Refused when either is not JSON.
 */
export function theSameOutsideTheCeilings(one: string, other: string): Step<boolean> {
  const first = aManifestIn(one, 'the landed manifest')
  if ('refused' in first) return first
  const second = aManifestIn(other, 'the reviewed manifest')
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

/** One core slice's ceiling in the merged map (martha#415): a side without the key stands at the cap, and a merged value at
 * or under the cap is no exception, so the key is dropped. */
function theCeilingOnOneSlice(
  slice: string,
  cap: number,
  base: Readonly<Record<string, number>>,
  ours: Readonly<Record<string, number>>,
  theirs: Readonly<Record<string, number>>,
): number | undefined {
  const mine = ours[slice] ?? cap
  const other = theirs[slice] ?? cap
  const from = base[slice] ?? cap
  const merged = mine === other ? mine : from + (mine - from) + (other - from)
  return merged > cap ? merged : undefined
}

/** The core slices' exceptions the merged map takes, or why it cannot: with no cap, a side without a key has no value. */
function theSliceCeilingsTheThreeBring(
  cap: number | undefined,
  base: Readonly<Record<string, number>>,
  ours: Readonly<Record<string, number>>,
  theirs: Readonly<Record<string, number>>,
): Step<Record<string, number>> {
  if (cap === undefined) return theCeilingsTheThreeBring(base, ours, theirs)
  const next: Record<string, number> = {}
  for (const slice of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const ceiling = theCeilingOnOneSlice(slice, cap, base, ours, theirs)
    if (ceiling !== undefined) next[slice] = ceiling
  }
  return { ok: next }
}

/** The maps the two sides differ in, by the names a landing's commit records: the host map when neither does. */
function theMapsThatDiffer(ours: Manifest, theirs: Manifest): string {
  const differ = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean => JSON.stringify(a) !== JSON.stringify(b)
  const slices = differ(sliceCeilingsOf(ours), sliceCeilingsOf(theirs))
  const hosts = differ(ceilingsOf(ours), ceilingsOf(theirs)) || !slices
  return [...(hosts ? [CEILINGS_NAME] : []), ...(slices ? [SLICE_CEILINGS_NAME] : [])].join(', ')
}

/** `ours` with both maps summed into it, the slices' only when a side carries that map, or why a map has no sum. */
function theMapsWrittenInto(ours: string, base: Manifest, ours_manifest: Manifest, theirs: Manifest): Step<string> {
  const summed = theCeilingsTheThreeBring(ceilingsOf(base), ceilingsOf(ours_manifest), ceilingsOf(theirs))
  if ('refused' in summed) return summed
  const with_hosts = withCeilings(ours, summed.ok)
  if (ours_manifest.martha?.sliceCeilings === undefined && theirs.martha?.sliceCeilings === undefined) return { ok: with_hosts }
  const sliced = theSliceCeilingsTheThreeBring(sliceCapOf(ours_manifest), sliceCeilingsOf(base), sliceCeilingsOf(ours_manifest), sliceCeilingsOf(theirs))
  if ('refused' in sliced) return sliced
  return { ok: withTheMap(with_hosts, THE_SLICE_CEILINGS_KEY, sliced.ok) }
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
  if (withoutTheCeilings(ours_manifest) !== withoutTheCeilings(theirs_manifest)) {
    return { refused: `${the_manifest} differs outside ${CEILINGS_NAME}, so the clash is not one this redoes` }
  }
  const text = theMapsWrittenInto(ours, base_manifest, ours_manifest, theirs_manifest)
  if ('refused' in text) return text
  return { ok: { text: text.ok, recorded: `${the_manifest} ${theMapsThatDiffer(ours_manifest, theirs_manifest)} (measured)` } }
}
