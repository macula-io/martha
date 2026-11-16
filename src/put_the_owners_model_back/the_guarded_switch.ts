// The owner's default, guarded while a switch runs and put back after it (martha#359, #443 part 5): the order that makes
// a switch real, the guard taken before it goes out, and the put-back that finishes it.
//
// A switch is an order the mod carries out at the end of the turn (../refresh_a_member/the_refresh_flow.ts
// `CARRY_A_MODEL`), so the host's own model command cannot run inside the turn that asked for it. This file decides what
// that order is, takes the owner's settings file's lock before it goes out, and puts the owner's default back once the
// host reports — the record of what was not put back is the row's, so a switch the file refused cannot be lost. The tools
// slice (../a_crews_tools) keeps only the table that calls this, and the one writer of the row.

import type { Refused } from '../host_contract/host_contract.ts'
import { CARRY_A_MODEL, type TheOrder } from '../refresh_a_member/the_refresh_flow.ts'
import type { TheOwnersDefaultTold } from '../show_dashboard_beat/show_dashboard_beat.ts'
import {
  modelPlace,
  theModelOf,
  theOwnersDefaultKept,
  theSwitchDirected,
  theSwitchRefused,
  type ModelMarker,
} from '../switch_a_members_model/switch_a_members_model.ts'
import type { TheTriggerPlace } from '../switch_a_members_model/the_switch_tools.ts'
import {
  guardTheOwnersDefault,
  putTheOwnersModelBack,
  theSaveInTheFile,
  theSaveSeenNow,
  theSaveThatNeverShowed,
  type AGuardedSwitch,
  type OwnersDefaultPlace,
  type TheSaveSeen,
} from './put_the_owners_model_back.ts'

/**
 * What the session holds of a guarded switch (martha#359): the owner's settings one switch has guarded and not yet put
 * back, and what the owner's file needs of the owner for the turn's one row write.
 */
export interface AGuardedSession {
  /**
   * The lock it holds, the record to keep, and the file's bytes as they were. It is taken when the order goes out and
   * released when the host reports, so a second switch waits for it rather than building its record on the first one's
   * half-finished work.
   */
  guarded: AGuardedSwitch | null
  /**
   * A reason and the line the row said before it, so a switch that was not put back is said once, in the row the turn
   * already writes, and a finished one takes its own line away. It is folded into that write rather than written
   * beside it: a beat taken at the same clock value as the row already there is dropped whole.
   */
  owner_needs: TheOwnersDefaultTold | null
}

/** What an order is decided over: where the switch is recorded, the owner's file, and what the session holds of a guard. */
export interface AnOrderAsked extends TheTriggerPlace {
  readonly owners: OwnersDefaultPlace | Refused | undefined
  readonly session: AGuardedSession
}

/**
 * The order that makes a recorded switch real, or null when there is nothing to direct (martha#315): one exact shape,
 * `{carry: 'model', model}`, which the mod answers with the host's own model command once the turn has ended. The
 * record is marked directed before the order goes back, so the same switch is not handed over twice.
 *
 * Every model in a record is one the declaration names, because a switch is refused for a member that declares none
 * (r=2), so there is no model here that cannot be spelled as the host's command argument.
 */
export async function theModelOrder(asked: AnOrderAsked): Promise<TheOrder | null> {
  const place = modelPlace(asked)
  if ('refusal' in place) return null
  const current = theModelOf(place, asked.member)
  if (current.kind === 'unreadable') return null
  const marker = current.kind === 'switched' ? current.marker : current.last_marker
  if (marker === null || marker.directed) return null
  // One switch at a time (martha#359, R2): a switch whose host report has not come back yet still holds the owner's
  // lock, and this one waits for a later turn rather than against itself.
  if (asked.session.guarded !== null) return null
  return await guardedOrder(asked, marker)
}

/**
 * The order, with the owner's default guarded first (martha#359): the lock taken and the file snapshotted before the
 * order goes out, and the record kept beside the model record before the host runs anything. A guard that cannot be
 * taken refuses the switch — the record goes back to where the member is, and the owner reads why in its row.
 *
 * A record an earlier switch left open goes to the guard with it (r=2): this switch is then built on the owner's own
 * model rather than on the member's, which is what the file says while that record is open.
 */
async function guardedOrder(asked: AnOrderAsked, marker: ModelMarker): Promise<TheOrder | null> {
  const owners = asked.owners
  if (owners === undefined) return refuseTheSwitch(asked, marker, noOwnersSettings(asked))
  if ('refusal' in owners) return refuseTheSwitch(asked, marker, owners.refusal)
  // The model the host is asked to save: the one save this switch waits for, and the one it may have to undo.
  const model = marker.switched ? marker.model : marker.home
  const guard = await guardTheOwnersDefault(owners, model, marker.settings)
  if ('refusal' in guard) return refuseTheSwitch(asked, marker, guard.refusal)
  const kept = theOwnersDefaultKept(asked, asked.member, marker, guard.record)
  if ('refusal' in kept) {
    guard.lock.release()
    return null
  }
  const directed = theSwitchDirected(asked, asked.member, kept)
  if ('refusal' in directed) {
    guard.lock.release()
    return null
  }
  asked.session.guarded = guard
  return { carry: CARRY_A_MODEL, model }
}

/** A switch the launcher will not make, in the member's own row: the member stayed where it was, and the owner is told. */
function refuseTheSwitch(asked: AnOrderAsked, marker: ModelMarker, why: string): null {
  theSwitchRefused(asked, asked.member, marker, why, new Date(asked.ledger.clock.now()))
  asked.session.owner_needs = { why, before: [] }
  return null
}

/** Why a switch is refused when the launch cannot name the owner's settings file: the one file it would have to undo. */
const noOwnersSettings = (asked: AnOrderAsked): string =>
  `this launch cannot name the settings file Claude Code saves a model into, so a switch to ${asked.member} could not be undone and none was made`

/**
 * Steps 4 to 6 of a switch (martha#359), in the launcher's own process: wait for the file to show the host's save, keep
 * the record before the restore, put the owner's model back when nothing else moved, and give the lock back. A switch
 * whose save never showed keeps its record: the next launch finishes it by the hash the record holds.
 */
export async function theOwnersDefaultPutBack(asked: AnOrderAsked): Promise<TheOwnersDefaultTold> {
  const guard = asked.session.guarded
  asked.session.guarded = null
  const owners = asked.owners
  if (guard === null || owners === undefined || 'refusal' in owners) return { why: '', before: [] }
  try {
    return theOwnersDefaultAnswered(asked, owners, guard, await theSaveInTheFile(owners, guard))
  } finally {
    guard.lock.release()
  }
}

/**
 * A guard whose report never came, closed at the next turn's question (martha#359): one look at the file, the restore
 * if the host's save is there, and the record kept when it is not, so the next launch finishes what this session
 * cannot. The lock is given back either way, so a host that never reports does not stop every later switch.
 */
export async function closeTheGuardNoOneReported(asked: AnOrderAsked): Promise<TheOwnersDefaultTold> {
  const guard = asked.session.guarded
  asked.session.guarded = null
  const owners = asked.owners
  if (guard === null || owners === undefined || 'refusal' in owners) return { why: '', before: [] }
  try {
    const told = theOwnersDefaultAnswered(asked, owners, guard, theSaveSeenNow(owners, guard) ?? theSaveThatNeverShowed(owners, guard))
    asked.session.owner_needs = told
    return told
  } finally {
    guard.lock.release()
  }
}

/** The restore itself, over one guarded switch and what the file showed of it: the record kept, and the row's line. */
function theOwnersDefaultAnswered(
  asked: AnOrderAsked,
  owners: OwnersDefaultPlace,
  guard: AGuardedSwitch,
  seen: TheSaveSeen,
): TheOwnersDefaultTold {
  const place = modelPlace(asked)
  if ('refusal' in place) return { why: seen.why, before: [] }
  const current = theModelOf(place, asked.member)
  const marker = current.kind === 'switched' ? current.marker : current.kind === 'home' ? current.last_marker : null
  if (marker === null) return { why: seen.why, before: [] }
  const before = linesTheRowMaySay(marker.settings?.why ?? '', guard)
  if (!seen.moved) {
    theOwnersDefaultKept(asked, asked.member, marker, seen.record)
    return { why: seen.why, before }
  }
  const after = putTheOwnersModelBack(owners, guard, seen.record)
  theOwnersDefaultKept(asked, asked.member, marker, after.record)
  return { why: after.why, before }
}

/**
 * Every line this switch is answerable for in the row (martha#359 r=3): the line its own record carries, and the line an
 * open record it settled left there. The two differ when the guard's recovery refused and wrote a fresh reason over the
 * open one — the row keeps the older line until the switch that settled the record takes it away.
 */
const linesTheRowMaySay = (fromTheRecord: string, guard: AGuardedSwitch): readonly string[] =>
  fromTheRecord === guard.settled ? [fromTheRecord] : [fromTheRecord, ...(guard.settled === undefined ? [] : [guard.settled])]
