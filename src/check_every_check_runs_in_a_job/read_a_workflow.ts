// One workflow file, read as text into what this check needs of it (martha#741): whether every pull request runs it,
// and what each of its jobs runs.
//
// No YAML parser: the tree has none, and this reader reads the workflows the way prove_the_core/the_release_is_proven/the_installer_jobs_steps
// reads its job, by their two-space layout. What it cannot read it never reads as nothing. An `on:` in a form other than
// the three below, or a `jobs:` with no job header this reader can see, throws, naming the file, so a workflow written
// another way is a check that could not be made, never a workflow with no trigger or no jobs.
//
// The `on:` forms read: `on: <event>`, `on: [<events>]`, and a block whose two-space keys are events. A pull_request key
// in that block with anything written after its colon is not read either, since a filter could hide there.

/** How a workflow's pull_request trigger reaches the pull requests: all of them, some of them, or none. */
export type PullRequestTrigger =
  | { readonly kind: 'every' }
  | { readonly kind: 'none' }
  | { readonly kind: 'filtered'; readonly by: 'paths:' | 'paths-ignore:' }

/** One job of a workflow. */
export interface Job {
  /** The job's id, its two-space key under `jobs:`. */
  readonly id: string
  /** Every line of the job that is not a comment, YAML's or a shell's: where a script name is mentioned. */
  readonly lines: readonly string[]
  /** The value of every step written on one line, `run: <command>`: what the job runs. A `run: |` block is not one. */
  readonly steps: readonly string[]
}

/** A workflow, read. */
export interface Workflow {
  /** The file, from the repository's top, as a finding names it. */
  readonly file: string
  readonly trigger: PullRequestTrigger
  readonly jobs: readonly Job[]
}

const TOP_LEVEL = /^[^\s#]/
const ON = /^on:(.*)$/
const JOBS = /^jobs:\s*(?:#.*)?$/
const EVENT = /^[A-Za-z_]+$/
const EVENT_KEY = /^ {2}([A-Za-z_]+):(.*)$/
const JOB_HEADER = /^ {2}([A-Za-z0-9_-]+):\s*(?:#.*)?$/
const UNDER_A_KEY = /^ {3,}\S/
const FILTER = /^\s+(paths|paths-ignore)\s*:/
const ONE_LINE_RUN = /^\s+(?:- )?run:\s*([^|>\s].*?)\s*$/

const PULL_REQUEST = 'pull_request'

const isComment = (line: string): boolean => line.trim().startsWith('#')
const isBlank = (line: string): boolean => line.trim() === ''
/** A line's text without a trailing ` # comment`, trimmed. */
const withoutComment = (text: string): string => text.replace(/\s+#.*$/, '').trim()

/** The lines after `start` up to the next top-level key, blank and comment lines left out. */
function theBlockAfter(lines: readonly string[], start: number): string[] {
  const end = lines.findIndex((line, at) => at > start && TOP_LEVEL.test(line))
  return lines.slice(start + 1, end === -1 ? undefined : end).filter((line) => !isBlank(line) && !isComment(line))
}

/** The events of an `on:` written on its own line, or undefined when it is in a form this reader does not read. */
function inlineEvents(value: string): string[] | undefined {
  const list = /^\[(.*)\]$/.exec(value)
  const events = list === null ? [value] : (list[1] ?? '').split(',').map((event) => event.trim())
  return events.every((event) => EVENT.test(event)) ? events : undefined
}

/** The trigger a block `on:` holds, or undefined when one of its lines is in a form this reader does not read. */
function blockTrigger(block: readonly string[]): PullRequestTrigger | undefined {
  const keys = theEventKeys(block)
  const unread = block.some((line) => !EVENT_KEY.test(line) && !UNDER_A_KEY.test(line))
  if (keys[0]?.at !== 0 || unread) return undefined
  const pullRequest = keys.find((key) => key.event === PULL_REQUEST)
  if (pullRequest === undefined) return { kind: 'none' }
  if (pullRequest.after !== '') return undefined
  const next = keys.find((key) => key.at > pullRequest.at)?.at ?? block.length
  return theFilter(block.slice(pullRequest.at + 1, next))
}

/** Each two-space event key of an `on:` block: its event, what is written after its colon, and its line. */
function theEventKeys(block: readonly string[]): { readonly event: string; readonly after: string; readonly at: number }[] {
  return block.flatMap((line, at) => {
    const key = EVENT_KEY.exec(line)
    return key === null ? [] : [{ event: key[1] ?? '', after: withoutComment(key[2] ?? ''), at }]
  })
}

/** The pull_request trigger whose lines under its key are `under`: filtered by paths, or reaching every one. */
function theFilter(under: readonly string[]): PullRequestTrigger {
  const filter = under.map((line) => FILTER.exec(line)?.[1]).find((by) => by !== undefined)
  if (filter === undefined) return { kind: 'every' }
  return { kind: 'filtered', by: filter === 'paths' ? 'paths:' : 'paths-ignore:' }
}

/** The trigger of the `on:` at line `at`, whose own line holds `inline`; undefined when it cannot be read. */
function triggerAt(lines: readonly string[], at: number, inline: string): PullRequestTrigger | undefined {
  if (inline === '') return blockTrigger(theBlockAfter(lines, at))
  const events = inlineEvents(inline)
  if (events === undefined) return undefined
  return { kind: events.includes(PULL_REQUEST) ? 'every' : 'none' }
}

/** How the workflow's `on:` reaches pull requests. Throws when it has no `on:`, or one that cannot be read. */
function theTrigger(file: string, lines: readonly string[]): PullRequestTrigger {
  const at = lines.findIndex((line) => ON.test(line))
  const trigger = at === -1 ? undefined : triggerAt(lines, at, withoutComment(ON.exec(lines[at] ?? '')?.[1] ?? ''))
  if (trigger === undefined) throw new Error(`${file}: its on: cannot be read`)
  return trigger
}

/** One job, from the lines of the jobs block between its header and the next. */
function theJob(id: string, lines: readonly string[]): Job {
  return { id, lines, steps: lines.flatMap((line) => ONE_LINE_RUN.exec(line)?.[1] ?? []) }
}

/** Every job under the workflow's `jobs:`. Throws when it holds none this reader can see. */
function theJobs(file: string, lines: readonly string[]): Job[] {
  const at = lines.findIndex((line) => JOBS.test(line))
  const block = at === -1 ? [] : theBlockAfter(lines, at)
  const headers = block.flatMap((line, index) => JOB_HEADER.test(line) ? [index] : [])
  if (headers.length === 0) throw new Error(`${file}: jobs: holds no job this reader can see`)
  return headers.map((start, index) => theJob(JOB_HEADER.exec(block[start] ?? '')?.[1] ?? '', block.slice(start + 1, headers[index + 1])))
}

/** The workflow `text`, read from `file`. Throws, naming the file, when its `on:` or its `jobs:` cannot be read. */
export function readAWorkflow(file: string, text: string): Workflow {
  const lines = text.split('\n')
  return { file, trigger: theTrigger(file, lines), jobs: theJobs(file, lines) }
}
