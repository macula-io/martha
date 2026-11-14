// The crew mod: the tools a member calls, and the pane the owner reads (martha#254).
//
// This exists so a member's session can report and draw without deciding anything: the mod registers the crew's
// tools, carries every call of one to the member's launcher, and hands the core's answer back unchanged. It asks the
// launcher for the tools themselves (their names, descriptions and schemas) so it holds no copy of a description
// that quotes a constant, and it opens the pane at a session's start only when the crew's declaration switched the
// dashboard on, which the launcher answers with the rows.
//
// A hooks module runs with no Node and may import only its own files, so nothing of the core is reachable here: the
// socket in the environment and the shapes in ./relay_protocol.ts are all this file knows.

import { crewToolsIn, type ALaunchersTool } from './crew_tools_answer.ts'
import { heardToolAnswer, RELAY_ORIGIN, TOOL_ANSWER_PATH, toolCallBody } from './relay_protocol.ts'
import { readingTheChannelWith } from './crew_channel_reading.ts'
import { beatingTheTurnWith } from './crew_turn_beat.ts'
import { orderIn, paneIn, PANE_CHROME_ROWS, switchTheModelOnTheHost, theOwnersListIn, type TheOrder, type TheOwnersListShown } from './crew_answers.ts'

/** The pane's id, as the host names one. */
export const PANE = 'crew'

/** What the owner types to open the pane. */
export const OPEN_THE_PANE = 'crew'

/** Why a tool call has no answer: the member was started by hand, or the launcher could not be heard. */
const NOT_OURS = 'Martha is not running this session, so it answers no tool'

/** A tool as the launcher gives it, as the one parser for its answer reads it. */
type CrewTool = ALaunchersTool

/** The engine calls this module makes, typed by shape as the relay's own module types them. */
interface CrewEngine {
  readonly env: { get(name: string): Promise<string | undefined> }
  readonly http: { fetch(url: string, init: { method: string; headers: Record<string, string>; body: string; socketPath: string }): Promise<{ status: number; text: string }> }
  /** The session's id, and the host's own reading of it: its usage, taken as it comes and read by the core. */
  readonly session: { id(): Promise<string>; usage(): Promise<unknown> }
  readonly clock: { after(ms: number, fn: () => void): { cancel(): void }; every(ms: number, fn: () => void): { cancel(): void } }
  /** Submits a prompt into this session (martha#253): the text a message is handed in. */
  readonly prompt: { submit(input: { readonly text: string }): Promise<unknown> }
  /** Ends a running turn by its id (martha#311); the host rejects when that turn is not the one running. */
  readonly turn: { abort(input: { readonly turnId: string }): Promise<unknown> }
  readonly tool: { register(tool: CrewTool & { description: string }): Promise<unknown> }
  /** `run` runs one of the host's own commands in this session: the refresh flow's clear is that one (martha#255). */
  readonly command: { register(command: { name: string; description: string }): Promise<unknown>; run(command: { command: string; args?: string }): Promise<unknown> }
  /**
   * `invalidate` asks the host to draw a hook's view again; it caches one `ui.render` until a plugin invalidates it
   * (martha#254).
   */
  readonly ui: {
    open(view: { id: string; title: string; rows: number }): Promise<unknown>
    close(view: { id: string }): Promise<unknown>
    invalidate(event: string): Promise<unknown>
    toast(text: string): unknown
    /** Puts text on the clipboard of the session whose button was pressed: the surface is the press's own handle. */
    copy(input: { readonly text: string; readonly surface?: unknown }): Promise<unknown>
    resolve(event: unknown): { Box: unknown; Text: unknown; Button: unknown }
  }
}

type CrewNext = (event: unknown) => Promise<unknown>

/** The event whose view the pane asks the host to draw again, as the host names it. */
const THE_PANES_RENDER = 'ui.render'

/** What the mod asks the launcher for: the next message this member has not taken in (martha#253). */
const THE_NEXT_MESSAGE = 'take_a_crew_message'

/**
 * What the mod tells the launcher at every turn start, so a handed message is taken in at the next main turn
 * (martha#253), and so the launcher hears every main turn the model runs, the ones whose prompt the host never raised
 * to this mod included (martha#440).
 */
const THE_TURN_STARTED = 'a_turn_started'

/** What the mod asks the launcher for: how often, in seconds, to read the channel again (martha#253). */
const THE_CHANNEL_READ = 'channel_read_seconds'

/** What the mod asks the launcher for: what this session should do now, if a refresh is due (martha#255). */
const THE_REFRESH_QUESTION = 'the_refresh_of_this_session'

/** What the mod says once a model switch resolved, so the row says the model this session really runs (martha#315). */
const THE_MODEL_REPORT = 'note_the_model_the_session_runs'

/**
 * The host's own command that switches this session's model (martha#315), run once the turn has ended. It is spelled
 * out as the host's command name, the way `clear` is above: a hooks module imports only its own files.
 */
const THE_MODEL_COMMAND = 'model'

/** What the mod asks the launcher for: the owner's to-do list, as the pane draws it (martha#316). */
const THE_OWNERS_TODO = 'the_owners_todo'

/**
 * The row of the owner's list the keyboard is on, by id (martha#316): the pane's own glue. The launcher decides what
 * that reveals, and only a revealed row carries anything to copy.
 */
let ownersFocus = ''

/** The interval the channel is read on, once the launcher has named it; null until it has. */
let readingTheChannel: { cancel(): void } | null = null

/** The one reading of the channel this session holds, built on first use. */
let theReading: ReturnType<typeof readingTheChannelWith> | null = null

/**
 * The reading this session holds (martha#253, slice 2): the launcher answers with the framed text of the next crew
 * message the member has not taken in, and the mod submits it as a prompt, only while the session is idle. The launcher
 * counts it taken in when the next main turn starts, which `turn.start` below reports — so the reading is the one rule
 * in ./crew_channel_reading.ts, and every hook here goes through it.
 */
function theChannelReading($: CrewEngine): ReturnType<typeof readingTheChannelWith> {
  theReading ??= readingTheChannelWith(
    async () => {
      const heard = await hearTheLauncher($, THE_NEXT_MESSAGE, {})
      return 'said' in heard ? heard.said : null
    },
    (text) => $.prompt.submit({ text }),
  )
  return theReading
}

/** The one beat this session holds (martha#311): the running main turn asked about, as ./crew_turn_beat.ts rules it. */
let theBeat: ReturnType<typeof beatingTheTurnWith> | null = null
const theTurnBeat = ($: CrewEngine): ReturnType<typeof beatingTheTurnWith> =>
  (theBeat ??= beatingTheTurnWith((ms, fn) => $.clock.every(ms, fn), (turnId) => takeTheAct($, { turnId }, { turn_running: 1 })))

/** The agent an event belongs to: the host stamps a subagent's turn with one, and the main turn with none. */
function agentIdIn(event: unknown): unknown {
  return typeof event === 'object' && event !== null ? (event as { agentId?: unknown }).agentId : undefined
}

/** Starts reading the channel: once now, and every interval the declaration names, for this session's whole life. */
async function startReadingTheChannel($: CrewEngine): Promise<void> {
  if (readingTheChannel !== null) return
  const heard = await hearTheLauncher($, THE_CHANNEL_READ, {})
  const seconds = 'said' in heard ? Number.parseInt(heard.said, 10) : Number.NaN
  if (!Number.isInteger(seconds) || seconds < 1) return
  const reading = theChannelReading($)
  readingTheChannel = $.clock.every(seconds * 1000, () => void reading.readWhileIdle())
  await reading.readWhileIdle()
}

/**
 * Asks the launcher what this session should do now, and does it (martha#255). What the session knows goes with the
 * question — its context, the turn that just ended and the answer it ended with — and the launcher decides; this does
 * nothing but carry the act out. A clear is run out of the turn's own hook, because a `/clear` cannot run inside one.
 */
async function takeTheAct($: CrewEngine, e: unknown, more: Readonly<Record<string, unknown>> = {}): Promise<void> {
  const order = await theOrderTheLauncherAnswers($, e, more)
  if (order === null || order.carry === 'none') return
  await carryOutTheAct($, order)
}

/** The order the launcher answers this session's question with, or null when it said none this mod could read. */
async function theOrderTheLauncherAnswers($: CrewEngine, e: unknown, more: Readonly<Record<string, unknown>>): Promise<TheOrder | null> {
  const heard = await hearTheLauncher($, THE_REFRESH_QUESTION, { ...(await whatTheSessionSays($, e)), ...more })
  return 'said' in heard ? orderIn(heard.said) : null
}

/** What the session knows of itself, as the host reports it: its usage, the turn that just ended, and its answer. */
async function whatTheSessionSays($: CrewEngine, e: unknown): Promise<Readonly<Record<string, unknown>>> {
  return { usage: await $.session.usage().catch(() => undefined), turn_id: textIn(e, 'turnId'), answer: textIn(e, 'answer') }
}

/** The one order the launcher gave: a text submitted, the clear, or the model this session is to run on. */
async function carryOutTheAct($: CrewEngine, order: TheOrder): Promise<void> {
  if (order.carry === 'submit') return await $.prompt.submit({ text: order.text })
  if (order.carry === 'model') await switchTheModel($, order.model)
  // The end of the running turn (martha#311): the host's abort; the launcher reads the outcome off the turn's own end.
  if (order.carry === 'end_the_turn') return void (await $.turn.abort({ turnId: order.turn_id }).catch(() => undefined))
  if (order.carry !== 'clear') return
  // Out of the turn's hook: /clear cannot run inside a hook the turn waits on.
  $.clock.after(CLEAR_DELAY_MS, () => void $.command.run({ command: 'clear' }).catch(() => undefined))
}

/**
 * Runs the host's own model command with the model the launcher named, and tells the launcher what this session now
 * runs on (martha#315). Both acts are the host's, so they are bound here; what a failed command means for the report is
 * the slice's, where ./crew_answers.node-test.ts can reach it.
 */
async function switchTheModel($: CrewEngine, model: string): Promise<void> {
  return await switchTheModelOnTheHost(
    {
      runTheModelCommand: (one) => $.command.run({ command: THE_MODEL_COMMAND, args: one }),
      noteTheModel: (one) => askTheLauncherQuietly($, THE_MODEL_REPORT, { model: one }),
    },
    model,
  )
}

/** Asks the launcher for one thing and says nothing when it cannot be heard: a report that failed changes no decision. */
async function askTheLauncherQuietly($: CrewEngine, tool: string, args: Readonly<Record<string, unknown>>): Promise<void> {
  const heard = await hearTheLauncher($, tool, args)
  if (!('said' in heard)) $.ui.toast(`Martha did not note this session's model: ${heard.why}`)
}

/** How long after the turn the clear is run: out of the hook, so the host is not holding a turn while it clears. */
const CLEAR_DELAY_MS = 500

/** A field of an event as text, or '': a turn's id and its text at its start, and its answer at its end. */
function textIn(e: unknown, field: 'turnId' | 'text' | 'answer'): string {
  const held = typeof e === 'object' && e !== null ? (e as Record<string, unknown>)[field] : undefined
  return typeof held === 'string' ? held : ''
}

/** What the launcher heard, or why it could not be heard: the two are not the same, and only one of them is an answer. */
type Heard = { readonly said: string } | { readonly why: string }

/**
 * Asks the launcher for a core tool's answer. A launcher that cannot be heard is not a yes: the caller is told which
 * of the two happened, so a pane can say a read failed instead of drawing an empty crew (martha#254 part 2 r=2 R2).
 */
async function hearTheLauncher($: CrewEngine, tool: string, args: Readonly<Record<string, unknown>>): Promise<Heard> {
  // The name is spelled out, as the relay's own module spells it: the host refuses a hooks module whose
  // `$.env.get` is given anything but a literal, an imported constant included (#104).
  const socket_path = await $.env.get('MARTHA_RELAY_SOCKET')
  if (socket_path === undefined) return { why: NOT_OURS }
  const session_id = await $.session.id()
  try {
    const heard = await $.http.fetch(`${RELAY_ORIGIN}${TOOL_ANSWER_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toolCallBody(session_id, tool, args)),
      socketPath: socket_path,
    })
    const answer = heardToolAnswer(heard.status, heard.text)
    return answer.answered ? { said: answer.answer } : { why: answer.why }
  } catch (error) {
    return { why: error instanceof Error ? error.message : String(error) }
  }
}

/** Asks the launcher for a core tool's answer, and gives back the words the model is shown. */
async function askTheLauncher($: CrewEngine, tool: string, args: Readonly<Record<string, unknown>>): Promise<string> {
  const heard = await hearTheLauncher($, tool, args)
  return 'said' in heard ? heard.said : `Martha did not answer: ${heard.why}`
}

/** Asks the launcher for the tools to register, which it alone names and describes. */
async function toolsFromTheLauncher($: CrewEngine): Promise<readonly CrewTool[]> {
  const heard = await hearTheLauncher($, 'the_crews_tools', {})
  const tools = 'said' in heard ? crewToolsIn(heard.said) : null
  if (tools !== null) return tools
  // A launcher that could not answer is not a crew with no tools: registering nothing in silence would leave the
  // member calling tools that were never registered, and nothing would say why (martha#254 part 2 r=2 R2).
  $.ui.toast(`Martha did not give the crew's tools: ${'said' in heard ? 'its answer is not a list of them' : heard.why}`)
  return []
}

/** The pane's redraw timer while a pane is open: the host draws a `ui.render` once and caches it until invalidated. */
let redrawing: { cancel(): void } | null = null

/** Asks the host to draw the pane again on the interval the launcher named, once per open pane. */
function startRedrawing($: CrewEngine, every_ms: number | null): void {
  if (redrawing !== null || every_ms === null) return
  redrawing = $.clock.every(every_ms, () => void $.ui.invalidate(THE_PANES_RENDER))
}

/** Closes the pane, and stops asking the host to draw it again: it is closed, or the session is over. */
async function shutThePane($: CrewEngine): Promise<void> {
  redrawing?.cancel()
  redrawing = null
  await $.ui.close({ id: PANE })
}

/** The owner's list as the launcher answers it for the row the keyboard is on, or null when it could not be read. */
async function theOwnersList($: CrewEngine): Promise<TheOwnersListShown | null> {
  const heard = await hearTheLauncher($, THE_OWNERS_TODO, { focus: ownersFocus })
  return 'said' in heard ? theOwnersListIn(heard.said) : null
}

/** Moves the keyboard to the row the launcher named next, and asks the host to draw the pane again. */
async function stepTheOwnersList($: CrewEngine, next: string): Promise<void> {
  ownersFocus = next
  await $.ui.invalidate(THE_PANES_RENDER)
}

type TheViews = { Box: unknown; Text: unknown; Button: unknown }

/**
 * The owner's list under the crew (martha#316): its heading, the line saying a member wrote it, and its lines as the
 * launcher drew them, the copy button where the launcher put it (martha#311).
 */
function theOwnersListBlock($: CrewEngine, views: TheViews, list: TheOwnersListShown | null): unknown {
  const { Box, Text, Button } = views
  if (list === null) return <Text>Could not read the owner's list.</Text>
  const copy = (press: { surface?: unknown } | undefined): void => void $.ui.copy({ text: list.copy, surface: press?.surface }).catch(() => undefined)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{list.heading}</Text>
        {list.next === list.focus ? null : <Button key="todo:next" label="next" hotkey="n" onPress={() => void stepTheOwnersList($, list.next)} />}
      </Box>
      <Text dimColor>{list.claim}</Text>
      {list.drawn.map((line, at) =>
        line.copy ? <Button key={`todo:copy:${at}`} label="copy" hotkey="c" onPress={copy} /> : <Text key={`todo:${at}`} bold={line.bold} dimColor={line.dim}>{line.text}</Text>,
      )}
    </Box>
  )
}

/** Opens the pane, with the rows the launcher asks the host for, and asks it to keep drawing while it is open. */
async function openThePane($: CrewEngine): Promise<void> {
  const heard = await hearTheLauncher($, 'see_the_crew', {})
  const shown = 'said' in heard ? paneIn(heard.said) : null
  const list = await theOwnersList($)
  await $.ui.open({ id: PANE, title: 'Crew', rows: (shown === null ? PANE_CHROME_ROWS : shown.rows) + (list === null ? 1 : list.lines) })
  if (shown !== null) startRedrawing($, shown.redraw_ms)
}

/** One tool's hook: the call's own fields, minus the ones the host adds, posted to the launcher. */
const answerFromTheLauncher = async ($: CrewEngine, e: Record<string, unknown>, tool: string): Promise<unknown> => {
  const { tool: _tool, agentId: _agent, tool_use_id: _use, ...args } = e
  return { result: await askTheLauncher($, tool, args) }
}

// Each hook is a named function, never a call returning one: the host's plugin validator refuses a hook that is
// "not a function literal or the name of one", and refuses a tool named by anything but a string literal.
const answerReportProgress = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'report_progress')
const answerLogAMilestone = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'log_a_milestone')
const answerWhatWasSent = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'what_was_sent')
const answerNoteWhatBecame = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'note_what_became_of_an_act')
const answerSeeTheCrew = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'see_the_crew')
const answerWhoIsFree = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'who_is_free')
const answerSayToTheCrew = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'say_to_the_crew')
const answerReadTheReceipts = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'read_the_receipts')
const answerWriteMyHandover = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'write_my_handover')
const answerRefreshThisSession = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'refresh_this_session')
const answerParkAMember = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'park_a_member')
const answerWakeAMember = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'wake_a_member')
const answerRestartAMember = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'restart_a_member')
const answerSwitchYourModel = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'switch_your_model')
const answerReturnToYourOwnModel = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'return_to_your_own_model')
const answerVerifyRange = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'verify_range')
const answerLandBatch = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'land_batch')
const answerFastForward = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'fast_forward_after_the_owners_yes')
const answerWorktreeOpen = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'worktree_open')
const answerWorktreeFinish = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'worktree_finish')
const answerOwnerTodoAdd = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'owner_todo_add')
const answerOwnerTodoDone = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'owner_todo_done')
const answerQueueAsk = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'queue_ask')
const answerListAsks = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'list_asks')
const answerTakeAsks = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'take_asks')
const answerSettleAsks = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'settle_asks')
const answerStandingAdd = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'standing_add')
const answerStandingClose = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'standing_close')
const answerStanding = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'standing')
const answerWaitForCi = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'wait_for_ci')

/**
 * The pane as the host draws it: the crew's rows, then the owner's list (martha#316). When the read failed it says it
 * could not read the crew, and why: drawing `0/0 online` and "no one has reported" over a broken answer tells the owner
 * a lie about a working crew (martha#254 part 2 r=2 R2).
 */
async function drawThePane($: CrewEngine, e: unknown): Promise<unknown> {
  const views = $.ui.resolve(e) as TheViews
  const { Box, Text, Button } = views
  const heard = await hearTheLauncher($, 'see_the_crew', {})
  const shown = 'said' in heard ? paneIn(heard.said) : null
  const unread = 'said' in heard ? `Martha answered with something the pane cannot read: ${heard.said}` : heard.why
  // A pane that is being drawn is a pane that is open: if nothing is asking the host to draw it again, ask, so a
  // member who reports after it opened is drawn without the owner typing anything (part 2 r=2 R1).
  if (shown !== null) startRedrawing($, shown.redraw_ms)
  const list = shown === null ? undefined : await theOwnersList($)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>{shown === null ? 'Could not read the crew' : shown.header}</Text>
        <Button key="close" label="close" hotkey="x" role="dismiss" onPress={() => void shutThePane($)} />
      </Box>
      {(shown === null ? [unread] : shown.lines).map((line, at) => (
        <Text key={`${at}`}>{line}</Text>
      ))}
      {list === undefined ? null : theOwnersListBlock($, views, list)}
    </Box>
  )
}

/** The crew's tools registered with this host, and the pane drawn. */
export const register = (on: (event: string, options?: unknown, handler?: unknown) => unknown): void => {
  // Every tool is named in full here, because the host refuses a hook that builds its name; the manifest holds the
  // plugin's name, and the test pairing tools with hooks reads it, so a rename fails there (martha#343).
  on('tool.call', { tool: 'mcp__martha__report_progress' }, answerReportProgress)
  on('tool.call', { tool: 'mcp__martha__log_a_milestone' }, answerLogAMilestone)
  on('tool.call', { tool: 'mcp__martha__what_was_sent' }, answerWhatWasSent)
  on('tool.call', { tool: 'mcp__martha__note_what_became_of_an_act' }, answerNoteWhatBecame)
  on('tool.call', { tool: 'mcp__martha__see_the_crew' }, answerSeeTheCrew)
  on('tool.call', { tool: 'mcp__martha__who_is_free' }, answerWhoIsFree)
  on('tool.call', { tool: 'mcp__martha__say_to_the_crew' }, answerSayToTheCrew)
  on('tool.call', { tool: 'mcp__martha__read_the_receipts' }, answerReadTheReceipts)
  on('tool.call', { tool: 'mcp__martha__write_my_handover' }, answerWriteMyHandover)
  on('tool.call', { tool: 'mcp__martha__refresh_this_session' }, answerRefreshThisSession)
  on('tool.call', { tool: 'mcp__martha__park_a_member' }, answerParkAMember)
  on('tool.call', { tool: 'mcp__martha__wake_a_member' }, answerWakeAMember)
  on('tool.call', { tool: 'mcp__martha__restart_a_member' }, answerRestartAMember)
  on('tool.call', { tool: 'mcp__martha__switch_your_model' }, answerSwitchYourModel)
  on('tool.call', { tool: 'mcp__martha__return_to_your_own_model' }, answerReturnToYourOwnModel)
  on('tool.call', { tool: 'mcp__martha__verify_range' }, answerVerifyRange)
  on('tool.call', { tool: 'mcp__martha__land_batch' }, answerLandBatch)
  on('tool.call', { tool: 'mcp__martha__fast_forward_after_the_owners_yes' }, answerFastForward)
  on('tool.call', { tool: 'mcp__martha__worktree_open' }, answerWorktreeOpen)
  on('tool.call', { tool: 'mcp__martha__worktree_finish' }, answerWorktreeFinish)
  on('tool.call', { tool: 'mcp__martha__owner_todo_add' }, answerOwnerTodoAdd)
  on('tool.call', { tool: 'mcp__martha__owner_todo_done' }, answerOwnerTodoDone)
  on('tool.call', { tool: 'mcp__martha__queue_ask' }, answerQueueAsk)
  on('tool.call', { tool: 'mcp__martha__list_asks' }, answerListAsks)
  on('tool.call', { tool: 'mcp__martha__take_asks' }, answerTakeAsks)
  on('tool.call', { tool: 'mcp__martha__settle_asks' }, answerSettleAsks)
  on('tool.call', { tool: 'mcp__martha__standing_add' }, answerStandingAdd)
  on('tool.call', { tool: 'mcp__martha__standing_close' }, answerStandingClose)
  on('tool.call', { tool: 'mcp__martha__standing' }, answerStanding)
  on('tool.call', { tool: 'mcp__martha__wait_for_ci' }, answerWaitForCi)

  on('command.run', { command: OPEN_THE_PANE }, async ($: CrewEngine) => {
    await openThePane($)
    return { text: '' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, drawThePane)

  // Registration happens once this host shows the session, as the tools are the launcher's to name; the pane opens
  // by itself only when the crew's declaration switched the dashboard on.
  on('session.start', async ($: CrewEngine, e: unknown, next: CrewNext) => {
    for (const tool of await toolsFromTheLauncher($)) await $.tool.register(tool)
    const first = await askTheLauncher($, 'see_the_crew', {})
    if (paneIn(first)?.open_at_start === true) await openThePane($)
    await startReadingTheChannel($)
    await takeTheAct($, e)
    return next(e)
  })

  // A turn is running from `turn.start` until it ends, and the channel is read only outside one: a submit made while
  // the session is idle is queued into the next main turn, and that turn's start is what counts the message taken in.
  // The launcher is told of every start, with the agent it carries; it counts only a main one (martha#253, Pluto's
  // ruling (a)). The host fires both events for a subagent's turn too; those carry the agent, and the reading ignores
  // them, or a subagent finishing inside the member's own turn would read as the member going idle. The start carries
  // the turn's id and its text, the turn's last user message: a prompt this mod submitted from its own timer is never
  // raised to its `prompt.submit` (the host's re-entry rule), so this is the only place the launcher hears that turn
  // (martha#440).
  on('turn.start', ($: CrewEngine, e: unknown, next: CrewNext) => {
    theChannelReading($).aTurnStarted(agentIdIn(e))
    theTurnBeat($).aTurnStarted(agentIdIn(e), textIn(e, 'turnId'))
    void hearTheLauncher($, THE_TURN_STARTED, { agentId: agentIdIn(e), turnId: textIn(e, 'turnId'), text: textIn(e, 'text') })
    return next(e)
  })

  // A turn ended — answered, aborted, refused or failed, since `turn.complete` carries the reason — so the host is
  // idle and can take the next message the launcher hands it (martha#253, slice 2). The submit from `turn.complete`
  // is the one shape the host's own guidance names for submitting while the session idles.
  on('turn.complete', async ($: CrewEngine, e: unknown, next: CrewNext) => {
    theTurnBeat($).aTurnEnded(agentIdIn(e))
    await theChannelReading($).aTurnEnded(agentIdIn(e))
    await takeTheAct($, e)
    return next(e)
  })
}


