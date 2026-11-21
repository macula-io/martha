// The host's own task list, folded as this session keeps it (martha#1000, gap 8 of #957).
//
// This exists so a member's row says what it is doing from the list it already keeps, instead of asking the member to
// say it twice: the host's `TaskCreate`, `TaskUpdate` and `TodoWrite` move a session's list, and the mod folds the list
// after each of them and posts it to the launcher, which writes it onto the row's own `tasks`. Each write re-counts the
// list — the task in progress, else the first still pending, and the count done — as crew-code counted it
// (register.tsx:3783-3815), so the row's figures ages with the crew's clock and never with the beat.
//
// A hooks module runs with no Node and may import only its own files, so this file holds the three standings by literal
// and imports nothing of the core. It decides nothing of the row: what the launcher writes of the list is the launcher's
// question, and a list this file folds carries the standings as the host gave them.

/** One task as this session keeps it: what it says, and where it stands. */
export interface ATaskTheSessionKeeps {
  readonly subject: string
  readonly status: string
}

/** The session's task list, by the host's own id for each task. */
export type TheTaskList = Readonly<Record<string, ATaskTheSessionKeeps>>

/** The standings the host's own task tools write, and the only three a list this file folds carries. */
export const THE_SESSIONS_STANDINGS = ['pending', 'in_progress', 'completed'] as const

/** A list the session has not written yet: nothing to show, and a row that says nothing rather than an empty list. */
export const NO_TASKS: TheTaskList = {}

/** The standing a status names, or 'pending' for one this file does not know: a list keeps its task, whatever it says. */
const standingIn = (status: unknown, before: string): string => (THE_SESSIONS_STANDINGS.includes(status as never) ? (status as string) : before)

/**
 * The list after `TaskCreate` made one: the new task, still pending, under the id the host gave it. A create the host
 * answered without an id made no task this file can name, so it moves nothing.
 */
export function afterATaskWasCreated(list: TheTaskList, created: { readonly id: string; readonly subject: string }): TheTaskList {
  if (created.id === '') return list
  return { ...list, [created.id]: { subject: created.subject, status: 'pending' } }
}

/**
 * The list after `TaskUpdate` moved one: the task's own words and standing where it names them, the ones it held before
 * where it does not, and gone when the host says it was deleted.
 */
export function afterATaskWasUpdated(
  list: TheTaskList,
  update: { readonly task_id: string; readonly subject?: unknown; readonly status?: unknown },
): TheTaskList {
  if (update.task_id === '') return list
  const before = list[update.task_id]
  if (update.status === 'deleted') {
    const { [update.task_id]: _gone, ...rest } = list
    return rest
  }
  const subject = typeof update.subject === 'string' && update.subject !== '' ? update.subject : (before?.subject ?? update.task_id)
  return { ...list, [update.task_id]: { subject, status: standingIn(update.status, before?.status ?? 'pending') } }
}

/**
 * The list after `TodoWrite` wrote it whole: one task per entry of the list it wrote, under the entry's own place in
 * that list, as crew-code keyed them. An argument that is no list of entries is a write this file cannot read, and the
 * list it held stays.
 */
export function afterAToDoListWasWritten(list: TheTaskList, todos: unknown): TheTaskList {
  if (!Array.isArray(todos)) return list
  const written: Record<string, ATaskTheSessionKeeps> = {}
  todos.forEach((todo: unknown, at) => {
    if (typeof todo !== 'object' || todo === null) return
    const one = todo as Record<string, unknown>
    const active = typeof one['activeForm'] === 'string' && one['activeForm'] !== '' ? one['activeForm'] : ''
    const content = typeof one['content'] === 'string' ? one['content'] : ''
    const subject = active !== '' ? active : content
    if (subject === '') return
    written[String(at)] = { subject, status: standingIn(one['status'], 'pending') }
  })
  return written
}

/** The list as the launcher is posted it: each task's words and standing, in the order the list keeps them. */
export function theTasksToPost(list: TheTaskList): readonly ATaskTheSessionKeeps[] {
  return Object.values(list).map((task) => ({ subject: task.subject, status: task.status }))
}
