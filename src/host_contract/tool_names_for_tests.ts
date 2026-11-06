// How two coding tools name an MCP tool, for the core's tests.
//
// A host composes the name its model calls from the server the tool was
// installed under and the tool's own name, and each host does it its own way.
// The core never takes a called name apart itself: it asks the host's
// `ownNameOf` (host_contract.ts). These two splits stand in for the adapters in
// tests, so a slice is proved against both forms, not only the one it was
// written for.

import type { ToolNames } from './host_contract.ts'

/** The separator Claude Code puts around the server's name: `mcp__<server>__<tool>`. */
const CLAUDE_CODE_SEPARATOR = '__'
const CLAUDE_CODE_MCP = `mcp${CLAUDE_CODE_SEPARATOR}`

/** Claude Code's form: the own name is what follows the last `__` of an `mcp__` tool. */
export const claudeCodeToolNames: ToolNames = {
  ownNameOf: (called) =>
    called.startsWith(CLAUDE_CODE_MCP)
      ? called.slice(called.lastIndexOf(CLAUDE_CODE_SEPARATOR) + CLAUDE_CODE_SEPARATOR.length)
      : called,
}

/** The separator OpenCode puts between the server's name and the tool's: `<server>_<tool>`. */
const OPENCODE_SEPARATOR = '_'

/**
 * OpenCode's form. The separator also occurs inside both names, so the name
 * cannot be split by its text alone: the host knows which servers it installed
 * and strips the one the called name starts with.
 */
export const openCodeToolNames = (servers: readonly string[]): ToolNames => ({
  ownNameOf: (called) => {
    const server = servers.find((name) => called.startsWith(`${name}${OPENCODE_SEPARATOR}`))
    return server === undefined ? called : called.slice(server.length + OPENCODE_SEPARATOR.length)
  },
})
