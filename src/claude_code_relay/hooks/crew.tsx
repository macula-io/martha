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
import { opensAtStartOf, rowsToOpen } from './pane_rule.ts'
import { readingTheChannelWith } from './crew_channel_reading.ts'

/**
 * The server name the host gives this plugin's tools: `mcp__<server>__<tool>`. It is the plugin's own name, and each
 * tool name below is spelled out in full because the host's plugin validator refuses a hook that builds one.
 */
export const CREW_SERVER = 'martha-relay'

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
  readonly http: {
    fetch(url: string, init: { method: string; headers: Record<string, string>; body: string; socketPath: string }): Promise<{ status: number; text: string }>
  }
  readonly session: { id(): Promise<string> }
  readonly clock: {
    after(ms: number, fn: () => void): { cancel(): void }
    every(ms: number, fn: () => void): { cancel(): void }
  }
  /** Submits a prompt into this session (martha#253): the text a message is handed in. */
  readonly prompt: { submit(input: { readonly text: string }): Promise<unknown> }
  readonly tool: { register(tool: CrewTool & { description: string }): Promise<unknown> }
  readonly command: { register(command: { name: string; description: string }): Promise<unknown> }
  readonly ui: {
    open(view: { id: string; title: string; rows: number }): Promise<unknown>
    close(view: { id: string }): Promise<unknown>
    /** Asks the host to draw a hook's view again; it caches one `ui.render` until a plugin invalidates it (martha#254). */
    invalidate(event: string): Promise<unknown>
    toast(text: string): unknown
    resolve(event: unknown): { Box: unknown; Text: unknown; Button: unknown }
  }
}

type CrewNext = (event: unknown) => Promise<unknown>

/** The event whose view the pane asks the host to draw again, as the host names it. */
const THE_PANES_RENDER = 'ui.render'

/** What the mod asks the launcher for: the next message this member has not taken in (martha#253). */
const THE_NEXT_MESSAGE = 'take_a_crew_message'

/** What the mod asks the launcher for: how often, in seconds, to read the channel again (martha#253). */
const THE_CHANNEL_READ = 'channel_read_seconds'

/** The interval the channel is read on, once the launcher has named it; null until it has. */
let readingTheChannel: { cancel(): void } | null = null

/** The one reading of the channel this session holds, built on first use. */
let theReading: ReturnType<typeof readingTheChannelWith> | null = null

/**
 * The reading this session holds (martha#253, slice 2): the launcher answers with the framed text of the next crew
 * message the member has not taken in, and the mod submits it as a prompt. Only an idle submit is raised back through
 * the prompt hook, and that raise is what counts the message as taken in — so the reading is the one rule in
 * ./crew_channel_reading.ts, and every hook here goes through it.
 */
function theChannelReading($: CrewEngine): ReturnType<typeof readingTheChannelWith> {
  theReading ??= readingTheChannelWith(
    async () => {
      const heard = await hearTheLauncher($, THE_NEXT_MESSAGE, {})
      return 'said' in heard ? heard.said : null
    },
    async (text) => {
      await $.prompt.submit({ text })
    },
  )
  return theReading
}

/** Starts reading the channel: once now, and every interval the declaration names, for this session's whole life. */
/** The agent an event belongs to: the host stamps a subagent's turn with one, and the main turn with none. */
function agentIdIn(event: unknown): unknown {
  return typeof event === 'object' && event !== null ? (event as { agentId?: unknown }).agentId : undefined
}

async function startReadingTheChannel($: CrewEngine): Promise<void> {
  if (readingTheChannel !== null) return
  const heard = await hearTheLauncher($, THE_CHANNEL_READ, {})
  const seconds = 'said' in heard ? Number.parseInt(heard.said, 10) : Number.NaN
  if (!Number.isInteger(seconds) || seconds < 1) return
  const reading = theChannelReading($)
  readingTheChannel = $.clock.every(seconds * 1000, () => void reading.readWhileIdle())
  await reading.readWhileIdle()
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

/** What the launcher gives the relay when it asks for the tools to register. */
interface FromTheLauncher {
  readonly tools: readonly CrewTool[]
}

/** The crew as the launcher answered it, with the interval its pane is to be drawn again on. */
interface TheCrewShown {
  readonly rows: readonly ShownRow[]
  readonly counts: Record<string, number>
  readonly pane_redraw_ms: number | null
}

/** Asks the launcher for the tools to register, which it alone names and describes. */
async function toolsFromTheLauncher($: CrewEngine): Promise<FromTheLauncher> {
  const heard = await hearTheLauncher($, 'the_crews_tools', {})
  const tools = 'said' in heard ? crewToolsIn(heard.said) : null
  if (tools !== null) return { tools }
  // A launcher that could not answer is not a crew with no tools: registering nothing in silence would leave the
  // member calling tools that were never registered, and nothing would say why (martha#254 part 2 r=2 R2).
  $.ui.toast(`Martha did not give the crew's tools: ${'said' in heard ? 'its answer is not a list of them' : heard.why}`)
  return { tools: [] }
}

/** The pane's redraw timer while a pane is open: the host draws a `ui.render` once and caches it until invalidated. */
let redrawing: { cancel(): void } | null = null

/** Asks the host to draw the pane again on the interval the launcher named, once per open pane. */
function startRedrawing($: CrewEngine, every_ms: number | null): void {
  if (redrawing !== null || every_ms === null) return
  redrawing = $.clock.every(every_ms, () => void $.ui.invalidate(THE_PANES_RENDER))
}

/** Stops asking the host to draw the pane: it is closed, or the session is over. */
function stopRedrawing(): void {
  redrawing?.cancel()
  redrawing = null
}

/** Closes the pane, and stops asking the host to draw it again. */
async function shutThePane($: CrewEngine): Promise<void> {
  stopRedrawing()
  await $.ui.close({ id: PANE })
}

/** Opens the pane, with the rows the host draws it in, and asks it to keep drawing while it is open. */
async function openThePane($: CrewEngine): Promise<void> {
  const heard = await hearTheLauncher($, 'see_the_crew', {})
  const shown = 'said' in heard ? crewIn(heard.said) : null
  await $.ui.open({ id: PANE, title: 'Crew', rows: rowsToOpen('said' in heard ? heard.said : '') })
  if (shown !== null) startRedrawing($, shown.pane_redraw_ms)
}

/** What the pane draws, from the answer the launcher gives. */
interface ShownRow {
  readonly member: string
  readonly state: string
  readonly holds: string
  readonly task: string
  readonly progress: { readonly step: number; readonly of: number }
  readonly waits: { readonly on: string; readonly for: string } | null
  readonly needs: string
  readonly quiet_for: number | null
}

/** One member's line: who, how far, and what holds it up. */
function lineOf(row: ShownRow): string {
  const bar = `${row.progress.step}/${row.progress.of}`
  const waits = row.waits === null ? '' : ` · waits on ${row.waits.on} for ${row.waits.for}`
  const needs = row.needs === '' ? '' : ` · needs you: ${row.needs}`
  const holds = row.holds === '' ? '' : ` · ${row.holds}`
  return `${row.member}: ${row.state} · ${row.task} ${bar}${holds}${waits}${needs}`
}

/** The crew as the launcher answered it, or null when the answer is not one. */
function crewIn(said: string): TheCrewShown | null {
  try {
    const parsed = JSON.parse(said) as { rows?: readonly ShownRow[]; counts?: Record<string, number>; pane_redraw_ms?: unknown }
    const every = parsed.pane_redraw_ms
    return {
      rows: parsed.rows ?? [],
      counts: parsed.counts ?? {},
      pane_redraw_ms: typeof every === 'number' && every > 0 ? every : null,
    }
  } catch {
    return null
  }
}

/** Why the pane could not read the crew: the launcher's own words, or the shape it answered with. */
function unreadableOf(heard: Heard): string {
  return 'said' in heard ? `Martha answered with something the pane cannot read: ${heard.said}` : heard.why
}

/**
 * The pane when the read failed: it says that it could not read the crew, and why. Drawing `0/0 online` and "no one
 * has reported" over a broken answer tells the owner a lie about a working crew (martha#254 part 2 r=2 R2).
 */
function unreadablePane($: CrewEngine, views: { Box: unknown; Text: unknown; Button: unknown }, why: string): unknown {
  const { Box, Text, Button } = views
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>Could not read the crew</Text>
        <Button key="close" label="close" hotkey="x" role="dismiss" onPress={() => void shutThePane($)} />
      </Box>
      <Text>{why}</Text>
    </Box>
  )
}

/** One tool's hook: the call's own fields, minus the ones the host adds, posted to the launcher. */
const answerFromTheLauncher = async ($: CrewEngine, e: Record<string, unknown>, tool: string): Promise<unknown> => {
  const { tool: _tool, agentId: _agent, tool_use_id: _use, ...args } = e
  return { result: await askTheLauncher($, tool, args) }
}

// Each hook is a named function, never a call returning one: the host's plugin validator refuses a hook that is
// "not a function literal or the name of one", and refuses a tool named by anything but a string literal.
const answerReportProgress = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'report_progress')
const answerCrewLog = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'crew_log')
const answerWhatWasSent = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'what_was_sent')
const answerNoteWhatBecame = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'note_what_became_of_an_act')
const answerSeeTheCrew = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'see_the_crew')
const answerCrewSay = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'crew_say')
const answerCrewReceipts = ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => answerFromTheLauncher($, e, 'crew_receipts')

/** The crew's tools registered with this host, and the pane drawn. */
export const register = (on: (event: string, options?: unknown, handler?: unknown) => unknown): void => {
  on('tool.call', { tool: 'mcp__martha-relay__report_progress' }, answerReportProgress)
  on('tool.call', { tool: 'mcp__martha-relay__crew_log' }, answerCrewLog)
  on('tool.call', { tool: 'mcp__martha-relay__what_was_sent' }, answerWhatWasSent)
  on('tool.call', { tool: 'mcp__martha-relay__note_what_became_of_an_act' }, answerNoteWhatBecame)
  on('tool.call', { tool: 'mcp__martha-relay__see_the_crew' }, answerSeeTheCrew)
  on('tool.call', { tool: 'mcp__martha-relay__crew_say' }, answerCrewSay)
  on('tool.call', { tool: 'mcp__martha-relay__crew_receipts' }, answerCrewReceipts)

  on('command.run', { command: OPEN_THE_PANE }, async ($: CrewEngine) => {
    await openThePane($)
    return { text: '' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($: CrewEngine, e: unknown) => {
    const { Box, Text, Button } = $.ui.resolve(e) as { Box: unknown; Text: unknown; Button: unknown }
    const heard = await hearTheLauncher($, 'see_the_crew', {})
    const crew = 'said' in heard ? crewIn(heard.said) : null
    if (crew === null) return unreadablePane($, { Box, Text, Button }, unreadableOf(heard))
    // A pane that is being drawn is a pane that is open: if nothing is asking the host to draw it again, ask, so a
    // member who reports after it opened is drawn without the owner typing anything (part 2 r=2 R1).
    startRedrawing($, crew.pane_redraw_ms)
    const { rows, counts } = crew
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{`${counts.online ?? 0}/${counts.members ?? 0} online · ${counts.waiting ?? 0} waiting · ${counts.needs_you ?? 0} need you`}</Text>
          <Button key="close" label="close" hotkey="x" role="dismiss" onPress={() => void shutThePane($)} />
        </Box>
        {rows.length === 0 ? <Text dimColor>No member of this crew has reported yet.</Text> : null}
        {rows.map((row) => (
          <Text key={row.member}>{lineOf(row)}</Text>
        ))}
      </Box>
    )
  })

  // Registration happens once this host shows the session, as the tools are the launcher's to name; the pane opens
  // by itself only when the crew's declaration switched the dashboard on.
  on('session.start', async ($: CrewEngine, e: unknown, next: CrewNext) => {
    const fromTheLauncher = await toolsFromTheLauncher($)
    for (const tool of fromTheLauncher.tools) await $.tool.register(tool)
    const first = await askTheLauncher($, 'see_the_crew', {})
    if (opensAtStartOf(first)) await openThePane($)
    await startReadingTheChannel($)
    return next(e)
  })

  // A turn is running from `turn.start` until it ends, and the channel is read only outside one: the host queues a
  // submit made during a turn and never raises it back, so it could never be counted as taken in (martha#253 r=2).
  // The host fires both events for a subagent's turn too; those carry the agent, and the rule ignores them, or a
  // subagent finishing inside the member's own turn would read as the member going idle.
  on('turn.start', ($: CrewEngine, e: unknown, next: CrewNext) => {
    theChannelReading($).aTurnStarted(agentIdIn(e))
    return next(e)
  })

  // A turn ended — answered, aborted, refused or failed, since `turn.complete` carries the reason — so the host is
  // idle and can take the next message the launcher hands it (martha#253, slice 2). The submit from `turn.complete`
  // is the one shape the host's own guidance names for submitting while the session idles.
  on('turn.complete', async ($: CrewEngine, e: unknown, next: CrewNext) => {
    await theChannelReading($).aTurnEnded(agentIdIn(e))
    return next(e)
  })
}


