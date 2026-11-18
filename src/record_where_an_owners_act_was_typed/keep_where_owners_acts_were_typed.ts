// The disk side of where the owner's own acts were typed (martha#619): the record files each act may write, read
// before and after it, and the log beside them. Every decision is ./record_where_an_owners_act_was_typed.ts's; this
// reads and writes the project's own state and hands the lines over.
//
// The record is written by the act first; the entries are appended after it, only for an act that ended done, one per
// line the act added. A crash between the two leaves those lines reading "written without the martha command".

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { APPROVALS_FILE, appendStateLine, crewSubdirectory, readStateFile, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { COMMAND_SHAPES_FILE, OWNER_KEYS_FILE } from '../keep_what_the_owner_signed/keep_what_the_owner_signed.ts'
import { THE_BELLS_FILE, THE_BELLS_PLACE } from '../ring_the_owner/the_mute_of_a_members_bells.ts'
import { PROC_ROOT, whereItIsTypedUnder } from '../linux_process_identity/process_identity_from_proc.ts'
import {
  aLateCutover,
  howTheLinesRead,
  theCutoverOver,
  theEntriesFor,
  theLineFor,
  theLogIn,
  type SeenFrom,
  type TheCutover,
  type TheLogRead,
} from './record_where_an_owners_act_was_typed.ts'

/** The log of the owner's acts, and its cutover, in the project's own state. */
export const OWNER_ACTS_FILE = 'owner_acts.jsonl'
export const OWNER_ACTS_CUTOVER_FILE = 'owner_acts_cutover.json'
const FILE_MODE = 0o600

/** The places a project's state keeps for this: where it is, and the crew's checkout it belongs to. */
export interface TheOwnersActsPlace {
  readonly state: MarthaState
  readonly root: string
}

/** Every record file an owner's act writes in this project, by the act's word; none for an act that writes no line. */
export function theRecordFilesOf(place: TheOwnersActsPlace): Readonly<Record<string, string>> {
  const bells = crewSubdirectory(place.state.state_root, place.root, THE_BELLS_PLACE)
  return {
    approve: join(place.state.directory, APPROVALS_FILE),
    'pin-key': join(place.state.directory, OWNER_KEYS_FILE),
    'keep-shapes': join(place.state.directory, COMMAND_SHAPES_FILE),
    ...('path' in bells ? { bells: join(bells.path, THE_BELLS_FILE) } : {}),
  }
}

/** A record file's lines: a whole-file record (the kept shapes) is one line; a file not there holds none. */
export function linesOf(path: string): readonly string[] {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  if (path.endsWith(COMMAND_SHAPES_FILE)) return text === '' ? [] : [text]
  return text.split('\n').filter((line) => line !== '')
}

/** This process's own terminal and session. */
export const seenFromThisProcess = (): SeenFrom => whereItIsTypedUnder(PROC_ROOT, process.pid)

/** The log and its cutover as kept; the log empty and the cutover absent when Martha has not begun recording. */
export function theLogKept(place: TheOwnersActsPlace): { readonly log: TheLogRead; readonly cutover: TheCutover | undefined } {
  const log = readStateFile(join(place.state.directory, OWNER_ACTS_FILE))
  let cutover: TheCutover | undefined
  try {
    cutover = aCutoverIn(JSON.parse(readFileSync(join(place.state.directory, OWNER_ACTS_CUTOVER_FILE), 'utf8')))
  } catch {
    cutover = undefined
  }
  return { log: 'text' in log ? theLogIn(log.text) : { entries: [], unreadable: [] }, cutover }
}

/** A cutover as kept, or undefined for anything that is not one: then no line reads as history. */
function aCutoverIn(held: unknown): TheCutover | undefined {
  if (typeof held !== 'object' || held === null) return undefined
  const { taken_at, files } = held as Record<string, unknown>
  if (typeof taken_at !== 'string' || typeof files !== 'object' || files === null) return undefined
  const kept = Object.values(files as Record<string, unknown>).every((one) => {
    const { lines, sha256 } = (one ?? {}) as Record<string, unknown>
    return typeof lines === 'number' && Number.isInteger(lines) && lines >= 0 && typeof sha256 === 'string'
  })
  return kept ? (held as TheCutover) : undefined
}

/** Takes the cutover over every record file, once, before the first act Martha records; never again. */
export function theCutoverTakenOnce(place: TheOwnersActsPlace, at: string): void {
  const path = join(place.state.directory, OWNER_ACTS_CUTOVER_FILE)
  const files = theRecordFilesOf(place)
  try {
    writeFileSync(path, `${JSON.stringify(theCutoverOver(Object.fromEntries(Object.values(files).map((file) => [file, linesOf(file)])), at))}\n`, { mode: FILE_MODE, flag: 'wx' })
  } catch {
    // Already taken: the first cutover stands.
  }
}

/** The entries for every line `act` added to its record file since `before`, appended after the record. */
export function keepWhereItWasTyped(place: TheOwnersActsPlace, act: string, before: number, at: string, seen_from: SeenFrom): string | undefined {
  const file = theRecordFilesOf(place)[act]
  if (file === undefined) return undefined
  const lines = linesOf(file)
  const added = act === 'keep-shapes' ? theEntriesFor(act, file, lines, 0, at, seen_from) : theEntriesFor(act, file, lines, before, at, seen_from)
  for (const entry of added) {
    const refused = appendStateLine(join(place.state.directory, OWNER_ACTS_FILE), JSON.stringify(entry), 'owner act')
    if (refused !== undefined) return refused.refusal
  }
  return undefined
}

/** What the owner reads of one record file: each line's reading, a late cutover, and the log lines that vouch for nothing. */
export function whatTheOwnerReadsOf(place: TheOwnersActsPlace, act: string, first_approved_at: string | undefined): readonly string[] {
  const file = theRecordFilesOf(place)[act]
  if (file === undefined) return []
  const { log, cutover } = theLogKept(place)
  const lines = linesOf(file)
  const read = howTheLinesRead(file, lines, log, cutover).map((how, index) => `  line ${index + 1}: ${theLineFor(how)}`)
  const late = cutover === undefined ? undefined : aLateCutover(cutover, first_approved_at)
  const unreadable = log.unreadable.map((number) => `${OWNER_ACTS_FILE} line ${number} is not an entry, so it vouches for no record.`)
  return [...(late === undefined ? [] : [late]), ...unreadable, ...read]
}
