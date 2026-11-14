// The ceilings a merge of two passed heads brings (martha#381, martha#410).
//
// A batch lands one passed head, then the next, and two heads that both moved the same host directory's ceiling clash in
// package.json. That file is not wholly generated: only the maps a landing sums are. So each of them is merged here
// rather than taken from one side — each ceiling stands at the base plus what each review added to it, `base + (ours -
// base) + (theirs - base)`, read from the three stages a conflicted merge keeps. A ceiling equals its own directory's
// count exactly (../check_a_host_directory_stays_under_its_ceiling/record_the_ceilings.ts), so the sum is what the two
// reviewed changes amount to, and no number a review did not see is ever written.
//
// Outside those maps the file is what git's own merge of the three stages writes (./the_merge_of_three_texts): a part
// one head changed and the other left alone merges, and only a file the merge itself clashes in outside the maps was
// never generated. What that merge writes must read back as one manifest before it is written anywhere — a merge of
// lines can settle the same key twice, which JSON reads as the last of them.
//
// A key that is not a number on all three stages has no sum, and a file the merge clashes in outside the maps was never
// generated: both are refused, in the words a landing prints when it stops.
//
// martha.sliceCeilings is summed the same way (martha#415), with two more rules, because there an exception appearing or
// disappearing is routine: a slice that shrinks under martha.sliceCap loses its exception, and one that grows past it
// gains one. So a key absent on a side stands at the cap on that side, which keeps the sum defined, and a merged value
// at or under the cap drops the key. The cap is an upper bound for the absent side, so a merge where one side shrank a
// slice under the cap and the other grew it past can leave the ceiling above the landed count; the check names that
// headroom, and a record run on the branch fixes it.
//
// The sum stands on one cap for every stage, so a head that moves martha.sliceCap is refused (martha#410): its
// exceptions were measured against another number, and summing them against ours would drop one that only the moved
// cap needed. On main that pair is refused too, the cap differing outside the maps.

import { basename } from 'node:path'

import { manifestPathOf, type Manifest } from '../../prove_the_core/declared_in_package_json.ts'
import {
  ceilingsOf,
  CEILINGS_NAME,
  SLICE_CAP_NAME,
  SLICE_CEILINGS_NAME,
  sliceCapOf,
  sliceCeilingsOf,
  THE_CEILINGS_KEY,
  THE_SLICE_CEILINGS_KEY,
  withCeilings,
  withTheMap,
} from '../../prove_the_core/the_host_ceilings.ts'
import { theMergeOfThreeTexts } from './the_merge_of_three_texts.ts'

/** What a merge's ceilings come to: the package.json to write, and the words a landing's commit records of it. */
export interface ThePackageJsonAMergeBrings {
  readonly text: string
  readonly recorded: string
}

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** The two maps a merge sums (martha#415): the host directories' ceilings, and the core slices' above the cap. */
const THE_SUMMED_MAPS: readonly { readonly key: string; readonly name: string }[] = [
  { key: THE_CEILINGS_KEY, name: CEILINGS_NAME },
  { key: THE_SLICE_CEILINGS_KEY, name: SLICE_CEILINGS_NAME },
]

/** The keys those maps stand under, inside `martha`. */
const THE_SUMMED_KEYS: readonly string[] = THE_SUMMED_MAPS.map((map) => map.key)

/** What a refusal names as the part of package.json a landing writes itself. */
export const THE_SUMMED_NAMES: string = THE_SUMMED_MAPS.map((map) => map.name).join(' and ')

/**
 * The manifest with every summed map it carries emptied in place, as one text: the file the two sides hold outside the
 * maps, one key to a line so a merge of the two finds what each side changed there. A map keeps its place — emptied,
 * every side holds it the same, so the merge passes it through where it stands and the numbers are written over it
 * afterwards. A map a side does not carry is left out, so no key is added to the file.
 */
function withTheSummedMapsEmptied(manifest: Manifest): string {
  const martha =
    manifest.martha === undefined
      ? undefined
      : Object.fromEntries(Object.entries(manifest.martha).map(([key, held]) => [key, THE_SUMMED_KEYS.includes(key) ? {} : held]))
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
 * Whether two package.json texts are the same file once every map a merge sums is taken out of each (martha#339): what
 * the range gate's judge asks of a landed manifest against what the merge of the reviewed heads writes. Refused when
 * either is not JSON.
 */
export function theSameOutsideTheCeilings(one: string, other: string): Step<boolean> {
  const first = aManifestIn(one, 'the landed manifest')
  if ('refused' in first) return first
  const second = aManifestIn(other, 'the merged manifest')
  if ('refused' in second) return second
  return { ok: withTheSummedMapsEmptied(first.ok) === withTheSummedMapsEmptied(second.ok) }
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

/** One core slice's ceiling in the merged map (martha#415): a side without the key stands at the cap, and a merged value
 * at or under the cap is no exception, so the key is dropped. */
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

/** What the merge wrote, read back: the manifest it is, or why it is not one a landing may write. */
function aManifestThatReadsBackAsItself(text: string, the_manifest: string): Step<Manifest> {
  try {
    const manifest = JSON.parse(text) as Manifest
    if (`${JSON.stringify(manifest, null, 2)}\n` === text) return { ok: manifest }
  } catch {
    // the text is not JSON at all, which the refusal below already says
  }
  return {
    refused: `${the_manifest} is not one manifest outside ${THE_SUMMED_NAMES} once the two sides are merged, so the clash is not one this redoes`,
  }
}

/** The manifest the merge writes outside the summed maps, or why there is none. */
function theManifestOutsideTheSummedMapsAMergeWrites(
  the_manifest: string,
  base: Manifest,
  ours: Manifest,
  theirs: Manifest,
): Step<string> {
  const merged = theMergeOfThreeTexts([withTheSummedMapsEmptied(ours), withTheSummedMapsEmptied(base), withTheSummedMapsEmptied(theirs)])
  if ('refused' in merged) return merged
  if ('clashed' in merged) {
    return { refused: `${the_manifest} differs outside ${THE_SUMMED_NAMES}, so the clash is not one this redoes` }
  }
  const read = aManifestThatReadsBackAsItself(merged.ok, the_manifest)
  return 'refused' in read ? read : { ok: merged.ok }
}

/** The maps the two sides differ in, by the names a landing's commit records: the host map when neither does. */
function theMapsThatDiffer(ours: Manifest, theirs: Manifest): string {
  const differ = (a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean => JSON.stringify(a) !== JSON.stringify(b)
  const slices = differ(sliceCeilingsOf(ours), sliceCeilingsOf(theirs))
  const hosts = differ(ceilingsOf(ours), ceilingsOf(theirs)) || !slices
  return [...(hosts ? [CEILINGS_NAME] : []), ...(slices ? [SLICE_CEILINGS_NAME] : [])].join(', ')
}

/** The cap the three stages stand at, or why their slices' ceilings are summed against none: a side that moved the cap
 * measured its slices against another number, so a sum would drop an exception it needed or invent one it never had. */
function theCapTheThreeStandAt(base: Manifest, ours: Manifest, theirs: Manifest): Step<number | undefined> {
  const caps = [sliceCapOf(base), sliceCapOf(ours), sliceCapOf(theirs)]
  if (caps.every((cap) => cap === caps[0])) return { ok: caps[0] }
  return {
    refused: `${SLICE_CAP_NAME} is ${theCapsInWords(caps)} across the three stages of the merge, so the core slices' ceilings were measured against no one cap: a head that moves it is merged by hand`,
  }
}

/** The caps a refusal names, in the order the stages hold them: `600 and 500`, a stage that declares none as `no cap`. */
function theCapsInWords(caps: readonly (number | undefined)[]): string {
  const words = [...new Set(caps)].map((cap) => (cap === undefined ? 'no cap' : String(cap)))
  return `${words.slice(0, -1).join(', ')} and ${String(words[words.length - 1])}`
}

/** `ours` with both maps summed into it, the slices' only when a side carries that map, or why a map has no sum. */
function theMapsWrittenInto(ours: string, base: Manifest, ours_manifest: Manifest, theirs: Manifest): Step<string> {
  const cap = theCapTheThreeStandAt(base, ours_manifest, theirs)
  if ('refused' in cap) return cap
  const summed = theCeilingsTheThreeBring(ceilingsOf(base), ceilingsOf(ours_manifest), ceilingsOf(theirs))
  if ('refused' in summed) return summed
  const with_hosts = withCeilings(ours, summed.ok)
  if (ours_manifest.martha?.sliceCeilings === undefined && theirs.martha?.sliceCeilings === undefined) return { ok: with_hosts }
  const sliced = theSliceCeilingsTheThreeBring(cap.ok, sliceCeilingsOf(base), sliceCeilingsOf(ours_manifest), sliceCeilingsOf(theirs))
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
  const outside = theManifestOutsideTheSummedMapsAMergeWrites(the_manifest, base_manifest, ours_manifest, theirs_manifest)
  if ('refused' in outside) return outside
  const text = theMapsWrittenInto(outside.ok, base_manifest, ours_manifest, theirs_manifest)
  if ('refused' in text) return text
  return { ok: { text: text.ok, recorded: `${the_manifest} ${theMapsThatDiffer(ours_manifest, theirs_manifest)} (measured)` } }
}
