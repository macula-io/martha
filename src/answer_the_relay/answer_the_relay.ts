// What a member's launcher answers its relay (#41).
//
// This exists so every gate the core keeps is asked, in the launcher, about
// each event the member's host raises, and so every event the launcher cannot
// vouch for is refused.
//
// The relay (../claude_code_relay) forwards the engine's fields unchanged and
// holds no policy. Everything is decided here, by the core, through the
// adapter's mappings (../claude_code_host):
//
// | Event the relay posts | What the launcher does |
// |---|---|
// | session_started (the settings SessionStart hook's input) | the outcome `CLAUDE_CODE_SESSION_EVENTS` gives `sessionStartOf(input)`'s event, handed to the entry's `aSessionStarted`: it starts the session, takes in each source the launch hands the model by itself (`handed_at_start`, martha#121) and the crew's start line, keeps the record, and answers what the session is handed (martha#541) |
// | prompt_submitted (`text`, the engine's `origin`, `command`, `isMeta`) | `arrivalOfPrompt(kinds, origin.kind, whatAPromptCarries(body))`, handed to the entry's `aTurnArrived`, which takes it in and keeps the record; a kept turn is then heard, raised, and handed back as `aReviewTheHostSawFail` with the origin the engine stamped (martha#390, martha#541) |
// | the mod's `a_turn_started` ask (a main turn's `turnId` and `text`; martha#440) | the crew's answer first, which is the carrier's decision on the crew message the turn took in; then `hearAMainTurnStart`: that message, if `prompt_submitted` never heard it, `takeInTurn` as a plugin's prompt; a turn with no message that no heard prompt started (its text, or a slash command's line), `takeInTurn` from an unknown origin and one journal line `A_TURN_OF_UNNAMED_SOURCE`; each then keeps the record and tells the screen a turn started |
// | tool_called (the engine's call) | the call in the contract's words (`ACalledTool`), handed to the entry's `aToolCalled`, which reads the session's stored record back, asks the two refusals this adapter closes over its own files (the owner's settings, martha#122; their memory, martha#136), then `answerToolCall`, then beside the gate the crew's reviewer rule and the workspace guard's first seam (martha#562: the shell line read into its git calls), and counts an allowed call (martha#513, martha#541); an allowed call is answered `{allow: 1}` and closes the dialog it raised (martha#313) |
// | tool_answered (the same call, after it ran, with the host's answer) | the dialogs the call raised closed (martha#313), then the result in the contract's words (`AResultOfACall`: whether the name is an MCP server's, the agent `tool_response.agentId` names, the model a spawned agent resolved to), handed to the entry's `aResultCame` (martha#541, PR 3), which does what follows and answers taken or stop: the member's own write kept (martha#132), then `recheckLaunchPassingOwnWrites(launch)`, the settings files read again for a key that turns the relay off (martha#122) or a hook or plugin the owner's user or managed settings now declare (martha#121), then for an MCP tool `takeInTurn(session, { source: sourceOfAMeshToolResult(ownName) }, binder)`: a ring's answer on A5, what answering a ring returns on A4, any other result on B2 — except a `mesh_hello` or `mesh_goodbye` answer whose every leaf came from this launch (`wordsInAMeshAnswer`), which takes nothing in and keeps the member's shell (B9, martha#251); and for one of the host's own `takeInToolResult(session, { tool, input, rows: CLAUDE_CODE_TOOL_RESULT_ROWS, launch, approved_start, host }, binder)`, where `approved_start` is the checkout's tree read when the relay was made, kept only when that state is one the owner approved (martha#127), except a `martha run <name>` whose answer is exactly the one its receipt builds, which records nothing (martha#129) |
//
// Failing closed, per event, so the relay never chooses (Mars's point 3):
//
//   - a session with no start taken, or whose record could not be kept, is
//     refused: its prompts are dropped and its tools denied, for the rest of
//     this process. A refused append (ROW_NOT_DURABLE among them) is never "allow,
//     the row failed";
//   - after a tool ran, anything but a clean recheck and a kept record stops the
//     member: the launcher sends SIGKILL to its process group, and the relay's
//     request is never answered, so the hook never returns;
//   - a body not in the shape the relay sends is refused like the rest.
//
// Events are answered one at a time, in the order they arrive: a host runs tool
// calls in parallel, and each answer reads the record the one before it wrote.
// That order, the sessions it is kept for and the record of each are the entry's
// (../answer_what_a_host_reports, martha#541): this adapter translates what the host
// says into the entry's words, and reads nothing from the host's shapes that the
// entry would need to. Since PR 3 every report is answered there, an agent's start
// and stop and the crew's tool ask included; what stays here is the translation,
// the owner's screen, the signed runs' `run` and the guard's two git judgements.

import type { Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { ApprovedLaunch } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { agentRunsKept, answersOver, NO_CREW_TOOLS, type TheAnswersOfOneLaunch, type ThePlacesAHostReportsOver } from '../answer_what_a_host_reports/answer_what_a_host_reports.ts'
/** What a session is handed as it starts: the entry's since martha#541, and named here still for the tests that import it. */
export { handedAtThisStart } from '../answer_what_a_host_reports/answer_what_a_host_reports.ts'
import { CLAUDE_CODE_SESSION_EVENTS, outcomeOfAStart, type SessionStart } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import {
  CLAUDE_CODE_READ_ATTACHES_NOTHING,
  CLAUDE_CODE_TOOL_RESULT_ROWS,
  isMcpToolCall,
  sessionStartOf,
  type SessionStartHookInput,
} from '../claude_code_host/claude_code_host.ts'
import { namesTheOwnersSettings, type HookSettingsWatch } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import type { ACalledTool, AnAgentOfASession, AResultOfACall, AStartingSession, TheAnswerToAnAgent, ToolNames, TurnSource } from '../host_contract/host_contract.ts'
import { reviewSpawnsRemembered, type TheReviewSpawns } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { resolvedModelIn } from '../read_what_claude_code_says_of_an_agent/the_agent_calls_answer.ts'
import { agentIdOf, type TheRunTable } from '../vouch_for_the_agents_a_session_started/vouch_for_the_agents_a_session_started.ts'
import { THE_HOSTS_FAILED_REVIEW } from '../claude_code_host/the_failed_reviews_envelope.ts'
import type { WhatTheLaunchSupplies } from '../prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts'
import { arrivalOfPrompt, CLAUDE_CODE_PROMPT_ORIGINS, whatAPromptCarries } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import { hearingEveryTurn, theCommandNamed, type HearingEveryTurn } from '../hear_every_turn_the_model_runs/hear_every_turn_the_model_runs.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import type { StartedWith } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { theAgentInAToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { ALLOW, TAKEN, type Answered, type Ran, type RelayEvent, type Refused, type Taken, type TakenWithAHandedLine, type Verdict } from '../claude_code_relay/hooks/relay_protocol.ts'
import type { CrewTools } from '../a_crews_tools/a_crews_tools.ts'
import type { GateMode } from '../read_the_gate_mode/read_the_gate_mode.ts'
import type { GateAuditPlace } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import type { TheScreenKeeper } from '../say_what_the_host_is_asking/the_owners_screen.ts'
import { theCallIn, TOOL_CHECK, whatTheHostSaidOf } from '../hear_the_hosts_dialogs/hear_the_hosts_dialogs.ts'
import type { TurnRaising } from '../raise_a_turn_to_the_member/raise_a_turn_to_the_member.ts'
import type { SignedRuns } from '../run_an_owner_signed_command/signed_runs.ts'
import { rememberOwnWriteOfCall } from '../launch_a_claude_code_member/remember_own_write_of_a_call.ts'
import type { JournalAnswer, RelayJournal } from '../keep_the_relays_journal/keep_the_relays_journal.ts'
import type { SessionRecords } from '../session_records_in_rows/session_records_in_rows.ts'
import { writesTheOwnersMemory, type OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { theGitCallJudged, theRefTransactionJudged, type AGuardsAnswer } from '../guard_the_git_a_member_runs/judge_a_guards_question.ts'

/** What the launcher sends back, or that it is stopping the member and sends nothing. */
export type RelayReply =
  | { readonly answered: true; readonly body: Taken | TakenWithAHandedLine | Refused | Verdict }
  | { readonly answered: false; readonly stopping: string }

export interface MemberRelay {
  answer(event: RelayEvent, body: unknown): Promise<RelayReply>
  /**
   * A tool call the crew's mod posted (martha#254): the core's answer, unchanged, or a refusal naming the tool this
   * launcher registers nothing for. Answered on its own, not through the event queue, so a tool call never waits
   * behind a turn's events.
   */
  answerTool(body: unknown): Promise<Answered | Refused>
  /** `martha run <name>` asks for a signed shape (martha#129); answered outside the event queue, as a run takes long. */
  run(body: unknown): Promise<Ran | Refused>
  /**
   * The `git` the launch put first on the member's PATH asks about a call it is about to run (martha#562, seam b).
   * Answered outside the event queue: the shim is a program waiting in the member's shell.
   */
  judgeAGitCall(body: unknown): Promise<AGuardsAnswer>
  /**
   * The clone's `reference-transaction` hook asks about the refs a transaction would update (martha#562, seam c), for a
   * delete that reached git past the shell and past the shim. Answered outside the event queue, as the shim's is.
   */
  judgeARefTransaction(body: unknown): Promise<AGuardsAnswer>
}

export interface MemberRelayPlace {
  readonly records: SessionRecords
  /** The member's launch, as `prepareLaunch` was given it. */
  readonly launch: ApprovedLaunch
  readonly policy: Policy
  /** How the host names a called tool: the adapter's `host.tools`. */
  readonly names: ToolNames
  /**
   * What this launch started the host with, down to the names its adapter declares (martha#135): the arguments and
   * environment `spawn` got, so a read's exemption can ask what really started the host.
   */
  readonly started_with: StartedWith
  /** `bindNothing` until the host attests a sender (A6, anthropics/claude-code#107216). */
  readonly binder: Binder
  /**
   * What the launch puts into every session it starts by itself, which the
   * owner's approval does not bind: an approved hook's output (A7), a server's
   * instruction block (A11). The adapter's `sourcesALaunchHandsTheModel`.
   */
  readonly handed_at_start: readonly TurnSource[]
  /** The settings files the host reads, watched for a key that turns the relay off (martha#122). */
  readonly hookSettings: HookSettingsWatch
  /**
   * What the gate does to this member (martha#321): the launcher reads it from the declaration once and hands it here,
   * and every answer this relay gives follows it. Absent means enforced, so a place built by a caller that has not
   * heard of the setting keeps the guard.
   */
  readonly gate?: GateMode
  /**
   * Where an audited member's would-be refusals are kept (martha#321). Absent, an audited member's call is refused: the
   * audit never runs without a place to write its evidence.
   */
  readonly audit?: GateAuditPlace | undefined
  /** Where the owner's sessions load memory and instructions from, which a member does not write (martha#136). */
  readonly ownerMemory: OwnerMemoryPlaces
  /** The member's signed runs (martha#129); a member without them runs no shape. */
  readonly signed_runs?: SignedRuns
  /** The crew's tools, answered by the slices behind them (martha#254); a launch with none answers no tool. */
  readonly crew?: CrewTools
  /**
   * The crew text this launch hands every session it starts (martha#306): who the member is, the crew's practice,
   * its role and mode texts, the lines it sends and the crew's conventions, composed once at the launch from the
   * bytes the owner approved. Empty or absent, a session is handed only the acts line, as it was before this existed.
   */
  readonly crew_text?: string
  /**
   * What this launch supplied a mesh answer, and which answer may be read as the member's own (martha#251). Absent,
   * no MCP answer is read that way and every one records on B2, as it did before this existed: a caller that cannot
   * say what it supplied gets the taint, not a guess.
   */
  readonly wordless_answers?: Omit<WhatTheLaunchSupplies, 'input'>
  /**
   * What this launch raises every turn the host took in to (martha#253): the crew channel's readers wait on it, so a
   * message is counted as taken in only when the host raised it back. A launch given none raises nothing, and a turn
   * is still recorded.
   */
  readonly turns?: TurnRaising
  /**
   * What this launch is doing, for the run that waits on it (martha#240): a line when it receives an event and one when
   * it answers it. A run watching a launcher with none reads the terminal and the requests alone, as #210 left it.
   */
  readonly journal?: RelayJournal
  /**
   * The owner's dashboard as this launch keeps it (martha#313): the host's dialogs move the member's row, and the bell
   * is the row's change. A launch given none writes no row and rings nothing.
   */
  readonly screen?: TheScreenKeeper
  /**
   * Where a line of Martha's own about this member goes (martha#390): its row, and the member's own session. Absent, a
   * launch tells neither and every other answer is as it was.
   */
  readonly telling?: TheMembersTelling
  /** Sends SIGKILL to the member's process group. */
  stopMember(why: string): void
}

/** The two places a line of Martha's own reaches this member (martha#390): the row the owner reads, and the member. */
export interface TheMembersTelling {
  /** The member's row: the line goes where the owner's dashboard reads what is waiting. */
  theRow(line: string): void
  /**
   * The member's own session: the line is handed to it as a turn, through the crew's own channel. `call` is the host's
   * id for the review the line is about, when the line is about one, so a refusal can be written down against it
   * (martha#430).
   */
  theMember(line: string, call?: string): Promise<void>
  /**
   * The line this launcher put in the row leaves it again (martha#390 r=1): the member has taken the matter up, so what
   * needed the owner no longer does. Only this launcher's own line goes — a line another owner wrote stays where it is.
   */
  takeTheLineBack(): void
}

/** Why a run is refused for a member launched without signed runs. */
export const NO_SIGNED_RUNS = 'this member was launched with no signed shapes to run'

const answered = (body: Taken | TakenWithAHandedLine | Refused | Verdict): RelayReply => ({ answered: true, body })
const refused = (why: string): RelayReply => answered({ refused: why })
const denied = (why: string): RelayReply => answered({ deny: why })

/** What the journal's answer line says: the one word a run reading it needs, without the launcher's whole answer. */
const journalAnswerOf = (reply: RelayReply): JournalAnswer => {
  if (!reply.answered) return 'stopped'
  if ('allow' in reply.body) return 'allow'
  if ('deny' in reply.body) return 'deny'
  if ('taken' in reply.body) return 'taken'
  return 'refused'
}

/** Why the launcher answered that, where the answer carries a reason; the journal keeps it beside the answer. */
const refusalReasonOf = (reply: RelayReply): string | undefined => {
  if (!reply.answered) return reply.stopping
  if ('deny' in reply.body) return reply.body.deny
  if ('refused' in reply.body) return reply.body.refused
  return undefined
}

type Body = Readonly<Record<string, unknown>>

const isBody = (value: unknown): value is Body => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** What one member's answers share: its place, and the entry that holds the sessions and the order they are answered in. */
interface RelayState {
  readonly place: MemberRelayPlace
  /**
   * What this launch answers from: its sessions, the record of each, one order its events are answered in, and the tree
   * the owner approved (../answer_what_a_host_reports). A handler that has not moved yet asks it here.
   */
  readonly answers: TheAnswersOfOneLaunch
  /** What this launch hears of its turns, every main turn start the mod reports included (martha#440). */
  readonly everyTurn: HearingEveryTurn
}

/** The launcher's answers for one member. */
export function memberRelay(place: MemberRelayPlace, sessions: Map<string, HostSession> = new Map<string, HostSession>()): MemberRelay {
  // One table of the reviews this launch allowed and one of its agents, each made once and handed to the entry, which
  // writes and reads both.
  const reviews = reviewSpawnsRemembered()
  const agents = agentRunsKept()
  const state: RelayState = {
    place,
    answers: answersOver(placesOfTheEntry(place, reviews, agents), sessions),
    everyTurn: hearingEveryTurn({ keep: async (id, arrival) => state.answers.aTurnTheHostNeverRaised(id, arrival), ...place, now }),
  }
  /**
   * Runs `work` after every piece of work already asked for, so it reads the record the one before it wrote. One queue
   * per launch, held by the entry: a handler that has not moved yet and one that has are answered in the same order.
   */
  const inOrder = state.answers.inOrder

  const stop = (why: string): RelayReply => stopMember(place, why)

  const handlers: Readonly<Record<RelayEvent, (body: Body) => Promise<RelayReply>>> = {
    session_started: async (body) => sessionStarted(state, body),
    prompt_submitted: async (body) => promptSubmitted(state, body),
    tool_called: async (body) => toolCalled(state, body),
    tool_answered: async (body) => toolAnswered(state, body),
    subagent_started: async (body) => subagentStarted(state, body),
    subagent_stopped: async (body) => subagentStopped(state, body),
    owner_dialog: async (body) => ownerDialog(state, body),
    tool_checked: async (body) => toolChecked(state, body),
  }

  /** What an event gets when its body is no body, or its handler failed. */
  const failed: Readonly<Record<RelayEvent, (why: string) => RelayReply>> = {
    session_started: refused,
    prompt_submitted: refused,
    tool_called: denied,
    tool_answered: stop,
    // An agent's start or stop this launcher cannot take in leaves the agent unvouched for, so its answer closes the
    // shell; the event itself is only refused, never the member stopped, because nothing ran.
    subagent_started: refused,
    subagent_stopped: refused,
    // A dialog or a check this launcher cannot read is refused and nothing else: neither is a gate on what the member
    // may do, and the host's own dialog still reaches the owner.
    owner_dialog: refused,
    tool_checked: refused,
  }

  return {
    answer: (event, body) => {
      // The receipt line is stamped here, synchronously, before the event queues: an event waiting its turn is timed
      // from when it arrived rather than from when the queue reached it (martha#240).
      const journaled = place.journal?.received(event, body)
      return inOrder(async () => {
        const reply = await answerOne(event, body)
        // Written before the answer goes back, so an event this launcher has answered is on disk at once.
        journaled?.answered(journalAnswerOf(reply), refusalReasonOf(reply))
        return reply
      })
    },
    run: async (body) => (place.signed_runs === undefined ? { refused: NO_SIGNED_RUNS } : place.signed_runs.run(body)),
    answerTool: async (body) => answerAToolAndHearItsTurn(state, body, inOrder),
    judgeAGitCall: async (body) => theGitCallJudged(place.crew, body),
    judgeARefTransaction: async (body) => theRefTransactionJudged(place.crew, body),
  }

  /** One event, answered; never throws, so the journal's answer line is written whatever the event did. */
  async function answerOne(event: RelayEvent, body: unknown): Promise<RelayReply> {
    if (!isBody(body)) return failed[event]('the relay sent no body the launcher reads')
    try {
      return await handlers[event](body)
    } catch (error) {
      return failed[event](`the launcher failed to answer (${error instanceof Error ? error.message : String(error)})`)
    }
  }
}


/** The moment the owner's row records, as the clock this process has: a beat's `at` is milliseconds since the epoch. */
const now = (): number => Date.now()

/**
 * What the host is asking the owner (martha#313): the member's row moves, and the owner's bell rings on the change.
 * Nothing is gated here and nothing is refused for the member: the host's own dialog is the owner's to answer, and a
 * hook this launcher cannot read is refused as an event, never as the member's work.
 */
function ownerDialog(state: RelayState, body: Body): RelayReply {
  const said = isText(body.hook) ? whatTheHostSaidOf(body.hook, isBody(body.fields) ? body.fields : {}) : undefined
  if (said === undefined || !isText(body.session_id)) return refused('the dialog the host raised is not one this launcher reads')
  state.place.screen?.heard(body.session_id, said, now())
  return answered(TAKEN)
}

/** A call the host has checked and not yet run (martha#313): the id the permission about it will be keyed by. */
function toolChecked(state: RelayState, body: Body): RelayReply {
  const said = isText(body.session_id) ? whatTheHostSaidOf(TOOL_CHECK, isBody(body.check) ? body.check : {}) : undefined
  if (said === undefined) return refused('the check the host ran names no call')
  state.place.screen?.heard(body.session_id as string, said, now())
  return answered(TAKEN)
}

/** What a launch with no crew place answers a tool call: the entry's since martha#541 PR 3, named here still for the tests that import it. */
export { NO_CREW_TOOLS } from '../answer_what_a_host_reports/answer_what_a_host_reports.ts'

/**
 * A tool call the crew's mod posted (martha#254): its session, the tool's own name, and its arguments, handed to the
 * entry, which takes a refreshed session in first and lets the crew's slice decide (martha#541, PR 3). The launcher
 * hands the answer back unchanged; a name the crew registers nothing for is refused by name, never answered as though
 * it had been.
 */
async function answerACoreTool(state: RelayState, body: unknown): Promise<Answered | Refused> {
  if (state.place.crew === undefined) return { refused: NO_CREW_TOOLS }
  const call = bodyOfAToolCall(body)
  if (call === undefined) return { refused: 'the tool call is not one this launcher reads: it wants a session, a tool and its arguments' }
  return state.answers.aCrewToolAsked(call)
}

/**
 * A tool call the mod posted, answered; and a main turn's start it reported, recorded among the host's events after the
 * carrier decided what the turn took in (martha#440): the record follows that decision, never one of its own.
 */
async function answerAToolAndHearItsTurn(state: RelayState, body: unknown, inOrder: (work: () => Promise<void>) => Promise<void>): Promise<Answered | Refused> {
  const answer = await answerACoreTool(state, body)
  const start = state.everyTurn.startIn(body, answer)
  if (start !== undefined) await inOrder(async () => state.everyTurn.recorded(start))
  return answer
}

/** A tool call's three fields, or undefined when the body is not one. */
function bodyOfAToolCall(body: unknown): { readonly session_id: string; readonly tool: string; readonly args: Readonly<Record<string, unknown>> } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { session_id, tool, args } = body as Record<string, unknown>
  if (typeof session_id !== 'string' || typeof tool !== 'string') return undefined
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return { session_id, tool, args: args as Readonly<Record<string, unknown>> }
}

/**
 * The entry's places for this launch: the record, the launch the owner approved, and the machine the launch gate reads
 * the checkout through. The same values this relay answers with, so the entry reads nothing the adapter does not.
 */
const placesOfTheEntry = (place: MemberRelayPlace, reviews: TheReviewSpawns, agents: TheRunTable): ThePlacesAHostReportsOver => ({
  records: place.records,
  launch: place.launch,
  machine: thisMachine,
  binder: place.binder,
  handed_at_start: place.handed_at_start,
  crew: place.crew,
  crew_text: place.crew_text,
  reviews,
  failed_review_report: THE_HOSTS_FAILED_REVIEW,
  told: place.telling,
  agents,
  policy: place.policy,
  names: place.names,
  gate: place.gate,
  audit: place.audit,
  signed_runs: place.signed_runs,
  // This host's own two decisions, closed over the files it reads, the launch's directory, the owner's home and the
  // machine (packages 2-4's design, row "2"): they stay here until each host has its own recorded fact set (#257 row 5).
  refusesAWriteToTheOwnersSettings: (input) => namesTheOwnersSettings(input, place.hookSettings.owners_file, place.launch.launch_dir, place.hookSettings.home),
  refusesAWriteToTheOwnersMemory: (tool, input) => writesTheOwnersMemory(tool, input, place.ownerMemory, place.launch.launch_dir, place.hookSettings.home, thisMachine),
  // What recording a result needs (PR 3): this host's own table and switches as values, and its two decisions over its
  // own files closed here, so the entry reads no Claude Code table and holds no path.
  results: {
    tool_result_rows: CLAUDE_CODE_TOOL_RESULT_ROWS,
    read_attaches_nothing: CLAUDE_CODE_READ_ATTACHES_NOTHING,
    started_with: place.started_with,
    wordless_answers: place.wordless_answers,
    noteWhatThisCallWrote: (call) => rememberOwnWriteOfCall(place.launch, { ...call, home: place.hookSettings.home }, thisMachine),
    checkTheSettingsStillHold: () => place.hookSettings.check(),
  },
  journal: place.journal,
})

function stopMember(place: MemberRelayPlace, why: string): RelayReply {
  place.stopMember(why)
  return { answered: false, stopping: why }
}

async function sessionStarted(state: RelayState, body: Body): Promise<RelayReply> {
  if (!isText(body.session_id) || !isText(body.source)) return refused('the session start names no session or no source')
  const answer = await state.answers.aSessionStarted(aStartingSessionOf(sessionStartOf(body as SessionStartHookInput)))
  if ('refused' in answer) return refused(answer.refused)
  return answered(answer.taken === '' ? TAKEN : { taken: 1, handed: answer.taken })
}

/**
 * The host's start in the contract's words: the outcome its own table gives the event, never the event's name
 * (martha#541). The hook names no predecessor (`sessionStartOf` reads only the event and the session), so none is
 * passed on: the one start that inherits is the crew's refresh, and the entry makes that one itself.
 */
function aStartingSessionOf(reported: SessionStart): AStartingSession {
  return { session_id: reported.session_id, outcome: outcomeOfAStart(CLAUDE_CODE_SESSION_EVENTS, reported.event) }
}

async function promptSubmitted(state: RelayState, body: Body): Promise<RelayReply> {
  const origin = body.origin
  if (typeof body.text !== 'string' || !isBody(origin) || !isText(origin.kind)) {
    return refused('the prompt carries no text or no origin the engine stamped')
  }
  const arrival = arrivalOfPrompt(CLAUDE_CODE_PROMPT_ORIGINS, origin.kind, whatAPromptCarries(body))
  const answer = await state.answers.aTurnArrived(body.session_id, { text: body.text, arrival })
  if ('refused' in answer) return refused(answer.refused)
  // Kept, so the session is one the entry holds, named by the id this prompt carried.
  const session_id = String(body.session_id)
  // Heard, so the turn it starts (or the running turn it is folded into) is in the record already (martha#440).
  state.everyTurn.heard(session_id, { text: body.text, command: theCommandNamed(body.command) })
  // A dialog an earlier turn left open is dropped as this turn starts (martha#313): a prompt nobody answered cannot pin
  // the row at "needs you" for the rest of the session. Only a prompt this launcher took in starts a turn.
  state.place.screen?.heard(session_id, { said: 'turn-started' }, now())
  // The turn is kept, so the host really took it in: it is raised to whatever waits on turns, in the shape the host
  // contract names (martha#253). A prompt this launcher refused is never raised.
  state.place.turns?.prompted(body.text, origin.kind, whatAPromptCarries(body))
  // Kept and raised, so the entry may name a review the host reports failed in it (martha#390): the origin is the one
  // the engine stamped, never read from the text.
  await state.answers.aReviewTheHostSawFail({ session_id, text: body.text, origin_kind: origin.kind })
  return answered(TAKEN)
}

function callOf(body: Body): { readonly tool: string; readonly input: Body; readonly agent_id: string | undefined; readonly id: string | undefined } | undefined {
  const call = body.call
  if (!isBody(call) || !isText(call.tool)) return undefined
  const { tool, ...input } = call
  const id = call['tool_use_id']
  return { tool, input, agent_id: agentIdOf(call), id: isText(id) ? id : undefined }
}

/** The host says an agent started under this session (martha#170), handed to the entry in the contract's words. */
async function subagentStarted(state: RelayState, body: Body): Promise<RelayReply> {
  return theAgentsAnswer(state, body, 'the agent start names no agent', async (agent) => state.answers.anAgentStarted(agent))
}

/**
 * The host says an agent stopped (martha#170), which is the only report of a background agent's answer; the entry
 * decides whether that answer is a subagent's text to record.
 */
async function subagentStopped(state: RelayState, body: Body): Promise<RelayReply> {
  return theAgentsAnswer(state, body, 'the agent stop names no agent', async (agent) => state.answers.anAgentStopped(agent))
}

/** An agent's start or stop, answered: a body that names no agent is refused, after why its session cannot be answered for when it cannot be. */
async function theAgentsAnswer(state: RelayState, body: Body, no_agent: string, ask: (agent: AnAgentOfASession) => Promise<TheAnswerToAnAgent>): Promise<RelayReply> {
  if (!isText(body.agent_id)) {
    const named = state.answers.named(body.session_id)
    return refused(typeof named === 'string' ? named : no_agent)
  }
  const answer = await ask({ session_id: isText(body.session_id) ? body.session_id : '', agent_id: body.agent_id })
  return 'refused' in answer ? refused(answer.refused) : answered(TAKEN)
}

/**
 * A tool call, in the contract's words, handed to the entry (martha#541, PR 2): the entry allows or denies it, and only
 * this adapter writes Claude Code's own yes. An allowed call then closes the dialog it raised (martha#313). That close
 * now comes after the entry told the turn's end the call is in flight, not just before (the ruling on PR 2's order,
 * option 1): neither reads the other's state, so nothing is granted or refused differently. If the close throws (the
 * bell's terminal write, say), the call is already in flight, so a held end waits until it expires (ruling D) instead
 * of riding on that call.
 */
async function toolCalled(state: RelayState, body: Body): Promise<RelayReply> {
  const call = callOf(body)
  // A body that names no tool is denied as before: why its session cannot be answered for first, when it cannot be.
  if (call === undefined) {
    const named = state.answers.named(body.session_id)
    return denied(typeof named === 'string' ? named : 'the tool call names no tool')
  }
  const answer = await state.answers.aToolCalled(aCalledToolOf(body, call))
  if ('denied' in answer) return denied(answer.denied)
  closeTheDialogTheCallRan(state, String(body.session_id), body, call)
  return answered(ALLOW)
}

/** The host's call in the contract's words: its session, the tool, the input, and the call's and the agent's ids where the host stamped them. */
function aCalledToolOf(body: Body, call: NonNullable<ReturnType<typeof callOf>>): ACalledTool {
  return {
    session_id: isText(body.session_id) ? body.session_id : '',
    tool: call.tool,
    input: call.input,
    ...(call.id === undefined ? {} : { call_id: call.id }),
    ...(call.agent_id === undefined ? {} : { agent_id: call.agent_id }),
  }
}

/**
 * The screen told that a call is about to run (martha#313). The host posts this before it checks the call and before it
 * asks the owner, so it opens the host's own menu and closes nothing: the close is the call's answer.
 */
function closeTheDialogTheCallRan(state: RelayState, session_id: string, body: Body, call: { readonly tool: string; readonly input: Body }): void {
  state.place.screen?.heard(session_id, { said: 'ran', call: theCallIn(body.call) ?? { tool: call.tool, input: call.input } }, now())
}

/**
 * A ran tool's report, in the contract's words, handed to the entry (martha#541, PR 3): the entry records it or says why
 * the member stops, and a taken result carries the end of the turn the launcher holds when it rides on this answer
 * (martha#311 ruling D). Only this adapter writes Claude Code's own answer. The dialogs the call raised are closed
 * first, under the same two conditions as before the move (the session is named, the call is named): the screen is no
 * gate, and no step of the entry reads it.
 */
async function toolAnswered(state: RelayState, body: Body): Promise<RelayReply> {
  const { place } = state
  const session = state.answers.named(body.session_id)
  const call = callOf(body)
  if (typeof session === 'string') return stopMember(place, session)
  if (call === undefined) return stopMember(place, 'a tool ran that the relay could not name')
  closeTheDialogsTheCallAnswered(place, session.id, body, call)
  const answer = await state.answers.aResultCame(aResultOfACallOf(body, call))
  if ('stop' in answer) return stopMember(place, answer.stop)
  return answered(answer.end_turn === undefined ? TAKEN : { ...TAKEN, end_turn: answer.end_turn })
}

/**
 * The host's result in the contract's words: the call as `aCalledToolOf` reads it, the answer untouched, and the three
 * facts the core needs read out of Claude Code's own answer here: whether the name is an MCP server's, the agent the
 * answer names (`tool_response.agentId`), and the model a spawned agent resolved to.
 */
function aResultOfACallOf(body: Body, call: NonNullable<ReturnType<typeof callOf>>): AResultOfACall {
  const names_agent = theAgentInAToolResult(body.answer)
  const resolved_model = resolvedModelIn(body.answer)
  return {
    ...aCalledToolOf(body, call),
    answer: body.answer,
    from_a_tool_server: isMcpToolCall(call.tool),
    ...(names_agent === undefined ? {} : { answer_names_agent: names_agent }),
    ...(resolved_model === undefined ? {} : { resolved_model }),
  }
}

/**
 * Every dialog a call raised, closed because that call was answered (martha#313): the permission the owner allowed
 * and the menu they picked from are both answered by the call's own answer, and by nothing before it.
 *
 * This is the close the row relies on, because it is the only event the host offers after the owner has answered. The
 * host posts the call (`tool_called`) before it checks it and before it asks (`tool_checked`, `owner_dialog`), and
 * nothing more until the call is answered. So a dialog an owner allowed stays on the row while the call runs: for a
 * long command that is the run's own length. That is the one limit this design accepts, and the row is otherwise the
 * truth.
 */
function closeTheDialogsTheCallAnswered(place: MemberRelayPlace, session_id: string, body: Body, call: { readonly tool: string; readonly input: Body }): void {
  place.screen?.heard(session_id, { said: 'answered', call: theCallIn(body.call) ?? { tool: call.tool, input: call.input } }, now())
}
