// `see_the_crew`: every member's row, in the declaration's order, with what has gone quiet said as gone quiet
// (martha#254).
//
// This exists so the owner's pane and any later reader ask one slice what the crew looks like, and so the answer is
// the same everywhere: one row per member of the declaration, never one per session or per beat, and a member that
// never beat reads idle rather than working. `offline` is the reader's word about a row that has gone quiet — no
// writer records it — so a session that dies leaves a row that says so within one interval instead of a row
// claiming work it is not doing.

import { BEAT_INTERVAL_MS, IDLE, OFFLINE, OFFLINE_AFTER_MS, STATES, type DashboardRow, type HostFacts, type ShownState, type Waits } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** One member's row as a reader is shown it. */
export interface CrewRow {
  readonly member: string
  readonly session: string
  readonly state: ShownState
  readonly holds: string
  readonly task: string
  readonly progress: { readonly step: number; readonly of: number }
  readonly waits: Waits | null
  readonly needs: string
  readonly host: HostFacts
  /** When the row was last beaten, or null for a member that never beat. */
  readonly at: number | null
  /** How long the row has been quiet, in milliseconds; null for a member that never beat. */
  readonly quiet_for: number | null
}

/** What the pane's header counts. */
export interface CrewCounts {
  readonly members: number
  /** Members whose row is younger than OFFLINE_AFTER_MS. */
  readonly online: number
  readonly working: number
  readonly waiting: number
  readonly needs_you: number
}

/** The declaration, as this slice needs it: the crew's members, in the order the declaration names them. */
export interface TheDeclaredCrew {
  readonly members: readonly { readonly name: string }[]
}

/** Every member's row, in the declaration's order, and the counts a header shows. */
export function seeTheCrew(crew: TheDeclaredCrew, beats: Readonly<Record<string, DashboardRow>>, now: number): { readonly rows: readonly CrewRow[]; readonly counts: CrewCounts } {
  const rows = crew.members.map((member) => rowOf(member.name, beats[member.name], now))
  return { rows, counts: countsOf(rows) }
}

/** One member's row: its beat, or the row a member that never beat reads as. */
function rowOf(member: string, beat: DashboardRow | undefined, now: number): CrewRow {
  if (beat === undefined) {
    return {
      member,
      session: '',
      state: IDLE,
      holds: '',
      task: '',
      progress: { step: 0, of: 1 },
      waits: null,
      needs: '',
      host: { model: '', provider: '', contextPercent: null, costUsd: null },
      at: null,
      quiet_for: null,
    }
  }
  const quiet_for = Math.max(0, now - beat.at)
  const state: ShownState = quiet_for > OFFLINE_AFTER_MS ? OFFLINE : beat.state
  return {
    member,
    session: beat.session,
    state,
    holds: beat.holds,
    task: beat.task,
    progress: beat.progress,
    waits: beat.waits,
    needs: beat.needs,
    host: beat.host,
    at: beat.at,
    quiet_for,
  }
}

function countsOf(rows: readonly CrewRow[]): CrewCounts {
  // Online is the header's own word about a row being fresh, which is what CrewCounts says it is: a member whose row
  // is younger than OFFLINE_AFTER_MS, whatever that row says it is doing (r=1 R2: a live member that has reported
  // nothing has a row, and it reads idle, so counting only the working states would drop it from the crew's size).
  const online = rows.filter((row) => row.at !== null && row.state !== OFFLINE)
  return {
    members: rows.length,
    online: online.length,
    working: online.filter((row) => row.state === 'working' || row.state === 'reviewing').length,
    waiting: online.filter((row) => row.state === 'waiting').length,
    needs_you: online.filter((row) => row.state === 'needs-you').length,
  }
}

/** The states a reader can show, so a pane draws one of these and nothing else. */
export const SHOWN_STATES: readonly ShownState[] = [...STATES, OFFLINE]

/** The beat interval a reader counts a row's quiet against, as the writer's own constant. */
export const READER_BEAT_MS = BEAT_INTERVAL_MS
