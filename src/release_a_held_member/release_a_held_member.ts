// The owner's release of a member the gate is holding (martha#321).
//
// This exists so an owner whose gate is holding a member can let that member work again without throwing its session
// away. One act, typed at the owner's own terminal, clears the member's whole record once, and writes nothing else.
//
// WHY THE TERMINAL, AND WHY NO TOOL. A member's shell tool runs with no terminal on its input, so a gate that refuses
// the shell refuses this too: `martha release` is refused where there is no terminal, exactly as `martha approve` is.
// There is no crew tool and no act in the declaration's table for it — the release is the owner's, and the model it
// frees cannot reach it.
//
// WHY THE WHOLE RECORD. Not a chosen subset: the member cannot be asked which arrivals are safe, because deciding is
// the model's job and the model is what the gate exists to protect against (the same reason ../refuse_execution_after_
// ungated_text has no dismiss). The decision moves to the one party the gate guards the owner against the model with.
//
// WHAT IT WRITES is one mark on `release-of:<session>` (../apply_the_owners_release), never on the session's own
// record: that stream has exactly one writer, the member's launcher, and a second writer would leave the member
// refused or lost. The count travels in the mark and reaches the owner; the text of what was cleared never does.
//
// The residual, said plainly (martha#619; Raf, 2026-11-18, "Speed bumps, said plainly"): a member runs as the owner's
// own OS user. Martha refuses this act typed from inside a member (../refuse_an_owner_act_from_inside_a_member) and
// denies Martha's state to a member's file tools, but these are speed bumps, not a wall: a member that sets out to could
// still fake the owner's release, by making a terminal of its own outside its process tree or by writing the release
// stream directly with its shell. No check inside the same OS user closes that, and this slice does not pretend to.

import { sameMemberName } from '../declare_crew/declare_crew.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { Row, RowStore } from '../host_contract/host_contract.ts'
import { GATE_GENERATION, OWNER_AT_THE_TERMINAL, type Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { recordOf, sessionRecordStreamOf } from '../session_records_in_rows/session_records_in_rows.ts'
import { RECORD_LOST } from '../take_in_a_turn/take_in_a_turn.ts'
import type { GateMode } from '../read_the_gate_mode/read_the_gate_mode.ts'
import { markOf, releaseMarkFor, releaseStreamOf, staleReleaseMarkFor, type ReleaseMark } from '../apply_the_owners_release/apply_the_owners_release.ts'

/** What the owner typed, and what the release needs to answer it. */
export interface ReleaseAsked {
  /** The member the owner named, as they typed it. */
  readonly member: string
  /** The members the crew declares: a name the declaration does not know releases nothing. */
  readonly members: readonly string[]
  /** This member's dashboard row, which is the only member-to-live-session lookup there is. */
  readonly row: DashboardRow | null
  /** The crew's row streams: the session records and the release streams among them. */
  readonly rows: RowStore
  /** Whether the act was typed on a terminal, the one thing that makes it the owner's. */
  readonly onATerminal: boolean
  /** What the gate does to this member now, so a release of a member nothing holds can say so. */
  readonly gate: GateMode
  /** The moment the mark records; the system clock unless a test gives its own. */
  readonly now?: () => number
  /**
   * `--stale` (martha#987): release only what a gate older than `generation` recorded, and keep what it recorded itself.
   * Absent, the whole record is released, as before.
   */
  readonly stale?: boolean
  /** The generation `--stale` judges against: this gate's, unless a test names another. */
  readonly generation?: number
}

/** The act, and what the owner is told for it. */
export type TheRelease =
  | {
      readonly released: true
      readonly member: string
      readonly session: string
      readonly cleared: number
      /** For `--stale` (martha#987): how many arrivals this gate recorded still hold the member after the release. */
      readonly still_held?: number
    }
  | { readonly released: false; readonly refusal: string }

/** Why a release is refused where no owner is at the keyboard. */
export const A_RELEASE_NEEDS_THE_OWNERS_TERMINAL =
  'only the owner, at a terminal, releases a held member, and this is no terminal.'

const refused = (refusal: string): TheRelease => ({ released: false, refusal })

/**
 * Releases the member the owner named: one mark on its session's release stream, clearing the whole record it holds.
 *
 * Each refusal is its own answer, and writes nothing: no terminal, a member the declaration does not know, a member
 * with no live session, and a record that cannot be read or holds no arrival.
 */
export async function releaseAHeldMember(asked: ReleaseAsked): Promise<TheRelease> {
  if (!asked.onATerminal) return refused(A_RELEASE_NEEDS_THE_OWNERS_TERMINAL)
  const member = asked.members.find((name) => sameMemberName(name, asked.member))
  if (member === undefined) {
    return refused(`the declaration does not know ${asked.member}, so nothing was released (its members are ${asked.members.join(', ')}).`)
  }
  const session = asked.row?.session ?? ''
  if (session === '') return refused(`${member} has no live session, so nothing is holding it and nothing was released.`)
  const held = await whatHoldsIt(asked, member, session)
  if (typeof held === 'string') return refused(held)
  return asked.stale === true ? keepTheStaleRelease(asked, member, session, held) : keepTheRelease(asked, member, session, held)
}

/**
 * The `--stale` release (martha#987): one mark clearing what an older gate recorded at the head of what is still held.
 * The owner's earlier releases are read strictly here: a release stream that cannot be read could hold a release this
 * mark would undo, so it refuses rather than reads as none.
 */
async function keepTheStaleRelease(asked: ReleaseAsked, member: string, session: string, raw: readonly Ingestion[]): Promise<TheRelease> {
  const marks = await theReleasesStrictly(asked.rows, session)
  if (typeof marks === 'string') return refused(`${member}'s earlier releases cannot be read (${marks}), so nothing was released.`)
  const mark = staleReleaseMarkFor(raw, marks, asked.generation ?? GATE_GENERATION, OWNER_AT_THE_TERMINAL, asked.now ?? Date.now)
  if (mark === undefined) return refused(`${member} holds nothing an older gate recorded at the head of its record, so nothing was released.`)
  const kept = await keepTheMark(asked, member, session, mark)
  return kept.released ? { ...kept, still_held: raw.length - mark.through } : kept
}

/**
 * `martha release --stale` with no member named (martha#987, crew-code's "One menu clears all", DECIDED 2026-11-07):
 * the stale release for every member the crew declares, one answer each. A member with no live session, or nothing an
 * older gate recorded, answers with its refusal and writes nothing.
 */
export async function releaseEveryMembersStale(asked: Omit<ReleaseAsked, 'member' | 'row' | 'gate' | 'stale'> & {
  readonly rowOf: (member: string) => DashboardRow | null
  readonly gateOf: (member: string) => GateMode
}): Promise<readonly TheRelease[]> {
  if (!asked.onATerminal) return [refused(A_RELEASE_NEEDS_THE_OWNERS_TERMINAL)]
  const answers: TheRelease[] = []
  for (const member of asked.members) {
    answers.push(await releaseAHeldMember({ ...asked, member, row: asked.rowOf(member), gate: asked.gateOf(member), stale: true }))
  }
  return answers
}

/** Every release kept for this session, or why the stream cannot be read. */
async function theReleasesStrictly(rows: RowStore, session_id: string): Promise<readonly ReleaseMark[] | string> {
  try {
    const stored = await rows.read(releaseStreamOf(session_id))
    return stored.flatMap(({ row }) => {
      const mark = markOf(row)
      return mark === undefined ? [] : [mark]
    })
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error)
  }
}

/** The arrivals the release would clear, or the refusal that says why there is nothing to release. */
async function whatHoldsIt(asked: ReleaseAsked, member: string, session: string): Promise<readonly Ingestion[] | string> {
  const raw = await theRawRecord(asked.rows, session)
  if (typeof raw === 'string') return `${member}'s record cannot be read (${raw}), so nothing was released.`
  if (raw.length > 0) return raw
  const off = asked.gate === 'off' ? ' The gate is off for this member, so nothing was holding it either.' : ''
  return `${member}'s record holds no arrival, so nothing was holding it and nothing was released.${off}`
}

/** One mark clearing the record, or the refusal that says it could not be kept. */
async function keepTheRelease(asked: ReleaseAsked, member: string, session: string, raw: readonly Ingestion[]): Promise<TheRelease> {
  return keepTheMark(asked, member, session, releaseMarkFor(raw, OWNER_AT_THE_TERMINAL, asked.now ?? Date.now))
}

/** The mark appended to the session's release stream, or the refusal that says it could not be kept. */
async function keepTheMark(asked: ReleaseAsked, member: string, session: string, mark: ReleaseMark): Promise<TheRelease> {
  try {
    await asked.rows.append(releaseStreamOf(session), mark as unknown as Row)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    return refused(`the release of ${member} could not be kept (${typeof code === 'string' ? code : String(error)}), so it was not released.`)
  }
  return { released: true, member, session, cleared: mark.cleared }
}

/** The record `martha release` clears: the whole of what this session has taken in. */
async function theRawRecord(rows: RowStore, session_id: string): Promise<readonly Ingestion[] | string> {
  let stored
  try {
    stored = await rows.read(sessionRecordStreamOf(session_id))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error)
  }
  const last = stored.at(-1)
  if (last === undefined) return []
  const record = recordOf(last.row)
  return record.ingested.some((ingest) => ingest.path === RECORD_LOST.path) ? 'it reads as lost' : record.ingested
}

/** What the owner reads for this release: the count and what the member may do again, never the text. */
export function toldOfARelease(release: TheRelease): string {
  if (!release.released) return release.refusal
  const oneOrMore = release.cleared === 1 ? '1 arrival' : `${release.cleared} arrivals`
  if (release.still_held === undefined) return `Released ${release.member}: cleared ${oneOrMore} from its record, and its shell runs again.`
  const after =
    release.still_held === 0
      ? 'nothing else holds it, and its shell runs again'
      : release.still_held === 1
        ? '1 arrival this gate recorded still holds it'
        : `${release.still_held} arrivals this gate recorded still hold it`
  return `Released what an older gate recorded for ${release.member}: cleared ${oneOrMore}; ${after}.`
}
