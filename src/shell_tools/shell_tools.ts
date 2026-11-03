// What "the shell" is: every tool that can execute something, directly or later.
//
// Bash is the obvious one. The write tools are the shell one step removed — a
// hook, a settings file, a script or an .envrc written now runs next. An agent
// spawn hands the shell to a child. An MCP tool acts on the mesh or on another
// member without a command line at all.
//
// A gate on Bash alone would leave three of the four open, which is why the
// refusal in ../refuse_execution_after_ungated_text takes a tool name and this
// module decides whether that name is part of the shell.

export const SHELL_TOOLS = [
  'Bash',
  'Write',
  'Edit',
  'NotebookEdit',
  'Agent',
  'Task',
  'mesh_call',
  'crew_restart',
] as const

// MCP tools that only read. Everything else an MCP server offers is treated as
// executing: a server's tools are not known in advance, so the safe default is
// that an unnamed MCP tool can act.
const READ_ONLY_MCP_TOOLS = new Set([
  'mcp__macula__mesh_read_inbox',
  'mcp__macula__mesh_rooms',
  'mcp__macula__mesh_agents',
  'mcp__macula__mesh_list_realms',
  'mcp__macula__mesh_list_stations',
  'mcp__macula__mesh_get',
  'mcp__macula__mesh_find_records',
  'mcp__macula__mesh_find_record',
  'mcp__macula__mesh_find_records_by_type',
  'mcp__macula__mesh_recall',
  'mcp__macula__mesh_read_node_events',
  'mcp__macula__mesh_lobby_transcript',
])

/** True when a tool can execute something, now or later. */
export function isShellTool(tool: string): boolean {
  if ((SHELL_TOOLS as readonly string[]).includes(tool)) return true

  return tool.startsWith('mcp__') && !READ_ONLY_MCP_TOOLS.has(tool)
}
