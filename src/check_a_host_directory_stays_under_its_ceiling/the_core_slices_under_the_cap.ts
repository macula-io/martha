// What a core slice's count fails on: one cap for every slice, and the few slices measured above it (martha#415).
//
// A host directory carries its own ceiling because nothing else reads it. A core slice is read by every core check, and
// yet one of them, the crew's tools, grew from a file of 1424 lines to one of 1808 in two days by collecting other slices' decisions, and
// no check noticed. So every core slice is held to one cap, martha.sliceCap. The cap is a bound, not a measurement: a
// slice under it may grow to it without a word, which is the price of keeping most slices out of package.json. The few
// slices already above it stand in martha.sliceCeilings, each at its exact count, judged the way a host ceiling is: over
// it fails, and so does room under it, until a record run brings it down (martha#341). An exception that names no
// slice, or a slice now at or under the cap, fails too, so the map never holds a number nobody is held to.
//
// A core slice is every directory under src that package.json does not declare as a host directory. src/host_contract
// is one: every slice depends on the contract, so it stays small under the same cap.
//
// The judgement is pure. Which directories are there, and how many lines each holds, is read by judge_the_tree.ts.

import type { Manifest } from '../../prove_the_core/declared_in_package_json.ts'
import { SLICE_CAP_NAME, SLICE_CEILINGS_NAME } from '../../prove_the_core/the_host_ceilings.ts'
import { RECORD_COMMAND } from './check_a_host_directory_stays_under_its_ceiling.ts'
import { declaredDirectoriesOf } from './declared_host_directories.ts'
import { standsAbove } from './record_the_ceilings.ts'

/** One thing the check has to say about the core's slices. */
export type SliceFinding =
  | { readonly kind: 'no_cap' }
  | { readonly kind: 'over_cap'; readonly slice: string; readonly code: number; readonly cap: number }
  | { readonly kind: 'over_ceiling'; readonly slice: string; readonly code: number; readonly ceiling: number }
  | { readonly kind: 'slice_headroom'; readonly slice: string; readonly code: number; readonly ceiling: number }
  | { readonly kind: 'under_the_cap'; readonly slice: string; readonly code: number; readonly ceiling: number; readonly cap: number }
  | { readonly kind: 'no_such_slice'; readonly slice: string }

/** Where a decision belongs once a slice is over what it may hold. */
const ADVICE = 'move the decision into the slice that owns it, not into a new slice made to hold it'

/** The directories among `directories` that are core slices: every one package.json does not declare a host directory. */
export function coreSlicesAmong(directories: readonly string[], manifest: Manifest): string[] {
  const host = new Set(declaredDirectoriesOf(manifest).map((entry) => entry.directory))
  return directories.filter((directory) => !host.has(directory))
}

/** What one slice's count says against the cap, or against its own ceiling when it has one. */
function againstWhatItMayHold(slice: string, code: number, cap: number, ceiling: number | undefined): SliceFinding | undefined {
  if (ceiling === undefined) return code > cap ? { kind: 'over_cap', slice, code, cap } : undefined
  if (code > ceiling) return { kind: 'over_ceiling', slice, code, ceiling }
  if (code <= cap) return { kind: 'under_the_cap', slice, code, ceiling, cap }
  if (standsAbove(ceiling, code)) return { kind: 'slice_headroom', slice, code, ceiling }
  return undefined
}

/** Everything wrong with the core slices' counts, in the order they are counted, then the exceptions no slice has. */
export function sliceFindingsOf(cap: number | undefined, ceilings: Readonly<Record<string, number>>, code: Readonly<Record<string, number>>): SliceFinding[] {
  if (cap === undefined) return [{ kind: 'no_cap' }]
  const found: SliceFinding[] = []
  for (const [slice, counted] of Object.entries(code)) {
    const finding = againstWhatItMayHold(slice, counted, cap, ceilings[slice])
    if (finding !== undefined) found.push(finding)
  }
  for (const slice of Object.keys(ceilings)) {
    if (code[slice] === undefined) found.push({ kind: 'no_such_slice', slice })
  }
  return found
}

/** One finding in the words a red run prints it, the advice on its own line. */
export function describeASlice(finding: SliceFinding): string {
  switch (finding.kind) {
    case 'no_cap':
      return `${SLICE_CAP_NAME} is not declared, so no core slice is held to a ceiling`
    case 'over_cap':
      return `${finding.slice}: ${finding.code} lines of code, over the cap of ${finding.cap} (${SLICE_CAP_NAME})\n  ${ADVICE}`
    case 'over_ceiling':
      return `${finding.slice}: ${finding.code} lines of code, ceiling ${finding.ceiling} (${SLICE_CEILINGS_NAME})\n  ${ADVICE}`
    case 'slice_headroom':
      return (
        `${finding.slice}: ${finding.code} lines of code, ceiling ${finding.ceiling} (${SLICE_CEILINGS_NAME}): ` +
        `${finding.ceiling - finding.code} line(s) of room to grow back unseen\n` +
        `  lower it in the change that shrank it: ${RECORD_COMMAND}`
      )
    case 'under_the_cap':
      return (
        `${SLICE_CEILINGS_NAME} holds ${finding.slice} at ${finding.ceiling}, and it is ${finding.code} lines, at or under ` +
        `the cap of ${finding.cap}\n  remove the exception in the change that shrank it: ${RECORD_COMMAND}`
      )
    case 'no_such_slice':
      return `${SLICE_CEILINGS_NAME} names ${finding.slice}, which is no core slice`
  }
}
