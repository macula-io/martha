// The `see_the_crew` tool (martha#254, #320, #443 part 5): its name, what it is for, and what the pane is answered.
//
// Every member's row, in the declaration's order, and the nudges this member is told under them. The nudges run here, in
// the launcher's own process, and nothing here acts on what it finds: a nudge says what it sees, and whoever reads it
// decides. The tools slice (../a_crews_tools) keeps only the table that calls this.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { Processes, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { readTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { landingsOf } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { headNudges, nudgesOf, packagesNamedIn, theNudgesGoTo, theNudgesPartLines, theWaitsTheClosesLeave, windowsOf, type SentMessage, type WhatEndsAWait } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { theParkedMembers } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { theBacklogReaderIn } from '../find_the_unheld_work/keep_the_backlog_read.ts'
import { theUnheldNudgesFor } from '../nudge_an_idle_crew/nudge_an_idle_crew.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { GITHUB_BUDGET_PLACE, theClosesOfTheWaits, theClosesRecorded, theGithubSpenderOf, theHeadsOfTheWaits, type AHead } from '../spend_the_github_budget/spend_the_github_budget.ts'
import { deadlockNudges } from '../watch_waits/watch_waits.ts'
import { READER_BEAT_MS, seeTheCrew, thePaneAnsweredBy } from './see_the_crew.ts'

/** The name the pane is read under; nothing but this file's own tool record names it, so it is not exported. */
const SEE_THE_CREW = 'see_the_crew'

/** What `see_the_crew` says it is for: every row, in the declaration's order, and what has gone quiet. */
export const SEE_THE_CREW_DESCRIPTION = "Every member's row of this crew, in the declaration's order, with what has gone quiet marked."

/** What `see_the_crew` takes, as the mod registers it: nothing. */
export const SEE_THE_CREW_TOOL = {
  name: SEE_THE_CREW,
  description: SEE_THE_CREW_DESCRIPTION,
  inputSchema: { type: 'object', properties: {} },
}

/** What the pane is answered over: this crew's declaration, this member, its rows, and the places its nudges are read in. */
export interface SeeTheCrewAsked {
  readonly settings: CrewSettings
  readonly member: string
  /** Every member's row, by name, as the launcher laid them out in the declaration's order. */
  readonly rows: Readonly<Record<string, DashboardRow>>
  readonly ledger: LedgerHost
  readonly stores: TheCrewFilesStores
  readonly root: string
  readonly processes?: Processes
  readonly now: number
}

/** `see_the_crew`: the pane as words — its header, one line per member, and how many rows it asks for — with the nudges. */
export async function seeTheCrewOver(asked: SeeTheCrewAsked): Promise<{ readonly answer: string }> {
  const seen = seeTheCrew(asked.settings, asked.rows, asked.now)
  const nudges = await theNudgesFor(asked)
  return { answer: JSON.stringify(thePaneAnsweredBy(seen, asked.settings.house_rules.dashboard, READER_BEAT_MS, nudges)) }
}

/**
 * The nudges this member is told, as the lines its pane draws (martha#320), or none: a crew that reads no nudges, and a
 * member the mode's table grants nobody's work to, are told nothing.
 */
async function theNudgesFor(asked: SeeTheCrewAsked): Promise<readonly string[]> {
  const { settings } = asked
  if (!settings.house_rules.nudges) return []
  const receivers = theNudgesGoTo(settings)
  if (!receivers.some((receiver) => receiver.toLowerCase() === asked.member.toLowerCase())) return []
  const channel = await readTheChannel(asked.ledger)
  const messages: SentMessage[] = channel.map(({ message }) => ({ from: message.from, to: message.to, text: message.text, sent_at: message.sent_at }))
  const waits = await theWaitsTheClosesLeave(messages, receivers, await whatEndsAWaitIn(asked, messages))
  const input = { rows: Object.values(asked.rows), waits, parked: theParkedMembers({ stores: asked.stores }, settings.members.map((member) => member.name)), windows: windowsOf(settings.house_rules), now: asked.now, owner: settings.owner, receivers }
  const heads = await theHeadsOfTheWaiters(asked, waits)
  const unheld = await theUnheldNudgesFor({ backlog: settings.backlog, members: settings.members.map((member) => member.name), reader: theBacklogReaderIn(asked), rows: input.rows, parked: input.parked, receivers })
  return theNudgesPartLines(nudgesOf(input, [...deadlockNudges(input), ...headNudges(waits, heads), ...unheld]), settings)
}

/** What ends a wait besides the channel's lines, for nudge_the_supervisor to apply (martha#415): the landings the ledgers
 * keep, the closes the budget's record holds, and GitHub's reader of new ones when this launch holds processes. */
async function whatEndsAWaitIn(asked: SeeTheCrewAsked, messages: readonly SentMessage[]): Promise<WhatEndsAWait> {
  const landings = await landingsOf(asked.ledger, packagesNamedIn(messages))
  const recorded = theClosesRecorded(asked.stores.crew.place(GITHUB_BUDGET_PLACE))
  if (asked.processes === undefined) return { landings, recorded }
  const spender = theGithubSpenderOf({ stores: asked.stores, root: asked.root, processes: asked.processes, clock: asked.ledger.clock })
  return { landings, recorded, read: (packages) => theClosesOfTheWaits(spender, packages) }
}

/**
 * The heads the crew's waiting packages stand at, read through the crew's GitHub budget (martha#320, package B), or
 * none when this launch holds no processes to ask with. A read GitHub cannot answer leaves the head it last showed, so
 * the flag a failed read cannot clear is the one that was true.
 */
async function theHeadsOfTheWaiters(asked: SeeTheCrewAsked, waits: readonly { readonly package: string }[]): Promise<Readonly<Record<string, AHead>>> {
  if (asked.processes === undefined || waits.length === 0) return {}
  const spender = theGithubSpenderOf({ stores: asked.stores, root: asked.root, processes: asked.processes, clock: asked.ledger.clock })
  const heads = await theHeadsOfTheWaits(spender, waits.map((wait) => wait.package))
  return 'refusal' in heads ? {} : heads
}
