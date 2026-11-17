// The skills Claude Code says it loaded, read from the init event it prints
// before any model call (martha#243).
//
// A row that asks what the host loads from a folder cannot ask the model: the
// answer is in the first line of a stream-json run, and the run reaches it with
// no login and no answer from anyone. It is how the trash is held at the depth
// the host reads it: a SKILL.md directly in the trash is listed, and one below an
// entry in it is not.

/** One line of what the host printed, parsed, or undefined when it is not json. */
function parsed(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return undefined
  }
}

/** The subtype of the init event the host prints at session start, before any model call. */
const INIT = 'init'

/** Whether a parsed line is the session's init event. */
const isInit = (line: unknown): boolean => typeof line === 'object' && line !== null && (line as { subtype?: unknown }).subtype === INIT

/**
 * The skills the host listed at session start, by the name it listed them under:
 * the folder a SKILL.md sits in, not the name its frontmatter carries. A run that
 * printed no init event, or no list, names none.
 */
export function skillsListedIn(printed: string): readonly string[] {
  const init = printed.split('\n').map(parsed).find(isInit)
  const listed = (init as { skills?: unknown } | undefined)?.skills
  return Array.isArray(listed) ? listed.filter((one): one is string => typeof one === 'string') : []
}
