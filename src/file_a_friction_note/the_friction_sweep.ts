// The sweep of the crew's friction notes (martha#318, ported from crew-code's `sweepFriction`, register.tsx:2531): a
// note whose issue has closed is not friction still waiting, so the crew's index drops it.
//
// Every FRICTION_SWEEP_INTERVAL_MS, one pass at a time, the member the crew's work is routed to asks each note's issue
// state by number and drops the ones that are closed. A gh that fails removes nothing: an issue whose state cannot be
// read is not a closed issue, and dropping it would hide work the crew still has.

import { MINUTE_MS, sameMemberName, type CrewSettings } from '../declare_crew/declare_crew.ts'
import type { CrewPlace, CrewStore, Processes } from '../host_contract/host_contract.ts'
import { theNudgesGoTo } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { THE_NOTES_FILE, theNotesIn, theNotesText, theNotesWithout, type AFiledNote, type TheNotesFiled } from './friction_note.ts'
import { FRICTION_PLACE } from './the_friction_tool.ts'

/** How often the notes are swept: at most once per window, and never two at once. */
export const FRICTION_SWEEP_INTERVAL_MS = 10 * MINUTE_MS

/** What a sweep is handed: the crew's store, the checkout gh runs in, this member, and the declaration read afresh. */
export interface TheNotesSweepAsked {
  readonly crew: CrewStore
  readonly root: string
  readonly member: string
  readonly processes?: Processes
  /** The declaration as it stands at this sweep, read again each time so an edited one takes effect without a relaunch. */
  readonly settings: () => Promise<CrewSettings | { readonly refused: string }>
}

/**
 * The sweep of the crew's friction notes: at most once per FRICTION_SWEEP_INTERVAL_MS, and never two at once. It returns
 * its stop, as the owner's list's sweep does.
 */
export function startSweepingTheNotes(asked: TheNotesSweepAsked): () => void {
  if (asked.processes === undefined) return () => undefined
  let sweeping = false
  const timer = setInterval(() => {
    if (sweeping) return
    sweeping = true
    void sweepTheNotes(asked).finally(() => {
      sweeping = false
    })
  }, FRICTION_SWEEP_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}

/**
 * One pass: the keys of the notes it dropped. Only the member the crew's work is routed to sweeps, so a crew asks
 * GitHub once a window, not once per session; a launch that holds no processes sweeps nothing.
 */
export async function sweepTheNotes(asked: TheNotesSweepAsked): Promise<readonly string[]> {
  const owed = await theNotesThisMemberSweeps(asked)
  if (owed === null) return []
  const closed: string[] = []
  for (const [key, note] of Object.entries(owed.notes)) {
    if (await closedTheIssue(asked, note)) closed.push(key)
  }
  if (closed.length === 0) return []
  owed.place.keep(THE_NOTES_FILE, theNotesText(theNotesWithout(owed.notes, closed)))
  return closed
}

/**
 * The notes this launch owes a sweep, or null when it is not the member to sweep them: a launch that holds no
 * processes, a declaration that cannot be read, a member the crew's work is not routed to, or a store that will not
 * answer each sweep nothing.
 */
async function theNotesThisMemberSweeps(asked: TheNotesSweepAsked): Promise<{ readonly place: CrewPlace; readonly notes: TheNotesFiled } | null> {
  if (asked.processes === undefined) return null
  const settings = await asked.settings()
  if ('refused' in settings) return null
  if (!theNudgesGoTo(settings).some((name) => sameMemberName(name, asked.member))) return null
  const place = asked.crew.place(FRICTION_PLACE)
  if ('refusal' in place) return null
  const held = place.read(THE_NOTES_FILE)
  if (held === undefined || 'refusal' in held) return null
  return { place, notes: theNotesIn(held.text) }
}

/** Whether a note's issue has closed: false when gh could not say, since an issue nobody could read is not a closed one. */
async function closedTheIssue(asked: TheNotesSweepAsked, note: AFiledNote): Promise<boolean> {
  if (asked.processes === undefined) return false
  const ran = await asked.processes
    .run({ command: 'gh', args: ['issue', 'view', String(note.issue), '-R', note.repo, '--json', 'state'], cwd: asked.root })
    .catch(() => null)
  if (ran === null || ran.exit_code !== 0) return false
  try {
    const held = JSON.parse(ran.stdout.trim() || '{}') as { state?: unknown }
    return typeof held.state === 'string' && held.state.toUpperCase() === 'CLOSED'
  } catch {
    return false
  }
}
