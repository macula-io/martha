// The workspace drift a launch tells the owner about (martha#562 package 2).
//
// A launch scans the workspace it was given once its host is up and folds what it finds into the member's row. The scan
// is started here and never awaited, so a launch never waits on it; a scan that rejects is one line on the row, never a
// failed launch and never an unhandled rejection. The row keeps one line for what needs the owner, so the scan's line
// waits for a tick on which it can be taken, exactly as a miss does.
//
// This is a slice and not the program `npm run check:workspace-layout` runs (../check_the_workspace_layout), which an
// adapter may not import: the launch reports what the same scan finds, it does not run that program.

import { theDriftInTheWorkspace } from '../check_the_workspace_matches_its_layout/check_the_workspace_matches_its_layout.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { theRowWithTheLine, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The one line the scan leaves, when it found something: the first drift is the one a reader fixes first, and the row
 * keeps one line. Nothing when the workspace matches its layout. */
const theScanLine = (lines: readonly string[]): string | null => {
  const first = lines[0]
  if (first === undefined) return null
  return lines.length === 1
    ? `the workspace drifts from its layout: ${first}`
    : `the workspace drifts from its layout in ${String(lines.length)} places, the first being: ${first}`
}

/** What the row says when the scan could not be made: the launch goes on, and the owner is told what was not looked at. */
const THE_SCAN_FAILED = 'the workspace could not be scanned: run npm run check:workspace-layout by hand'

/** A scan of the workspace a launch was given: the drift lines it found, or a rejection the launch reports and goes on
 * past. Testable through the folder below, which takes one in place of the scan it runs. */
export type TheScanOfTheWorkspace = (workspace: TheWorkspace) => Promise<readonly string[]>

/** The scan a launch runs: the slice, over this machine's tree and git, with the places the crew declared. */
const theScanOf: TheScanOfTheWorkspace = (workspace: TheWorkspace) =>
  theDriftInTheWorkspace({ files: thisMachine.stores.files, processes: thisMachine.processes, workspace })

/** Nothing to fold: a crew that declared no layout, or a launch given none. */
const NOTHING_TO_FOLD = (): void => {}

/** The tick's other work: the scan a launch started once its host was up, folded into the member's row on the tick the
 * launcher already keeps. The scan is started here and never awaited, so a launch never waits on it; a scan that
 * rejects is one line on the row, never a failed launch and never an unhandled rejection. */
export function aFolderOfTheScan(
  workspace: TheWorkspace | undefined,
  member: string,
  beats: DashboardStore,
  scan: TheScanOfTheWorkspace = theScanOf,
): () => void {
  if (workspace === undefined) return NOTHING_TO_FOLD
  let line: string | null = null
  let wrote = ''
  void scan(workspace).then(
    (lines) => (line = theScanLine(lines)),
    () => (line = THE_SCAN_FAILED),
  )
  return () => {
    const held = line
    if (held === null || held === wrote) return
    if (beats.change(member, (row) => (row === null ? null : theRowWithTheLine(row, { wrote, line: held, at: Date.now() }))).kept) wrote = held
  }
}

/** The tick's work, both halves: the misses a guard left, and the scan of the workspace, folded on the same tick. */
export const aTickOfTheRowsWork = (theMisses: () => void, theScan: () => void): (() => void) => () => (theMisses(), theScan())
