// The `report_where_the_work_stands` tool (martha#254, #443 part 5): what it takes, and what a report does to the row.
//
// The tool is the only one a member is given a schema for that answers nothing of its own: a report moves this member's
// row, and the member is told what landed. The row is written through the writer the tools slice hands in, so the one
// place a row is written stays where it is and this slice decides only what the report says.

import { A_PACKAGE } from '../keep_the_ledger/the_ledger_tools.ts'
import { returnedForAnotherPackage, type TheTriggerPlace } from '../switch_a_members_model/the_switch_tools.ts'
import { theRowWithNothingSaid, type DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { REPORT_WHERE_THE_WORK_STANDS, REPORT_WHERE_THE_WORK_STANDS_DESCRIPTION, takeProgress, type TheCrew } from './report_where_the_work_stands.ts'

/** What `report_where_the_work_stands` takes, as the mod registers it. */
export const REPORT_PROGRESS_TOOL = {
  name: REPORT_WHERE_THE_WORK_STANDS,
  description: REPORT_WHERE_THE_WORK_STANDS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      task: { type: 'string', description: 'The task, short, naming the outcome' },
      step: { type: 'integer', minimum: 0, description: 'Steps completed so far' },
      of: { type: 'integer', minimum: 1, description: 'Total steps, your best current estimate' },
      phase: { type: 'string', enum: ['working', 'reviewing'], description: 'reviewing while you review work, working when you are back at it' },
      waiting_on: { type: 'string', description: "What you now wait on: 'ci', 'owner', 'supervisor', or a crew member's name" },
      waiting_for: { type: 'string', description: 'What you wait for (a HANDOFF, a verdict, a menu, a yes); required when waiting_on names a person' },
      package: A_PACKAGE,
    },
    required: ['task', 'step', 'of'],
  },
}

/** What a report is handed: this crew, this member, the row it last had, and the writer the launcher keeps. */
export interface ReportProgressAsked {
  readonly crew: TheCrew
  readonly member: string
  /** The row this session last had, read by the launcher: what a report carries over is its own. */
  readonly held: DashboardRow | null
  readonly now: number
  /** The one writer of the member's row, which this slice decides the change for. */
  readonly keepTheRow: (change: (row: DashboardRow) => DashboardRow) => void
  /** Where a switch is recorded, for the return a report makes when it names another package (martha#315). */
  readonly switching: TheTriggerPlace
}

/** What the tool answers: the line the member is told, and the return a switch makes of it. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** `report_where_the_work_stands`: the report's own rules move the row, and the member is told what landed. */
export async function reportProgressOver(asked: ReportProgressAsked, args: Readonly<Record<string, unknown>>): Promise<AToolAnswer> {
  // What a report carries over — the waits and what it holds — is this session's own, read from the row it last had.
  const before = asked.held ?? theRowWithNothingSaid()
  const report = takeProgress(args, asked.crew, { waits: before.waits, holds: before.holds }, asked.now)
  asked.keepTheRow((row) => ({
    ...row,
    state: report.taken.state,
    task: report.taken.task,
    progress: report.taken.progress,
    waits: report.taken.waits,
    holds: report.taken.holds,
    reported_at: report.taken.reported_at,
  }))
  const home = await returnedForAnotherPackage(asked.switching, report.taken.holds)
  return { answer: home === null ? report.told : `${report.told} ${home}` }
}
