// What the launcher answers when the mod asks for the crew's tools, and the one parser for it (martha#254).
//
// The launcher answers with the crew's tools as a bare array — `JSON.stringify(CREW_TOOLS)` in a_crews_tools — and
// this is the only place that shape is read. It lives beside the hooks module rather than inside it so a test can
// feed the launcher's own answer to the parser that reads it: at r=3 the two disagreed (the parser read
// `parsed.tools`, the launcher sent an array) and no test joined them, so a started member registered no tools at
// all and every test still passed. This file is the join (r=4).

/** A tool as the launcher gives it: its name, what it is for, and the schema of what it takes. */
export interface ALaunchersTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

/** The crew's tools as the launcher answered them, or null when the answer is not that. */
export function crewToolsIn(said: string): readonly ALaunchersTool[] | null {
  try {
    const parsed: unknown = JSON.parse(said)
    return Array.isArray(parsed) ? (parsed as ALaunchersTool[]) : null
  } catch {
    return null
  }
}
