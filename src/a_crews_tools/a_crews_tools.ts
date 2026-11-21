// The tools a member of a crew can call, and the one place their answers are decided (martha#254).
//
// This exists so the mod that runs in the member's session registers the tools and the launcher answers them: the
// session can draw and post, and nothing that decides anything runs inside it. Every tool here is a name, an
// argument object, and an answer the slice behind it gives — `report_where_the_work_stands` and `see_the_crew` over the dashboard
// rows, `log_a_milestone`, `what_was_sent` and `note_what_became_of_an_act` over the ledger.
//
// The row a member's beat writes is the launcher's own state: the report moves it, and a heartbeat keeps it fresh at
// BEAT_INTERVAL_MS so a pane can tell a working member from a session that has died. The heartbeat runs here, in the
// launcher, and writes the same row the report wrote, so nothing but this slice ever folds a beat in.
//
// Since #443 part 5 this file is the wiring: each tool's name, description, schema and decision live in the slice that
// owns it (the design's table, section 5 of the issue), and what stays here is the imports, the type that lists every
// tool, the state one place's tools hold between calls, the handler table and the answers the mod asks for by name —
// the refresh flow's question among them, which reads the launch's every place and so cannot leave this file.

import { declareCrew, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { holdingTheEnds, type TheEndsHold } from '../end_a_running_turn/hold_the_end.ts'
import { answerAChannelAsk, type MessageCarrier } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { theLineToHandAtStart, type TheStartLine } from '../hand_a_member_its_crew_text/the_start_line.ts'
import { theCrewStateOfATurn } from '../hand_a_member_its_crew_text/the_crew_state_of_a_turn.ts'
import type { DocumentStore, HandoverStampStore, HostContract, Refused, TheCrewFilesStores, ToolNames } from '../host_contract/host_contract.ts'
import { VERIFY_RANGE_TOOL, verifyTheRangeOver } from '../check_a_range_before_the_owner_says_yes/the_verify_range_tool.ts'
import { theRangeACallNames } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { THE_CHANNEL_READ_ASK, theChannelReadAsk } from '../keep_the_crew_channel/the_channel_read.ts'
import { LOG_A_MILESTONE_TOOL, NOTE_WHAT_BECAME_TOOL, WHAT_WAS_SENT_TOOL, logTheMilestone, noteTheActsOutcome, whatTheMemberSent } from '../keep_the_ledger/the_ledger_tools.ts'
import { RELEASE_THE_FILES_TOOL, releaseTheFilesAKilledRunLeft, thePathsOf } from '../release_what_a_killed_run_left/release_what_a_killed_run_left.ts'
import { KEEP_THE_CONTRACT_TOOL, keepTheContract } from '../keep_the_package_contract/the_contract_tools.ts'
import { theNewestContractOrWhy } from '../keep_the_package_contract/keep_the_package_contract.ts'
import { THE_OWNERS_TODO_ASK, addAnAct, closeAnAct } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { OWNER_TODO_ADD_TOOL, OWNER_TODO_DONE_TOOL, keepTheOwnersList, startSweeping, theOwnersTodoAsk } from '../keep_the_owners_todo_list/the_todo_tools.ts'
import { closeAStandingItem, recordAStandingItem } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { STANDING_ADD_TOOL, STANDING_CLOSE_TOOL, STANDING_TOOL, keepTheStandingItems, theStandingToolOver } from '../keep_the_supervisors_standing_items/the_standing_tools.ts'
import { FAST_FORWARD_TOOL, LAND_BATCH_TOOL, fastForwardOntoTheApprovedTipOver, landTheBatchOver } from '../land_passed_work_as_one_batch/the_landing_tools.ts'
import { theFastForwardACallNames, theLandingACallNames } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { finishAWorktree, openAWorktree, type WorktreesRequest } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { WORKTREE_FINISH_TOOL, WORKTREE_OPEN_TOOL, theWorktreeToolOver } from '../open_and_finish_a_worktree/the_worktree_tools.ts'
import { parkAMember, parkedPlace, theParkOf, theParkedMembers, unparkAMember } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { THE_WAKE_ASK, WAKE_PLACE, theWakeFor } from '../wake_an_idle_member/wake_an_idle_member.ts'
import { theHostsReadingIn } from '../keep_what_a_session_spent/the_hosts_usage.ts'

import { PARK_A_MEMBER_TOOL, WAKE_A_MEMBER_TOOL, theParkToolOver, type AParkAsked } from '../park_and_wake_a_member/the_park_tools.ts'
import type { AGuardedSwitch, OwnersDefaultPlace } from '../put_the_owners_model_back/put_the_owners_model_back.ts'
import { closeTheGuardNoOneReported, theModelOrder, theOwnersDefaultPutBack } from '../put_the_owners_model_back/the_guarded_switch.ts'
import { menusTheLauncherKeeps, type ACallAnswered, type TheOwnersMenus } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import {
  LIST_ASKS_TOOL,
  QUEUE_ASK_TOOL,
  SETTLE_ASKS_TOOL,
  TAKE_ASKS_TOOL,
  listTheOwnersAsks,
  queueTheAsk,
  theSettlingOfTheAsks,
  theTakeOfTheAsks,
} from '../queue_the_owners_asks/the_ask_tools.ts'
import { refreshesPlace, theFlowOf } from '../refresh_a_member/refresh_a_member.ts'
import {
  CONTRACT_ACTS,
  theActsOfACall,
  type AContractAct,
  type AReadableCall,
} from '../refuse_calls_outside_the_package_contract/the_acts_of_a_call.ts'
import type { TheContractHanded } from '../refuse_calls_outside_the_package_contract/refuse_a_call_outside_the_contract.ts'
import { THE_BUDGET_ASK, keepTheWeekly, theBudgetCommandAnswer, theBudgetCommandIn } from '../keep_what_a_session_spent/the_crews_budget.ts'
import {
  THE_REFRESH_ASK,
  aSwitchMayFollow,
  askAMemberToRefresh,
  theOrderOf,
  theQuestionIn,
  theRefreshAct,
  type TheAct,
  type TheRefreshPlaces,
  type TheSessionsQuestion,
} from '../refresh_a_member/the_refresh_flow.ts'
import { REPORT_PROGRESS_TOOL, reportProgressOver } from '../report_where_the_work_stands/report_progress_tool.ts'
import { theBudgetOver, theSpendOnARow, type TheBudgetAsACrewHoldsIt } from '../hold_a_package_to_its_budget/the_budget_tools.ts'
import type { ASpendInForce } from '../hold_a_package_to_its_budget/refuse_a_call_past_the_budget.ts'
import type { TheCrew } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { type ASpawnedAgent, theReviewRuleOver, type TheReviewRule } from '../run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts'
import { theNudgesGoTo } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { seeTheCrew } from '../see_the_crew/see_the_crew.ts'
import { SEE_THE_CREW_TOOL, seeTheCrewOver } from '../see_the_crew/the_see_the_crew_tool.ts'
import { WHO_IS_FREE_TOOL, whoIsFreeOver } from '../see_who_is_free/who_is_free_tool.ts'
import { UNHELD_WORK_TOOL, unheldWorkOver } from '../find_the_unheld_work/unheld_work_tool.ts'
import { theBacklogReaderIn } from '../find_the_unheld_work/the_backlog_reader_of_a_launch.ts'
import { SAY_TO_THE_CREW_TOOL, sayToTheCrewOver } from '../send_a_crew_message/say_to_the_crew_tool.ts'
import { GH_MS } from '../send_a_crew_message/the_runs_a_handoff_names.ts'
import {
  BEAT_INTERVAL_MS,
  SPEND_FIELD,
  beatAfter,
  rowAfterASwitch,
  theRowWithNothingSaid,
  type AUnitOnARow,
  type DashboardRow,
  type DashboardStore,
  type TheOwnersDefaultTold,
} from '../show_dashboard_beat/show_dashboard_beat.ts'
import { READ_THE_RECEIPTS_TOOL, theReceiptsOver } from '../show_what_a_message_became/the_receipts_tool.ts'
import { theGithubSpenderOf } from '../spend_the_github_budget/spend_the_github_budget.ts'
import type { StoppingHost } from '../stop_and_restart_a_member/stop_and_restart_a_member.ts'
import { RESTART_A_MEMBER_TOOL, theRestartToolOver } from '../stop_and_restart_a_member/the_restart_tool.ts'
import { RETURN_TO_YOUR_OWN_MODEL_TOOL, SWITCH_YOUR_MODEL_TOOL, returnToYourOwnModelOver, switchTheModelOver } from '../switch_a_members_model/the_switch_tools.ts'
import { theBeatOverTheCrewTools, theBeatsMarkedOn, withTheOwedLine, withTheTimesLineOnAReturn, type AHandedWindow, type HoldingTheWatch, type TheWindowPlaces } from '../keep_a_members_crew_tools_window/heed_the_crew_tools.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { theRootsInForce } from '../tell_a_citer_of_a_volatile_path/volatile_paths.ts'
import { WAIT_FOR_CI_TOOL, theCiWaitACallNames, theCiWaitOver } from '../wait_for_ci/the_ci_wait_tool.ts'
import { WRITE_MY_HANDOVER_SCHEMA, theHandoverToolOver } from '../write_my_handover/the_handover_tool.ts'
import { NO_MODEL_NAMED, type ModelVocabulary } from '../declare_crew/a_hosts_model_vocabulary.ts'
import { FILE_A_FRICTION_NOTE_TOOL, fileAFrictionNote } from '../file_a_friction_note/the_friction_tool.ts'
import { startSweepingTheNotes } from '../file_a_friction_note/the_friction_sweep.ts'
import { anOrderOver, beatsOf, theAsksAsked, theOfferingAsked, theOwnersListAsked, theStandingAsked, triggerPlaceOf } from './the_places_a_tool_is_decided_over.ts'
import type { AUsageHost } from '../keep_what_a_session_spent/keep_what_a_session_spent.ts'

/**
 * The name the refresh tool is registered under (martha#343). It is the tool a member calls, and not the word a
 * refreshed session is recorded with: the SessionStart source value keeps a name of its own,
 * `THE_REFRESH_THE_MOD_RUNS`, whose value is `martha_refresh` since #468 took crew-code's tool name off it.
 */
export const REFRESH_THIS_SESSION = 'refresh_this_session'

/** What the mod asks under to say which model the session now runs on, once the host's command resolved (martha#315). */
export const THE_MODEL_REPORT_ASK = 'note_the_model_the_session_runs'

/** What `refresh_this_session` says it is for: a member told to refresh asks for one, and hands over at its next turn's end. */
export const CREW_REFRESH_DESCRIPTION =
  'Ask to be refreshed, when the owner or the Supervisor tells you to. The session hands over and is cleared at the end of this turn, and the reason you give is kept on the crew’s row.'

/** What `refresh_this_session` takes, as the mod registers it. */
const REFRESH_THIS_SESSION_TOOL = {
  name: REFRESH_THIS_SESSION,
  description: CREW_REFRESH_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: { reason: { type: 'string', description: 'Why you are refreshing, in one line: the owner reads it on the row' } },
    required: ['reason'],
  },
}

/**
 * The name the mod asks under for the tools to register (martha#254): the launcher owns their names, their
 * descriptions and their schemas, and the mod holds no copy of any of them, so a description that quotes a constant
 * quotes the one the slice defines.
 */
export const THE_TOOLS_ASK = 'the_crews_tools'

/** A tool as the mod registers it: its name, what it is for, and the schema of what it takes. */
export interface CrewTool {
  readonly name: CrewToolName
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** The answer to a tool call: what the slice said, or why the name is not one the crew has. */
export type CoreToolAnswer = { readonly answer: string } | { readonly refused: string }

/** What a tool's call named, read by the slice that owns the tool: what it names, or why the call is refused. */
type AnAsked<Asked> = { readonly ok: Asked } | { readonly refused: string }

/**
 * What the tools are given: whose row it is, where the crew's place is, and how the declaration is read; and what the
 * host adapter reads of its sessions' crew tools (martha#658), so a launch given none keeps no window.
 */
export interface CrewToolPlaces extends Pick<TheWindowPlaces, 'served_tools'> {
  readonly member: string
  /** The crew's streams: the ledger and the session records. */
  readonly ledger: LedgerHost
  /** The crew's dashboard rows: one per member, kept by the host (../dashboard_rows_directory/dashboard_rows_directory). */
  readonly beats: DashboardStore
  /** The checkout the crew is declared in. */
  readonly root: string
  readonly documents: DocumentStore
  /** The crew's own store: the park marker this member keeps, and the handovers a wake reads (../park_and_wake_a_member). */
  readonly stores: TheCrewFilesStores
  /**
   * The host's own processes: the tools that read a range, land a batch or move a worktree run git and gh through
   * these, so nothing that acts runs inside the member's session (martha#256). A place that holds none refuses
   * those five by name rather than pretending to act.
   */
  readonly processes?: HostContract['processes']
  /**
   * The sink a line about an act the tools carried on past is said through (martha#601): the launcher's writer to the
   * process's own error output. Absent, nothing is said.
   */
  readonly note?: ((line: string) => void) | undefined
  /**
   * Where a restart is asked of a member's launcher (martha#312): the crew's lifecycle requests, the launch records and
   * the ledger. A launch given none refuses `restart_a_member` by name.
   */
  readonly lifecycle?: StoppingHost
  /** The crew's declaration, whose workspace places the two worktree tools read (martha#256). */
  readonly settings?: CrewSettings
  /**
   * The models the host runs, as its adapter records them (martha#315): the declaration is read back against them, so a
   * crew whose `review_model` the host cannot spell is refused by name. A place given none names no model, and a
   * declaration naming one is then refused — nothing here invents a model list.
   */
  readonly models?: ModelVocabulary
  /** The host a session's usage is kept under (martha#999 package 5): an engine launch names its own; Claude Code when none. */
  readonly usage_host?: AUsageHost
  /** The model this member was launched on (martha#315): what its row says until a switch is confirmed. */
  readonly launched_on?: string
  /**
   * How this host spawns a subagent (martha#315): which tool, and which of its arguments say what the agent is and
   * which model runs it, as the adapter records it. A place given none holds no review to the crew's reviewer model.
   */
  readonly spawn?: ASpawnedAgent
  /**
   * The owner's own settings file, and where the one lock that guards it lives (martha#359): the file the host's model
   * command saves the switched model into as the owner's default. A launch given none refuses a switch by name, because
   * a switch that cannot be put back would leave the owner's every new session on the member's model.
   */
  readonly owners_settings?: OwnersDefaultPlace | Refused
  /**
   * What hands this member the crew's messages it has not taken in (martha#253). The mod asks for one each time it
   * starts and after each turn; a launch given none refuses the ask rather than answering an empty channel.
   */
  readonly carrier?: MessageCarrier
  /** Where the host keeps the stamps its handovers carry (martha#255). A launch given none writes no handover. */
  readonly stamps?: HandoverStampStore
  /** The sessions this launch took in, by id: what a handover is stamped with, and the predecessor a refresh inherits. */
  readonly sessions?: { readonly of: (session_id: string) => HostSession | undefined }
  /**
   * What this launcher keeps of the menus its host closed (martha#313): a settle of the owner's asks is refused unless a
   * menu closed in the session that took the batch. A launch given none settles no batch, and says so.
   */
  readonly menus?: TheOwnersMenus
  /** The share each session began at, by session id: kept here, so every threshold is measured from where it started. */
  readonly began_at?: Map<string, number>
  /**
   * The roots a reboot deletes on this machine (martha#314), for a crew whose declaration names none: derived by the
   * adapter that launches, from the OS, and handed in here rather than written into a slice. A place given none holds
   * no machine root, so the note then names only what the declaration names.
   */
  readonly volatile_roots?: readonly string[]
  /**
   * What the workspace guard refuses of a git call a member's shell is about to run (martha#562, seam a): the adapter
   * that asks git hands the refusal here, so the relay asks the crew once. A place given none refuses nothing, and a
   * crew that declared no workspace layout hands none.
   */
  readonly refusesTheGitCall?: (call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }) => Promise<string | undefined>
  /**
   * What the workspace guard refuses of a git call the launch's own `git` was handed (martha#562, seam b): the words a
   * member's shell gave the shim, and the directory it runs them in. A place given none refuses nothing, and a crew that
   * declared no workspace layout hands none.
   */
  readonly refusesTheGitOnThePath?: (call: { readonly directory: string; readonly args: readonly string[] }) => Promise<string | undefined>
  /**
   * What the workspace guard refuses of the refs a clone's transaction would update (martha#562, seam c): a delete of
   * another member's branch that reached git past the shell and past the shim. A place given none refuses nothing.
   */
  readonly refusesTheRefUpdate?: (updates: readonly { readonly ref: string; readonly deletes: boolean }[]) => string | undefined
  /**
   * What the killed-run record refuses of a hand-off (martha#719): a `say_to_crew` whose first line is a HANDOFF line,
   * while a leftover the record kept still stands where the record says it stands. A place given none refuses nothing,
   * and a crew that declared no workspace layout hands none.
   */
  readonly refusesTheHandOff?: (call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }) => Promise<string | undefined>
}

/** The tools a crew's member can call. */
export interface CrewTools extends TheReviewRule {
  readonly tools: readonly CrewTool[]
  /** Answers a tool call: the member's name is this launch's, the session's is the one the call came from. */
  answer(name: string, args: Readonly<Record<string, unknown>>, session: string): Promise<CoreToolAnswer>
  /** Starts the heartbeat, which keeps this member's row fresh; returns the stop. */
  startBeating(): () => void
  /**
   * Starts the sweeps this launch keeps (martha#316, #318): once every interval, the owner's list while this member may
   * keep it, and the crew's index of friction notes while this member is the one the crew's work is routed to. Returns
   * the stop of both.
   */
  startSweeping(): () => void
  /**
   * The line a session is handed, once, at its start: the Supervisor's standing items, when the table lets this member
   * assign work (martha#317), then every act of the package this member holds that was sent with no outcome recorded,
   * oldest first (martha#254 design, test 10). Null when there is neither. `taken_in` names the sources the line
   * carries that the session's record must take in, so the shell gate stands behind what the line handed. The starting
   * session's id is the host's own start event's, never the id of the last session that answered a tool (martha#658).
   */
  theLineToHandAtStart(session_id: string): Promise<TheStartLine | null>
  /**
   * The crew's state a turn of this member is handed (martha#984): the standing items and the nudges, read from what the
   * crew recorded and nothing else, when the table lets this member assign work. Null when nothing is handed. `taken_in`
   * names the source the session's record takes in before the text is answered.
   */
  theCrewStateOfATurn(): Promise<TheStartLine | null>
  /**
   * The start whose line that call built has been answered (martha#658 Done-when 4): a taken start marks the window
   * that hand read as handed to a successor, and a refused one drops the record unmarked, so the next start is handed
   * the beats. Either way nothing is kept for that session afterwards.
   */
  noteTheStart(session_id: string, taken: boolean): void
  /**
   * The session a clear was told in, when the crew's flow is waiting for its successor and this id is it (martha#255):
   * the launcher starts that session as a `martha_refresh` with this predecessor, whichever of the host's two events
   * names it first. Null when no clear is in flight, or when this id is the session the clear was told in.
   */
  thePredecessorOf(session_id: string): Promise<string | null>
  /**
   * What the package this member holds has spent of its budget (martha#513, slice 3): the units its newest contract
   * names and what was spent of each, read once for each session and package the member's row names and then answered
   * from memory. Undefined when the member holds no package, holds one with no bounded contract, or the crew could not
   * read what it spent.
   */
  theSpendInForce(session_id: string): Promise<ASpendInForce | undefined>
  /**
   * One more call counted against that package's budget, before the call runs (martha#513, slice 3): undefined when it
   * was kept, and the reason when it was not, for the launch's journal: the call runs either way (martha#601, row 113).
   */
  noteTheCallCounted(session_id: string, own_name: string): Promise<string | undefined>
  /**
   * The launcher saw the host answer one of this session's calls (martha#313): the menu tool's answer is what a settle
   * of the owner's asks stands on, so the relay hands every answer here, with the input the host posted, and the queue
   * decides which one is a menu and what the owner picked in it (martha#608).
   */
  noteTheCallsAnswer(call: ACallAnswered, session: string): void
  /**
   * The end of a running turn held at a tool boundary (martha#311, ruling D): the launcher's tool verdict asks it last,
   * so it only narrows a yes, and hands the end out on a yes to the last call in flight.
   */
  readonly ends: TheEndsHold
  /**
   * What the package this member holds says about this call (martha#513 slice 2): the package its own row holds, then
   * that package's newest contract in the ledger — read only for a call that is an act at all, since a contract has
   * nothing to say of any other. Undefined when it holds none, the package has no contract or one the ledger cannot read
   * back, or the call is no act. A call outside it runs, with a notice to its member (martha#601, row 110).
   */
  theContractInForce(call: AReadableCall, names: ToolNames): Promise<TheContractHanded>
  /**
   * What the workspace guard refuses of this call, before it runs (martha#562): the member's shell line read into its
   * git calls and judged against the crew's declared layout. Undefined when nothing refuses it — a call that is no git
   * call, or a crew that declared no layout. The asking is the adapter's, handed in by the place; a place given none
   * refuses nothing.
   */
  refusesTheGitIn?(call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }): Promise<string | undefined>
  /**
   * What the workspace guard refuses of a git call the launch's own `git` was handed (martha#562, seam b): the same
   * rules, asked from the shim's own words rather than from a shell line. Undefined when nothing refuses it, when the
   * crew declared no layout, or when a launch handed no guard of this seam at all.
   */
  refusesTheGitOnThePath?(call: { readonly directory: string; readonly args: readonly string[] }): Promise<string | undefined>
  /**
   * What the workspace guard refuses of a clone's ref transaction (martha#562, seam c): the refs git would update, and
   * whether each is a delete. Undefined when nothing refuses it, or when the crew declared no layout.
   */
  refusesTheRefUpdate?(updates: readonly { readonly ref: string; readonly deletes: boolean }[]): string | undefined
  /**
   * What the killed-run record refuses of a hand-off (martha#719): a `say_to_crew` whose first line is a HANDOFF line,
   * while a leftover it kept still stands where the record says it stands. Undefined when nothing refuses it, when the
   * crew declared no layout, or when a launch handed no guard of this place at all.
   */
  refusesTheHandOff?(call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }): Promise<string | undefined>
}

/** The tools, in the order the mod registers them, each as the slice that owns it defines it. */
const THE_TOOLS = [
  REPORT_PROGRESS_TOOL,
  LOG_A_MILESTONE_TOOL,
  RELEASE_THE_FILES_TOOL,
  WHAT_WAS_SENT_TOOL,
  NOTE_WHAT_BECAME_TOOL,
  KEEP_THE_CONTRACT_TOOL,
  SEE_THE_CREW_TOOL,
  WHO_IS_FREE_TOOL,
  UNHELD_WORK_TOOL,
  SAY_TO_THE_CREW_TOOL,
  READ_THE_RECEIPTS_TOOL,
  PARK_A_MEMBER_TOOL,
  WAKE_A_MEMBER_TOOL,
  RESTART_A_MEMBER_TOOL,
  SWITCH_YOUR_MODEL_TOOL,
  RETURN_TO_YOUR_OWN_MODEL_TOOL,
  WRITE_MY_HANDOVER_SCHEMA,
  REFRESH_THIS_SESSION_TOOL,
  VERIFY_RANGE_TOOL,
  LAND_BATCH_TOOL,
  FAST_FORWARD_TOOL,
  WORKTREE_OPEN_TOOL,
  WORKTREE_FINISH_TOOL,
  OWNER_TODO_ADD_TOOL,
  OWNER_TODO_DONE_TOOL,
  QUEUE_ASK_TOOL,
  LIST_ASKS_TOOL,
  TAKE_ASKS_TOOL,
  SETTLE_ASKS_TOOL,
  STANDING_ADD_TOOL,
  STANDING_CLOSE_TOOL,
  STANDING_TOOL,
  WAIT_FOR_CI_TOOL,
  FILE_A_FRICTION_NOTE_TOOL,
] as const

/** The names the crew's tools are registered under, and the only ones the launcher answers. */
export const CREW_TOOL_NAMES = THE_TOOLS.map((tool) => tool.name)
export type CrewToolName = (typeof THE_TOOLS)[number]['name']

/** The tools, as the mod registers them. */
export const CREW_TOOLS: readonly CrewTool[] = THE_TOOLS

export type { TheStartLine }

/** What one place's tools hold between calls: the row as this session last left it, and its session id. */
export interface SessionState {
  held: DashboardRow | null
  session: string
  /**
   * The model this member's row says it runs on (martha#315): the one the launch gave it, then the one a switch was
   * CONFIRMED on. Written when the session reports the host's model command resolved, never when the launcher answers
   * the tool, so the row never claims a switch the host has not made.
   */
  row_model: string
  /** The share each session began at, by session id (martha#255): every refresh threshold is measured from it. */
  readonly began_at: Map<string, number>
  /**
   * The owner's settings one switch has guarded and not yet put back (martha#359): the lock it holds, the record to
   * keep, and the file's bytes as they were. It is taken when the order goes out and released when the host reports, so
   * a second switch waits for it rather than building its record on the first one's half-finished work.
   */
  guarded: AGuardedSwitch | null
  /**
   * What the owner's file needs of the owner, for the turn's one row write (martha#359): a reason and the line the row
   * said before it, so a switch that was not put back is said once, in the row the turn already writes, and a finished
   * one takes its own line away. It is folded into that write rather than written beside it: a beat taken at the same
   * clock value as the row already there is dropped whole.
   */
  owner_needs: TheOwnersDefaultTold | null
  /** The one hold on the end of a running turn this launch keeps (martha#311). */
  readonly ends: TheEndsHold
  /**
   * The window each start's hand read, by the starting session's id (martha#658 Done-when 4): the beats are marked handed
   * only once the start is taken, and the record is dropped then, or dropped unmarked when the start is refused.
   */
  readonly start_hands: Map<string, AHandedWindow>
}

/**
 * What the package this member holds says about this call, or none when the launch has no crew to ask (martha#513
 * slice 2): the relay reads it after the gate, for the notice of an act the contract leaves out (martha#601, row 110).
 */
export async function theContractACrewHolds(
  crew: CrewTools | undefined,
  call: AReadableCall,
  names: ToolNames,
): Promise<TheContractHanded> {
  return crew === undefined ? undefined : crew.theContractInForce(call, names)
}

/**
 * The tools a member can call, over the place its launcher gave it. Places that hold the watch over the crew tools its
 * host served are answered tools holding that same watch (martha#710), so a launch's builder that leaves the watch out
 * of its places cannot compile; the type is the watch's own (../keep_a_members_crew_tools_window).
 *
 * The overload with the watch is declared first (martha#710). A call takes the first overload it matches, so places
 * holding a watch are answered tools holding it; and `ReturnType<typeof crewToolsOver>` reads the last one, the plain
 * CrewTools a test that builds no launch is handed. In the other order a builder that passes the watch would get plain
 * CrewTools back and fail to compile, and so would every test typed by ReturnType.
 */
export function crewToolsOver(places: HoldingTheWatch<CrewToolPlaces>): HoldingTheWatch<CrewTools>
export function crewToolsOver(places: CrewToolPlaces): CrewTools
export function crewToolsOver(places: CrewToolPlaces): CrewTools | HoldingTheWatch<CrewTools> {
  // The menus this launch's host closes, heard by its relay through noteTheCallsAnswer (martha#313): a settle of the
  // owner's asks stands on one, and a launch handed none keeps its own over the same clock.
  const held: CrewToolPlaces = { ...places, menus: places.menus ?? menusTheLauncherKeeps(places.ledger.clock) }
  const state: SessionState = {
    held: null,
    session: '',
    row_model: held.launched_on ?? '',
    began_at: held.began_at ?? new Map<string, number>(),
    ends: holdingTheEnds(),
    guarded: null,
    owner_needs: null,
    start_hands: new Map<string, AHandedWindow>(),
  }
  const handlers = handlersOver(held, state)
  // One budget over this launch's places (martha#513, slice 3): it reads a package's spend once per session and keeps
  // the tally, so the relay's every call costs one append and no read.
  const budget = theBudgetOver(held)

  return {
    ...(held.served_tools === undefined ? {} : { served_tools: held.served_tools }),
    tools: CREW_TOOLS,
    async answer(name: string, args: Readonly<Record<string, unknown>>, from: string): Promise<CoreToolAnswer> {
      state.session = from
      const asked = await answerAnAskOfTheMods(held, state, budget, name, args, from)
      if (asked !== undefined) return asked
      const handle = handlers[name as CrewToolName]
      if (handle === undefined) {
        return { refused: `${JSON.stringify(name)} is not a tool this crew registers (they are ${CREW_TOOL_NAMES.join(', ')})` }
      }
      return handle(args)
    },
    startBeating(): () => void {
      // A heartbeat says nothing of its own but the crew tools (martha#658): it is the row as this session last left it.
      const beat = theBeatOverTheCrewTools(held, () => state.session, (change) => writeRow(held, state, change))
      const timer = setInterval(() => {
        try {
          beat()
        } catch {
          // A beat the disk would not take is the next beat's business: the row it could not write stays readable.
        }
      }, BEAT_INTERVAL_MS)
      timer.unref()
      return () => clearInterval(timer)
    },
    startSweeping: () => startTheSweeps(held),
    theLineToHandAtStart: (session_id) => theStartLineOf(held, state, session_id),
    theCrewStateOfATurn: () => theCrewStateOf(held),
    noteTheStart: (session_id, taken) => noteTheStartIn(held, state, session_id, taken),
    thePredecessorOf: (session_id) => thePredecessorOf(held, session_id),
    theSpendInForce: (session_id) => budget.theSpendInForce(session_id),
    noteTheCallCounted: (session_id, own_name) => budget.noteTheCallCounted(session_id, own_name),
    ...theReviewRuleOver({ declared: () => crewOrRefusal(held), spawn: held.spawn }),
    noteTheCallsAnswer: (call, session) => held.menus?.noteTheCallsAnswer(call, session),
    ends: state.ends,
    theContractInForce: (call, names) => theContractTheMemberHolds(held, call, names),
    refusesTheGitIn: async (call) => (held.refusesTheGitCall === undefined ? undefined : held.refusesTheGitCall(call)),
    refusesTheGitOnThePath: async (call) => held.refusesTheGitOnThePath?.(call),
    refusesTheRefUpdate: (updates) => held.refusesTheRefUpdate?.(updates),
    refusesTheHandOff: async (call) => held.refusesTheHandOff?.(call),
  }
}

/**
 * What the package this member holds says about this call (martha#513 slice 2, martha#601), read from the two places
 * that already know it: the member's own dashboard row says which package it holds, and the package's ledger says which
 * contract it is on.
 *
 * The acts are read first, so a call that is no act reads no ledger. A package with no version, or a ledger that cannot
 * answer for it, comes back as none (martha#601, rows 109 and 111): the call runs, with nothing to notice.
 */
async function theContractTheMemberHolds(
  places: CrewToolPlaces,
  call: AReadableCall,
  names: ToolNames,
): Promise<TheContractHanded> {
  const held_package = places.beats.read(places.member)?.holds ?? ''
  if (held_package === '') return undefined
  if (theActsOfACall(call, held_package, names.ownNameOf).length === 0) return undefined
  // No contract, or one the ledger could not read back, gives nothing to compare the call with (martha#601, rows 109
  // and 111): the call runs and no notice is said.
  const read = await theNewestContractOrWhy(places.ledger, held_package)
  const newest = 'why' in read ? undefined : read.newest
  if (newest === undefined) return undefined
  const { version, contract } = newest
  const allowed: readonly AContractAct[] = contract.kind === 'bounded' ? CONTRACT_ACTS.filter((act) => contract.allowed.includes(act)) : []
  return { package: held_package, version, kind: contract.kind, allowed }
}

/**
 * The asks the mod makes on a session's behalf, never a model's: the tools to register, how often to read the channel,
 * what this session should do now, and what model it runs on. Undefined when `name` is one a member calls itself, which
 * the handlers answer.
 */
async function answerAnAskOfTheMods(
  places: CrewToolPlaces,
  state: SessionState,
  budget: TheBudgetAsACrewHoldsIt,
  name: string,
  args: Readonly<Record<string, unknown>>,
  from: string,
): Promise<CoreToolAnswer | undefined> {
  if (name === THE_TOOLS_ASK) return { answer: JSON.stringify(CREW_TOOLS) }
  if (name === THE_CHANNEL_READ_ASK) return await theChannelRead(places)
  if (name === THE_WAKE_ASK) return await theWakeOfThisSession(places, args)
  const channel = await answerAChannelAsk(places.carrier, name, args)
  if (channel !== undefined) return channel
  if (name === THE_REFRESH_ASK) return await theSessionsAct(places, state, budget, args, from)
  if (name === THE_MODEL_REPORT_ASK) return await theModelReported(places, state, args)
  if (name === THE_OWNERS_TODO_ASK) return await theOwnersTodoList(places, args)
  if (name === THE_BUDGET_ASK) return await theBudgetAsked(places, args)
  return undefined
}

/** `/crew-budget` as the owner typed it at this session's tab (martha#990): the line shown, or the reviewer gauge set. */
async function theBudgetAsked(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const command = theBudgetCommandIn(args)
  if (typeof command === 'string') return { refused: command }
  const settings = await theSettingsOrRefusal(places)
  if ('refused' in settings) return settings
  return { answer: theBudgetCommandAnswer(places.stores.crew, command, settings.house_rules.review_model, places.ledger.clock.now()) }
}

/** The owner's list as the pane draws it (martha#316), with `focus` the row the owner's keyboard is on. */
async function theOwnersTodoList(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  return theOwnersTodoAsk({ ledger: places.ledger, now: places.ledger.clock.now() }, args)
}

/**
 * The sweep of the owner's list: at most once per SWEEP_INTERVAL_MS, and never two at once. A launch that holds no
 * processes runs no check, and a member the table does not let keep the list sweeps nothing.
 */
function sweepTheOwnersList(places: CrewToolPlaces): () => void {
  if (places.processes === undefined) return () => undefined
  // The declaration is read again at each sweep, so an edited table takes effect without a relaunch.
  return startSweeping({ ledger: places.ledger, root: places.root, member: places.member, processes: places.processes, settings: () => theSettingsOrRefusal(places) })
}

/**
 * The sweeps this launch keeps (martha#316, #318): the owner's list, and the crew's index of friction notes. Each is
 * gated by its own rule inside its slice — the list by the declaration's table, the notes by the member the crew's work
 * is routed to — so a launch that keeps neither still starts nothing that acts.
 */
function startTheSweeps(places: CrewToolPlaces): () => void {
  const stopTheList = sweepTheOwnersList(places)
  const stopTheNotes = startSweepingTheNotes({
    crew: places.stores.crew,
    root: places.root,
    member: places.member,
    ...(places.processes === undefined ? {} : { processes: places.processes }),
    settings: () => theSettingsOrRefusal(places),
  })
  return () => {
    stopTheList()
    stopTheNotes()
  }
}

/** How often the mod is to read the crew channel, as the declaration gives it. */
async function theChannelRead(places: CrewToolPlaces): Promise<CoreToolAnswer> {
  const settings = await theSettingsOrRefusal(places)
  return 'refused' in settings ? settings : { answer: theChannelReadAsk(settings) }
}

/**
 * The wake an idle host is due, answered from this launch's own record (martha#959): the crew's rows and parks, the
 * backlog read the crew keeps, and the clock it keeps beside it. The session hands in its own context, so a session at
 * the crew's refresh limit is not woken into a handover the refresh flow would make anyway. No wake is answered while a
 * crew message is waiting for this member: the wake's turn is the one the carrier would count that message taken in at,
 * and it would be counted and never read (../hand_a_crew_message_to_its_member, `waiting`).
 */
async function theWakeOfThisSession(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const settings = await theSettingsOrRefusal(places)
  if ('refused' in settings) return settings
  // The session's own context is read exactly as the refresh flow reads it: a usage this launcher cannot read is refused
  // by name there, never read as a session that said nothing (martha#860 R5).
  const usage = theHostsReadingIn(args['usage'])
  if (typeof usage === 'string') return { refused: usage }
  if (places.carrier !== undefined && (await places.carrier.waiting())) return { answer: '' }
  const text = await theWakeFor({
    settings,
    member: places.member,
    rows: beatsOf(places.beats, settings),
    place: places.stores.crew.place(WAKE_PLACE),
    parked: theParkedMembers({ stores: places.stores }, settings.members.map((member) => member.name)),
    reader: theBacklogReaderIn({ ...places, github: settings.github, clock_zone: settings.clock_zone }),
    now: places.ledger.clock.now(),
    context_percent: usage.percent,
  })
  return { answer: text ?? '' }
}

/**
 * The question the refresh flow is answered on (martha#255): what this session says about itself, and the one act it is
 * told to take. The mod makes it at a session's start and at every turn's end, and decides nothing itself.
 */
async function theSessionsAct(
  places: CrewToolPlaces,
  state: SessionState,
  budget: TheBudgetAsACrewHoldsIt,
  args: Readonly<Record<string, unknown>>,
  from: string,
): Promise<CoreToolAnswer> {
  const question = theQuestionIn(args, from)
  if (typeof question === 'string') return { refused: question }
  // The crew's newest weekly reading (martha#990): kept whatever the flow orders; a store that will not keep it leaves
  // the reading before it, which the next turn's end replaces.
  if (question.weekly !== null) keepTheWeekly(places.stores.crew, question.weekly)
  // A switch whose report never came (martha#359): the mod reports the host's command before it asks this question
  // again, so a guard still open here is one no session is coming back for. It is closed without waiting — the host's
  // save may still land, and the record it leaves is what the next launch finishes.
  await closeTheGuardNoOneReported(anOrderOver(places, state))
  const act = await theRefreshAct(refreshPlacesOf(places, state), question)
  const ordered = theOrderOf(act)
  const switching = aSwitchMayFollow(ordered, question) ? await theModelOrder(anOrderOver(places, state)) : null
  // What the package has spent, through the one budget this launch keeps: a session's first question is where that
  // read happens, so the row costs nothing a call would not have cost anyway (martha#513, slice 3).
  const spend = theSpendOnARow(await budget.theSpendInForce(from))
  writeRow(places, state, (row) => theRowAfterTheTurn(state, row, question, act, spend))
  return { answer: JSON.stringify(switching ?? ordered) }
}

/**
 * The row after one turn's question, in ONE write: what the session reported about itself and what the flow said it is
 * doing, because the row store keeps the newest beat and two writes in the same millisecond would lose the second.
 */
function theRowAfterTheTurn(
  state: SessionState,
  row: DashboardRow,
  question: TheSessionsQuestion,
  act: TheAct,
  spend: readonly AUnitOnARow[] | undefined,
): DashboardRow {
  return { ...row, ...(act.refresh === undefined ? {} : { refresh: act.refresh }), needs: theNeedsAfter(state, row), session: question.session_id, host: { ...row.host, contextPercent: question.percent, costUsd: question.cost_usd }, [SPEND_FIELD]: spend }
}

/** The row's `needs` after this turn (martha#359): what the owner's file said, or its own line taken away again. */
function theNeedsAfter(state: SessionState, row: DashboardRow): string {
  const told = state.owner_needs
  if (told === null) return row.needs
  state.owner_needs = null
  if (told.why !== '') return told.why
  return told.before.includes(row.needs) ? '' : row.needs
}

/**
 * The line this member's session starts on: what the member's own row says it holds, and every act of that package
 * that was sent with no outcome recorded (martha#254 design line 53, test 10). Null when nothing is handed.
 */
async function theStartLineOf(places: CrewToolPlaces, state: SessionState, session_id: string): Promise<TheStartLine | null> {
  // What a successor owes for its member's window follows the line (martha#658): the window this hand read is kept until
  // the start is answered, because the beats are marked only once it is taken.
  const handed = withTheOwedLine(places, session_id, await theLineToHandAtStart({
    ledger: places.ledger,
    member: places.member,
    settings: await theSettingsOrRefusal(places),
    held: state.held ?? places.beats.read(places.member),
    now: places.ledger.clock.now(),
  }))
  if (handed.beats_read === undefined) state.start_hands.delete(session_id)
  else state.start_hands.set(session_id, handed.beats_read)
  return handed.line
}

/** The crew's state this member's turn is handed (martha#984): the pane's own reading, with no processes to ask with. */
async function theCrewStateOf(places: CrewToolPlaces): Promise<TheStartLine | null> {
  const settings = await theSettingsOrRefusal(places)
  const rows = 'refused' in settings ? {} : beatsOf(places.beats, settings)
  return theCrewStateOfATurn({ ledger: places.ledger, stores: places.stores, root: places.root, member: places.member, settings, rows, now: places.ledger.clock.now() })
}

/**
 * The answer to a start whose line was built (martha#658 Done-when 4): a taken start marks the window that hand read as
 * handed, and a refused one marks nothing. The record is dropped either way, so no later start's note can carry it.
 */
function noteTheStartIn(places: CrewToolPlaces, state: SessionState, session_id: string, taken: boolean): void {
  const read = state.start_hands.get(session_id)
  state.start_hands.delete(session_id)
  if (read === undefined || !taken) return
  theBeatsMarkedOn(places, read)
}

/**
 * The session a clear was told in, when the crew's flow is waiting for its successor (martha#255). A flow in the
 * clearing phase names the session it cleared from; any other id is not that flow's successor, and a store that will
 * not answer names none — the session then starts as the host said it did, which is the fail-closed reading.
 */
async function thePredecessorOf(places: CrewToolPlaces, session_id: string): Promise<string | null> {
  const place = refreshesPlace(places)
  if ('refusal' in place) return null
  const flow = theFlowOf(place, places.member)
  if (flow === undefined || 'refusal' in flow) return null
  if (flow.phase !== 'clearing' || flow.clear_from === '' || flow.clear_from === session_id) return null
  return flow.clear_from
}

/** What `who_is_free` is answered over: the declaration's rows laid out, and the park each member's marker says. */
const theWhoIsFreeAsked = (places: CrewToolPlaces, settings: CrewSettings, args: Readonly<Record<string, unknown>>) => {
  const parked = parkedPlace(places)
  return {
    settings,
    asker: places.member,
    rows: seeTheCrew(settings, beatsOf(places.beats, settings), places.ledger.clock.now()).rows,
    parkOf: (member: string) => ('refusal' in parked ? { kind: 'unreadable' as const, refusal: parked.refusal } : theParkOf(parked, member)),
    now: places.ledger.clock.now(),
    member: textOf(args['member']),
  }
}

/** The crew's declaration says; or why it could not be read. */
type CrewDeclared = { readonly crew: TheCrew; readonly settings: CrewSettings }

/** One tool's answer, before any one tool decides what it is. */
type AHandler = (args: Readonly<Record<string, unknown>>) => Promise<CoreToolAnswer>

/** A tool that reads the crew's declaration first: its answer, or the refusal a crew that cannot be read gives. */
const declaring =
  (places: CrewToolPlaces, act: (declared: CrewDeclared, args: Readonly<Record<string, unknown>>) => Promise<CoreToolAnswer>): AHandler =>
  async (args) => {
    const declared = await crewOrRefusal(places)
    return 'refused' in declared ? declared : act(declared, args)
  }

/**
 * A tool that reads its call's own words before the crew's declaration, and the place after both: a call that names
 * nothing it can ask is refused in its own words whatever the launch holds (martha#931 B: wait_for_ci now reads the
 * declaration's github.budget_floor, and the arguments-first rule still holds).
 */
const namedThenDeclaring =
  <Named>(places: CrewToolPlaces, name: (args: Readonly<Record<string, unknown>>) => AnAsked<Named>, act: (declared: CrewDeclared, named: AnAsked<Named>) => Promise<CoreToolAnswer>): AHandler =>
  async (args) => {
    const named = name(args)
    if ('refused' in named) return { refused: named.refused }
    return declaring(places, async (declared) => act(declared, named))(args)
  }

/**
 * What a park or a wake is asked, read once for both (martha#255): the crew's own store, this member, the declaration's
 * table and the call's own words, so the two tools differ only in which of the two acts they run.
 */
const theParkAsked = (places: CrewToolPlaces, declared: CrewDeclared, args: Readonly<Record<string, unknown>>): AParkAsked => ({
  stores: places.stores,
  member: places.member,
  settings: declared.settings,
  now: places.ledger.clock.now(),
  switching: triggerPlaceOf(places),
  reason: textOf(args['reason']),
  onto: textOf(args['member']),
})

/** Who may resume a paused package (martha#512): who this crew's nudges go to, or nobody when its declaration cannot be read. */
const whoMayResume = async (places: CrewToolPlaces) => {
  const declared = await crewOrRefusal(places)
  return 'refused' in declared ? [] : theNudgesGoTo(declared.settings)
}

/** What each tool answers, over one place: every tool is one slice's answer, told to the member. */
/** The friction note's handler (martha#318): the note is judged before gh runs, and filed through this launch's processes. */
const filingAFrictionNote = (places: CrewToolPlaces): AHandler =>
  declaring(places, async (declared, args) =>
    fileAFrictionNote(
      {
        member: places.member,
        settings: declared.settings,
        root: places.root,
        crew: places.stores.crew,
        ...(places.processes === undefined ? {} : { processes: places.processes }),
        now: places.ledger.clock.now(),
      },
      args,
    ),
  )

function handlersOver(places: CrewToolPlaces, state: SessionState): Readonly<Record<CrewToolName, AHandler>> {
  const ledger = { ledger: places.ledger, member: places.member }
  const parked = (declared: CrewDeclared, args: Readonly<Record<string, unknown>>, act: typeof parkAMember): Promise<CoreToolAnswer> =>
    theParkToolOver(theParkAsked(places, declared, args), act)
  /**
   * An acting tool's answer, in the order the base's own handlers had it (martha#256, #443 part 5 r=2): the call's
   * arguments are read first, by the slice that owns the tool, and this launch is asked for the processes it acts with
   * only after them. A call whose arguments are wrong is answered by them even here, where nothing could be acted on.
   */
  const actingOn = async <Asked>(
    asked: AnAsked<Asked>,
    act: (on: CrewToolPlaces & { readonly processes: HostContract['processes'] }, ok: Asked) => Promise<CoreToolAnswer>,
  ): Promise<CoreToolAnswer> => {
    if ('refused' in asked) return { refused: asked.refused }
    if (places.processes === undefined) return { refused: NO_ACTING_PLACE }
    return act({ ...places, processes: places.processes }, asked.ok)
  }
  return {
    [REPORT_PROGRESS_TOOL.name]: declaring(places, async (declared, args) =>
      withTheTimesLineOnAReturn(places, state.session, await reportProgressOver(theProgressAsked(places, state, declared), args))),
    [RELEASE_THE_FILES_TOOL.name]: async (args) => releaseTheFilesAKilledRunLeft({ crew: places.stores.crew, member: places.member, paths: thePathsOf(args['paths']) }),
    [LOG_A_MILESTONE_TOOL.name]: async (args) => logTheMilestone(ledger, { package: textOf(args['package']), event: args['event'], note: args['note'] }, async () => whoMayResume(places)),
    [WHAT_WAS_SENT_TOOL.name]: async (args) => whatTheMemberSent(ledger, textOf(args['package'])),
    [NOTE_WHAT_BECAME_TOOL.name]: async (args) => noteTheActsOutcome(ledger, { package: textOf(args['package']), announced_at: args['announced_at'], succeeded: args['succeeded'], detail: args['detail'] }),
    [KEEP_THE_CONTRACT_TOOL.name]: async (args) => keepTheContract({ ...ledger, documents: places.documents }, args),
    [SEE_THE_CREW_TOOL.name]: declaring(places, async (declared) => seeTheCrewOver(thePaneAsked(places, declared.settings))),
    [WHO_IS_FREE_TOOL.name]: declaring(places, async (declared, args) => whoIsFreeOver(theWhoIsFreeAsked(places, declared.settings, args))),
    [UNHELD_WORK_TOOL.name]: declaring(places, async (declared) => unheldWorkOver({ settings: declared.settings, asker: places.member, reader: theBacklogReaderIn({ ...places, github: declared.settings.github, clock_zone: declared.settings.clock_zone }) })),
    [SAY_TO_THE_CREW_TOOL.name]: declaring(places, async (declared, args) => sayToTheCrewOver(theSendAsked(places, state, declared.settings, args))),
    [READ_THE_RECEIPTS_TOOL.name]: declaring(places, async (declared) => theReceiptsOver(theReceiptsAsked(places, declared.settings))),
    [PARK_A_MEMBER_TOOL.name]: declaring(places, (declared, args) => parked(declared, args, parkAMember)),
    [WAKE_A_MEMBER_TOOL.name]: declaring(places, (declared, args) => parked(declared, args, unparkAMember)),
    [RESTART_A_MEMBER_TOOL.name]: declaring(places, async (declared, args) => theRestartAsked(places, declared.settings, args)),
    [SWITCH_YOUR_MODEL_TOOL.name]: declaring(places, async (declared, args) => switchTheModelOver({ ...triggerPlaceOf(places), settings: declared.settings }, args)),
    [RETURN_TO_YOUR_OWN_MODEL_TOOL.name]: async (args) => returnToYourOwnModelOver(triggerPlaceOf(places), args),
    [WRITE_MY_HANDOVER_SCHEMA.name]: async (args) =>
      theHandoverToolOver(theHandoverAsked(places, state, theRootsInForce(places.settings?.volatile_paths ?? [], places.volatile_roots ?? [])), args),
    [REFRESH_THIS_SESSION]: async (args) => theRefreshAskedOf(places, args),
    [VERIFY_RANGE_TOOL.name]: (args) =>
      actingOn(theRangeACallNames(args), async (on, asked) =>
        on.settings === undefined ? { refused: NO_ACTING_PLACE } : verifyTheRangeOver(actingHost(on), asked, places.note)),
    [LAND_BATCH_TOOL.name]: (args) =>
      actingOn(theLandingACallNames(args), (on, asked) => landTheBatchOver(actingHost(on), places.member, asked.batch, asked.dry, places.note)),
    [FAST_FORWARD_TOOL.name]: (args) =>
      actingOn(theFastForwardACallNames(args), async (on, asked) =>
        on.settings === undefined ? { refused: NO_ACTING_PLACE } : fastForwardOntoTheApprovedTipOver(actingHost(on), places.member, asked, on.settings)),
    [WORKTREE_OPEN_TOOL.name]: async (args) => theWorktreeToolOver(worktreesOf(places), openAWorktree, args),
    [WORKTREE_FINISH_TOOL.name]: async (args) => theWorktreeToolOver(worktreesOf(places), finishAWorktree, args),
    [OWNER_TODO_ADD_TOOL.name]: declaring(places, async (declared, args) => keepTheOwnersList(theOwnersListAsked(places, declared.settings), () => addAnAct(places.ledger, args, places.member))),
    [OWNER_TODO_DONE_TOOL.name]: declaring(places, async (declared, args) => keepTheOwnersList(theOwnersListAsked(places, declared.settings), () => closeAnAct(places.ledger, args['id'], { by: 'member', member: places.member }))),
    [QUEUE_ASK_TOOL.name]: async (args) => queueTheAsk(theAsksAsked(places, state), args),
    [LIST_ASKS_TOOL.name]: async () => listTheOwnersAsks(theAsksAsked(places, state)),
    [TAKE_ASKS_TOOL.name]: declaring(places, async (declared) => theTakeOfTheAsks(theOfferingAsked(places, state, declared.settings))),
    [SETTLE_ASKS_TOOL.name]: declaring(places, async (declared, args) => theSettlingOfTheAsks(theOfferingAsked(places, state, declared.settings), args)),
    [STANDING_ADD_TOOL.name]: declaring(places, async (declared, args) => keepTheStandingItems(theStandingAsked(places, declared.settings), () => recordAStandingItem(places.ledger, args, places.member))),
    [STANDING_CLOSE_TOOL.name]: declaring(places, async (declared, args) => keepTheStandingItems(theStandingAsked(places, declared.settings), () => closeAStandingItem(places.ledger, args, places.member))),
    [STANDING_TOOL.name]: async () => theStandingToolOver({ ledger: places.ledger, now: places.ledger.clock.now() }),
    [WAIT_FOR_CI_TOOL.name]: namedThenDeclaring(places, theCiWaitACallNames, async (declared, named) =>
      actingOn(named, (on, asked) => theCiWaitOver(theGithubSpenderOf({ stores: on.stores, root: on.root, processes: on.processes, clock: on.ledger.clock, github: declared.settings.github, clock_zone: declared.settings.clock_zone }), asked)),
    ),
    [FILE_A_FRICTION_NOTE_TOOL.name]: filingAFrictionNote(places),
  }
}

/** What a report is handed: the crew the rules read, this member, the row it last had, and the one writer of the row. */
const theProgressAsked = (places: CrewToolPlaces, state: SessionState, declared: CrewDeclared) => ({
  crew: declared.crew,
  member: places.member,
  held: state.held ?? places.beats.read(places.member),
  now: places.ledger.clock.now(),
  keepTheRow: (change: (row: DashboardRow) => DashboardRow) => writeRow(places, state, change),
  switching: triggerPlaceOf(places),
})

/** What the pane is answered over: this crew's declaration, its rows, and the places its nudges are read in. */
const thePaneAsked = (places: CrewToolPlaces, settings: CrewSettings) => ({
  settings,
  member: places.member,
  rows: beatsOf(places.beats, settings),
  ledger: places.ledger,
  stores: places.stores,
  root: places.root,
  ...(places.processes === undefined ? {} : { processes: places.processes }),
  now: places.ledger.clock.now(),
})

/** What a send is handed: this member, the crew's roster, and the row that says what it holds. */
const theSendAsked = (places: CrewToolPlaces, state: SessionState, settings: CrewSettings, args: Readonly<Record<string, unknown>>) => ({
  ledger: places.ledger,
  member: places.member,
  roster: settings.members.map((member) => member.name),
  receivers: theNudgesGoTo(settings),
  held: state.held === null ? places.beats.read(places.member) : state.held,
  to: args['to'],
  text: args['text'],
  volatile_roots: theRootsInForce(settings.volatile_paths, places.volatile_roots ?? []),
  models: settings.members.map(({ name, model }) => ({ name, model })),
  // A HANDOFF's range is read in the crew's clone when the launch handed the host's processes (martha#980 package 3).
  ...(places.processes === undefined ? {} : { commits: { processes: places.processes, clones: settings.house_rules.clones } }),
  // A HANDOFF's ci= runs are read through the crew's GitHub budget, each gh bounded (martha#980 package 4).
  ...(places.processes === undefined
    ? {}
    : { runs: theGithubSpenderOf({ stores: places.stores, root: places.root, processes: places.processes, clock: places.ledger.clock, github: settings.github, clock_zone: settings.clock_zone }, GH_MS) }),
})

/** What the receipts are read over: the channel's ledger, the member that sent, and the crew it sent to. */
const theReceiptsAsked = (places: CrewToolPlaces, settings: CrewSettings) => ({
  ledger: places.ledger,
  member: places.member,
  roster: settings.members.map((member) => member.name),
})

/** `restart_a_member`: this launch's member is the caller, and a launch with no place to ask refuses by name. */
async function theRestartAsked(places: CrewToolPlaces, settings: CrewSettings, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  if (places.lifecycle === undefined) return { refused: `this launch was given no place to ask a restart in, so ${RESTART_A_MEMBER_TOOL.name} cannot run here.` }
  const reason = textOf(args['reason'])
  const onto = textOf(args['member'])
  return theRestartToolOver({ lifecycle: places.lifecycle, settings, member: places.member, reason, onto, fresh: args['fresh'] === true })
}

/** What a handover is written over: the crew's store, its stamps, the session this call came from, and the roots a reboot deletes. */
const theHandoverAsked = (places: CrewToolPlaces, state: SessionState, volatileRoots: readonly string[]) => ({
  host: places,
  stamps: places.stamps,
  sessions: places.sessions,
  session: state.session,
  member: places.member,
  now: () => places.ledger.clock.now(),
  volatile_roots: volatileRoots,
})

/** `refresh_this_session`: a member asked to refresh is told its handover is expected, or why no refresh is asked for. */
async function theRefreshAskedOf(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const reason = textOf(args['reason'])
  if (reason === '') return { refused: 'a refresh says why in one line, and this one says nothing' }
  const asked = askAMemberToRefresh(places, places.member, reason, places.ledger.clock.now())
  if (asked !== undefined) return { refused: asked.refusal }
  return { answer: `Refresh asked: ${reason}. This session hands over at the end of this turn; write your handover when Martha asks for it.` }
}

/**
 * What a place that holds no processes or no declaration is told when it calls one of the acting tools: a launch
 * that cannot act says so, instead of answering for something it did not do (martha#256).
 */
export const NO_ACTING_PLACE = 'this launch holds no processes or no crew declaration, so this tool cannot act in it: start the member through Martha.'

/** The host the acting tools run over: the launcher's own processes and the ledger's clock and rows (martha#256). */
const actingHost = (places: CrewToolPlaces & { readonly processes: HostContract['processes'] }): Pick<HostContract, 'processes'> & LedgerHost => ({
  processes: places.processes,
  ...places.ledger,
})

/** What the two worktree tools are given, or the refusal of a place that holds no processes or no declaration (martha#256). */
const worktreesOf = (places: CrewToolPlaces): WorktreesRequest | { readonly refused: string } =>
  places.processes === undefined || places.settings === undefined ? { refused: NO_ACTING_PLACE } : { host: actingHost({ ...places, processes: places.processes }), settings: places.settings, member: places.member }

/**
 * Changes the member's row by this session's own fields, applied to the row the store holds at the door: the model is
 * this session's (martha#315), the state, task and figures are the member's, and everything else — the dialogs the
 * launcher wrote, above all — is the row's, never a copy this session read earlier (martha#363, martha#380).
 *
 * The beat rule lives here, with the one writer that owns the row's `at`: a change whose beat is not newer than the row
 * held is dropped whole, so a beat landing late never takes back a newer row (r=1, O1). A dialog is not a beat, so this
 * rule can never refuse one.
 */
function writeRow(places: CrewToolPlaces, state: SessionState, change: (row: DashboardRow) => DashboardRow): void {
  const nothing_said = theRowWithNothingSaid()
  let changed: DashboardRow | null = null
  places.beats.change(places.member, (held) => {
    const row: DashboardRow = {
      ...nothing_said,
      ...(held ?? {}),
      member: places.member,
      session: state.session,
      at: places.ledger.clock.now(),
      host: { ...nothing_said.host, ...(held?.host ?? {}), model: state.row_model },
    }
    changed = change(row)
    return beatAfter(held, changed)
  })
  // The row this session last had, whether the store kept it or dropped a beat that was not newer: it is what this
  // session's own report is written over, as it was before (martha#255).
  if (changed !== null) state.held = changed
}

/**
 * What the mod says once the host's model command resolved (martha#315): the model this session runs on, written into
 * the row. It is the only writer of a switched model, so the row never says a switch the host has not made.
 *
 * It is also where the owner's default is put back (martha#359): the host's save is waited for in the file, never
 * assumed from this answer, and the record a crash would need is kept before the restore. What was not put back is said
 * in the row's `needs` and in this answer, which is all the member is told — the mod carries this answer no further.
 */
async function theModelReported(places: CrewToolPlaces, state: SessionState, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const model = textOf(args['model'])
  if (model === '') return { refused: 'a session reporting its model names it, and this one named none' }
  const putBack = await theOwnersDefaultPutBack(anOrderOver(places, state))
  state.row_model = model
  writeRow(places, state, (row) => rowAfterASwitch(row, putBack))
  const noted = `Noted: this row says ${model}.`
  return { answer: putBack.why === '' ? noted : `${noted} ${putBack.why}` }
}

/** The places the refresh flow decides over: the crew's own store, the row, the stamps, and where this session began. */
function refreshPlacesOf(places: CrewToolPlaces, state: SessionState): TheRefreshPlaces {
  return {
    member: places.member,
    stores: places.stores,
    beats: places.beats,
    ...(places.stamps === undefined ? {} : { stamps: places.stamps }),
    root: places.root,
    documents: places.documents,
    models: places.models ?? NO_MODEL_NAMED,
    ...(places.usage_host === undefined ? {} : { usage_host: places.usage_host }),
    ledger: places.ledger,
    row_model: state.row_model,
    began_at: state.began_at,
    ends: state.ends,
    ...(places.processes === undefined ? {} : { processes: places.processes }),
  }
}

/** The declaration, and the crew's names as a report's rules read them; or why it could not be read. */
async function crewOrRefusal(places: CrewToolPlaces): Promise<CrewDeclared | { readonly refused: string }> {
  try {
    const settings = await declareCrew(places.documents, places.root, places.models ?? NO_MODEL_NAMED)
    return { crew: { owner: settings.owner, members: settings.members.map((member) => member.name) }, settings }
  } catch (error) {
    return { refused: `the crew's declaration could not be read: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The declaration's settings alone, or why it could not be read: what a slice that reads no crew names needs. */
async function theSettingsOrRefusal(places: CrewToolPlaces): Promise<CrewSettings | { readonly refused: string }> {
  const declared = await crewOrRefusal(places)
  return 'refused' in declared ? declared : declared.settings
}

/** The package an argument names, as the tool's own text; '' when it names none, which the ledger refuses. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
