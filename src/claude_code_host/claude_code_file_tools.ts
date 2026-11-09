// Claude Code's tools that write one file the call names (martha#132).
//
// A call of one of these is the only change a member makes that Martha records as its own: the launcher reads the
// file the call names once the call has run, and keeps its blob (../remember_a_members_own_writes). A tool not
// named here is never an own write, so a tool a host adds changes the checkout as an outsider would until it is
// added here.
//
// It also holds how the host resolves the path a file tool's call names, which #122's settings guard and the own
// writes share.

import { join, resolve } from 'node:path'

/** Each file-writing tool, by the argument of its call that names the file. */
export const CLAUDE_CODE_FILE_WRITING_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  Write: 'file_path',
  Edit: 'file_path',
  NotebookEdit: 'notebook_path',
})

/** The tool that writes a whole file from its call: what is on disk after it must be the call's content. */
export const WHOLE_FILE_TOOL = 'Write'

/** The argument of a WHOLE_FILE_TOOL call that holds the whole file. */
export const WHOLE_FILE_CONTENT = 'content'

/** The argument naming the file a call of `tool` writes, or undefined when `tool` writes no one file. */
export const fileArgumentOf = (tool: string): string | undefined =>
  Object.hasOwn(CLAUDE_CODE_FILE_WRITING_TOOLS, tool) ? CLAUDE_CODE_FILE_WRITING_TOOLS[tool] : undefined

/** The file a path in a call names as the host resolves it: trimmed, a leading `~` against its home, the rest against `cwd`. */
export function asTheHostResolves(value: string, cwd: string, home: string): string {
  const trimmed = value.trim()
  if (trimmed === '~') return home
  if (trimmed.startsWith('~/')) return join(home, trimmed.slice(2))
  return resolve(cwd, trimmed)
}
