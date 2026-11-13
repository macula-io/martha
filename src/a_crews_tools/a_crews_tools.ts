// The tools a member of a crew can call, and the one place their answers are decided (martha#254).
//
// This exists so the mod that runs in the member's session registers the tools and the launcher answers them: the
// session can draw and post, and nothing that decides anything runs inside it. Every tool here is a name, an
// argument object, and an answer the slice behind it gives — `report_progress` and `see_the_crew` over the dashboard
// rows, `log_a_milestone`, `what_was_sent` and `note_what_became_of_an_act` over the ledger.
//
// The row a member's beat writes is the launcher's own state: the report moves it, and a heartbeat keeps it fresh at
// BEAT_INTERVAL_MS so a pane can tell a working member from a session that has died. The heartbeat runs here, in the
// launcher, and writes the same row the report wrote, so nothing but this slice ever folds a beat in.

import { declareCrew, type CrewSettings } from '../declare_crew/declare_crew.ts'
import { CREW_SAY_DESCRIPTION, SAY_TO_THE_CREW, sendACrewMessage } from '../send_a_crew_message/send_a_crew_message.ts'
import { theRangeACallNames, VERIFY_RANGE, VERIFY_RANGE_DESCRIPTION, verifyRange } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import {
  FAST_FORWARD_AFTER_THE_OWNERS_YES,
  FAST_FORWARD_DESCRIPTION,
  LAND_BATCH,
  LAND_BATCH_DESCRIPTION,
  fastForwardAfterTheOwnersYes,
  landPassedWorkAsOneBatch,
  theBatchACallNames,
  theFastForwardACallNames,
} from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import {
  WORKTREE_FINISH,
  WORKTREE_FINISH_DESCRIPTION,
  WORKTREE_OPEN,
  WORKTREE_OPEN_DESCRIPTION,
  finishAWorktree,
  openAWorktree,
  type WorktreeAnswer,
  type WorktreesRequest,
} from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { THE_NEXT_MESSAGE_ASK, type MessageCarrier } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { CREW_RECEIPTS_DESCRIPTION, READ_THE_RECEIPTS, whatBecameOfWhatISent } from '../show_what_a_message_became/show_what_a_message_became.ts'
import type { DocumentStore, HandoverStampStore, HostContract, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { parkAMember, parkedPlace, theParkOf, unparkAMember, type TheDeclaration } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { theFlowOf, refreshesPlace } from '../refresh_a_member/refresh_a_member.ts'
import { askAMemberToRefresh, theOrderOf, theRefreshAct, THE_REFRESH_ASK, type TheAct, type TheSessionsQuestion } from '../refresh_a_member/the_refresh_flow.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { theHandoverAToolWrote, WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import {
  CREW_LOG_DESCRIPTION,
  LOG_A_MILESTONE,
  NOTE_WHAT_BECAME_DESCRIPTION,
  type AWorker,
  WHAT_WAS_SENT_DESCRIPTION,
  keepTheMilestone,
  noteWhatBecameOfAnAct,
  theLineAStartingSessionIsHanded,
  whatWasSent,
} from '../keep_the_ledger/keep_the_ledger.ts'
import { ledgerStreamOf, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { REPORT_PROGRESS_DESCRIPTION, takeProgress, type TheCrew } from '../report_progress/report_progress.ts'
import { READER_BEAT_MS, seeTheCrew, thePaneAnsweredBy } from '../see_the_crew/see_the_crew.ts'
import { WHO_IS_FREE, WHO_IS_FREE_DESCRIPTION, whoIsFreeOver } from '../see_who_is_free/who_is_free_tool.ts'
import { BEAT_INTERVAL_MS, theRowWithNothingSaid, type DashboardRow, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'
import {
  homeModelOf,
  modelPlace,
  returnAMemberHome,
  switchAMembersModel,
  theModelOf,
  theOwnersDefaultKept,
  theSwitchACallAsks,
  theSwitchDirected,
  theSwitchRefused,
  type ModelMarker,
} from '../switch_a_members_model/switch_a_members_model.ts'
import {
  guardTheOwnersDefault,
  putTheOwnersModelBack,
  theSaveInTheFile,
  theSaveSeenNow,
  theSaveThatNeverShowed,
  type TheSaveSeen,
  type AGuardedSwitch,
  type OwnersDefaultPlace,
} from '../put_the_owners_model_back/put_the_owners_model_back.ts'
import { reviewModelRefusal, type ASpawnedAgent } from '../run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts'
import { CARRY_A_MODEL, type TheOrder } from '../refresh_a_member/the_refresh_flow.ts'
import { noteMilestone } from '../log_ledger/log_ledger.ts'
import {
  OWNER_TODO_ADD,
  OWNER_TODO_ADD_DESCRIPTION,
  OWNER_TODO_DONE,
  OWNER_TODO_DONE_DESCRIPTION,
  OWNER_TODO_STREAM,
  SWEEP_INTERVAL_MS,
  THE_OWNERS_TODO_ASK,
  addAnAct,
  closeAnAct,
  mayKeepTheOwnersList,
  sweepTheList,
  theListForThePane,
  theOpenRows,
  whoMayKeepTheList,
  type TodoAnswer,
} from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'

/** The name a member parks with (martha#343): one act, and it says which by being this tool. */
export const PARK_A_MEMBER = 'park_a_member'

/** The name a member wakes another with (martha#343): the other half of the park, as a tool of its own. */
export const WAKE_A_MEMBER = 'wake_a_member'

/**
 * The name the refresh tool is registered under (martha#343). It is the tool a member calls, and not the word a
 * refreshed session is recorded with: the SessionStart source value keeps its own name, `CREW_REFRESH`, because a
 * ledger already holds it and the host's vocabulary names it.
 */
export const REFRESH_THIS_SESSION = 'refresh_this_session'

/**
 * The name the model switch is registered under (martha#315). A verb, as the nine tools beside it are: the owner's
 * decision of 2026-11-13 took the `crew_` prefix off every tool, and the design's `crew_model` predates that by hours.
 */
export const SWITCH_YOUR_MODEL = 'switch_your_model'

/** The name the return is registered under (martha#315): one act each, as `park_a_member` and `wake_a_member` are. */
export const RETURN_TO_YOUR_OWN_MODEL = 'return_to_your_own_model'

/** What the mod asks under to say which model the session now runs on, once the host's command resolved (martha#315). */
export const THE_MODEL_REPORT_ASK = 'note_the_model_the_session_runs'

/** The names the crew's tools are registered under, and the only ones the launcher answers. */
export const CREW_TOOL_NAMES = [
  'report_progress',
  LOG_A_MILESTONE,
  'what_was_sent',
  'note_what_became_of_an_act',
  'see_the_crew',
  WHO_IS_FREE,
  SAY_TO_THE_CREW,
  READ_THE_RECEIPTS,
  PARK_A_MEMBER,
  WAKE_A_MEMBER,
  SWITCH_YOUR_MODEL,
  RETURN_TO_YOUR_OWN_MODEL,
  WRITE_MY_HANDOVER_TOOL,
  REFRESH_THIS_SESSION,
  VERIFY_RANGE,
  LAND_BATCH,
  FAST_FORWARD_AFTER_THE_OWNERS_YES,
  WORKTREE_OPEN,
  WORKTREE_FINISH,
  OWNER_TODO_ADD,
  OWNER_TODO_DONE,
] as const
export type CrewToolName = (typeof CREW_TOOL_NAMES)[number]

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

/** What the tools are given: whose row it is, where the crew's place is, and how the declaration is read. */
export interface CrewToolPlaces {
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
  /** The crew's declaration, whose workspace places the two worktree tools read (martha#256). */
  readonly settings?: CrewSettings
  /**
   * The models the host runs, as its adapter records them (martha#315): the declaration is read back against them, so a
   * crew whose `review_model` the host cannot spell is refused by name. A place given none names no model, and a
   * declaration naming one is then refused — nothing here invents a model list.
   */
  readonly models?: readonly string[]
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
  readonly owners_settings?: OwnersDefaultPlace
  /**
   * What hands this member the crew's messages it has not taken in (martha#253). The mod asks for one each time it
   * starts and after each turn; a launch given none refuses the ask rather than answering an empty channel.
   */
  readonly carrier?: MessageCarrier
  /** Where the host keeps the stamps its handovers carry (martha#255). A launch given none writes no handover. */
  readonly stamps?: HandoverStampStore
  /** The sessions this launch took in, by id: what a handover is stamped with, and the predecessor a refresh inherits. */
  readonly sessions?: { readonly of: (session_id: string) => HostSession | undefined }
  /** The share each session began at, by session id: kept here, so every threshold is measured from where it started. */
  readonly began_at?: Map<string, number>
}

/** What the mod asks for: how often, in seconds, to read the channel (martha#253). */
export const THE_CHANNEL_READ_ASK = 'channel_read_seconds'

/** The tools a crew's member can call. */
export interface CrewTools {
  readonly tools: readonly CrewTool[]
  /** Answers a tool call: the member's name is this launch's, the session's is the one the call came from. */
  answer(name: string, args: Readonly<Record<string, unknown>>, session: string): Promise<CoreToolAnswer>
  /** Starts the heartbeat, which keeps this member's row fresh; returns the stop. */
  startBeating(): () => void
  /**
   * Starts the sweep of the owner's list (martha#316): once every SWEEP_INTERVAL_MS, while this member may keep the
   * list, every open row's check is asked whether its act is done. Returns the stop.
   */
  startSweeping(): () => void
  /**
   * The line a session starting on a package is handed, once, at its start (martha#254 design, test 10): every act of
   * the package this member holds that was sent with no outcome recorded, oldest first, or null when it holds no
   * package or nothing of it was left waiting.
   */
  theLineToHandAtStart(): Promise<string | null>
  /**
   * Why a subagent call this member made is not run: it spawns a review and does not name the crew's reviewer model
   * (martha#315). Asked by the launcher's tool-call verdict, beside ../answer_a_tool_call, and never inside it.
   */
  refusesTheSubagent(call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }): Promise<string | undefined>
  /**
   * The session a clear was told in, when the crew's flow is waiting for its successor and this id is it (martha#255):
   * the launcher starts that session as a `crew_refresh` with this predecessor, whichever of the host's two events
   * names it first. Null when no clear is in flight, or when this id is the session the clear was told in.
   */
  thePredecessorOf(session_id: string): Promise<string | null>
}

/** The schema shared by the tools that name a package, which every one of the ledger's tools does. */
const A_PACKAGE: Readonly<Record<string, unknown>> = { type: 'string', description: 'The work package, owner/repo#n, as the issue is named' }

/** The model a switch names (martha#315): one the declaration names for this member. */
const A_MODEL: Readonly<Record<string, unknown>> = {
  type: 'string',
  description: 'The model to run on: one this crew\'s declaration names for you (your own model, or its review_model)',
}

/** The clone a tool works in (martha#256): where the repository is on this machine, never a URL. */
const A_CLONE: Readonly<Record<string, unknown>> = { type: 'string', description: 'The clone to work in, as a path on this machine' }

/** The base a range was checked against (martha#256). */
const A_BASE: Readonly<Record<string, unknown>> = { type: 'string', description: 'The base the range was checked against, as a full sha' }

/** The tip a range ends at (martha#256). */
const A_TIP: Readonly<Record<string, unknown>> = { type: 'string', description: 'The tip the range ends at, as a full sha' }

/** The work packages a landing or a checked range names (martha#256). */
const THE_PACKAGES: Readonly<Record<string, unknown>> = {
  type: 'array',
  items: A_PACKAGE,
  description: 'The work packages it lands, each as owner/repo#n',
}

/** The repository a worktree is made in or removed from (martha#256). */
const A_REPOSITORY: Readonly<Record<string, unknown>> = { type: 'string', description: 'The repository, org/name' }

/** What a worktree is for: the slug its path and branch carry (martha#256). */
const A_SLUG: Readonly<Record<string, unknown>> = {
  type: 'string',
  description: 'What the worktree is for, as lowercase letters, digits and hyphens',
}

/** What `park_a_member` says it is for: the design's own words, and what a park does and does not do. */
export const PARK_A_MEMBER_DESCRIPTION =
  'Park a member, so it is not refreshed between tasks and is never started by Martha on its own. A member may always park itself; parking another needs the declaration\'s table, and a refusal names the act that would have allowed it. Leave `member` out to park yourself.'

/** What `wake_a_member` says it is for: the other half, and what a wake does with the marker it finds. */
export const WAKE_A_MEMBER_DESCRIPTION =
  'Bring a member out of a park, so it is refreshed between tasks again. The marker is written, not removed, so the reason stays readable. A member may always wake itself; waking another needs the declaration\'s table, and a refusal names the act that would have allowed it. Leave `member` out to wake yourself.'

/** What `switch_your_model` says it is for: one package, one model the declaration names, and when it happens. */
export const SWITCH_YOUR_MODEL_DESCRIPTION =
  'Run on another model for one work package. The model must be one this crew\'s declaration names for you: your own ' +
  'model, or the crew\'s review_model — anything else is refused by name. The switch happens at the end of this turn, ' +
  'and you return to your own model when you park, report progress on another package, or call ' + '`return_to_your_own_model`.'

/** What `return_to_your_own_model` says it is for: the other half of the switch, and when it happens. */
export const RETURN_TO_YOUR_OWN_MODEL_DESCRIPTION =
  'Return to your own model now, ending a switch made with `switch_your_model`. The record of what the package ran on ' +
  'is kept. You would be returned automatically when you park or report progress on another package; this is for ending ' +
  'a switch while you still hold the package.'

/** What `write_my_handover` says it is for: the host writes the file, at the path the host chose, and stamps it. */
export const WRITE_MY_HANDOVER_DESCRIPTION =
  'Write your handover — what your successor needs to carry on — as one text. Martha writes and stamps the file at a path it chooses; a handover you write with your own file tool is not one and clears nothing. Answer CREW-HANDOVER-WRITTEN when your handover ask is done.'

/** What `refresh_this_session` says it is for: a member told to refresh asks for one, and hands over at its next turn's end. */
export const CREW_REFRESH_DESCRIPTION =
  'Ask to be refreshed, when the owner or the Supervisor tells you to. The session hands over and is cleared at the end of this turn, and the reason you give is kept on the crew’s row.'

/** The tools, as the mod registers them. */
export const CREW_TOOLS: readonly CrewTool[] = [
  {
    name: 'report_progress',
    description: REPORT_PROGRESS_DESCRIPTION,
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
  },
  {
    name: LOG_A_MILESTONE,
    description: CREW_LOG_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        package: A_PACKAGE,
        event: { type: 'string', enum: ['checkpoint', 'review_round', 'release', 'fix_after_ship'] },
        note: { type: 'string', description: 'One short line: what happened' },
      },
      required: ['package', 'event', 'note'],
    },
  },
  {
    name: 'what_was_sent',
    description: WHAT_WAS_SENT_DESCRIPTION,
    inputSchema: { type: 'object', properties: { package: A_PACKAGE }, required: ['package'] },
  },
  {
    name: 'note_what_became_of_an_act',
    description: NOTE_WHAT_BECAME_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        package: A_PACKAGE,
        announced_at: { type: 'integer', minimum: 0, description: 'The row the act was announced at, as what_was_sent shows it' },
        succeeded: { type: 'boolean', description: 'Whether the act happened' },
        detail: { type: 'string', description: 'What you found, in one line' },
      },
      required: ['package', 'announced_at', 'succeeded', 'detail'],
    },
  },
  {
    name: 'see_the_crew',
    description: "Every member's row of this crew, in the declaration's order, with what has gone quiet marked.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: WHO_IS_FREE,
    description: WHO_IS_FREE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { member: { type: 'string', description: 'The member to ask about: may it take a package now? Leave it out for every member\'s row' } },
    },
  },
  {
    name: SAY_TO_THE_CREW,
    description: CREW_SAY_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        to: {
          description: "Who it is for: a list of this crew's members' names, or \"crew\" for every member but you",
          anyOf: [{ type: 'string', enum: ['crew'] }, { type: 'array', items: { type: 'string' }, minItems: 1 }],
        },
        text: { type: 'string', description: 'What you say. A HANDOFF or VERDICT line is read from its first line' },
      },
      required: ['to', 'text'],
    },
  },
  {
    name: READ_THE_RECEIPTS,
    description: CREW_RECEIPTS_DESCRIPTION,
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: PARK_A_MEMBER,
    description: PARK_A_MEMBER_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you park, in one line: the owner reads it, and so does whoever wakes you' },
        member: { type: 'string', description: 'Whose park to set; leave it out for your own' },
      },
      required: ['reason'],
    },
  },
  {
    name: WAKE_A_MEMBER,
    description: WAKE_A_MEMBER_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why you wake it, in one line: the owner reads it on the marker' },
        member: { type: 'string', description: 'Whose park to clear; leave it out for your own' },
      },
      required: ['reason'],
    },
  },
  {
    name: SWITCH_YOUR_MODEL,
    description: SWITCH_YOUR_MODEL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        model: A_MODEL,
        package: A_PACKAGE,
        reason: { type: 'string', description: 'Why you switch, in one line: the ledger and the row read it' },
      },
      required: ['model', 'package', 'reason'],
    },
  },
  {
    name: RETURN_TO_YOUR_OWN_MODEL,
    description: RETURN_TO_YOUR_OWN_MODEL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why you come back, in one line: the ledger and the row read it' } },
      required: ['reason'],
    },
  },
  {
    name: WRITE_MY_HANDOVER_TOOL,
    description: WRITE_MY_HANDOVER_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string', description: 'The whole handover: first rules, what runs, open items, pending decisions, gotchas, and one line per package you hold' } },
      required: ['content'],
    },
  },
  {
    name: REFRESH_THIS_SESSION,
    description: CREW_REFRESH_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why you are refreshing, in one line: the owner reads it on the row' } },
      required: ['reason'],
    },
  },
  {
    name: VERIFY_RANGE,
    description: VERIFY_RANGE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        path: A_CLONE,
        base: A_BASE,
        tip: A_TIP,
        packages: THE_PACKAGES,
      },
      required: ['path', 'base', 'tip'],
    },
  },
  {
    name: LAND_BATCH,
    description: LAND_BATCH_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { path: A_CLONE, packages: { ...THE_PACKAGES, minItems: 1 } },
      required: ['path', 'packages'],
    },
  },
  {
    name: FAST_FORWARD_AFTER_THE_OWNERS_YES,
    description: FAST_FORWARD_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { path: A_CLONE, base: A_BASE, tip: A_TIP, packages: { ...THE_PACKAGES, minItems: 1 } },
      required: ['path', 'base', 'tip', 'packages'],
    },
  },
  {
    name: WORKTREE_OPEN,
    description: WORKTREE_OPEN_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        repo: A_REPOSITORY,
        slug: A_SLUG,
      },
      required: ['repo', 'slug'],
    },
  },
  {
    name: WORKTREE_FINISH,
    description: WORKTREE_FINISH_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: { repo: A_REPOSITORY, slug: A_SLUG, package: A_PACKAGE },
      required: ['repo', 'slug', 'package'],
    },
  },
  {
    name: OWNER_TODO_ADD,
    description: OWNER_TODO_ADD_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'A short id for the act: a package ref or a slug of letters, digits, ".", "_" or "-"' },
        title: { type: 'string', description: 'What the owner is asked to do, in one line' },
        goal: { type: 'string', description: 'The end goal the act serves, in one line' },
        waiting_on: { type: 'string', description: 'Who waits on it, so the owner knows who to tell when it is done' },
        commands: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'The exact command the owner runs; variable names only, never a secret' },
              does: { type: 'string', description: 'What the command does and what success looks like, in one line' },
            },
            required: ['command', 'does'],
          },
        },
        check: {
          type: 'object',
          description: 'Optional: how Martha can tell the act is done by itself — { pr_merged: { repo, number } } or { tag_exists: { repo, tag } }',
        },
      },
      required: ['id', 'title', 'commands'],
    },
  },
  {
    name: OWNER_TODO_DONE,
    description: OWNER_TODO_DONE_DESCRIPTION,
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: "The act's id, as it was added" } }, required: ['id'] },
  },
]

/** What one place's tools hold between calls: the row as this session last left it, and its session id. */
interface SessionState {
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
}

/** The tools a member can call, over the place its launcher gave it. */
export function crewToolsOver(places: CrewToolPlaces): CrewTools {
  const state: SessionState = {
    held: null,
    session: '',
    row_model: places.launched_on ?? '',
    began_at: places.began_at ?? new Map<string, number>(),
    guarded: null,
    owner_needs: null,
  }
  const handlers = handlersOver(places, state)

  return {
    tools: CREW_TOOLS,
    async answer(name: string, args: Readonly<Record<string, unknown>>, from: string): Promise<CoreToolAnswer> {
      state.session = from
      const asked = await answerAnAskOfTheMods(places, state, name, args, from)
      if (asked !== undefined) return asked
      const handle = handlers[name as CrewToolName]
      if (handle === undefined) {
        return { refused: `${JSON.stringify(name)} is not a tool this crew registers (they are ${CREW_TOOL_NAMES.join(', ')})` }
      }
      return handle(args)
    },
    startBeating(): () => void {
      const timer = setInterval(() => {
        try {
          writeRow(places, state, rowNow(places, state))
        } catch {
          // A beat the disk would not take is the next beat's business: the row it could not write stays readable.
        }
      }, BEAT_INTERVAL_MS)
      timer.unref()
      return () => clearInterval(timer)
    },
    startSweeping: () => startSweeping(places),
    theLineToHandAtStart: () => theLineToHandAtStart(places, state),
    thePredecessorOf: (session_id) => thePredecessorOf(places, session_id),
    refusesTheSubagent: (call) => refusesTheSubagent(places, call),
  }
}

/**
 * The asks the mod makes on a session's behalf, never a model's: the tools to register, how often to read the channel,
 * what to hand next, and what this session should do now. Undefined when `name` is one a member calls itself, which the
 * handlers answer.
 */
async function answerAnAskOfTheMods(
  places: CrewToolPlaces,
  state: SessionState,
  name: string,
  args: Readonly<Record<string, unknown>>,
  from: string,
): Promise<CoreToolAnswer | undefined> {
  if (name === THE_TOOLS_ASK) return { answer: JSON.stringify(CREW_TOOLS) }
  if (name === THE_CHANNEL_READ_ASK) return await theChannelReadAsk(places)
  if (name === THE_NEXT_MESSAGE_ASK) return await theNextMessageAsk(places)
  if (name === THE_REFRESH_ASK) return await theSessionsAct(places, state, args, from)
  if (name === THE_MODEL_REPORT_ASK) return await theModelReported(places, state, args)
  if (name === THE_OWNERS_TODO_ASK) return await theOwnersTodoAsk(places, args)
  return undefined
}

/** The owner's list as the pane draws it (martha#316), with `focus` the row the owner's keyboard is on. */
async function theOwnersTodoAsk(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const rows = theOpenRows(await places.ledger.stores.rows.read(OWNER_TODO_STREAM))
  return { answer: JSON.stringify(theListForThePane(rows, args['focus'], places.ledger.clock.now())) }
}

/**
 * `owner_todo_add` and `owner_todo_done` (martha#316): the declaration's table says whether this launch's member may
 * keep the owner's list, and the row is written as this launch's member, never as a name the call carries.
 */
async function keepTheOwnersList(places: CrewToolPlaces, act: () => Promise<TodoAnswer>): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return declared
  const declaration = theDeclarationOf(declared.settings)
  if (!mayKeepTheOwnersList(declaration, places.member)) return { refused: whoMayKeepTheList(declaration, places.member) }
  return asAnAnswer(await act())
}

/**
 * The sweep of the owner's list: at most once per SWEEP_INTERVAL_MS, and never two at once. A launch that holds no
 * processes runs no check, and a member the table does not let keep the list sweeps nothing.
 */
function startSweeping(places: CrewToolPlaces): () => void {
  const processes = places.processes
  if (processes === undefined) return () => undefined
  let sweeping = false
  const timer = setInterval(() => {
    if (sweeping) return
    sweeping = true
    void sweepOnce(places, processes).finally(() => {
      sweeping = false
    })
  }, SWEEP_INTERVAL_MS)
  timer.unref()
  return () => clearInterval(timer)
}

/** One sweep, when this member may keep the list; a declaration that cannot be read sweeps nothing. */
async function sweepOnce(places: CrewToolPlaces, processes: HostContract['processes']): Promise<void> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared || !mayKeepTheOwnersList(theDeclarationOf(declared.settings), places.member)) return
  await sweepTheList({ ...places.ledger, processes }, places.root).catch(() => undefined)
}

/** How often the mod is to read the crew channel, as the declaration gives it. */
async function theChannelReadAsk(places: CrewToolPlaces): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  return 'refused' in declared ? declared : { answer: String(declared.settings.channel_read_seconds) }
}

/** The next crew message to hand the session, or '' when none is waiting. */
async function theNextMessageAsk(places: CrewToolPlaces): Promise<CoreToolAnswer> {
  if (places.carrier === undefined) return { refused: 'this launch reads no crew channel' }
  return { answer: (await places.carrier.next()) ?? '' }
}

/**
 * The question the refresh flow is answered on (martha#255): what this session says about itself, and the one act it is
 * told to take. The mod makes it at a session's start and at every turn's end, and decides nothing itself.
 */
async function theSessionsAct(
  places: CrewToolPlaces,
  state: SessionState,
  args: Readonly<Record<string, unknown>>,
  from: string,
): Promise<CoreToolAnswer> {
  const question = theQuestionIn(args, from)
  if (typeof question === 'string') return { refused: question }
  // A switch whose report never came (martha#359): the mod reports the host's command before it asks this question
  // again, so a guard still open here is one no session is coming back for. It is closed without waiting — the host's
  // save may still land, and the record it leaves is what the next launch finishes.
  await closeTheGuardNoOneReported(places, state)
  const act: TheAct = await theRefreshAct(refreshPlacesOf(places, state), question)
  const ordered = theOrderOf(act)
  const switching = ordered.carry === 'none' ? await theModelOrder(places, state) : null
  keepWhatTheSessionSaid(places, state, question, act)
  return { answer: JSON.stringify(switching ?? ordered) }
}

/**
 * The line this member's session starts on: what the member's own row says it holds, and every act of that package
 * that was sent with no outcome recorded (martha#254 design line 53, test 10). The row is the member's, so a session
 * that resumes a package reads its predecessor's package and checks what became of what it sent, instead of hoping it
 * asks. Null when the member holds no package, or when nothing of it was left waiting.
 */
async function theLineToHandAtStart(places: CrewToolPlaces, state: SessionState): Promise<string | null> {
  const held = state.held ?? places.beats.read(places.member)
  const package_name = held?.holds ?? ''
  if (package_name === '') return null
  const sent = await whatWasSent(places.ledger, package_name)
  return theLineAStartingSessionIsHanded(package_name, sent.acts)
}

/** What each tool answers, over one place: every tool is one slice's answer, told to the member. */
function handlersOver(places: CrewToolPlaces, state: SessionState): Readonly<Record<CrewToolName, (args: Readonly<Record<string, unknown>>) => Promise<CoreToolAnswer>>> {
  const workerOf = (args: Readonly<Record<string, unknown>>): AWorker => ({ package: textOf(args['package']), member: places.member })
  return {
    report_progress: (args) => reportProgress(places, state, args),
    see_the_crew: () => seeTheCrewOf(places),
    [WHO_IS_FREE]: (args) => whoIsFreeOf(places, args),
    [READ_THE_RECEIPTS]: async () => {
      const declared = await crewOrRefusal(places)
      if ('refused' in declared) return declared
      return { answer: await whatBecameOfWhatISent(places.ledger, places.member, declared.settings.members.map((member) => member.name)) }
    },
    [SAY_TO_THE_CREW]: async (args) => {
      const declared = await crewOrRefusal(places)
      if ('refused' in declared) return declared
      const held = state.held === null ? places.beats.read(places.member) : state.held
      const sent = await sendACrewMessage(places.ledger, {
        member: places.member,
        roster: declared.settings.members.map((member) => member.name),
        package: held === null || held.holds === '' ? null : held.holds,
        to: args['to'],
        text: args['text'],
      })
      return 'refused' in sent ? { refused: sent.refused } : { answer: sent.told }
    },
    [LOG_A_MILESTONE]: async (args) => ({ answer: (await keepTheMilestone(places.ledger, { ...workerOf(args), event: args['event'], note: args['note'] })).told }),
    [PARK_A_MEMBER]: async (args) => moveThePark(places, args, parkAMember),
    [WAKE_A_MEMBER]: async (args) => moveThePark(places, args, unparkAMember),
    [SWITCH_YOUR_MODEL]: (args) => switchTheModel(places, args),
    [RETURN_TO_YOUR_OWN_MODEL]: (args) => returnTheModel(places, args),
    write_my_handover: async (args) => theHandoverTheMemberWrote(places, state, args),
    [REFRESH_THIS_SESSION]: async (args) => {
      const reason = textOf(args['reason'])
      if (reason === '') return { refused: 'a refresh says why in one line, and this one says nothing' }
      const asked = askAMemberToRefresh(places, places.member, reason, places.ledger.clock.now())
      if (asked !== undefined) return { refused: asked.refusal }
      return { answer: `Refresh asked: ${reason}. This session hands over at the end of this turn; write your handover when Martha asks for it.` }
    },
    what_was_sent: async (args) => ({ answer: (await whatWasSent(places.ledger, workerOf(args).package)).told }),
    note_what_became_of_an_act: async (args) => {
      const { announced_at, succeeded, detail } = args
      return { answer: (await noteWhatBecameOfAnAct(places.ledger, { ...workerOf(args), announced_at, succeeded, detail })).told }
    },
    [VERIFY_RANGE]: (args) => verifyTheRange(places, args),
    [LAND_BATCH]: (args) => landTheBatch(places, args),
    [FAST_FORWARD_AFTER_THE_OWNERS_YES]: (args) => fastForwardOntoTheApprovedTip(places, args),
    [WORKTREE_OPEN]: (args) => aWorktreeTool(places, openAWorktree, args),
    [WORKTREE_FINISH]: (args) => aWorktreeTool(places, finishAWorktree, args),
    [OWNER_TODO_ADD]: (args) => keepTheOwnersList(places, () => addAnAct(places.ledger, args, places.member)),
    [OWNER_TODO_DONE]: (args) => keepTheOwnersList(places, () => closeAnAct(places.ledger, args['id'], { by: 'member', member: places.member })),
  }
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

/** What the two worktree tools are given, or null when this place holds no processes or no declaration. */
const worktreesOf = (places: CrewToolPlaces): WorktreesRequest | null =>
  places.processes === undefined || places.settings === undefined ? null : { host: actingHost({ ...places, processes: places.processes }), settings: places.settings, member: places.member }

/** A landing's `told` or `refused`, as a tool answers it (martha#256). */
const asAnAnswer = (landing: { readonly told: string } | { readonly refused: string }): CoreToolAnswer =>
  'told' in landing ? { answer: landing.told } : { refused: landing.refused }

/** `verify_range`: the range a call names, checked by the slice that reads it and writes nothing (martha#256). */
async function verifyTheRange(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const asked = theRangeACallNames(args)
  if ('refused' in asked) return { refused: asked.refused }
  if (places.processes === undefined) return { refused: NO_ACTING_PLACE }
  return asAnAnswer(await verifyRange(actingHost({ ...places, processes: places.processes }), asked.ok))
}

/** `land_batch`: the batch a call names, landed as one integration branch by the slice that cuts it (martha#256). */
async function landTheBatch(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const asked = theBatchACallNames(args)
  if ('refused' in asked) return { refused: asked.refused }
  if (places.processes === undefined) return { refused: NO_ACTING_PLACE }
  return asAnAnswer(await landPassedWorkAsOneBatch(actingHost({ ...places, processes: places.processes }), places.member, asked.ok))
}

/** `fast_forward_after_the_owners_yes`: the default branch moved onto the approved tip (martha#256). */
async function fastForwardOntoTheApprovedTip(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const asked = theFastForwardACallNames(args)
  if ('refused' in asked) return { refused: asked.refused }
  if (places.processes === undefined) return { refused: NO_ACTING_PLACE }
  return asAnAnswer(await fastForwardAfterTheOwnersYes(actingHost({ ...places, processes: places.processes }), places.member, asked.ok))
}

/**
 * `worktree_open` and `worktree_finish`, or the refusal of a place that can act in none (martha#256). The slice's
 * own answer keeps the told/refused split, and it is carried through as it is: wrapping every string as `{ answer }`
 * would hand a member a refusal — a dirty worktree, an unpushed commit, another member's branch — as a success.
 */
async function aWorktreeTool(
  places: CrewToolPlaces,
  act: (request: WorktreesRequest, args: Readonly<Record<string, unknown>>) => Promise<WorktreeAnswer>,
  args: Readonly<Record<string, unknown>>,
): Promise<CoreToolAnswer> {
  const request = worktreesOf(places)
  return request === null ? { refused: NO_ACTING_PLACE } : asAnAnswer(await act(request, args))
}

/**
 * The row as this session last left it: what a report moves and the heartbeat rewrites. The model is this session's
 * own (martha#315): the one the launch gave it, and then the one a confirmed switch put it on, never the one a
 * heartbeat guessed.
 */
function rowNow(places: CrewToolPlaces, state: SessionState): DashboardRow {
  const kept = state.held ?? places.beats.read(places.member)
  const nothing_said = theRowWithNothingSaid()
  const host = { ...nothing_said.host, ...(kept?.host ?? {}), model: state.row_model }
  return { ...nothing_said, ...(kept ?? {}), member: places.member, session: state.session, at: places.ledger.clock.now(), host }
}

/** Keeps the row, in this process and on disk. */
function writeRow(places: CrewToolPlaces, state: SessionState, row: DashboardRow): void {
  state.held = row
  places.beats.keep(row)
}

/** `report_progress`: the report's own rules move the row, and the member is told what landed. */
async function reportProgress(places: CrewToolPlaces, state: SessionState, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return declared
  const before = rowNow(places, state)
  const report = takeProgress(args, declared.crew, { waits: before.waits, holds: before.holds }, places.ledger.clock.now())
  writeRow(places, state, {
    ...before,
    at: places.ledger.clock.now(),
    state: report.taken.state,
    task: report.taken.task,
    progress: report.taken.progress,
    waits: report.taken.waits,
    holds: report.taken.holds,
    reported_at: report.taken.reported_at,
  })
  const home = await returnedForAnotherPackage(places, report.taken.holds)
  return { answer: home === null ? report.told : `${report.told} ${home}` }
}

/**
 * `park_a_member` and `wake_a_member`: one act each over the crew's marker, and the member is told what landed. Both
 * read the same arguments — a reason, and whose park it is — so what a call must say is written once, and the act a
 * call moves is the tool's, never an argument's (martha#343): the `parked` flag this replaces was the only reason one
 * tool could be asked for two things, and a flag the tool could not read had to be refused (martha#255 part 2 r=1 R3).
 */
async function moveThePark(
  places: CrewToolPlaces,
  args: Readonly<Record<string, unknown>>,
  act: typeof parkAMember,
): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return declared
  const reason = textOf(args['reason'])
  if (reason === '') return { refused: 'a park or a wake says why in one line, and this one says nothing' }
  const member = textOf(args['member']) === '' ? places.member : textOf(args['member'])
  const names = declared.settings.members.map((one) => one.name)
  if (!names.includes(member)) return { refused: `${member} is not on this crew (its members are ${names.join(', ')}), so there is no park to move.` }
  const asked = { actor: places.member, member, reason, at: new Date(places.ledger.clock.now()), declaration: theDeclarationOf(declared.settings) }
  const said = act(places, asked)
  if ('refusal' in said) return { refused: said.refusal }
  const told = `${said.parked ? 'parked' : 'not parked'}: ${member} — ${said.reason}`
  const home = await theParkReturnsIt(places, act === parkAMember, said.parked)
  return { answer: home === null ? told : `${told} ${home}` }
}

/**
 * The return a park makes of it (martha#315): a member that parks is back on its own model, and the return happens on
 * the next turn's order rather than inside this call, because a host command cannot run inside a turn. Null when this
 * was a wake, or when the park was refused.
 */
async function theParkReturnsIt(places: CrewToolPlaces, isAPark: boolean, parked: boolean): Promise<string | null> {
  return isAPark && parked ? await returnedForTheTrigger(places, 'you parked') : null
}

/** The declaration as parking reads it: each member's name and role, and the table of who may what. */
const theDeclarationOf = (settings: CrewSettings): TheDeclaration => ({
  members: settings.members.map((member) => ({ name: member.name, role: member.role })),
  mode: { may: settings.mode.may },
})

/** `see_the_crew`: every member's row, and whether the declaration switches the pane on at a session's start. */
async function seeTheCrewOf(places: CrewToolPlaces): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return declared
  const seen = seeTheCrew(declared.settings, beatsOf(places.beats, declared.settings), places.ledger.clock.now())
  // The pane is the host's, and opens by itself only when the declaration switched it on (martha#254): one bit, read
  // from the declaration the launcher already read, so the mod decides nothing on its own. The interval it redraws on
  // is the beat's own, named here and read there, so the pane cannot drift from the beat the rows are written on
  // (part 2 r=2 R1): the host draws a `ui.render` once and caches it until a plugin invalidates it.
  // What it draws is answered as words (martha#255): its header, one line per member, and how many rows it asks for,
  // so the mod parses no row and formats nothing.
  return { answer: JSON.stringify(thePaneAnsweredBy(seen, declared.settings.house_rules.dashboard, READER_BEAT_MS)) }
}

/**
 * `who_is_free` (martha#319): the crew's rows and its park markers, handed to the slice that decides. The launch's own
 * member is the asker, never a name read out of the call, and only a role the declaration lets `assign_work` may ask.
 */
async function whoIsFreeOf(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return declared
  const parked = parkedPlace(places)
  const seen = seeTheCrew(declared.settings, beatsOf(places.beats, declared.settings), places.ledger.clock.now())
  return whoIsFreeOver({
    settings: declared.settings,
    asker: places.member,
    rows: seen.rows,
    parkOf: (member) => ('refusal' in parked ? { kind: 'unreadable', refusal: parked.refusal } : theParkOf(parked, member)),
    now: places.ledger.clock.now(),
    member: textOf(args['member']),
  })
}

/** The host's own reading of a session (martha#255), as the mod hands it over untouched. */
interface AHostsUsage {
  readonly context?: { readonly percent?: number | null }
  readonly cost?: { readonly usd?: number | null }
}

/** The host's usage, read as the object it is, or undefined when what arrived is not one. */
function usageIn(args: Readonly<Record<string, unknown>>): AHostsUsage | undefined {
  const usage = args['usage']
  return typeof usage === 'object' && usage !== null ? (usage as AHostsUsage) : undefined
}

/**
 * A share of the context limit as the host reports it, or 0 when it reports none this launcher can trust (martha#255).
 * The host's own number is taken as it comes: a session that says nothing about its context has not reached a limit.
 */
function aPercentOf(usage: AHostsUsage | undefined): number {
  const percent = usage?.context?.percent
  return typeof percent === 'number' && Number.isFinite(percent) ? percent : 0
}

/** What the session has cost as the host reports it, or null when it reports nothing this launcher can trust. */
function aCostOf(usage: AHostsUsage | undefined): number | null {
  const cost = usage?.cost?.usd
  return typeof cost === 'number' ? cost : null
}

/** What each field of the question must be, and what is said when it is not: read in order, the first miss refused. */
const QUESTION_FIELDS: readonly ((args: Readonly<Record<string, unknown>>) => string | undefined)[] = [
  (args) => (typeof args['turn_id'] === 'string' && typeof args['answer'] === 'string' ? undefined : 'the refresh question carries no turn, or no answer for one'),
]

/** The question the refresh flow is answered on, read strictly: a shape this launcher does not know is refused. */
function theQuestionIn(args: Readonly<Record<string, unknown>>, session_id: string): TheSessionsQuestion | string {
  const refused = QUESTION_FIELDS.map((holds) => holds(args)).find((said) => said !== undefined)
  if (refused !== undefined) return refused
  const usage = usageIn(args)
  const turn_id = args['turn_id'] as string
  // At a session's start the host stamps no turn, which is the one reading of "first question" there is (martha#255):
  // the mod reported the empty turn before, and now says nothing about it that could disagree with its own turn id.
  return { session_id, percent: aPercentOf(usage), cost_usd: aCostOf(usage), turn_id, answer: args['answer'] as string, at_start: turn_id === '' }
}

/**
 * Writes what the session reported about itself, and what the flow said it is doing, in ONE row write: the row store
 * keeps the newest beat and refuses one that is not newer, so two writes in the same millisecond would lose the second.
 */
function keepWhatTheSessionSaid(places: CrewToolPlaces, state: SessionState, question: TheSessionsQuestion, act: TheAct): void {
  const before = rowNow(places, state)
  writeRow(places, state, {
    ...before,
    needs: theNeedsAfter(state, before),
    session: question.session_id,
    at: places.ledger.clock.now(),
    host: { ...before.host, contextPercent: question.percent, costUsd: question.cost_usd },
    ...(act.refresh === undefined ? {} : { refresh: act.refresh }),
  })
}

/** The row's `needs` after this turn (martha#359): what the owner's file said, or its own line taken away again. */
function theNeedsAfter(state: SessionState, row: DashboardRow): string {
  const told = state.owner_needs
  if (told === null) return row.needs
  state.owner_needs = null
  if (told.why !== '') return told.why
  return row.needs === told.before ? '' : row.needs
}

/** The places the refresh flow decides over: the crew's own store, the row, the stamps, and where this session began. */
function refreshPlacesOf(places: CrewToolPlaces, state: SessionState): Parameters<typeof theRefreshAct>[0] {
  return {
    member: places.member,
    stores: places.stores,
    beats: places.beats,
    ...(places.stamps === undefined ? {} : { stamps: places.stamps }),
    root: places.root,
    documents: places.documents,
    models: places.models ?? [],
    ledger: places.ledger,
    began_at: state.began_at,
  }
}

/**
 * `write_my_handover`: the host writes the member's handover where the host chose and stamps it. A launch with no
 * stamps, or a call from a session this launch does not hold, refuses rather than writing a file nothing stamped —
 * which would be a handover no successor could inherit from (martha#16).
 */
function theHandoverTheMemberWrote(places: CrewToolPlaces, state: SessionState, args: Readonly<Record<string, unknown>>): CoreToolAnswer {
  if (places.stamps === undefined) return { refused: 'this launch keeps no handover stamps, so it writes no handover' }
  const session = places.sessions?.of(state.session)
  if (session === undefined) return { refused: 'this launch does not know the session this call came from, so no handover is stamped for it' }
  const wrote = theHandoverAToolWrote(
    { host: places, stamps: places.stamps, session, member: places.member, now: () => new Date(places.ledger.clock.now()) },
    args,
  )
  return 'answer' in wrote ? wrote : { refused: wrote.refusal }
}

/** The declaration, and the crew's names as a report's rules read them; or why it could not be read. */
async function crewOrRefusal(places: CrewToolPlaces): Promise<{ readonly crew: TheCrew; readonly settings: CrewSettings } | { readonly refused: string }> {
  try {
    const settings = await declareCrew(places.documents, places.root, places.models ?? [])
    return { crew: { owner: settings.owner, members: settings.members.map((member) => member.name) }, settings }
  } catch (error) {
    return { refused: `the crew's declaration could not be read: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The package an argument names, as the tool's own text; '' when it names none, which the ledger refuses. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Every member's beat, by name, for `seeTheCrew` to lay out in the declaration's order. */
function beatsOf(store: DashboardStore, settings: CrewSettings): Readonly<Record<string, DashboardRow>> {
  const held = store.all()
  const beats: Record<string, DashboardRow> = {}
  for (const member of settings.members) {
    const beat = held[member.name]
    if (beat !== undefined) beats[member.name] = beat
  }
  return beats
}

/** The stream a package's ledger lives in, for a reader that wants the name: one way to build it, in the ledger. */
export const ledgerStreamNameOf = ledgerStreamOf

// --- the model switch (martha#315) ---------------------------------------------------------------
//
// A member's model, switched for one package and returned home: the tool that asks for it, the record in the crew
// store (../switch_a_members_model), the ledger's checkpoint row for each, and the three return triggers. What the
// member is TOLD is decided here; what the host does about it is one order (../../refresh_a_member/the_refresh_flow.ts
// `CARRY_A_MODEL`) the mod carries out at the end of the turn, because a host command cannot run inside a turn that is
// waiting on the tool that asked for it.

/** `switch_your_model`: a model the declaration names, for one package, recorded and told. */
async function switchTheModel(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return declared
  const place = modelPlace(places)
  if ('refusal' in place) return { refused: place.refusal }
  const current = theModelOf(place, places.member)
  if (current.kind === 'unreadable') return { refused: current.refusal }
  // The tool's own argument is `reason`, as a park's and a wake's are; the record calls it why.
  const asked = theSwitchACallAsks({ model: args['model'], package: args['package'], why: args['reason'] }, declared.settings, places.member)
  if (typeof asked === 'string') return { refused: asked }
  const home = homeModelOf(declared.settings, places.member)
  const switched = switchAMembersModel(places, { ...asked, member: places.member, home, at: new Date(places.ledger.clock.now()) })
  if ('refusal' in switched) return { refused: switched.refusal }
  const notKept = await keepTheModelCheckpoint(places, switched.package, `switched to ${asked.model} for the package: ${asked.why}`)
  return { answer: `${whatASwitchTells(asked, home)}${notKept}` }
}

/** `return_to_your_own_model`: a switched member comes home, and nothing is directed when it is home already. */
async function returnTheModel(places: CrewToolPlaces, args: Readonly<Record<string, unknown>>): Promise<CoreToolAnswer> {
  const reason = textOf(args['reason'])
  if (reason === '') return { refused: 'a return says why in one line, and this one says nothing' }
  const place = modelPlace(places)
  if ('refusal' in place) return { refused: place.refusal }
  const current = theModelOf(place, places.member)
  if (current.kind === 'unreadable') return { refused: current.refusal }
  // A switch recorded and not yet directed is still a switch: the member asked for the other model and has changed its
  // mind before the end of the turn, so the record goes home and no order follows it (the switch never moved the
  // session). Reading this as "no switch is recorded" would keep the record switched and move the member anyway.
  if (current.kind !== 'switched') {
    return { answer: `${places.member} is on its own model already: no switch is recorded, so there is nothing to direct.` }
  }
  return { answer: await returnedHome(places, current.marker, reason) }
}

/**
 * What a switch tells the member: the model, the package, and every way it comes back — so the member never has to ask
 * when the switch ends. The home is always one the declaration names (martha#315 r=2 refuses a switch for a member
 * that declares none), so it is named here as the member will read it.
 */
function whatASwitchTells(asked: { readonly model: string; readonly package: string }, home: string): string {
  return (
    `Switching to ${asked.model} for ${asked.package} at the end of this turn; back to ${home} when you park, ` +
    `report progress on another package, or call ${RETURN_TO_YOUR_OWN_MODEL}.`
  )
}

/** A member returned home: the record written, the ledger told, and the member told what happens next. */
async function returnedHome(places: CrewToolPlaces, marker: ModelMarker, why: string): Promise<string> {
  const returned = returnAMemberHome(places, { member: places.member, marker, why, at: new Date(places.ledger.clock.now()) })
  if ('refusal' in returned) return `Not recorded: ${returned.refusal}.`
  const notKept = await keepTheModelCheckpoint(places, marker.package, `back from ${marker.model}: ${why}`)
  return `Back to ${marker.home} at the end of this turn: ${why}.${notKept}`
}

/** The return a park or a return tool makes of it, or null when this member is not switched. */
async function returnedForTheTrigger(places: CrewToolPlaces, why: string): Promise<string | null> {
  const place = modelPlace(places)
  if ('refusal' in place) return null
  const current = theModelOf(place, places.member)
  if (current.kind !== 'switched') return null
  return await returnedHome(places, current.marker, why)
}

/**
 * The return a report makes of it when it names another package: a member that moves on to new work is back on its own
 * model, unless the switch was made for the package it now holds (then it keeps the switch for that work).
 */
async function returnedForAnotherPackage(places: CrewToolPlaces, holds: string): Promise<string | null> {
  const place = modelPlace(places)
  if ('refusal' in place) return null
  const current = theModelOf(place, places.member)
  if (current.kind !== 'switched' || holds === '' || holds === current.marker.package) return null
  return await returnedHome(places, current.marker, `you reported progress on ${holds}`)
}

/**
 * The ledger's checkpoint row for a switch or a return (martha#315): one line on the package, so the owner can see what
 * a package cost on which model. The record in the crew store is what the return is decided by, so a row the ledger
 * would not keep is said to the member and changes nothing else.
 */
async function keepTheModelCheckpoint(places: CrewToolPlaces, package_name: string, note: string): Promise<string> {
  if (package_name === '') return ''
  try {
    await noteMilestone(places.ledger, { package: package_name, member: places.member, milestone: 'checkpoint_reached', note })
    return ''
  } catch (error) {
    return ` Note: the ledger did not keep this row (${error instanceof Error ? error.message : String(error)}), so the package's history is missing it.`
  }
}

/**
 * The order that makes a recorded switch real, or null when there is nothing to direct (martha#315): one exact shape,
 * `{carry: 'model', model}`, which the mod answers with the host's own model command once the turn has ended. The
 * record is marked directed before the order goes back, so the same switch is not handed over twice.
 *
 * Every model in a record is one the declaration names, because a switch is refused for a member that declares none
 * (r=2), so there is no model here that cannot be spelled as the host's command argument.
 */
async function theModelOrder(places: CrewToolPlaces, state: SessionState): Promise<TheOrder | null> {
  const place = modelPlace(places)
  if ('refusal' in place) return null
  const current = theModelOf(place, places.member)
  if (current.kind === 'unreadable') return null
  const marker = current.kind === 'switched' ? current.marker : current.last_marker
  if (marker === null || marker.directed) return null
  // One switch at a time (martha#359, R2): a switch whose host report has not come back yet still holds the owner's
  // lock, and this one waits for a later turn rather than against itself.
  if (state.guarded !== null) return null
  const ordered = await guardedOrder(places, state, marker)
  return ordered
}

/**
 * The order, with the owner's default guarded first (martha#359): the lock taken and the file snapshotted before the
 * order goes out, and the record kept beside the model record before the host runs anything. A guard that cannot be
 * taken refuses the switch — the record goes back to where the member is, and the owner reads why in its row.
 */
async function guardedOrder(places: CrewToolPlaces, state: SessionState, marker: ModelMarker): Promise<TheOrder | null> {
  const owners = places.owners_settings
  if (owners === undefined) return refuseTheSwitch(places, state, marker, noOwnersSettings(places))
  const guard = await guardTheOwnersDefault(owners)
  if ('refusal' in guard) return refuseTheSwitch(places, state, marker, guard.refusal)
  const kept = theOwnersDefaultKept(places, places.member, marker, guard.record)
  if ('refusal' in kept) {
    guard.lock.release()
    return null
  }
  const directed = theSwitchDirected(places, places.member, kept)
  if ('refusal' in directed) {
    guard.lock.release()
    return null
  }
  state.guarded = guard
  const model = marker.switched ? marker.model : marker.home
  return { carry: CARRY_A_MODEL, model }
}

/** A switch the launcher will not make, in the member's own row: the member stayed where it was, and the owner is told. */
function refuseTheSwitch(places: CrewToolPlaces, state: SessionState, marker: ModelMarker, why: string): null {
  theSwitchRefused(places, places.member, marker, why, new Date(places.ledger.clock.now()))
  state.owner_needs = { why, before: '' }
  return null
}

/** Why a switch is refused when the launch cannot name the owner's settings file: the one file it would have to undo. */
const noOwnersSettings = (places: CrewToolPlaces): string =>
  `this launch cannot name the settings file Claude Code saves a model into, so a switch to ${places.member} could not be undone and none was made`

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
  const putBack = await theOwnersDefaultPutBack(places, state)
  state.row_model = model
  writeRow(places, state, rowAfterASwitch(places, state, putBack))
  const noted = `Noted: this row says ${model}.`
  return { answer: putBack.why === '' ? noted : `${noted} ${putBack.why}` }
}

/** What a switch left for the owner: the line that needs them, and the line the row said before it, so it can be cleared. */
interface TheOwnersDefaultTold {
  readonly why: string
  readonly before: string
}

/**
 * Steps 4 to 6 of a switch (martha#359), in the launcher's own process: wait for the file to show the host's save, keep
 * the record before the restore, put the owner's model back when nothing else moved, and give the lock back. A switch
 * whose save never showed keeps its record: the next launch finishes it by the hash the record holds.
 */
async function theOwnersDefaultPutBack(places: CrewToolPlaces, state: SessionState): Promise<TheOwnersDefaultTold> {
  const guard = state.guarded
  state.guarded = null
  const owners = places.owners_settings
  if (guard === null || owners === undefined) return { why: '', before: '' }
  try {
    return theOwnersDefaultAnswered(places, owners, guard, await theSaveInTheFile(owners, guard))
  } finally {
    guard.lock.release()
  }
}

/**
 * A guard whose report never came, closed at the next turn's question (martha#359): one look at the file, the restore
 * if the host's save is there, and the record kept when it is not, so the next launch finishes what this session
 * cannot. The lock is given back either way, so a host that never reports does not stop every later switch.
 */
async function closeTheGuardNoOneReported(places: CrewToolPlaces, state: SessionState): Promise<TheOwnersDefaultTold> {
  const guard = state.guarded
  state.guarded = null
  const owners = places.owners_settings
  if (guard === null || owners === undefined) return { why: '', before: '' }
  try {
    const told = theOwnersDefaultAnswered(places, owners, guard, theSaveSeenNow(owners, guard) ?? theSaveThatNeverShowed(owners, guard.record))
    state.owner_needs = told
    return told
  } finally {
    guard.lock.release()
  }
}

/** The restore itself, over one guarded switch and what the file showed of it: the record kept, and the row's line. */
function theOwnersDefaultAnswered(places: CrewToolPlaces, owners: OwnersDefaultPlace, guard: AGuardedSwitch, seen: TheSaveSeen): TheOwnersDefaultTold {
  const place = modelPlace(places)
  if ('refusal' in place) return { why: seen.why, before: '' }
  const current = theModelOf(place, places.member)
  const marker = current.kind === 'switched' ? current.marker : current.kind === 'home' ? current.last_marker : null
  if (marker === null) return { why: seen.why, before: '' }
  const before = marker.settings?.why ?? ''
  if (!seen.moved) {
    theOwnersDefaultKept(places, places.member, marker, seen.record)
    return { why: seen.why, before }
  }
  const after = putTheOwnersModelBack(owners, guard, seen.record)
  theOwnersDefaultKept(places, places.member, marker, after.record)
  return { why: after.why, before }
}

/** The row after a switch: the model reported, and the line that needs the owner when the file was not put back. */
function rowAfterASwitch(places: CrewToolPlaces, state: SessionState, told: TheOwnersDefaultTold): DashboardRow {
  const row = rowNow(places, state)
  if (told.why !== '') return { ...row, needs: told.why }
  return row.needs === told.before ? { ...row, needs: '' } : row
}

/**
 * The reviewer-model rule, as the launcher's tool-call verdict asks it (martha#315): the crew's `house_rules`
 * `review_model`, the adapter's own data on which tool spawns a subagent and under which fields. A launch that cannot
 * say what a host's spawn looks like refuses a review rather than letting it run unheld: the rule is the crew's, and a
 * launcher that cannot judge it is not one that may pass it.
 */
async function refusesTheSubagent(places: CrewToolPlaces, call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>> }): Promise<string | undefined> {
  const declared = await crewOrRefusal(places)
  if ('refused' in declared) return undefined
  if (declared.settings.house_rules.review_model === null) return undefined
  if (places.spawn === undefined) {
    return `${call.tool} is not run: this crew holds reviews to ${declared.settings.house_rules.review_model}, and this launch cannot say which tool spawns a subagent, so no review may run.`
  }
  return reviewModelRefusal(call, { spawn: places.spawn, review_model: declared.settings.house_rules.review_model })
}
