// Nothing a test starts may take a real member's key (martha#683).
//
// On 2026-11-18 five test-runner children were found alive on a member's machine, one of them holding that member's
// crew session key: the member could not be relaunched until they were stopped. A test's process is a process like any
// other, and what it may hold is bounded by what it is allowed to reach: its own throwaway homes and the machine's
// ordinary files, never another process's session record.
//
// The crew keeps one record per session, a JSON file directly in its own home. This module names that shape once —
// nothing else in this repository defines it — and answers two questions of it: whether a path is such a record, and
// which lines of a source name the home at all.

import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** The crew's home: one directory, with a record of each session directly in it. */
export const THE_CREWS_HOME = join(homedir(), '.claude', 'crew')

/** What ends a session record's name: the crew writes one JSON file per session, directly in its home. */
const A_RECORD_ENDS = '.json'

/** Whether `path` is a crew session record: a JSON file directly in the crew's home, and nothing deeper. */
export const isASessionRecord = (path: string): boolean =>
  dirname(path) === THE_CREWS_HOME && path.endsWith(A_RECORD_ENDS)

/** The line numbers of `text` that name the crew's home, which a source the tests run has no business naming. */
export function linesNamingTheCrewsHome(text: string): number[] {
  return text
    .split('\n')
    .flatMap((line, at) => (line.includes(THE_CREWS_HOME) ? [at + 1] : []))
}

/** What a test's process held when it looked: the paths its open descriptors name, and its environment. */
export type WhatAProcessHeld = {
  readonly descriptors: readonly string[]
  readonly environment: Readonly<Record<string, string>>
}

/** Every crew session record among the descriptors a process held and the values it was given. */
export function sessionRecordsHeld(held: WhatAProcessHeld): string[] {
  const inDescriptors = held.descriptors.filter(isASessionRecord)
  const inEnvironment = Object.values(held.environment).filter(isASessionRecord)
  return [...inDescriptors, ...inEnvironment]
}
