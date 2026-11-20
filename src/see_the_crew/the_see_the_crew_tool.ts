// The `see_the_crew` tool (martha#254, #320, #443 part 5): its name, what it is for, and what the pane is answered.
//
// Every member's row, in the declaration's order, and the nudges this member is told under them, among them the packages
// a failed act paused (martha#512), read from the ledgers of the packages the rows hold and the crew's lines name. The nudges run here, in
// the launcher's own process, and nothing here acts on what it finds: a nudge says what it sees, and whoever reads it
// decides. The tools slice (../a_crews_tools) keeps only the table that calls this.

import { BUDGET_LINE_LABEL, theBudgetLineOf } from '../keep_what_a_session_spent/the_crews_budget.ts'
import { sameMemberName } from '../declare_crew/declare_crew.ts'
import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { Processes, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { readTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { landingsOf } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { WORK_PACKAGE } from '../log_ledger/log_ledger.ts'
import { driftNudges, headNudges, nudgesOf, packagesNamedIn, repoDriftNudges, theNudgesGoTo, theNudgesPartLines, theWaitsTheClosesLeave, windowsOf, type Nudge, type SentMessage, type WhatEndsAWait } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { theDriftOf, type APackagesDrift } from '../read_a_crew_line/the_drift_on_a_package.ts'
import { theParkedMembers } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { theBacklogReaderIn } from '../find_the_unheld_work/the_backlog_reader_of_a_launch.ts'
import { theUnheldNudgesFor } from '../nudge_an_idle_crew/nudge_an_idle_crew.ts'
import { thePausedNudges } from '../recover_a_failed_act/resume_a_paused_package.ts'
import type { DashboardRow } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { GITHUB_BUDGET_PLACE, theClosesOfTheWaits, theClosesRecorded, theGithubSpenderOf, theHeadsOfTheWaits, type AHead } from '../spend_the_github_budget/spend_the_github_budget.ts'
import { theDriftReadToday } from '../spend_the_github_budget/the_repos_numbers.ts'
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
  return { answer: JSON.stringify(thePaneAnsweredBy(seen, asked.settings.house_rules.dashboard, READER_BEAT_MS, [...theBudgetPart(asked), ...nudges])) }
}

/**
 * The budget line the pane draws under the members (martha#990): the crew's newest weekly reading and the reviewer
 * gauge, or nothing before any reading. A measurement for the owner; nothing is done by it.
 */
function theBudgetPart(asked: SeeTheCrewAsked): readonly string[] {
  const line = theBudgetLineOf(asked.stores.crew, asked.settings.house_rules.review_model, asked.now)
  return line === '' ? [] : [`${BUDGET_LINE_LABEL} ${line}`]
}

/**
 * The nudges this member is told, as the lines its pane draws (martha#320), or none: a crew that reads no nudges, and a
 * member the mode's table grants nobody's work to, are told nothing.
 */
async function theNudgesFor(asked: SeeTheCrewAsked): Promise<readonly string[]> {
  return theNudgesPartLines(await theNudgeListFor(asked, true), asked.settings)
}

/** What a turn's look at the nudges is asked over: the pane's places, with no processes to ask GitHub with. */
export type ATurnsLookAsked = Omit<SeeTheCrewAsked, 'processes'>

/**
 * The nudges a turn of this member is handed (martha#984): the pane's own list, read from what is recorded only. No
 * processes are handed, so no wait, head or backlog is asked of GitHub, and the idle clock is read but not kept, so the
 * look writes nothing. A wait only GitHub could close may then show until the pane's next look reads it.
 */
export async function theNudgesOfATurn(asked: ATurnsLookAsked): Promise<readonly Nudge[]> {
  // Taken off at run time too: an object the type lets through may still carry the launch's processes.
  const { processes: _never, ...recorded } = asked as SeeTheCrewAsked
  return theNudgeListFor(recorded, false)
}

/**
 * The nudges themselves, before they are printed, or none: a crew that reads no nudges, and a member the mode's table
 * grants nobody's work to, are told nothing. `keeps_the_clock` is the pane's, and a turn keeps none (martha#984).
 */
async function theNudgeListFor(asked: SeeTheCrewAsked, keeps_the_clock: boolean): Promise<readonly Nudge[]> {
  const { settings } = asked
  if (!settings.house_rules.nudges) return []
  const receivers = theNudgesGoTo(settings)
  if (!receivers.some((receiver) => sameMemberName(receiver, asked.member))) return []
  const channel = await readTheChannel(asked.ledger)
  const messages: SentMessage[] = channel.map(({ message }) => ({ from: message.from, to: message.to, text: message.text, sent_at: message.sent_at }))
  const waits = await theWaitsTheClosesLeave(messages, receivers, await whatEndsAWaitIn(asked, messages))
  const input = { rows: Object.values(asked.rows), waits, parked: theParkedMembers({ stores: asked.stores }, settings.members.map((member) => member.name)), windows: windowsOf(settings.house_rules, settings.thresholds), now: asked.now, owner: settings.owner, receivers }
  const heads = await theHeadsOfTheWaiters(asked, waits)
  const unheld = await theUnheldNudgesFor({ backlog: settings.backlog, members: settings.members.map((member) => member.name), reader: theBacklogReaderIn({ ...asked, github: settings.github, clock_zone: settings.clock_zone }), rows: input.rows, parked: input.parked, receivers, offline_ms: input.windows.offline_ms, keeps_the_clock })
  const packages = [...input.rows.map((row) => row.holds), ...packagesNamedIn(messages)]
  const paused = await thePausedNudges(asked.ledger, packages)
  const drifts = await theDriftsIn(asked, packages)
  const repos = await theReposDriftIn(asked, packages)
  return nudgesOf(input, [...deadlockNudges(input), ...headNudges(waits, heads), ...unheld, ...paused, ...driftNudges(drifts, settings.house_rules), ...repos])
}

/**
 * The drift each package the crew's rows hold or its own lines name shows (martha#1010), read from that package's
 * ledger: the two numbers a package is nudged about are its own, so no crew-wide count is made up for it.
 */
async function theDriftsIn(asked: SeeTheCrewAsked, packages: readonly string[]): Promise<readonly APackagesDrift[]> {
  return Promise.all([...new Set(packages.filter((package_name) => WORK_PACKAGE.test(package_name)))].map((package_name) => theDriftOf(asked.ledger, package_name)))
}

/** The repo a package names: `org/repo#n`, read as `org/repo`. */
const theRepoNamedIn = (package_name: string): string => package_name.slice(0, package_name.indexOf('#'))

/**
 * The drift each repo the week's packages name shows (martha#1010's addendum): the three numbers their daily record
 * keeps, read once a day through the crew's budget, nudged as a rise against the same number a week earlier or against
 * a fixed line the owner set. A launch holding no processes to ask with, and a crew naming no package, ask GitHub
 * nothing and read no repo drift.
 */
async function theReposDriftIn(asked: SeeTheCrewAsked, packages: readonly string[]): Promise<readonly Nudge[]> {
  const repos = [...new Set(packages.filter((package_name) => WORK_PACKAGE.test(package_name)).map(theRepoNamedIn))]
  if (asked.processes === undefined || repos.length === 0) return []
  const spender = theGithubSpenderOf({ stores: asked.stores, root: asked.root, processes: asked.processes, clock: asked.ledger.clock, github: asked.settings.github, clock_zone: asked.settings.clock_zone })
  const record = await theDriftReadToday(spender, repos, asked.now, asked.settings.house_rules.issue_untouched_days)
  return repoDriftNudges(record, asked.now, asked.settings.house_rules)
}

/** What ends a wait besides the channel's lines, for nudge_the_supervisor to apply (martha#415): the landings the ledgers
 * keep, the closes the budget's record holds, and GitHub's reader of new ones when this launch holds processes. */
async function whatEndsAWaitIn(asked: SeeTheCrewAsked, messages: readonly SentMessage[]): Promise<WhatEndsAWait> {
  const landings = await landingsOf(asked.ledger, packagesNamedIn(messages))
  const recorded = theClosesRecorded(asked.stores.crew.place(GITHUB_BUDGET_PLACE))
  if (asked.processes === undefined) return { landings, recorded }
  const spender = theGithubSpenderOf({ stores: asked.stores, root: asked.root, processes: asked.processes, clock: asked.ledger.clock, github: asked.settings.github, clock_zone: asked.settings.clock_zone })
  return { landings, recorded, read: (packages) => theClosesOfTheWaits(spender, packages) }
}

/**
 * The heads the crew's waiting packages stand at, read through the crew's GitHub budget (martha#320, package B), or
 * none when this launch holds no processes to ask with. A read GitHub cannot answer leaves the head it last showed, so
 * the flag a failed read cannot clear is the one that was true.
 */
async function theHeadsOfTheWaiters(asked: SeeTheCrewAsked, waits: readonly { readonly package: string }[]): Promise<Readonly<Record<string, AHead>>> {
  if (asked.processes === undefined || waits.length === 0) return {}
  const spender = theGithubSpenderOf({ stores: asked.stores, root: asked.root, processes: asked.processes, clock: asked.ledger.clock, github: asked.settings.github, clock_zone: asked.settings.clock_zone })
  const heads = await theHeadsOfTheWaits(spender, waits.map((wait) => wait.package))
  return 'refusal' in heads ? {} : heads
}
