// A member's model switch, and the owner's own default for new sessions (martha#359).
//
// This exists because the host's own `/model` command does two things at once: it switches the member's session, and it
// saves the switched model into the owner's `settings.json` as the default for every new session the owner starts.
// Claude Code 2.1.323 says so itself — "Set model to … and saved as your default for new sessions" — and it saves
// asynchronously, bounded at 3 s, with the write still going after its answer. A crew that switches a member to the
// expensive model therefore leaves the owner's next personal session there too.
//
// No spelling of the command switches a session alone (design, routes 1–9), so the switch is kept and what it did to
// the owner is undone: snapshot the file, let the command run, wait for the file to show the host's save, and put the
// owner's own bytes back when nothing else in the file has moved. Every step is here, in the launcher's own process,
// which is the one present before the order goes out and after the host reports; the mod still only runs the command
// and reports the model.
//
// Three rules carry the whole of it:
//
//   - NEVER ON THE COMMAND'S WORD. The wait keys on the file, never on the command resolving, because a save that lands
//     after the answer is exactly the case a restore on the command's word would be overwritten by (R1).
//   - NOTHING ELSE MAY MOVE. Before writing a byte back, the file's every key but `model` must still hash as it did,
//     and `model` must be the change this switch brought. An owner's edit in the window is never overwritten (R1).
//   - NO COPY OF THE FILE. The record keeps the presence and old value of `model`, the value written, and hashes; never
//     the file, which can hold the owner's environment and other secrets (R3). `without_model` is the canonical hash of
//     everything else, which is what lets a recovery a crash left behind tell "only the model moved" without the file.
//
// What this cannot do, said plainly: between the host's save and the restore, a session the owner starts runs on the
// member's model. The window is milliseconds and nothing reachable closes it. An owner who sets the same model from
// their own session inside the window cannot be told from the host's save, and the restore undoes it.

import type { ASwitchLock, Refused, TheOwnersSettingsStore } from '../host_contract/host_contract.ts'
import type { DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { modelPlace, theModelOf, theOwnersDefaultKept, type SwitchingHost } from '../switch_a_members_model/switch_a_members_model.ts'
import {
  NO_FILE_BEFORE,
  settingsWithTheOwnerModelBack,
  sha256Of,
  snapshotOf,
  theModelIn,
  type TheOwnersSettingsSnapshot,
} from './the_owners_settings_file.ts'

/** How long the launcher waits for the file to show the host's save: above the host's own 3 s bound, then nothing. */
export const THE_SAVE_WAIT_MS = 10_000

/** How long one look at the file waits before it looks again. */
export const THE_SAVE_STEP_MS = 25

/**
 * The owner's file as this launcher reaches it: the store the host gives over its own settings file, the path the owner
 * reads in what needs them, and the config directory the record keeps — so a launch that finds a record for another
 * config directory than the one it reads refuses the recovery by name rather than putting a model back somewhere else.
 */
export interface OwnersDefaultPlace {
  readonly store: TheOwnersSettingsStore
  readonly file: string
  readonly config_dir: string
}

/**
 * What a switch keeps about the owner's default (R3): never a copy of the file. `after` is set the moment the host's
 * save is seen, so a crash between seeing it and the restore is still finishable by hash; with `after` null,
 * `without_model` is what a recovery has to match.
 */
export interface TheOwnersModelRecord {
  readonly config_dir: string
  /** The sha256 of the file's bytes before the switch; NO_FILE_BEFORE when the owner had no file. */
  readonly before: string
  /** The sha256 of the bytes once the switched value was seen, or null while no file of the host's has been seen. */
  readonly after: string | null
  /** The sha256 of the canonical parse with `model` removed: everything a recovery must find unchanged. */
  readonly without_model: string
  /** Whether the owner had a settings file at all, so a restore knows whether the answer is a file or no file. */
  readonly had_file: boolean
  /** Whether the owner's file held a `model`, and what it held. */
  readonly had_model: boolean
  readonly owner_model: string
  /** The value the file gained while this switch held the lock, or null while it has not been seen. */
  readonly wrote: string | null
  /** What needs the owner about this switch, in one line; '' while nothing does. Cleared with the record. */
  readonly why: string
}

/** A switch that may go ahead: the lock it holds, the record to keep, and the file as it was. */
export interface AGuardedSwitch {
  readonly record: TheOwnersModelRecord
  readonly snapshot: TheOwnersSettingsSnapshot
  readonly lock: ASwitchLock
}

/** What becomes of the owner's default: the record left for a later launch (null when the switch is finished), and the
 * line that needs the owner, when one does. */
export interface TheOwnersDefaultAfter {
  readonly record: TheOwnersModelRecord | null
  readonly why: string
}

/**
 * Steps 1 and 2 of a switch: the one lock for the owner's config directory, and the file as it is before the command
 * runs. A refusal is a switch not made — the owner's default is never moved by a switch that could not be put back.
 */
export async function guardTheOwnersDefault(place: OwnersDefaultPlace): Promise<AGuardedSwitch | Refused> {
  const lock = await place.store.takeTheLock()
  if ('refusal' in lock) return lock
  const snapshot = snapshotOf(place.store.read())
  if ('refusal' in snapshot) {
    lock.release()
    return snapshot
  }
  return { lock, snapshot, record: theRecordFor(place, snapshot, '') }
}

/** The record a snapshot makes: everything a launch after a crash needs to finish the switch, and no copy of the file. */
function theRecordFor(place: OwnersDefaultPlace, snapshot: TheOwnersSettingsSnapshot, why: string): TheOwnersModelRecord {
  const { had_model, owner_model } = theModelIn(snapshot.exists ? snapshot.parsed : {})
  return {
    config_dir: place.config_dir,
    before: snapshot.before,
    after: null,
    without_model: snapshot.without_model,
    had_file: snapshot.exists,
    had_model,
    owner_model,
    wrote: null,
    why,
  }
}

/** What the file showed of the host's save: whether it moved at all, the record to keep now, and what needs the owner. */
export interface TheSaveSeen {
  readonly moved: boolean
  readonly record: TheOwnersModelRecord
  readonly why: string
}

/**
 * Step 4: waits, bounded, for the file to show the host's save. The record comes back with `after` and `wrote` set the
 * moment the file moves, so the caller keeps it BEFORE the restore: a crash between the two is finishable by hash at
 * the next launch. A file that never moves is not a success — it is a switch whose save may land later.
 */
export async function theSaveInTheFile(place: OwnersDefaultPlace, guarded: AGuardedSwitch): Promise<TheSaveSeen> {
  for (let looked = 0; looked < THE_SAVE_WAIT_MS / THE_SAVE_STEP_MS; looked += 1) {
    const seen = theSaveSeenNow(place, guarded)
    if (seen !== null) return seen
    await new Promise((resolved) => setTimeout(resolved, THE_SAVE_STEP_MS))
  }
  return theSaveThatNeverShowed(place, guarded.record)
}

/**
 * One look at the file, for a caller that will not wait: the save if it is there, and null while the file still says
 * what it said before the command. It is what a switch whose session never reported is closed with — the report is
 * what a save landing after the answer is waited for, and a session that died before reporting may still have saved.
 */
export function theSaveSeenNow(place: OwnersDefaultPlace, guarded: AGuardedSwitch): TheSaveSeen | null {
  const now = snapshotOf(place.store.read())
  if ('refusal' in now) return { moved: false, record: { ...guarded.record, why: now.refusal }, why: now.refusal }
  if (theHashNow(now) === guarded.record.before) return null
  return { moved: true, record: theRecordSaved(guarded.record, now), why: '' }
}

/** The record a switch keeps when the file never showed its save: the next launch finishes it by the hash it holds. */
export function theSaveThatNeverShowed(place: OwnersDefaultPlace, record: TheOwnersModelRecord): TheSaveSeen {
  const why = `${place.file} showed no save of the switched model within ${THE_SAVE_WAIT_MS} ms, so the owner's default may be the member's model: the next launch finishes this switch`
  return { moved: false, record: { ...record, why }, why }
}

/** The record with the save in it: the bytes the host wrote, and the model value the file gained. */
function theRecordSaved(record: TheOwnersModelRecord, now: TheOwnersSettingsSnapshot): TheOwnersModelRecord {
  const { had_model, owner_model } = theModelIn(now.exists ? now.parsed : {})
  const gained = had_model && (owner_model !== record.owner_model || !record.had_model) ? owner_model : null
  return { ...record, after: now.exists ? sha256Of(now.bytes) : null, wrote: gained }
}

/** The file's hash as it is now: NO_FILE_BEFORE while the owner has no file, so "a file appeared" is a move. */
const theHashNow = (now: TheOwnersSettingsSnapshot): string => (now.exists ? sha256Of(now.bytes) : NO_FILE_BEFORE)

/**
 * Step 5: puts the owner's own bytes back, atomically, and only when nothing else in the file has moved. Every other
 * case writes nothing and says in one line what needs the owner, because an owner's edit is never overwritten by a
 * restore. The lock the caller holds is released by the caller, after this.
 */
export function putTheOwnersModelBack(place: OwnersDefaultPlace, guarded: AGuardedSwitch, record: TheOwnersModelRecord): TheOwnersDefaultAfter {
  const now = snapshotOf(place.store.read())
  if ('refusal' in now) return { record: { ...record, why: now.refusal }, why: now.refusal }
  if (now.without_model !== record.without_model) return refusedAfter(record, somethingElseMoved(place))
  const { had_model, owner_model } = theModelIn(now.exists ? now.parsed : {})
  if (had_model === record.had_model && owner_model === record.owner_model) return { record: null, why: '' }
  if (record.wrote !== null && owner_model !== record.wrote) return refusedAfter(record, replacedAfterTheSwitch(place))
  return theOwnerModelBack(place, guarded, record)
}

/** The restore itself: the snapshot's own bytes, or no file where the owner had none. */
function theOwnerModelBack(place: OwnersDefaultPlace, guarded: AGuardedSwitch, record: TheOwnersModelRecord): TheOwnersDefaultAfter {
  const written = guarded.snapshot.exists ? place.store.writeBack(guarded.snapshot.bytes, guarded.snapshot.mode) : place.store.remove()
  return written === undefined ? { record: null, why: '' } : { record: { ...record, why: written.refusal }, why: written.refusal }
}

/** The record kept, saying what needs the owner: nothing was written back, and the owner reads why. */
const refusedAfter = (record: TheOwnersModelRecord, why: string): TheOwnersDefaultAfter => ({ record: { ...record, why }, why })

/**
 * Step 7: finishes a switch a crash left behind, at a launch and before the member's host starts, so the owner's file is
 * right before any new session reads it. It takes the same lock a switch does, writes only `model` — it never had a copy
 * of the file — and only when the hash the record kept still describes what is there: the bytes the host wrote
 * (`after`), or, when the wait never saw them, everything but `model` (`without_model`).
 */
export async function finishAnUnfinishedSwitch(place: OwnersDefaultPlace, record: TheOwnersModelRecord): Promise<TheOwnersDefaultAfter> {
  if (record.config_dir !== place.config_dir) {
    return refusedAfter(record, otherConfigDirectory(place, record))
  }
  const lock = await place.store.takeTheLock()
  if ('refusal' in lock) return refusedAfter(record, lock.refusal)
  try {
    return theRecovery(place, record)
  } finally {
    lock.release()
  }
}

/** The recovery's decision and its one write, taken under the lock: hash first, and the model alone when it matches. */
function theRecovery(place: OwnersDefaultPlace, record: TheOwnersModelRecord): TheOwnersDefaultAfter {
  const now = snapshotOf(place.store.read())
  if ('refusal' in now) return refusedAfter(record, now.refusal)
  const moved = whatMovedInstead(place, record, now)
  if (moved !== '') return refusedAfter(record, moved)
  const { had_model, owner_model } = theModelIn(now.exists ? now.parsed : {})
  if (had_model === record.had_model && owner_model === record.owner_model) return { record: null, why: '' }
  return now.exists ? writeTheRecoveredModel(place, record, now) : refusedAfter(record, noFileToFinish(place))
}

/** What moved instead of what the record kept, in one line; '' when the record still describes the file. */
function whatMovedInstead(place: OwnersDefaultPlace, record: TheOwnersModelRecord, now: TheOwnersSettingsSnapshot): string {
  if (record.after === null) return now.without_model === record.without_model ? '' : somethingElseMoved(place)
  return now.exists && sha256Of(now.bytes) === record.after ? '' : changedAfterTheSwitch(place)
}

/** The recovery's write: the file's own parse with the owner's `model` put back, and nothing else of it touched. */
function writeTheRecoveredModel(place: OwnersDefaultPlace, record: TheOwnersModelRecord, now: TheOwnersSettingsSnapshot): TheOwnersDefaultAfter {
  if (!now.exists) return refusedAfter(record, noFileToFinish(place))
  const written = place.store.writeBack(settingsWithTheOwnerModelBack(now.parsed, record.had_model, record.owner_model), now.mode)
  return written === undefined ? { record: null, why: '' } : refusedAfter(record, written.refusal)
}

/** The record was written for another config directory than the one this launch reads: nothing is put back anywhere. */
const otherConfigDirectory = (place: OwnersDefaultPlace, record: TheOwnersModelRecord): string =>
  `a switch was left unfinished on ${record.config_dir}'s settings, and this launch reads ${place.config_dir}, so nothing was put back: ${place.file} is not the file that switch wrote`

/** The owner's own edit, in the window: no restore may overwrite it, and the owner is told which file it is. */
const somethingElseMoved = (place: OwnersDefaultPlace): string =>
  `something other than the model changed in ${place.file} during the switch, so nothing was written back and the owner's default may be the member's model`

/** The host's own save was itself replaced before the restore could see it: as above, and the file is named. */
const replacedAfterTheSwitch = (place: OwnersDefaultPlace): string =>
  `the model in ${place.file} was changed again before the switch could be put back, so nothing was written back and the owner's default may be the member's model`

/** A file that changed after the switch: the record's hash no longer describes it, so nothing is written over it. */
const changedAfterTheSwitch = (place: OwnersDefaultPlace): string =>
  `${place.file} changed after the switch, so nothing was put back and the owner's default is theirs to set`

/** No file to finish a switch on: the file the save was seen in is gone, so there is nothing left to put back. */
const noFileToFinish = (place: OwnersDefaultPlace): string =>
  `${place.file} is gone, so the model a switch left there could not be put back`

/** What a launch hands the finishing below: this member, the crew's own store, where the owner's default lives, and the
 * row the launch writes for the member — or no place at all, when the launch could not name the owner's settings file. */
export interface TheOwnersDefaultAtLaunch {
  readonly member: string
  readonly host: SwitchingHost
  /** Where the owner's default lives, or the host's own refusal to name it: a launch that cannot name the file it would
   * have to undo made no switch, so there is no record to finish. */
  readonly owners: OwnersDefaultPlace | Refused
  readonly beats: DashboardStore
}

/**
 * Step 7 at a launch, before the member's host starts (martha#359): a switch that was recorded and never put back is put
 * back here, by the hash the record kept, or the owner is told why it was not. The record says what became of it either
 * way, so nothing is left claiming work that was done, and the line that needs the owner goes into the member's own row
 * as well as back to the caller, so the dashboard says it and not only the terminal.
 *
 * A launch that could name no owner's settings file finishes nothing: there is no record it could have written, because
 * a switch is refused before it starts when the file it would have to undo cannot be named.
 */
export async function finishTheOwnersDefaultAtLaunch(at: TheOwnersDefaultAtLaunch): Promise<readonly string[]> {
  if ('refusal' in at.owners) return []
  const place = modelPlace(at.host)
  if ('refusal' in place) return []
  const current = theModelOf(place, at.member)
  if (current.kind === 'unreadable') return []
  const marker = current.kind === 'switched' ? current.marker : current.last_marker
  if (marker === null || marker.settings === undefined) return []
  const after = await finishAnUnfinishedSwitch(at.owners, marker.settings)
  theOwnersDefaultKept(at.host, at.member, marker, after.record)
  if (after.why === '') return []
  keepTheOwnerNeedInTheRow(at, after.why)
  return [after.why]
}

/** The line that needs the owner, in the member's own row, so the dashboard says it rather than only the terminal. */
function keepTheOwnerNeedInTheRow(at: TheOwnersDefaultAtLaunch, why: string): void {
  const held = at.beats.read(at.member)
  if (held === null) return
  at.beats.keep({ ...held, at: Date.now(), needs: why })
}
