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

import { heardToolAnswer, RELAY_ORIGIN, TOOL_ANSWER_PATH, toolCallBody } from './relay_protocol.ts'
import { opensAtStartOf, rowsToOpen } from './pane_rule.ts'

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

/** A tool as the launcher gives it: its name, what it is for, and the schema of what it takes. */
interface CrewTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** The engine calls this module makes, typed by shape as the relay's own module types them. */
interface CrewEngine {
  readonly env: { get(name: string): Promise<string | undefined> }
  readonly http: {
    fetch(url: string, init: { method: string; headers: Record<string, string>; body: string; socketPath: string }): Promise<{ status: number; text: string }>
  }
  readonly session: { id(): Promise<string> }
  readonly clock: { after(ms: number, fn: () => void): { cancel(): void } }
  readonly tool: { register(tool: CrewTool & { description: string }): Promise<unknown> }
  readonly command: { register(command: { name: string; description: string }): Promise<unknown> }
  readonly ui: {
    open(view: { id: string; title: string; rows: number }): Promise<unknown>
    close(view: { id: string }): Promise<unknown>
    resolve(event: unknown): { Box: unknown; Text: unknown; Button: unknown }
  }
}

type CrewNext = (event: unknown) => Promise<unknown>

/**
 * Asks the launcher for a core tool's answer, and gives back exactly what it said. A launcher that cannot be
 * heard is not a yes: the answer says so, and the member carries on with it.
 */
async function askTheLauncher($: CrewEngine, tool: string, args: Readonly<Record<string, unknown>>): Promise<string> {
  // The name is spelled out, as the relay's own module spells it: the host refuses a hooks module whose
  // `$.env.get` is given anything but a literal, an imported constant included (#104).
  const socket_path = await $.env.get('MARTHA_RELAY_SOCKET')
  if (socket_path === undefined) return NOT_OURS
  const session_id = await $.session.id()
  try {
    const heard = await $.http.fetch(`${RELAY_ORIGIN}${TOOL_ANSWER_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toolCallBody(session_id, tool, args)),
      socketPath: socket_path,
    })
    const answer = heardToolAnswer(heard.status, heard.text)
    return answer.answered ? answer.answer : `Martha did not answer: ${answer.why}`
  } catch (error) {
    return `Martha did not answer: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Asks the launcher for the tools to register, which it alone names and describes. */
async function toolsFromTheLauncher($: CrewEngine): Promise<readonly CrewTool[]> {
  const said = await askTheLauncher($, 'the_crews_tools', {})
  try {
    const parsed: unknown = JSON.parse(said)
    return Array.isArray(parsed) ? (parsed as CrewTool[]) : []
  } catch {
    return []
  }
}

/** Opens the pane, with the rows the host draws it in. */
async function openThePane($: CrewEngine): Promise<void> {
  const said = await askTheLauncher($, 'see_the_crew', {})
  await $.ui.open({ id: PANE, title: 'Crew', rows: rowsToOpen(said) })
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

/** The crew's tools registered with this host, and the pane drawn. */
export const register = (on: (event: string, options?: unknown, handler?: unknown) => unknown): void => {
  const answerWith = (tool: string) => async ($: CrewEngine, e: Record<string, unknown>): Promise<unknown> => {
    const { tool: _tool, agentId: _agent, tool_use_id: _use, ...args } = e
    return { result: await askTheLauncher($, tool, args) }
  }

  // The tool names are spelled out, never built: the host's plugin validator reads this file and refuses a hook that
  // names its tool by anything but a string literal (the relay's register.ts records the same rule). Each name is
  // CREW_SERVER followed by the tool's own, and a test here fails by name when one of them drifts.
  on('tool.call', { tool: 'mcp__martha-relay__report_progress' }, answerWith('report_progress'))
  on('tool.call', { tool: 'mcp__martha-relay__crew_log' }, answerWith('crew_log'))
  on('tool.call', { tool: 'mcp__martha-relay__what_was_sent' }, answerWith('what_was_sent'))
  on('tool.call', { tool: 'mcp__martha-relay__note_what_became_of_an_act' }, answerWith('note_what_became_of_an_act'))
  on('tool.call', { tool: 'mcp__martha-relay__see_the_crew' }, answerWith('see_the_crew'))

  on('command.run', { command: OPEN_THE_PANE }, async ($: CrewEngine) => {
    await openThePane($)
    return { text: '' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($: CrewEngine, e: unknown) => {
    const { Box, Text, Button } = $.ui.resolve(e) as { Box: unknown; Text: unknown; Button: unknown }
    const said = await askTheLauncher($, 'see_the_crew', {})
    let parsed: { rows?: readonly ShownRow[]; counts?: Record<string, number> } = {}
    try {
      parsed = JSON.parse(said) as typeof parsed
    } catch {
      parsed = {}
    }
    const rows = parsed.rows ?? []
    const counts = parsed.counts ?? {}
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold>{`${counts.online ?? 0}/${counts.members ?? 0} online · ${counts.waiting ?? 0} waiting · ${counts.needs_you ?? 0} need you`}</Text>
          <Button key="close" label="close" hotkey="x" role="dismiss" onPress={() => void $.ui.close({ id: PANE })} />
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
    for (const tool of await toolsFromTheLauncher($)) await $.tool.register(tool)
    const first = await askTheLauncher($, 'see_the_crew', {})
    if (opensAtStartOf(first)) await openThePane($)
    return next(e)
  })
}


