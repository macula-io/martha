// The crew strip (martha#572 part 1): `martha crew`, the whole crew in a few lines, redrawn while it runs.
//
// This exists so an owner sees every member, and which one waits on them, from whichever terminal is in front. The
// strip draws the crew reader's answer (../see_the_crew) and nothing else: the same header and member lines the Claude
// Code Crew pane shows, so the strip and the pane never disagree about a member. `offline` and "needs you" are the
// reader's words; this slice decides neither.
//
// The strip runs in any terminal. Launching it as a split in each member's kitty tab, and setting that tab's title
// through remote control, are the kitty host's (#547 S6): it hands its title setter in through `title`, and the
// strip calls it only when the title changed.

import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import type { CrewGoal } from '../declare_crew/declare_crew.ts'
import { READER_BEAT_MS, seeTheCrew, thePaneAnsweredBy, type CrewCounts, type CrewRow, type TheDeclaredCrew } from '../see_the_crew/see_the_crew.ts'
import { theTitleToSet } from '../title_a_members_tab/title_a_members_tab.ts'

/** The strip opens by itself wherever it is launched; the pane's own open-at-start switch is not the strip's to read. */
const THE_STRIP_IS_OPEN = true

/** The frame the strip draws for the reader's answer: the pane's goal and header, then one line per member. */
export function theStripFrame(seen: { readonly rows: readonly CrewRow[]; readonly counts: CrewCounts; readonly goal?: CrewGoal | null }): readonly string[] {
  const pane = thePaneAnsweredBy(seen, THE_STRIP_IS_OPEN, READER_BEAT_MS)
  return [pane.goal, pane.header, ...pane.lines]
}

/** What the strip is drawn over: the crew, its rows as the launchers beat them, a clock, and where it draws. */
export interface TheStripsSeam {
  readonly crew: TheDeclaredCrew
  /** Every member's row as its launcher last beat it, by member. */
  readonly beats: () => Readonly<Record<string, DashboardRow>>
  readonly clock: { now(): number }
  /** Draws one whole frame in place of the last. */
  readonly draw: (frame: readonly string[]) => void
  /** Sets the title of the strip's own member's tab, when a host can (#547 S6). */
  readonly title?: { readonly member: string; readonly set: (text: string) => void }
  /** Resolves after `ms`, or at once when the strip is stopped. */
  readonly wait: (ms: number) => Promise<void>
}

/** What one look at the crew left: the frame drawn and the title set, so the next look redraws only a change. */
export interface TheStripDrawn {
  readonly frame: string | undefined
  readonly title: string | undefined
}

/** Nothing drawn yet. */
export const NOTHING_DRAWN: TheStripDrawn = { frame: undefined, title: undefined }

/** One look at the crew: asks the reader, and draws the frame and sets the title each only when it changed. */
export function drawOnce(seam: TheStripsSeam, last: TheStripDrawn): TheStripDrawn {
  const seen = seeTheCrew(seam.crew, seam.beats(), seam.clock.now())
  const frame = theStripFrame(seen)
  const joined = frame.join('\n')
  if (joined !== last.frame) seam.draw(frame)
  if (seam.title === undefined) return { frame: joined, title: last.title }
  const title = theTitleToSet(seen.rows, seam.title.member, last.title)
  if (title !== undefined) seam.title.set(title)
  return { frame: joined, title: title ?? last.title }
}

/** Draws the strip every reader interval until `stopped` is aborted. */
export async function drawTheStrip(seam: TheStripsSeam, stopped: AbortSignal): Promise<void> {
  let last = NOTHING_DRAWN
  while (!stopped.aborted) {
    last = drawOnce(seam, last)
    await seam.wait(READER_BEAT_MS)
  }
}
