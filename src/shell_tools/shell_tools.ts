// What may be called while a session holds text it must not act on.
//
// This is an ALLOW-LIST, and that is the whole point. A deny-list quietly allows
// every tool name it has not been taught: hosts differ (`bash` on one, `Bash` on
// another), plugins add their own (`MultiEdit`, `patch`), and a new release of a
// host can introduce a tool that executes before anyone updates a list here. So
// the only tools allowed while a session is tainted are the ones that only read.
// Everything else — a shell by any name, a write, an agent spawn, a web fetch, a
// message that hands the text to a peer, a tool this repository has never seen —
// executes, and is refused.
//
// Every name added here is a decision that the tool cannot make anything happen.

export const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'] as const

// MCP tools that only read. Keyed on the server's own names: a plugin-namespaced
// copy of the same tool does not match, and is therefore treated as executing.
// That is noisy and safe, which is the right way round.
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

/** True only for a tool that reads and cannot make anything happen. */
export function isReadOnlyTool(tool: string): boolean {
  return (READ_ONLY_TOOLS as readonly string[]).includes(tool) || READ_ONLY_MCP_TOOLS.has(tool)
}

/**
 * True for everything else, including a tool name nobody has seen before.
 *
 * The shell is not a list of tools: it is every tool except the ones that only
 * read. A gate that names `Bash` and forgets `bash` is not a gate.
 */
export function isShellTool(tool: string): boolean {
  return !isReadOnlyTool(tool)
}
