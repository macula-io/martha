// How long a release that moved no fact may pass host drift on a notice (martha#811, Raf's choice D).
//
// DECIDED 2026-11-19 "7 days or 5 versions (Recommended)": the notice turns into a failure 7 days after the first
// release newer than the recording was published, or once 5 releases newer than the recording exist, whichever comes
// first. So a due re-record cannot be put off for ever.
//
// A release newer than the recording is a version in npm's `versions` that is not a prerelease (no `-…` suffix) and
// is semver-greater than the recorded `host_version`; the 7 days run from that version's entry in npm's `time`. An
// npm answer that cannot be read, or a newer release with no publish time, is unreadable: the check never keeps
// passing on a notice it cannot age.

import { Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'

/** The days, and the number of newer releases, a notice may last. */
export const NOTICE_DAYS = 7
export const NOTICE_RELEASES = 5
const DAY_MS = 24 * 60 * 60 * 1000

/** A release version: three numbers, no prerelease. */
const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/

/** Whether release `one` is semver-greater than release `other`. */
function isNewer(one: string, other: string): boolean {
  const [a, b] = [numbersOf(one), numbersOf(other)]
  for (let at = 0; at < 3; at += 1) if (numberAt(a, at) !== numberAt(b, at)) return numberAt(a, at) > numberAt(b, at)
  return false
}

/** A release's three numbers, or none when it is no release. */
const numbersOf = (version: string): number[] => RELEASE.exec(version)?.slice(1).map(Number) ?? []

/** One number of a release, 0 where it has none. */
const numberAt = (numbers: readonly number[], at: number): number => numbers[at] ?? 0

/** npm's release times and versions from its answer, refusing an answer or a recorded version it cannot read. */
function timesAndVersions(answer: unknown, recorded: string): { readonly time: Record<string, unknown>; readonly versions: unknown[] } {
  const { time, versions } = (answer ?? {}) as { readonly time?: unknown; readonly versions?: unknown }
  if (time === null || typeof time !== 'object' || !Array.isArray(versions) || !RELEASE.test(recorded)) throw new Unreadable("npm's release times or versions")
  return { time: time as Record<string, unknown>, versions: versions as unknown[] }
}

/** Why a notice no longer holds, or undefined while it does. */
export function whyTheNoticeHasAged(answer: unknown, recorded: string, now: number): string | undefined {
  const { time, versions } = timesAndVersions(answer, recorded)
  const newer = versions.filter((version): version is string => typeof version === 'string' && RELEASE.test(version) && isNewer(version, recorded))
  const published = newer.map((version) => Date.parse(String(time[version])))
  if (published.some((at) => Number.isNaN(at))) throw new Unreadable("npm's release times or versions")
  if (newer.length >= NOTICE_RELEASES) return `${String(newer.length)} releases newer than ${recorded} exist, the limit is ${String(NOTICE_RELEASES)}`
  const first = Math.min(...published)
  if (newer.length > 0 && now - first >= NOTICE_DAYS * DAY_MS) return `the first release newer than ${recorded} came out ${String(NOTICE_DAYS)} or more days ago`
  return undefined
}
