// Nothing a test starts may take a real member's key (martha#683).
//
// On 2026-11-18 five test-runner children were found alive on a member's machine, one of them holding that member's
// crew session key: the member could not be relaunched until they were stopped. A test's process is a process like any
// other, and what it may hold is bounded by what it is allowed to reach: its own throwaway homes and the machine's
// ordinary files, never a real member's session record or the state root a real member's crew keeps.
//
// Three shapes are named here, once each, and nothing else in this repository defines them:
//
//   - a session record: a JSON file directly in the crew's home under Claude Code's own folder;
//   - the crew's home itself, as a source writes it: the expanded path, or the way sources actually build one, a real
//     home (the OS home or the process's own HOME) joined with the crew's folder, or handed to a state-root helper;
//   - what a process held: the paths its open descriptors name, and the environment it was given.

import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

import { CLAUDE_FOLDER } from '../../src/know_claude_codes_own_facts/claude_code_facts.ts'
import { STATE_ROOT_NAME } from '../../src/keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'

/** The crew's folder, under Claude Code's own folder in a home. */
const THE_CREWS_FOLDER = 'crew'

/** The crew's home: one directory, with a record of each session directly in it. */
export const THE_CREWS_HOME = join(homedir(), CLAUDE_FOLDER, THE_CREWS_FOLDER)

/** What ends a session record's name: the crew writes one JSON file per session, directly in its home. */
const A_RECORD_ENDS = '.json'

/** Whether `path` is a crew session record: a JSON file directly in the crew's home, and nothing deeper. */
export const isASessionRecord = (path: string): boolean =>
  dirname(path) === THE_CREWS_HOME && path.endsWith(A_RECORD_ENDS)

/**
 * How a source names a real home: the OS home, or the process's own HOME. A home a test made, from `tmpdir()` or a
 * directory of its own, is none of these, and naming the crew's folder under one is exactly what a test may do.
 */
const A_REAL_HOME = /\bhomedir\s*\(|process\.env\.HOME\b|process\.env\[['"]HOME['"]\]/

/** The crew's folder as a source spells it. */
const THE_CREWS_FOLDER_AS_A_SOURCE = /['"]crew['"]/

/**
 * The helpers that turn a home into the state root a crew keeps: called with a real home, a source names a real
 * member's state, so it is caught however the rest of the line is written.
 */
const A_STATE_ROOTS_HELPER = /\b(stateRootOf|stateHomeUnder|state_root_of)\s*\(/

/** The line numbers of `text` that name the crew's home, which a source the tests run has no business naming. */
export function linesNamingTheCrewsHome(text: string): number[] {
  return text.split('\n').flatMap((line, at) => {
    if (line.includes(THE_CREWS_HOME)) return [at + 1]
    if (!A_REAL_HOME.test(line)) return []
    const buildsItFromTheCrewsFolder = THE_CREWS_FOLDER_AS_A_SOURCE.test(line)
    const asksForARealStateRoot = A_STATE_ROOTS_HELPER.test(line)
    return buildsItFromTheCrewsFolder || asksForARealStateRoot ? [at + 1] : []
  })
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

/** A crew's state as a test plants it: the home a state root sits in, and a session id the crew has recorded. */
export type APlantedCrewState = {
  readonly state_home: string
  readonly session_id: string
}

/**
 * Every value a process held that names the planted crew's state: the state home or the root under it, anything inside
 * either, or the session id itself. A bare id counts: it is what a session record is named by, and nothing else in a
 * process's environment is (martha#683 r=1, item 1).
 */
export function plantedCrewStateHeld(held: WhatAProcessHeld, planted: APlantedCrewState): string[] {
  const root = join(planted.state_home, STATE_ROOT_NAME)
  const inside = (value: string): boolean =>
    [planted.state_home, root].some((place) => value === place || value.startsWith(`${place}${sep}`)) || value === planted.session_id
  return [...held.descriptors.filter(inside), ...Object.values(held.environment).filter(inside)]
}
