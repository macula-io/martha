// What a top-level folder of code fails on: every unit outside src under the one cap, and no licence to stand above it
// (martha#736).
//
// src is walked slice by slice. Every other top-level folder that holds a script is walked the same way: each folder
// directly under it is one unit, and the files that sit directly in it are one more, and so are the files that sit
// directly in the repository itself, which belong to no folder. Each unit is held to martha.sliceCap, and nothing
// excuses one over it: there are no ceilings outside the core (DECIDED 2026-11-18, "Split them first"), so a
// martha.sliceCeilings entry naming a folder outside src fails by name, where a future author would try to buy one.
//
// A folder that is not code to be read at all may stand in martha.ceilingExclusions with its reason. An exclusion with
// no reason fails, and so does one naming no folder the check would judge, so a licence never outlives its folder.
//
// The judgement is pure. Which units are there, and how many lines each holds, is read by the_top_level_units.ts.

import { CORE } from '../../prove_the_core/declared_in_package_json.ts'
import { CEILING_EXCLUSIONS_NAME, SLICE_CAP_NAME, SLICE_CEILINGS_NAME } from '../../prove_the_core/the_host_ceilings.ts'

/** One thing the check has to say about the code outside src. */
export type TopLevelFinding =
  | { readonly kind: 'over_cap'; readonly unit: string; readonly code: number; readonly cap: number }
  | { readonly kind: 'ceiling_outside_the_core'; readonly directory: string; readonly ceiling: number }
  | { readonly kind: 'exclusion_without_reason'; readonly folder: string }
  | { readonly kind: 'stale_exclusion'; readonly folder: string }

/** What is held to the cap, and what may stand aside from it. */
export interface TheTopLevel {
  /** Each unit's code lines, by the name a red run prints. */
  readonly units: Readonly<Record<string, number>>
  /** The top-level folders the check would judge before any exclusion: the repository root, and every code root but src. */
  readonly folders: readonly string[]
  readonly exclusions: Readonly<Record<string, string>>
}

/** Where a decision belongs once a unit outside src is over the cap. */
const ADVICE = 'split the folder so each part holds one decision; outside src no ceiling may stand above the cap'

/** Whether a directory named as package.json names one sits in the core, where a slice may carry its own ceiling. */
const inTheCore = (directory: string): boolean => directory.startsWith(`${CORE}/`)

/** What martha.ceilingExclusions says wrongly: a reason left out, or a folder the check would not judge anyway. */
function exclusionFindingsOf(top: TheTopLevel): TopLevelFinding[] {
  const found: TopLevelFinding[] = []
  for (const [folder, reason] of Object.entries(top.exclusions)) {
    if (reason.trim() === '') found.push({ kind: 'exclusion_without_reason', folder })
    if (!top.folders.includes(folder)) found.push({ kind: 'stale_exclusion', folder })
  }
  return found
}

/** Each unit over the cap, in the order the units were counted. With no cap, the core slices already fail by name. */
const unitsOverTheCap = (cap: number, units: Readonly<Record<string, number>>): TopLevelFinding[] =>
  Object.entries(units)
    .filter(([, code]) => code > cap)
    .map(([unit, code]) => ({ kind: 'over_cap', unit, code, cap }))

/** Everything wrong outside src: each unit over the cap, each ceiling bought outside the core, then the exclusions. */
export function topLevelFindingsOf(cap: number | undefined, ceilings: Readonly<Record<string, number>>, top: TheTopLevel): TopLevelFinding[] {
  const found: TopLevelFinding[] = cap === undefined ? [] : unitsOverTheCap(cap, top.units)
  for (const [directory, ceiling] of Object.entries(ceilings)) {
    if (!inTheCore(directory)) found.push({ kind: 'ceiling_outside_the_core', directory, ceiling })
  }
  return [...found, ...exclusionFindingsOf(top)]
}

/** The ceilings that are the core slices' to judge: those outside the core are this file's finding, said once. */
export const theCoreCeilingsOf = (ceilings: Readonly<Record<string, number>>): Record<string, number> =>
  Object.fromEntries(Object.entries(ceilings).filter(([directory]) => inTheCore(directory)))

/** One finding in the words a red run prints it, the advice on its own line. */
export function describeATopLevelUnit(finding: TopLevelFinding): string {
  switch (finding.kind) {
    case 'over_cap':
      return `${finding.unit}: ${finding.code} lines of code, over the cap of ${finding.cap} (${SLICE_CAP_NAME})\n  ${ADVICE}`
    case 'ceiling_outside_the_core':
      return `${SLICE_CEILINGS_NAME} holds ${finding.directory} at ${finding.ceiling}, a ceiling outside the core: outside ${CORE} every unit stays under ${SLICE_CAP_NAME}`
    case 'exclusion_without_reason':
      return `${CEILING_EXCLUSIONS_NAME} excludes ${finding.folder} with no reason: say why it is not code to be read`
    case 'stale_exclusion':
      return `${CEILING_EXCLUSIONS_NAME} names ${finding.folder}, which is no top-level folder of code the check would judge`
  }
}
