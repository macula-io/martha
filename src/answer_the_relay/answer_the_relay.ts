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
// | session_started (the settings SessionStart hook's input) | `startSession(store, CLAUDE_CODE_SESSION_EVENTS, sessionStartOf(input))`, then `takeInTurn` of each source the launch hands the model by itself (`handed_at_start`, martha#121), then keeps the record |
// | prompt_submitted (`text`, the engine's `origin`, `command`, `isMeta`) | `takeInTurn(session, arrivalOfPrompt(kinds, origin.kind, whatAPromptCarries(body)), binder)`, then keeps the record |
// | the mod's `a_turn_started` ask (a main turn's `turnId` and `text`; martha#440) | the crew's answer first, which is the carrier's decision on the crew message the turn took in; then `hearAMainTurnStart`: that message, if `prompt_submitted` never heard it, `takeInTurn` as a plugin's prompt; a turn with no message that no heard prompt started (its text, or a slash command's line), `takeInTurn` from an unknown origin and one journal line `A_TURN_OF_UNNAMED_SOURCE`; each then keeps the record and tells the screen a turn started |
// | tool_called (the engine's call) | the session's stored record read back, a call naming the owner's user settings file denied (martha#122), then `answerToolCall({ tool, session, policy, input, launch, names })`, and beside the gate the crew's reviewer rule and the workspace guard's first seam (martha#562: the shell line read into its git calls) |
// | tool_answered (the same call, after it ran, with the host's answer) | the member's own write kept (martha#132), then `recheckLaunchPassingOwnWrites(launch)`, the settings files read again for a key that turns the relay off (martha#122) or a hook or plugin the owner's user or managed settings now declare (martha#121), then for an MCP tool `takeInTurn(session, { source: sourceOfAMeshToolResult(ownName) }, binder)`: a ring's answer on A5, what answering a ring returns on A4, any other result on B2 — except a `mesh_hello` or `mesh_goodbye` answer whose every leaf came from this launch (`wordsInAMeshAnswer`), which takes nothing in and keeps the member's shell (B9, martha#251); and for one of the host's own `takeInToolResult(session, { tool, input, rows: CLAUDE_CODE_TOOL_RESULT_ROWS, launch, approved_start, host }, binder)`, where `approved_start` is the checkout's tree read when the relay was made, kept only when that state is one the owner approved (martha#127), except a `martha run <name>` whose answer is exactly the one its receipt builds, which records nothing (martha#129) |
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
// entry would need to. The handlers still answered here are the ones the packages
// after 1a move, and they ask the entry for the same state they used to hold.

import type { Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import { answerToolCall, whatTheCrewRefusesOfACall, type ApprovedLaunch } from '../answer_a_tool_call/answer_a_tool_call.ts'
import { answersOver, type TheAnswersOfOneLaunch, type ThePlacesAHostReportsOver } from '../answer_what_a_host_reports/answer_what_a_host_reports.ts'
import { noteTheCallCounted, theSpendACrewHolds } from '../hold_a_package_to_its_budget/the_budget_tools.ts'
import { CLAUDE_CODE_SESSION_EVENTS, THE_REFRESH_THE_MOD_RUNS, startSession, type SessionStart } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import {
  CLAUDE_CODE_READ_ATTACHES_NOTHING,
  CLAUDE_CODE_TOOL_RESULT_ROWS,
  isMcpToolCall,
  sessionStartOf,
  type SessionStartHookInput,
} from '../claude_code_host/claude_code_host.ts'
import { namesTheOwnersSettings, type HookSettingsWatch } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import type { Arrival, ToolNames, TurnSource } from '../host_contract/host_contract.ts'
import { nameTheFailedReviewIn, reviewSpawnsRemembered, type TheReviewSpawns } from '../name_a_review_the_host_reported_failed/name_the_review_the_host_reported_failed.ts'
import { keepWhatTheReviewResolvedTo } from '../read_what_claude_code_says_of_an_agent/the_agent_calls_answer.ts'
import { agentIdOf, agentOfAResult, agentsToHold, noteAnAgentsAnswer, noteTheAgentsCall, noteWhatItsCallsRead, runOf, vouchedRun, type AgentRun } from '../vouch_for_the_agents_a_session_started/vouch_for_the_agents_a_session_started.ts'
/** Whether a tool hands an agent's answer back: the host's own table places every one of these on the subagent row. */
const isAnAgentsAnswerTool = (tool: string): boolean => CLAUDE_CODE_TOOL_RESULT_ROWS[tool]?.reads === 'an_agents_answer'
import { THE_HOSTS_FAILED_REVIEW } from '../claude_code_host/the_failed_reviews_envelope.ts'
import { sourceOfAMeshToolResult } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { wordsInAMeshAnswer, type WhatTheLaunchSupplies } from '../prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts'
import { senderOfARingResult } from '../read_a_ring_results_sender/read_a_ring_results_sender.ts'
import { arrivalOfPrompt, CLAUDE_CODE_PROMPT_ORIGINS, whatAPromptCarries } from '../name_the_source_of_a_prompt/name_the_source_of_a_prompt.ts'
import { hearingEveryTurn, theCommandNamed, type HearingEveryTurn } from '../hear_every_turn_the_model_runs/hear_every_turn_the_model_runs.ts'
import type { Policy } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import { recheckLaunchPassingOwnWrites } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import type { StartedWith } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { takeInToolResult } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { ALLOW, TAKEN, type Answered, type Ran, type RelayEvent, type Refused, type Taken, type TakenWithAHandedLine, type Verdict } from '../claude_code_relay/hooks/relay_protocol.ts'
import { theContractACrewHolds, type CrewTools, type TheStartLine } from '../a_crews_tools/a_crews_tools.ts'
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
  /** The agents this host has started under a session, by the id the host stamps (martha#170). */
  readonly agents: Map<string, AgentRun>
  /** What this launch hears of its turns, every main turn start the mod reports included (martha#440). */
  readonly everyTurn: HearingEveryTurn
  /** The review calls this launcher allowed, by the host's id for the call, and what it resolved to (martha#390). */
  readonly reviews: TheReviewSpawns
}

/** The launcher's answers for one member. */
export function memberRelay(place: MemberRelayPlace, sessions: Map<string, HostSession> = new Map<string, HostSession>()): MemberRelay {
  const state: RelayState = {
    place,
    answers: answersOver(placesOfTheEntry(place), sessions),
    agents: new Map<string, AgentRun>(),
    everyTurn: hearingEveryTurn({ keep: async (id, arrival) => keepATurn(state, id, arrival), ...place, now }),
    reviews: reviewSpawnsRemembered(),
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

/** What a launch with no crew place answers a tool call: nothing, by name (martha#254). */
export const NO_CREW_TOOLS = 'this launch was given no crew place, so it answers no tool'

/**
 * A tool call the crew's mod posted (martha#254): its session, the tool's own name, and its arguments. The core's
 * slice decides the answer, and the launcher hands it back unchanged; a name the crew registers nothing for is
 * refused by name, never answered as though it had been.
 */
async function answerACoreTool(state: RelayState, body: unknown): Promise<Answered | Refused> {
  const place = state.place
  if (place.crew === undefined) return { refused: NO_CREW_TOOLS }
  const call = bodyOfAToolCall(body)
  if (call === undefined) return { refused: 'the tool call is not one this launcher reads: it wants a session, a tool and its arguments' }
  // The mod's question at a refreshed session's start is a tool call, and it can arrive before the host's own `clear`
  // start: taking the session in here is what makes the order of the host's two events not matter (martha#255).
  const why = await takeInARefreshedSession(state, call.session_id)
  if (why !== undefined) return { refused: why }
  return place.crew.answer(call.tool, call.args, call.session_id)
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

/** Takes a turn the host never raised as a prompt into its session's record (martha#440); false when it was not kept. */
async function keepATurn(state: RelayState, session_id: string, arrival: Arrival): Promise<boolean> {
  const session = state.answers.named(session_id)
  return typeof session !== 'string' && (await state.answers.keep(takeInTurn(session, arrival, state.place.binder))) === undefined
}

/** A tool call's three fields, or undefined when the body is not one. */
function bodyOfAToolCall(body: unknown): { readonly session_id: string; readonly tool: string; readonly args: Readonly<Record<string, unknown>> } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { session_id, tool, args } = body as Record<string, unknown>
  if (typeof session_id !== 'string' || typeof tool !== 'string') return undefined
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return undefined
  return { session_id, tool, args: args as Readonly<Record<string, unknown>> }
}

/** What a mesh tool's result is taken in as: its row, and the node id the result itself attests where the row's station attestation is really there (martha#247). */
function arrivalOfAMeshToolResult(own_name: string, input: unknown, answer: unknown): Arrival {
  const source = sourceOfAMeshToolResult(own_name)
  const sender = senderOfARingResult(own_name, input, answer)
  return sender === undefined ? { source: source as Exclude<TurnSource, 'cross_session'> } : { source: source as Exclude<TurnSource, 'cross_session'>, ...sender }
}

/**
 * The entry's places for this launch: the record, the launch the owner approved, and the machine the launch gate reads
 * the checkout through. The same values this relay answers with, so the entry reads nothing the adapter does not.
 */
const placesOfTheEntry = (place: MemberRelayPlace): ThePlacesAHostReportsOver => ({
  records: place.records,
  launch: place.launch,
  machine: thisMachine,
})

function stopMember(place: MemberRelayPlace, why: string): RelayReply {
  place.stopMember(why)
  return { answered: false, stopping: why }
}

async function sessionStarted(state: RelayState, body: Body): Promise<RelayReply> {
  if (!isText(body.session_id) || !isText(body.source)) return refused('the session start names no session or no source')
  const lost = state.answers.brokenBecause(body.session_id)
  if (lost !== undefined) return refused(lost)
  // A second start of a session this launch already holds changes nothing: re-beginning it would wipe the record the
  // first one kept, which is exactly the wipe a `clear` after a refresh would be (martha#255).
  if (state.answers.holds(body.session_id)) return answered(TAKEN)
  const reported = sessionStartOf(body as SessionStartHookInput)
  await state.answers.records.load(reported.session_id)
  const started = startSession(state.answers.records.store, CLAUDE_CODE_SESSION_EVENTS, await asTheCrewsRefresh(state, reported))
  const lineToStartOn = await theLineThisSessionStartsOn(state.place.crew)
  const why = await state.answers.keep(takenInAtStart(state, started, lineToStartOn))
  if (why !== undefined) return refused(why)
  return answerTheStart(state.place.crew_text, lineToStartOn)
}

/** The start's answer: taken, or taken with the crew text and the crew's start line handed to the session. */
function answerTheStart(crewText: string | undefined, line: TheStartLine | null): RelayReply {
  const toHand = handedAtThisStart(crewText, line?.line ?? null)
  return answered(toHand === '' ? TAKEN : { taken: 1, handed: toHand })
}

/**
 * A starting session with every source it is handed taken in: what the launch hands it, and what the crew's start line
 * carries (martha#317), before the record is kept. A line the record does not hold would reach the model with no gate
 * behind it.
 */
function takenInAtStart(state: RelayState, started: HostSession, line: TheStartLine | null): HostSession {
  return [...state.place.handed_at_start, ...(line?.taken_in ?? [])].reduce((session, source) => takeInTurn(session, { source }, state.place.binder), started)
}

/**
 * What this session takes in as it starts: the crew text, and then the line naming the acts it holds that were sent
 * with no outcome recorded (martha#254 test 10). One string, because the relay's answer carries one `handed` line and
 * the host puts it into the session before its first prompt; empty when there is neither, and then the start is
 * simply taken. A resumed, cleared or compacted session fires the host's start again and is handed both again, which
 * is the gap crew-code had: it told a member to read its card only at a fresh start (martha#306).
 */
export function handedAtThisStart(crewText: string | undefined, theLine: string | null): string {
  return [crewText === undefined ? '' : crewText.trim(), theLine === null ? '' : theLine.trim()].filter((part) => part !== '').join('\n\n')
}

/**
 * The start the crew's own refresh makes of a session, when this start is the successor's (martha#255): one the crew's
 * flow says it cleared from is started as `martha_refresh` with that predecessor, whatever the host called it. So a
 * `clear` after a refresh can never wipe the record the successor inherited. A session this launch already holds never
 * reaches here — its start was answered as taken — and one it holds is refused a predecessor by
 * `theRefreshTheSessionInherits`, so the refresh that made it stands.
 */
async function asTheCrewsRefresh(state: RelayState, reported: SessionStart): Promise<SessionStart> {
  const predecessor = await theRefreshTheSessionInherits(state, reported.session_id)
  return predecessor === null ? reported : { event: THE_REFRESH_THE_MOD_RUNS, session_id: reported.session_id, predecessor_id: predecessor }
}

/** The session a clear was told in, when this id is the one the crew is waiting for: the crew's own answer, or none. */
async function theRefreshTheSessionInherits(state: RelayState, session_id: string): Promise<string | null> {
  if (state.place.crew === undefined || state.answers.holds(session_id) || state.answers.brokenBecause(session_id) !== undefined) return null
  try {
    return await state.place.crew.thePredecessorOf(session_id)
  } catch {
    return null
  }
}

/**
 * Takes in a session the crew refreshed before the host's own start of it has been answered (martha#255): the mod's
 * question at its start, or the resume prompt it submits, can arrive first, and a session this launcher has not taken
 * in is refused. It is made here exactly as the host's start would make it — inheriting the predecessor's record.
 */
async function takeInARefreshedSession(state: RelayState, session_id: string): Promise<string | undefined> {
  if (state.answers.holds(session_id) || state.answers.brokenBecause(session_id) !== undefined) return undefined
  const predecessor = await theRefreshTheSessionInherits(state, session_id)
  if (predecessor === null) return undefined
  await state.answers.records.load(session_id)
  const started = startSession(state.answers.records.store, CLAUDE_CODE_SESSION_EVENTS, {
    event: THE_REFRESH_THE_MOD_RUNS,
    session_id,
    predecessor_id: predecessor,
  })
  const handed = state.place.handed_at_start.reduce((session, source) => takeInTurn(session, { source }, state.place.binder), started)
  return state.answers.keep(handed)
}

/**
 * The line this session is handed as it starts (martha#254 design line 53, test 10): the acts of the package this
 * member holds that were sent with no outcome recorded, so a session resuming a package checks what became of them
 * instead of hoping it asks. Null when the member holds no package, nothing of it is waiting, or the ledger cannot be
 * read — a start the ledger could not be read for is still a start, and the member can ask with what_was_sent.
 */
async function theLineThisSessionStartsOn(crew: CrewTools | undefined): Promise<TheStartLine | null> {
  if (crew === undefined) return null
  try {
    return await crew.theLineToHandAtStart()
  } catch {
    return null
  }
}

async function promptSubmitted(state: RelayState, body: Body): Promise<RelayReply> {
  const session = await theSessionOfAPrompt(state, body)
  if (typeof session === 'string') return refused(session)
  const origin = body.origin
  if (typeof body.text !== 'string' || !isBody(origin) || !isText(origin.kind)) {
    return refused('the prompt carries no text or no origin the engine stamped')
  }
  const arrival = arrivalOfPrompt(CLAUDE_CODE_PROMPT_ORIGINS, origin.kind, whatAPromptCarries(body))
  const why = await state.answers.keep(takeInTurn(session, arrival, state.place.binder))
  if (why !== undefined) return refused(why)
  // Heard, so the turn it starts (or the running turn it is folded into) is in the record already (martha#440).
  state.everyTurn.heard(session.id, { text: body.text, command: theCommandNamed(body.command) })
  // A dialog an earlier turn left open is dropped as this turn starts (martha#313): a prompt nobody answered cannot pin
  // the row at "needs you" for the rest of the session. Only a prompt this launcher took in starts a turn.
  state.place.screen?.heard(session.id, { said: 'turn-started' }, now())
  // The turn is kept, so the host really took it in: it is raised to whatever waits on turns, in the shape the host
  // contract names (martha#253). A prompt this launcher refused is never raised.
  state.place.turns?.prompted(body.text, origin.kind, whatAPromptCarries(body))
  await nameTheReviewTheHostReportsFailed(state, body.text, origin.kind)
  return answered(TAKEN)
}

/** The session a prompt is for, or why this launcher refuses it: a refreshed session is taken in before it is named. */
async function theSessionOfAPrompt(state: RelayState, body: Body): Promise<HostSession | string> {
  if (!isText(body.session_id)) return state.answers.named(body.session_id)
  return (await takeInARefreshedSession(state, body.session_id)) ?? state.answers.named(body.session_id)
}

function callOf(body: Body): { readonly tool: string; readonly input: Body; readonly agent_id: string | undefined; readonly id: string | undefined } | undefined {
  const call = body.call
  if (!isBody(call) || !isText(call.tool)) return undefined
  const { tool, ...input } = call
  const id = call['tool_use_id']
  return { tool, input, agent_id: agentIdOf(call), id: isText(id) ? id : undefined }
}

/** The host says an agent started under this session (martha#170): only this makes an agent one it saw start. */
async function subagentStarted(state: RelayState, body: Body): Promise<RelayReply> {
  const session = state.answers.named(body.session_id)
  if (typeof session === 'string') return refused(session)
  if (!isText(body.agent_id)) return refused('the agent start names no agent')
  runOf(state.agents, session.id, body.agent_id).started = true
  return answered(TAKEN)
}

/**
 * The host says an agent stopped (martha#170), which is the only report of a background agent's answer: the host
 * delivers that text into the member's turn with no tool result to place it on.
 *
 * A vouched agent's answer is nothing new and the shell stays. Any other agent's answer is a subagent's text: it is
 * recorded on B7 here, so the shell closes from this moment on, whichever call the member makes next.
 */
async function subagentStopped(state: RelayState, body: Body): Promise<RelayReply> {
  const session = state.answers.named(body.session_id)
  if (typeof session === 'string') return refused(session)
  if (!isText(body.agent_id)) return refused('the agent stop names no agent')
  const run = runOf(state.agents, session.id, body.agent_id)
  run.stopped = true
  if (vouchedRun(run)) return answered(TAKEN)
  const why = await state.answers.keep(takeInTurn(session, { source: 'subagent' }, state.place.binder))
  return why === undefined ? answered(TAKEN) : refused(why)
}

/**
 * Keeps an Agent call this launcher allowed when it is one of the crew's reviews on its reviewer model (martha#390), so
 * a failure the host reports later can be read as that review's and as no other's. A crew that names no reviewer model,
 * and a call that is not a review on it, keep nothing.
 *
 * An allowed review is also the member taking up again whichever review stopped before it: the line that one left in
 * the row has been acted on, and leaves it here (martha#390 r=1).
 */
async function noteTheReviewThisLauncherLetThrough(state: RelayState, call: { readonly tool: string; readonly input: Readonly<Record<string, unknown>>; readonly id: string | undefined }): Promise<void> {
  const crew = state.place.crew
  if (crew === undefined || call.id === undefined) return
  const review_model = await crew.theReviewModelOfTheCall(call)
  if (review_model === null) return
  state.reviews.remember(call.id, review_model)
  state.place.telling?.takeTheLineBack()
}

/**
 * The host's own report of a review that failed, named to the member and its row (martha#390): the envelope's fixed
 * fields decide it, the model is the one the allowed call resolved to, and the host's summary is repeated verbatim.
 * Nothing relaunches the review, and no second model is chosen anywhere.
 *
 * What the line is, where it goes, and the call being forgotten once it is written (martha#430) are the slice's
 * (../name_a_review_the_host_reported_failed); here is only what this launch can hand it: the crew's reviewer model,
 * and the row and the member the telling reaches.
 */
async function nameTheReviewTheHostReportsFailed(state: RelayState, text: string, origin_kind: string): Promise<void> {
  const crew = state.place.crew
  const telling = state.place.telling
  if (crew === undefined || telling === undefined) return
  const review_model = await crew.theReviewModel()
  if (review_model === null) return
  await nameTheFailedReviewIn(state.reviews, text, { origin_kind, review_model, report: THE_HOSTS_FAILED_REVIEW }, telling)
}

async function toolCalled(state: RelayState, body: Body): Promise<RelayReply> {
  const { place } = state
  const named = state.answers.named(body.session_id)
  if (typeof named === 'string') return denied(named)
  const call = callOf(body)
  if (call === undefined) return denied('the tool call names no tool')
  const session = await state.answers.vouchFor(named)
  if (typeof session === 'string') return denied(session)
  const agent_id = noteTheAgentsCall(state.agents, session.id, body)
  const denial = await theDenialOfACall(state, session, call, agent_id)
  if (denial !== undefined) return denied(denial)
  // The call runs, so it is counted against the package's budget before it does (martha#513, slice 3): a call whose row
  // cannot be kept does not run, so a member cannot spend where nothing counts it.
  const uncounted = await noteTheCallCounted(place.crew, session.id, place.names.ownNameOf(call.tool))
  if (uncounted !== undefined) return denied(uncounted)
  place.signed_runs?.callAllowed(call.tool, call.input)
  await noteTheReviewThisLauncherLetThrough(state, call)
  // The call runs, so the owner is no longer being asked about it (martha#313): the dialog it raised closes here, before
  // the tool runs, and never when this launcher refused the call, because a refused call never runs.
  closeTheDialogTheCallRan(state, session, body, call)
  place.crew?.ends.aCallAllowed(session.id, call.id ?? '')
  return answered(ALLOW)
}

/**
 * What the owner keeps from this call before the gate is asked (martha#122, #136): their own settings file, which no call
 * of a member's may name, and their memory, which no call may write. Undefined when the call may touch neither.
 */
function whatTheOwnerKeepsFromThisCall(place: MemberRelayPlace, call: { readonly tool: string; readonly input: Body }): string | undefined {
  const settings = namesTheOwnersSettings(call.input, place.hookSettings.owners_file, place.launch.launch_dir, place.hookSettings.home)
  if (settings !== undefined) return settings
  return writesTheOwnersMemory(call.tool, call.input, place.ownerMemory, place.launch.launch_dir, place.hookSettings.home, thisMachine)
}

/** Why this call is refused before it runs, or undefined when nothing does: the owner's settings, their memory, the gate, the crew's reviewer-model rule. */
async function theDenialOfACall(
  state: RelayState,
  session: HostSession,
  call: { readonly tool: string; readonly input: Body },
  agent_id: string | undefined,
): Promise<string | undefined> {
  const { place } = state
  const theOwners = whatTheOwnerKeepsFromThisCall(place, call)
  if (theOwners !== undefined) return theOwners
  const verdict = answerToolCall({
    tool: call.tool,
    session,
    policy: place.policy,
    input: call.input,
    launch: place.launch,
    names: place.names,
    host: thisMachine,
    agents_running: agentsToHold(state.agents, session.id, agent_id),
    ...(place.gate === undefined ? {} : { gate: place.gate }),
    audit: place.audit, contract: await theContractACrewHolds(place.crew, { tool: call.tool, input: call.input }, place.names),
    spend: await theSpendACrewHolds(place.crew, session.id),
  })?.deny
  if (verdict !== undefined) return verdict
  return whatTheCrewRefusesOfACall(place.crew, call, session.id)
}

/**
 * The screen told that a call is about to run (martha#313). The host posts this before it checks the call and before it
 * asks the owner, so it opens the host's own menu and closes nothing: the close is the call's answer.
 */
function closeTheDialogTheCallRan(state: RelayState, session: HostSession, body: Body, call: { readonly tool: string; readonly input: Body }): void {
  state.place.screen?.heard(session.id, { said: 'ran', call: theCallIn(body.call) ?? { tool: call.tool, input: call.input } }, now())
}

/**
 * A ran tool's report, answered (#132, #121, #122, the lanes); then, on a yes and only on one, the end of the turn the
 * launcher holds rides on it when this was the last call in flight (martha#311 ruling D). A no stays a no.
 */
async function toolAnswered(state: RelayState, body: Body): Promise<RelayReply> {
  const reply = await theReportOfARanTool(state, body)
  const end = reply.answered && isText(body.session_id) ? state.place.crew?.ends.aCallAnswered(body.session_id, callOf(body)?.id ?? '', state.place.journal) : undefined
  return end === undefined ? reply : answered({ ...TAKEN, end_turn: end })
}

async function theReportOfARanTool(state: RelayState, body: Body): Promise<RelayReply> {
  const { place } = state
  const session = state.answers.named(body.session_id)
  if (typeof session === 'string') return stopMember(place, session)
  const call = callOf(body)
  if (call === undefined) return stopMember(place, 'a tool ran that the relay could not name')
  keepWhatTheReviewResolvedTo(state.reviews, call.id, body.answer)
  // A menu's answer is what a settle of the owner's asks stands on (martha#313): the queue keeps the closings it hears.
  place.crew?.noteTheCallsAnswer({ tool: call.tool }, session.id)
  // An agent's own call, answered here: what "every call it made was answered" counts (martha#170).
  const answering = noteAnAgentsAnswer(state.agents, body)
  closeTheDialogsTheCallAnswered(place, session, body, call)
  // The receipt is single use: taken now, whatever the answer, so a later call takes none of it (martha#129).
  const kept = place.signed_runs?.callAnswered(call.tool, call.input, body.answer)
  const unvouched = recheckBeforeRecording(place, session, call)
  if (unvouched !== undefined) return stopMember(place, unvouched)
  // A `martha run <name>` whose answer is exactly the one its receipt builds records nothing (martha#129): the run's
  // output is text the owner vouched for, so the shell stays. Every other result records, as #127 leaves it.
  if (kept !== undefined && kept.why === undefined) return answered(TAKEN)
  const { reply, recorded } = await recordToolResult(state, session, call, body.answer)
  noteWhatItsCallsRead(state.agents, answering, recorded)
  return reply
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
function closeTheDialogsTheCallAnswered(place: MemberRelayPlace, session: HostSession, body: Body, call: { readonly tool: string; readonly input: Body }): void {
  place.screen?.heard(session.id, { said: 'answered', call: theCallIn(body.call) ?? { tool: call.tool, input: call.input } }, now())
}

/** The own write kept and every recheck, or why the member is stopped (#132, #121, #122). */
function recheckBeforeRecording(place: MemberRelayPlace, session: HostSession, call: { readonly tool: string; readonly input: Body }): string | undefined {
  // Kept before the recheck, so the write this call made is not taken for an outsider's (martha#132).
  const unkept = rememberOwnWriteOfCall(place.launch, { tool: call.tool, input: call.input, session: session.id, home: place.hookSettings.home }, thisMachine)
  if (unkept !== undefined) return unkept
  const launched = recheckLaunchPassingOwnWrites(place.launch, thisMachine)
  return launched.allow ? place.hookSettings.check() : launched.refusal
}

/** What the call's result records: a mesh tool's answer, or the host's own result by #127's table, and the rows it added. */
async function recordToolResult(
  state: RelayState,
  session: HostSession,
  call: { readonly tool: string; readonly input: Body; readonly agent_id: string | undefined },
  answer: unknown,
): Promise<{ readonly reply: RelayReply; readonly recorded: readonly string[] }> {
  const { place } = state
  const agent = isAnAgentsAnswerTool(call.tool) ? agentOfAResult(state.agents, call, answer) : undefined
  // A mesh tool's own session answer may carry nothing of anyone else's (martha#251): read first, so an answer whose
  // every leaf came from this launch takes nothing in and the member keeps the shell it needs for the ring it was
  // about to make. Every other answer, this tool's included when the launch cannot say what it supplied, records on
  // B2 exactly as before.
  const own_name = place.names.ownNameOf(call.tool)
  const wordless = place.wordless_answers === undefined ? undefined : wordsInAMeshAnswer(own_name, answer, { ...place.wordless_answers, input: call.input })
  if (wordless?.reads_nothing === true) return { reply: answered(TAKEN), recorded: [] }
  const taken = isMcpToolCall(call.tool)
    ? takeInTurn(session, arrivalOfAMeshToolResult(own_name, call.input, answer), place.binder)
    : takeInToolResult(
        session,
        {
          tool: call.tool,
          input: call.input,
          rows: CLAUDE_CODE_TOOL_RESULT_ROWS,
          launch: place.launch,
          approved_start: state.answers.approved_start,
          started_with: place.started_with,
          read_attaches_nothing: CLAUDE_CODE_READ_ATTACHES_NOTHING,
          host: thisMachine,
          // An agent's answer is placed by the agent, not by the tool's name alone (martha#170): the id is the one the
          // host stamps on the answer (`tool_response.agentId`) for the member's own Agent call, and the one on the
          // call itself when the agent hands its report back.
          ...(agent === undefined ? {} : { agent }),
        },
        place.binder,
      )
  const recorded = taken.gate.ingested.slice(session.gate.ingested.length).map((ingestion) => ingestion.path)
  if (recorded.length === 0) return { reply: answered(TAKEN), recorded }
  const why = await state.answers.keep(taken)
  return { reply: why === undefined ? answered(TAKEN) : stopMember(place, why), recorded }
}
