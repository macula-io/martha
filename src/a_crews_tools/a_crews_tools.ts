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
import { readTheChannel } from '../keep_the_crew_channel/crew_channel.ts'
import { readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import {
  nudgesOf,
  reviewWaitsIn,
  theNudgesGoTo,
  theNudgesPartLines,
  windowsOf,
  type SentMessage,
} from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { landedPackagesOf } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { deadlockNudges } from '../watch_waits/watch_waits.ts'
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
import { BEAT_INTERVAL_MS, IDLE, type DashboardRow, type DashboardStore } from '../show_dashboard_beat/show_dashboard_beat.ts'

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

/** The names the crew's tools are registered under, and the only ones the launcher answers. */
export const CREW_TOOL_NAMES = [
  'report_progress',
  LOG_A_MILESTONE,
  'what_was_sent',
  'note_what_became_of_an_act',
  'see_the_crew',
  SAY_TO_THE_CREW,
  READ_THE_RECEIPTS,
  PARK_A_MEMBER,
  WAKE_A_MEMBER,
  WRITE_MY_HANDOVER_TOOL,
  REFRESH_THIS_SESSION,
  VERIFY_RANGE,
  LAND_BATCH,
  FAST_FORWARD_AFTER_THE_OWNERS_YES,
  WORKTREE_OPEN,
  WORKTREE_FINISH,
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
  /** The crew's dashboard rows: one per member, kept by the host (../launch_a_claude_code_member/dashboard_rows_in_state). */
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
   * The line a session starting on a package is handed, once, at its start (martha#254 design, test 10): every act of
   * the package this member holds that was sent with no outcome recorded, oldest first, or null when it holds no
   * package or nothing of it was left waiting.
   */
  theLineToHandAtStart(): Promise<string | null>
  /**
   * The session a clear was told in, when the crew's flow is waiting for its successor and this id is it (martha#255):
   * the launcher starts that session as a `crew_refresh` with this predecessor, whichever of the host's two events
   * names it first. Null when no clear is in flight, or when this id is the session the clear was told in.
   */
  thePredecessorOf(session_id: string): Promise<string | null>
}

/** The schema shared by the tools that name a package, which every one of the ledger's tools does. */
const A_PACKAGE: Readonly<Record<string, unknown>> = { type: 'string', description: 'The work package, owner/repo#n, as the issue is named' }

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
]

/** What one place's tools hold between calls: the row as this session last left it, and its session id. */
interface SessionState {
  held: DashboardRow | null
  session: string
  /** The share each session began at, by session id (martha#255): every refresh threshold is measured from it. */
  readonly began_at: Map<string, number>
}

/** The tools a member can call, over the place its launcher gave it. */
export function crewToolsOver(places: CrewToolPlaces): CrewTools {
  const state: SessionState = { held: null, session: '', began_at: places.began_at ?? new Map<string, number>() }
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
    theLineToHandAtStart: () => theLineToHandAtStart(places, state),
    thePredecessorOf: (session_id) => thePredecessorOf(places, session_id),
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
  return undefined
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
  const act: TheAct = await theRefreshAct(refreshPlacesOf(places, state), question)
  keepWhatTheSessionSaid(places, state, question, act)
  return { answer: JSON.stringify(theOrderOf(act)) }
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
 * What a member that has reported nothing reads as, until its first report moves its row: `idle`, never `working`
 * (martha#254 test 7, r=1 R2). The heartbeat runs from the launch, before the member has said anything about itself,
 * so a row written with `working` here would make every live member read as working and no live member ever read
 * idle. What the member is doing is only ever the member's own report.
 */
const A_MEMBER_WITH_NO_BEAT = {
  state: IDLE,
  holds: '',
  task: '',
  progress: { step: 0, of: 1 },
  waits: null,
  needs: '',
  host: { model: '', provider: '', contextPercent: null, costUsd: null },
} satisfies Omit<DashboardRow, 'member' | 'session' | 'at'>

/** The row as this session last left it: what a report moves and the heartbeat rewrites. */
function rowNow(places: CrewToolPlaces, state: SessionState): DashboardRow {
  const kept = state.held ?? places.beats.read(places.member)
  return { ...A_MEMBER_WITH_NO_BEAT, ...(kept ?? {}), member: places.member, session: state.session, at: places.ledger.clock.now() }
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
  })
  return { answer: report.told }
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
  return { answer: `${said.parked ? 'parked' : 'not parked'}: ${member} — ${said.reason}` }
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
  const nudges = await theNudgesFor(places, declared.settings, beatsOf(places.beats, declared.settings))
  return { answer: JSON.stringify(thePaneAnsweredBy(seen, declared.settings.house_rules.dashboard, READER_BEAT_MS, nudges)) }
}

/**
 * The nudges this member is told, as the lines its pane draws (martha#320), or none: a crew that reads no nudges, and a
 * member the mode's table grants nobody's work to, are told nothing. The rules run here, in the launcher, and the session
 * draws what they answered; nothing here acts on what it finds.
 */
async function theNudgesFor(places: CrewToolPlaces, settings: CrewSettings, rows: Readonly<Record<string, DashboardRow>>): Promise<readonly string[]> {
  if (!settings.house_rules.nudges) return []
  const receivers = theNudgesGoTo(settings)
  if (!receivers.some((receiver) => receiver.toLowerCase() === places.member.toLowerCase())) return []
  const channel = await readTheChannel(places.ledger)
  const messages: SentMessage[] = channel.map(({ message }) => ({ from: message.from, to: message.to, text: message.text, sent_at: message.sent_at }))
  const waits = reviewWaitsIn(messages, await landedPackagesOf(places.ledger, packagesNamed(messages)), receivers)
  const input = { rows: Object.values(rows), waits, parked: parkedMembersOf(places, settings), windows: windowsOf(settings.house_rules), now: places.ledger.clock.now(), owner: settings.owner, receivers }
  return theNudgesPartLines(nudgesOf(input, deadlockNudges(input)), settings)
}

/** The packages the crew's own lines name: the only ones a wait can be about, so the only ledgers a landing is read in. */
function packagesNamed(messages: readonly SentMessage[]): readonly string[] {
  const named = messages.flatMap((message) => {
    const read = readACrewLine(message.text)
    return 'line' in read && read.line !== null ? [read.line.package] : []
  })
  return [...new Set(named)]
}

/** The members whose park marker says they are parked, or none when the crew's store will not answer (martha#255): a
 * store that cannot say is not the same fact as a member nobody parked, and a reader that cannot say reads no park. */
function parkedMembersOf(places: CrewToolPlaces, settings: CrewSettings): readonly string[] {
  const place = parkedPlace(places)
  if ('refusal' in place) return []
  return settings.members.flatMap((member) => (theParkOf(place, member.name).kind === 'parked' ? [member.name] : []))
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
    session: question.session_id,
    at: places.ledger.clock.now(),
    host: { ...before.host, contextPercent: question.percent, costUsd: question.cost_usd },
    ...(act.refresh === undefined ? {} : { refresh: act.refresh }),
  })
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
    const settings = await declareCrew(places.documents, places.root)
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
