// Which rule a file permission check actually matches, as the recorder cuts it from the host binary (martha#226).
//
// A permissions rule is written `Tool(path)`, and the host checks a file-editing rule against ONE tool's checks: its
// own statement maps a rule naming `Write`, `NotebookEdit` or `MultiEdit` to `Edit`, `Glob` to `Read`, and any other
// tool to itself. A rule under a tool the check never uses is written, never matched, and silently does nothing — which
// is what the host says about it in its own words, on the terminal at start and on the standard error of a run that is
// not a terminal. This guard writes its rules under the tool the check uses, and reads the host's complaint about one
// it would ignore (../refuse_a_member_writing_owner_memory/, martha#226); neither name is typed here:
//   - `file_permission_rules`: the statement that maps a rule's tool name to the one the check uses, whole. A host
//     that renames those tools, or that stops mapping one of them, fails the recording before the guard can write a
//     rule nothing honours.

/** What the host binary says about which rules its file permission checks match, as recorded. */
export interface FilePermissionRules {
  /** The statement that maps a rule's tool name to the tool whose file permission checks it is matched against. */
  readonly matcher: string
}

/**
 * Where the host says in words that a rule of a file tool is not matched by those checks. The recorder cuts the
 * statement that decides which rules are by this mark, and the launch reads the host's complaint about a rule by it
 * (../refuse_a_member_writing_owner_memory), so a host that rewords it fails the recording rather than the reading
 * quietly finding nothing.
 */
export const NOT_MATCHED_MARK = 'is not matched by file permission checks'

/** The one statement of the host's text that holds `at`: from the `let` it opens with to the `;` that ends it. */
function statementHolding(text: string, at: number): string {
  const start = text.lastIndexOf('let ', at)
  const end = text.indexOf(';', start)
  if (start < 0 || end < 0) throw new Error('The host says a rule is not matched by its file permission checks, but the statement that decides which rules are cannot be cut from its text.')
  return text.slice(start, end + 1)
}

/**
 * The statement that maps a rule's tool name to the tool its file permission checks use, only, from the host's text.
 * A host that words the complaint another way, or that holds two such statements, fails the recording rather than
 * leaving the guard deriving from a statement nobody read.
 */
export function filePermissionRulesIn(text: string): FilePermissionRules {
  const marks = [...text.matchAll(new RegExp(NOT_MATCHED_MARK, 'g'))]
  if (marks.length !== 1) throw new Error(`The host words its "not matched by file permission checks" complaint ${String(marks.length)} times, not once, so which rules its checks match cannot be told.`)
  const statement = statementHolding(text, marks[0]?.index ?? 0)
  // The mapping is the statement's whole point: a host that keeps the words and drops it fails here.
  if (!statement.includes('.toolName===')) throw new Error(`The host's statement on a rule its file permission checks do not match holds no tool mapping (${statement}), so the tool those checks use cannot be told.`)
  return { matcher: statement }
}

/** One `a.b==="x"||a.b==="y"? "z"` step of the statement's chain: the tool names it covers, and the one they are checked as. */
const A_STEP = /((?:[\w$]+\.toolName==="[^"]*"(?:\|\|)?)+)\?("[^"]*")/g
const A_TOOL_NAME = /\.toolName==="([^"]*)"/g

/**
 * Each tool name the statement covers, and the tool whose file permission checks a rule naming it is matched against,
 * read from the statement the recording carries (martha#226). A name the statement does not cover is checked as itself,
 * which is what the statement's `void 0` fallback says.
 */
export function ruleMatchersIn(statement: string): Readonly<Record<string, string>> {
  const chain = /^let [\w$]+=([\s\S]*);$/.exec(statement)?.[1]
  if (chain === undefined) throw new Error(`The recorded statement on which rules the file permission checks match is not a statement this reads (${statement}).`)
  const steps = [...chain.matchAll(A_STEP)].flatMap((step) => {
    const covered = [...(step[1] ?? '').matchAll(A_TOOL_NAME)].map((name) => name[1] ?? '')
    const checkedAs = step[2]?.slice(1, -1)
    if (covered.length === 0 || checkedAs === undefined) throw new Error(`A step of the recorded statement names no tool to check a rule as (${statement}).`)
    return covered.map((name) => [name, checkedAs] as const)
  })
  if (steps.length === 0) throw new Error(`The recorded statement maps no tool to the one its file permission checks use (${statement}).`)
  if (!/:void 0$/u.test(chain)) throw new Error(`The recorded statement does not end by checking a tool the host does not list as itself (${statement}), so a rule naming one cannot be told what it is matched against.`)
  return Object.fromEntries(steps)
}

/**
 * The tool a rule naming `tool` must be written under, so the host's file permission checks match it: the one the
 * statement maps it to, or its own name when the statement maps it to nothing (martha#226).
 */
export const theToolItsChecksMatch = (matchers: Readonly<Record<string, string>>, tool: string): string => matchers[tool] ?? tool
