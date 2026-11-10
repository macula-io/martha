// A background agent's completion, read as the host writes it (martha#170).
//
// This exists so the one door a background agent's words come through can be placed: on Claude Code 2.1.322 a
// background agent's completion arrives in the member's turn as a prompt whose origin is `task-notification`, and no
// tool result carries it. The origin alone places nothing: the engine stamps that same origin on a GitHub webhook, a
// PR steward and a session inbox, so a stranger's comment arrives under it too (../name_the_source_of_a_prompt).
//
// What this module does is read the notice's own fields and nothing else: the agent it names, the member's own spawn
// it answers, and the words it carries. Whether those ids are ones this launcher holds, and whether the words are the
// agent's own, is the launcher's question (../launch_a_claude_code_member/answer_the_relay) — never this module's,
// and never taken from the text.
//
// ONE NOTICE, OR NOTHING. The host writes a fixed sequence of elements and nothing between them; a text that pads any
// gap with words of its own is no notice at all, and its prompt stays what its origin says it is (a cross-session
// message, A6). This is the point of matching the whole sequence rather than finding three fields in a text: the ids
// and the agent's words are in the member's own transcript on disk, so a session on the same machine can build a text
// that names them, and padding it is exactly how it would carry words of its own past the gate (martha#170 r=2).

/** A completion notice's fields, as the host writes them. */
export interface CompletionNotice {
  /** The agent that finished: the host's task id, which is the agent id the relay's hooks carry. */
  readonly task_id: string
  /** The member's own call whose launch this completes. */
  readonly tool_use_id: string
  /** The agent's own last words, wrapped in `<result>`. */
  readonly words: string
}

/**
 * The host's own sequence, element by element, with a newline and nothing else between any two of them: the task, the
 * member's call, the output file, the status, the summary, the note (a host release may leave it out), the agent's
 * words, and the usage line. A field never holds `<`, so a tag opened inside one ends the match rather than passing.
 */
const NOTICE = new RegExp(
  '^<task-notification>\\n' +
    '<task-id>([^<\\n]+)</task-id>\\n' +
    '<tool-use-id>([^<\\n]+)</tool-use-id>\\n' +
    '<output-file>[^<\\n]+</output-file>\\n' +
    '<status>[^<\\n]+</status>\\n' +
    '<summary>[^<]*</summary>\\n' +
    '(?:<note>[^<]*</note>\\n)?' +
    '<result>([^<]*)</result>\\n' +
    '<usage><subagent_tokens>\\d+</subagent_tokens><tool_uses>\\d+</tool_uses><duration_ms>\\d+</duration_ms></usage>\\n' +
    '</task-notification>$',
)

/** The notice a prompt's text is, or `undefined` when the text is not one notice exactly. */
export function completionNoticeOf(text: string): CompletionNotice | undefined {
  const found = NOTICE.exec(text)
  if (found === null) return undefined
  const [, task_id, tool_use_id, words] = found
  return task_id === undefined || tool_use_id === undefined || words === undefined ? undefined : { task_id, tool_use_id, words }
}
