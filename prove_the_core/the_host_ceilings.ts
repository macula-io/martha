// The ceilings package.json declares, and the one place that writes them (martha#322, martha#381).
//
// A host directory's ceiling lives in package.json under martha.hostCeilings, and two things write it: the check's
// record run, which only ever brings a number down (../src/check_a_host_directory_stays_under_its_ceiling/
// record_the_ceilings), and a landing, which merges two reviews' ceilings into one (../src/land_passed_work_as_one_batch/
// the_ceilings_a_merge_brings). Both rewrite the same map, so the map is read and written here, once, and neither
// spells the key or the file's shape again.
//
// What is here is the vocabulary: where the map stands, how it is read from a manifest, and the text a manifest takes
// with a map in it. What each writer decides — a lowering, a sum — stays with its writer.

import type { Manifest } from './declared_in_package_json.ts'

/** Where the ceilings stand, as package.json names them: the words a landing's commit records of a ceiling it brought. */
export const CEILINGS_NAME = 'martha.hostCeilings'

/** The key the ceilings stand under, inside `martha`. */
export const THE_CEILINGS_KEY = 'hostCeilings'

/** The ceiling each declared directory carries, as package.json holds it. */
export function ceilingsOf(manifest: Manifest): Readonly<Record<string, number>> {
  return manifest.martha?.hostCeilings ?? {}
}

/** The part of package.json this reads and writes. */
interface WithCeilings {
  readonly martha?: Readonly<Record<string, unknown>> & { readonly hostCeilings?: Record<string, number> }
}

/** `text` with `hostCeilings` replaced by `next`, every other key where it was. */
export function withCeilings(text: string, next: Record<string, number>): string {
  const manifest = JSON.parse(text) as WithCeilings
  const martha = { ...(manifest.martha ?? {}), [THE_CEILINGS_KEY]: next }
  return `${JSON.stringify({ ...manifest, martha }, null, 2)}\n`
}
