// What a background agent's completion notice names (martha#170).
//
// This exists so a completion is placed on the agent it is about, and only on that agent. Claude Code delivers a
// finished background task into the member's turn as a prompt whose origin is `task-notification`, and the engine
// stamps that same origin on a GitHub webhook, a PR steward and the session inbox from any sender — so the origin
// says only "some task notification", never whose. What the notice itself carries is the pair the launcher can
// check against its own record: the task it is about, and the call that started it. So the notice is read, never
// believed, and this module is only the reading.
//
// Rules:
//
//   1. THE WHOLE TEXT IS ONE ELEMENT. Words before or after the notice are not a notice this reader places: a sender
//      that could put its own sentence beside a real one could have the launcher vouch for text the agent never wrote.
//   2. EXACTLY ONE TASK AND ONE CALL. A second tag of either kind is refused, never read as the first: the notice's
//      body carries the agent's own words, and an agent whose answer holds a `<task-id>` of its own would otherwise
//      choose which id is read.
//   3. AN ID IS A BARE WORD. Empty, spaced or carrying markup, it names nothing.

/** The task a completion is about, and the call that started it: both are the host's, and both are looked up. */
export interface AgentCompletion {
  /** The background task that finished: the agent's own id, as the engine stamps it. */
  readonly task_id: string
  /** The tool call the agent was started by: one this launcher answered, or the notice is not this member's. */
  readonly tool_use_id: string
}

const OPEN = '<task-notification>'
const CLOSE = '</task-notification>'
const TASK_ID = 'task-id'
const TOOL_USE_ID = 'tool-use-id'

/** An id the host would put in one of the notice's tags: no whitespace, and nothing that opens or closes a tag. */
const BARE_WORD = /^[^\s<>]+$/

/**
 * The task and the call a completion notice names, or `undefined` when the text is anything but exactly one notice
 * naming exactly one of each.
 */
export function completionInANotification(text: string): AgentCompletion | undefined {
  const notice = text.trim()
  if (!notice.startsWith(OPEN) || !notice.endsWith(CLOSE)) return undefined
  const task_id = theOneValueOf(notice, TASK_ID)
  const tool_use_id = theOneValueOf(notice, TOOL_USE_ID)
  return task_id === undefined || tool_use_id === undefined ? undefined : { task_id, tool_use_id }
}

/** The one bare word a notice holds under this tag; `undefined` when it holds none, or more than one. */
function theOneValueOf(notice: string, tag: string): string | undefined {
  const values = [...notice.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((match) => match[1] ?? '')
  return values.length === 1 && BARE_WORD.test(values[0] ?? '') ? values[0] : undefined
}
