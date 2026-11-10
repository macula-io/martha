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
// ONE NOTICE, OR NOTHING. The host writes a fixed sequence of elements and nothing between them; every field is the
// host's own form and nothing else. A text that pads a gap between elements, or pads a field, is no notice at all, and
// its prompt stays what its origin says it is (a cross-session message, A6). This is the point of matching the whole
// sequence with every field pinned: the ids and the agent's words sit in the member's own transcript on disk, so a
// session on the same machine can build a text that names them, and padding — in a gap or in a field — is exactly how
// it would carry words of its own past the gate (martha#170 r=2, r=3).

/** A completion notice's fields, as the host writes them. */
export interface CompletionNotice {
  /** The agent that finished: the host's task id, which is the agent id the relay's hooks carry. */
  readonly task_id: string
  /** The member's own call whose launch this completes. */
  readonly tool_use_id: string
  /** The host's summary line for this agent. */
  readonly summary: string
  /** The agent's own last words, wrapped in `<result>`. */
  readonly words: string
}

/**
 * The one status the host writes on a completion, read off every notice the recorded host and the live runs sent.
 * A host release that adds another status fails closed until that status is recorded and named here.
 */
export const COMPLETION_STATUS = 'completed'

/**
 * The host's one note sentence, word for word as Claude Code 2.1.322 writes it. The note is a constant: it says
 * nothing about this agent, so nothing but the host's own sentence may stand there.
 */
export const COMPLETION_NOTE =
  'A task-notification fires each time this agent stops with no live background children of its own. ' +
  'The user can send it another message and resume it, so the same task-id may notify more than once.'

/** The summary the host writes for an agent the member asked for, from that call's own description. */
export const summaryOfAnAgent = (description: string): string => `Agent "${description}" finished`

/**
 * The host's own sequence, element by element, with a newline and nothing else between any two of them: the task, the
 * member's call, the output file, the status, the summary, the note (a host release may leave it out), the agent's
 * words, and the usage line.
 *
 * The agent's words may hold `<` — code and XML are ordinary agent output — so the result is read to its own closing
 * tag; the launcher then holds it to the words the agent's stop reported, which is what makes it safe. Every other
 * field is read to its closing tag too and held to the host's form below.
 */
const NOTICE = new RegExp(
  '^<task-notification>\\n' +
    '<task-id>([^<\\n]+)</task-id>\\n' +
    '<tool-use-id>([^<\\n]+)</tool-use-id>\\n' +
    '<output-file>([^<\\n]+)</output-file>\\n' +
    '<status>([^<\\n]+)</status>\\n' +
    '<summary>([\\s\\S]*?)</summary>\\n' +
    '<note>([\\s\\S]*?)</note>\\n' +
    '<result>([\\s\\S]*?)</result>\\n' +
    '<usage><subagent_tokens>\\d+</subagent_tokens><tool_uses>\\d+</tool_uses><duration_ms>\\d+</duration_ms></usage>\\n' +
    '</task-notification>$',
)

/** The notice a prompt's text is, or `undefined` when the text is not one notice exactly. */
export function completionNoticeOf(text: string): CompletionNotice | undefined {
  const found = NOTICE.exec(text)
  if (found === null) return undefined
  const [, task_id, tool_use_id, output_file, status, summary, note, words] = found
  if (task_id === undefined || tool_use_id === undefined || output_file === undefined || summary === undefined || words === undefined) return undefined
  return itsFieldsAreTheHosts(task_id, output_file, status, note) ? { task_id, tool_use_id, summary, words } : undefined
}

/**
 * Whether the fixed fields are the host's: its one status, its one note sentence, and the background task's own
 * output file — a path with no space in it, ending in this task's own file. A path that names another task's output is
 * another task's notice.
 */
function itsFieldsAreTheHosts(task_id: string, output_file: string, status: string | undefined, note: string | undefined): boolean {
  return status === COMPLETION_STATUS && note === COMPLETION_NOTE && !/\s/.test(output_file) && output_file.endsWith(`/tasks/${task_id}.output`)
}
