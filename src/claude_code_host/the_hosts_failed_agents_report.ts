// The envelope the Claude Code host writes when an agent it started fails, derived from the host's own text rather than
// typed by hand (martha#390, threat T5).
//
// This exists so a review that stops at its reviewer model's limit is read from the host's own report and never from its
// prose: the notification's name, the elements the report carries and the word that says an agent failed are cut from
// the bundle (recorded_claude_code_host.json, re-recorded by npm run record:claude-code-host) and read from that record
// (recorded_claude_code_host.ts). A host that renames an element or the failure's own word fails the drift job by name,
// rather than a review that fails reading as one that did not.
//
// What is cut is the builder's whole map of elements, never one element by name: the host writes its report by walking
// `[[<name of task-id>, taskId], …, [<name of summary>, summary]]` in the one function that builds it, and the names are
// constants the bundle declares beside it. The words its tasks end in are cut from the switch that gives a task its
// status, which is where the `failed` this build decides on comes from.
//
// A name is read from the declaration NEAREST BEFORE the place that uses it, never from the bundle at large: a bundle of
// chunks reuses a minifier's names, and `FC` is `task-id` in one chunk and a help text in another.

/** What the host's report of a failed agent is: its notification, the elements it carries, and how a failure is spelled. */
export interface ARecordedFailedAgentsReport {
  /** The notification's own name: the envelope the host submits to the session, as `origin.kind` carries it too. */
  readonly notification: string
  /** The elements the report carries, in the host's own order, each with the field of the agent it holds. */
  readonly elements: readonly { readonly field: string; readonly element: string }[]
  /** Every word the host's tasks end in, as the switch that gives a task its status spells them. */
  readonly task_statuses: readonly string[]
}

/** The one word of `task_statuses` that says an agent failed: the status this build decides on, and no other. */
export const THE_FAILED_TASK_STATUS = 'failed'

/** The fields of the builder's own argument that this record is cut by, in the order the host writes them. */
const THE_FIELDS: readonly string[] = ['taskId', 'toolUseId', 'taskType', 'outputFile', 'status', 'summary']

/** A name the minifier may have chosen, matched by shape only. */
const NAME = '[\\w$]+'

/** The one function that builds the report: its argument names each field of the agent, which are never minified. */
const BUILDER = new RegExp(`\\{${THE_FIELDS.map((field) => `${field}:(${NAME})`).join(',')},summaryLead:`, 'g')

/** The map the builder walks: an element's name, then the argument it carries, once per field. */
const THE_ELEMENTS = new RegExp(`let ${NAME}=\\[(?:\\[${NAME},${NAME}\\],?){6}\\]`, 'g')

/** One case of the task-status switch: the word a task ended with, given back as the task's status. */
const A_STATUS_CASE = /case"([a-z-]+)":return\{taskId:[\w$]+,status:"([a-z-]+)"/g

/** The switch that gives a task its status, opened; its body is cut by its own braces below. */
const THE_STATUS_SWITCH = new RegExp(`switch\\(${NAME}\\.status\\)\\{`, 'g')

/**
 * The host's report of a failed agent, cut from `host`'s own text. Refuses with a message naming what it looked for when
 * the text holds none of it, or two that differ: a report this build cannot read is a fault of the recording, never a
 * silent "the host reported nothing".
 */
export function failedAgentsReportIn(host: string): ARecordedFailedAgentsReport {
  const [builder] = theOne(BUILDER, host, 'the function that builds a failed agent\'s report')
  const arguments_ = THE_FIELDS.map((field) => new RegExp(`${field}:(${NAME})`).exec(builder)?.[1] ?? '')
  const [map] = theOne(THE_ELEMENTS, host, 'the map of the report\'s elements')
  const pairs = [...map.matchAll(/\[([\w$]+),([\w$]+)\]/g)].map(([, element, argument]) => ({ element, argument }))
  if (pairs.map(({ argument }) => argument).join(',') !== arguments_.join(',')) {
    throw new Error(`The report's map carries ${pairs.map(({ argument }) => argument).join(', ')}, and the builder takes ${arguments_.join(', ')}: which element holds which field cannot be told`)
  }
  // The names are string constants the bundle declares together, in the chunk that holds the builder: one window that
  // declares all seven says what each of them stands for. Read one by one from the bundle at large they are not: a
  // minifier's name is reused from chunk to chunk.
  const values = theValuesOfTheNames(host, [...pairs.map(({ element }) => element ?? ''), theNotificationNameIn(host, builder)])
  const elements = pairs.map(({ element }, place) => ({ field: THE_FIELDS[place] ?? '', element: values.get(element ?? '') ?? '' }))
  return { notification: values.get(theNotificationNameIn(host, builder)) ?? '', elements, task_statuses: theTaskStatusesIn(host) }
}

/** How many declarations one run of them may span: the report's names are written together, among a handful of others. */
const A_RUN_OF_DECLARATIONS = 200

/**
 * What each of `names` stands for, from the one run of declarations in `host` that declares all of them. Refuses when no
 * run declares them all, or when two runs that do disagree: a report whose elements cannot be told is not read at all.
 */
function theValuesOfTheNames(host: string, names: readonly string[]): ReadonlyMap<string, string> {
  const runs = theRunsDeclaring(host, names)
  const [run] = [...runs]
  if (runs.size !== 1 || run === undefined) throw new Error(`The host's text holds ${runs.size} run(s) of declarations for the report's names, so which one is meant cannot be told: ${[...runs].slice(0, 3).join(' | ')}`)
  return new Map(names.map((name, place) => [name, run.split(RUN_SEPARATOR)[place] ?? '']))
}

/** Every run of declarations in `host` that holds all of `names`, each as the values it gives them, in `names`' order. */
function theRunsDeclaring(host: string, names: readonly string[]): ReadonlySet<string> {
  const declared = declarationsIn(host)
  const runs = new Set<string>()
  for (let first = 0; first < declared.length; first += 1) {
    const held = theRunFrom(declared, first, names)
    const complete = names.every((name) => held.has(name))
    if (complete) runs.add(names.map((name) => held.get(name) ?? '').join(RUN_SEPARATOR))
  }
  return runs
}

/**
 * What the run of declarations starting at `first` holds of `names`. A name declared again ends the run: the bundle has
 * moved to a chunk that reuses the minifier's name, and what follows is that chunk's meaning of it, not this one's.
 */
function theRunFrom(declared: readonly ADeclaration[], first: number, names: readonly string[]): ReadonlyMap<string, string> {
  const held = new Map<string, string>()
  for (let next = first; next < declared.length && next - first <= A_RUN_OF_DECLARATIONS; next += 1) {
    const one = declared[next]
    if (one === undefined || !names.includes(one.name) || held.has(one.name)) continue
    held.set(one.name, one.value)
  }
  return held
}

/** One `name="value"` the bundle declares. */
interface ADeclaration {
  readonly name: string
  readonly value: string
}

/** Every `name="value"` declaration in `host`, in the order the bundle writes them, the comma of a list included. */
function declarationsIn(host: string): readonly ADeclaration[] {
  return [...host.matchAll(/(?:var |let |const |,)([\w$]+)="([^"]*)"/g)].map(([, name, value]) => ({ name: name ?? '', value: value ?? '' }))
}

/** What separates one run of declarations' values in the set above. */
const RUN_SEPARATOR = '\u0000'

/** The one capture of `pattern` in `host`: exactly one, or the refusal that says what was looked for. */
function theOne(pattern: RegExp, host: string, what: string): RegExpMatchArray {
  const found = [...new Set([...host.matchAll(pattern)].map((match) => match[0]))]
  if (found.length !== 1) throw new Error(`The host's text holds ${found.length} of ${what}, so which one is meant cannot be told: ${found.slice(0, 3).join(' | ')}`)
  const one = found[0] ?? ''
  const match = one.match(pattern)
  if (match === null) throw new Error(`unreachable: ${what}`)
  return match
}

/** The variable the builder wraps the elements in as the notification's name: what its template opens on. */
function theNotificationNameIn(host: string, builder: string): string {
  const at = host.indexOf(builder)
  const after = host.slice(at + builder.length, at + builder.length + 400)
  const name = new RegExp('=`<\\$\\{(' + NAME + ')\\}>`').exec(after)?.[1]
  if (name === undefined) throw new Error('the builder of a failed agent\'s report wraps no element in a notification, so its name cannot be derived')
  return name
}

/**
 * Every word the host's tasks end in, from the switch that gives a task its status. A switch qualifies when every one of
 * its cases gives a task back the very word it ended with; two that disagree cannot both be how a task ends.
 */
function theTaskStatusesIn(host: string): readonly string[] {
  const found: string[][] = []
  for (const opened of host.matchAll(THE_STATUS_SWITCH)) {
    const body = theBracedBody(host, (opened.index ?? 0) + opened[0].length - 1)
    const cases = [...body.matchAll(A_STATUS_CASE)]
    if (cases.length === 0 || cases.some(([, ended, status]) => ended !== status)) continue
    found.push([...new Set(cases.map(([, ended]) => String(ended)))])
  }
  const distinct = [...new Set(found.map((words) => words.join(',')))]
  if (distinct.length !== 1) throw new Error(`The host's text holds ${distinct.length} switches that give a task its status, so which one is meant cannot be told: ${distinct.join(' | ')}`)
  return (distinct[0] ?? '').split(',')
}

/** The text between the brace at `opened` and the one that closes it. */
function theBracedBody(host: string, opened: number): string {
  let depth = 0
  for (let at = opened; at < host.length; at += 1) {
    if (host[at] === '{') depth += 1
    if (host[at] !== '}') continue
    depth -= 1
    if (depth === 0) return host.slice(opened + 1, at)
  }
  throw new Error('the switch that gives a task its status is never closed, so its cases cannot be cut')
}
