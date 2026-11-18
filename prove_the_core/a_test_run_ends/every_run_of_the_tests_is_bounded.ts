// Every run of the tests that ships is bounded (martha#683).
//
// `npm test` bounds every test: a time limit, force-exit and the guard that fails a file leaving something running
// (every_test_run_ends.ts). A `node --test` typed into a shell script, a workflow, a package folder's script or a page's
// code block gets none of that unless it names them, and a run without them leaves a file that waits forever in a child
// process of its own, to be reparented to the user's systemd when the run is stopped — five did on a member's machine on
// 2026-11-18.
//
// This reads every way the repository ships a run, each in the shape that shape really has:
//
//   - a shell script, a package folder's script (npm hands it to sh) and a page's code block tagged as shell, word by
//     word the way the shell reads them (martha#727): the runner's words are a run where they are words of a command,
//     and data where they are text inside one quoted word, unless something the shell hands that word to runs it
//     (where_a_shell_runs_a_string.ts). A name that holds the runner and is then run is a run, named by the line that
//     gave the name its value. A script whose quoting does not close is named too: what cannot be read never passes;
//   - a workflow and a page's other code blocks line by line, where a line ended with a backslash continues, and a
//     line that only writes a manifest (the checks plant one to prove they bite) is not a run: a YAML line such as
//     `name: Martha's check` would open a shell quote and swallow the rest of the file;
//   - a page of prose only inside its code blocks: a sentence that mentions the runner is not a run.
//
// What a run must state, it states as the word the runner receives: the flag itself, or the variable the flag's value
// lives in, as an argument after `--test`. A variable named anywhere else on the line, printed or mentioned, bounds
// nothing and is not counted.

import { FORCE_EXIT_FLAG, TIMEOUT_FLAG } from './every_test_run_ends.ts'
import { AnUnclosedPart, commandsOf, tokensOf, type ACommand, type AToken, type AWord } from '../read_a_shell_script/read_a_shell_script.ts'
import {
  DECLARATIONS,
  theForwarders,
  theProgramsPlace,
  theStringsItRuns,
  whatThePipesFeed,
  wherePlacesRun,
  type AString,
} from '../read_a_source/where_a_shell_runs_a_string.ts'

export type AKindOfShippedFile = 'a shell script' | 'a workflow' | 'a package script' | 'a page of prose'

export type AShippedFile = { readonly path: string; readonly text: string; readonly kind?: AKindOfShippedFile }

export type AnUnboundedRun = {
  readonly path: string
  readonly line: number
  readonly text: string
  readonly problems: readonly string[]
}

/** The words that make a line a run: the runner, then its own `--test`. */
const A_RUN = /\bnode\b[^\n]*?\s--test\b/

/** The timeout, as a word of the run's arguments that carries a value. */
const A_TIMEOUT_WORD = `${TIMEOUT_FLAG}=`

/** The guard's flag, which names the module a file's process loads first. */
const A_GUARD_WORD = '--import='

/** The file the guard loads, wherever the run's own folder puts it. */
const THE_GUARD = 'fail_a_test_file_that_leaves_something_running'

/** The shell variable a script keeps the force-exit flag in. */
const FORCE_EXIT_VARIABLE = 'FORCE_EXIT_FLAG'

/** The shell variable a script keeps the guard's flag in. */
const GUARD_VARIABLE = 'GUARD_FLAG'

/** A word of the run's arguments that is the value of the shell variable `name`: `$NAME`, `${NAME}`, either quoted. */
const namesTheVariable = (word: string, name: string): boolean => new RegExp(`^\\$\\{?${name}\\}?$`).test(word)

/** A word as the shell hands it to the runner: its outer quotes are gone. */
const unquoted = (word: string): string => word.replace(/^["']|["']$/g, '')

/** The words of a run's arguments: what follows its `--test`, up to the end of the line. */
function theRunsArguments(text: string): string[] {
  const at = text.search(/\s--test\b/)
  if (at === -1) return []
  return text
    .slice(at)
    .split(/\s+/)
    .filter((word) => word !== '')
    .map(unquoted)
}

/** Whether a line starts a run at all: a comment or a line that writes a file is not one. */
function startsARun(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith('#')) return false
  // A line that writes a manifest (the checks plant one to prove they bite) runs nothing.
  if (/\bprintf\b/.test(trimmed) && /package\.json/.test(trimmed)) return false
  return A_RUN.test(trimmed)
}

/** What a line that starts a run fails to state. */
const problemsOf = (text: string): string[] => whatTheArgumentsLack(theRunsArguments(text))

/** What a run's arguments, the words after its `--test`, fail to state. */
function whatTheArgumentsLack(words: readonly string[]): string[] {
  const statesTheTimeout = words.some((word) => word.startsWith(A_TIMEOUT_WORD) && word !== A_TIMEOUT_WORD)
  const statesTheForceExit = words.some((word) => word === FORCE_EXIT_FLAG || namesTheVariable(word, FORCE_EXIT_VARIABLE))
  const statesTheGuard = words.some((word) => (word.startsWith(A_GUARD_WORD) && word.includes(THE_GUARD)) || namesTheVariable(word, GUARD_VARIABLE))
  return [
    ...(statesTheTimeout ? [] : ['no --test-timeout=, so a test that hangs never fails (martha#56)']),
    ...(statesTheForceExit ? [] : ['no --test-force-exit, so a test file that holds a handle open never exits (martha#56)']),
    ...(statesTheGuard ? [] : ['no guard that fails a file leaving something running, so a leak passes silently (martha#56)']),
  ]
}

/**
 * A file's lines as the shell reads them: a line ended with a backslash continues onto the next, so a run split over
 * several lines is one line here, named by the line it starts on.
 */
function theLinesAsTheShellReadsThem(text: string): Array<{ readonly line: number; readonly text: string }> {
  const lines: Array<{ line: number; text: string }> = []
  let gathered = ''
  let started_at = 0
  text.split('\n').forEach((text_of_line, at) => {
    if (gathered === '') started_at = at + 1
    const trimmed = text_of_line.trimEnd()
    const continues = trimmed.endsWith('\\')
    gathered += (gathered === '' ? '' : ' ') + (continues ? trimmed.slice(0, -1) : text_of_line)
    if (continues) return
    lines.push({ line: started_at, text: gathered })
    gathered = ''
  })
  if (gathered !== '') lines.push({ line: started_at, text: gathered })
  return lines
}

/** Where a page of prose opens and closes a code block. */
const A_CODE_FENCE = /^\s*```/

/** The tags of a code block whose text is shell, read with the shell reader. */
export const SHELL_TAGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console'])

/** A page's code block: its tag, the line its text starts on, and its text. */
interface ACodeBlock {
  readonly tag: string
  readonly line: number
  readonly lines: string[]
}

/** A page of prose's code blocks, in order. */
function theCodeBlocks(text: string): ACodeBlock[] {
  const blocks: ACodeBlock[] = []
  let open: ACodeBlock | undefined
  text.split('\n').forEach((line, at) => {
    if (!A_CODE_FENCE.test(line)) return open?.lines.push(line)
    open = open === undefined ? { tag: /^\s*```\s*([\w-]*)/.exec(line)?.[1]?.toLowerCase() ?? '', line: at + 2, lines: [] } : undefined
    if (open !== undefined) blocks.push(open)
  })
  return blocks
}

/** A page's text with every line outside the code blocks `keep` takes made empty, so only what they hold can run. */
function onlyItsCodeBlocks(text: string, keep: (block: ACodeBlock) => boolean): string {
  const lines = text.split('\n').map(() => '')
  for (const block of theCodeBlocks(text).filter(keep)) block.lines.forEach((line, at) => (lines[block.line - 1 + at] = line))
  return lines.join('\n')
}

/** The runs a text read line by line starts that are not bounded. */
function theUnboundedLines(path: string, text: string): AnUnboundedRun[] {
  return theLinesAsTheShellReadsThem(text).flatMap(({ line, text: run }) => {
    const problems = startsARun(run) ? problemsOf(run) : []
    return problems.length === 0 ? [] : [{ path, line, text: run.trim(), problems }]
  })
}

/** The unbounded runs of one shipped file, read in the shape that file really has. */
function theUnboundedRunsOf(file: AShippedFile): AnUnboundedRun[] {
  if (file.kind === 'a workflow') return theUnboundedLines(file.path, file.text)
  if (file.kind !== 'a page of prose') return theUnboundedRunsOfAScript(file.path, file.text, 1, new Map())
  const shell = (block: ACodeBlock): boolean => SHELL_TAGS.has(block.tag)
  return [
    ...theUnboundedLines(file.path, onlyItsCodeBlocks(file.text, (block) => !shell(block))),
    ...theCodeBlocks(file.text)
      .filter(shell)
      .flatMap((block) => theUnboundedRunsOfAScript(file.path, block.lines.join('\n'), block.line, new Map())),
  ]
}

/** Every run the shipped files start that is missing one of the three things that bound it, each named by file and line. */
export function unboundedRunsIn(files: readonly AShippedFile[]): AnUnboundedRun[] {
  const seen = new Set<string>()
  return files.flatMap(theUnboundedRunsOf).filter((run) => {
    const key = `${run.path}:${run.line}:${run.text}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// The shell reader's side (martha#727).

/** What a script whose quoting does not close is named for. */
export const UNREADABLE = 'its quoting does not close here, so the check cannot tell a run from data'

/** A name that holds the runner: the line that gave it its value, how that assignment reads, and the value's words. */
interface AHeldRun {
  readonly line: number
  readonly text: string
  readonly words: readonly string[]
}

/** What a script's commands are read against: the names that hold the runner, its forwarding functions, its pipes. */
interface AReading {
  readonly path: string
  readonly held: ReadonlyMap<string, AHeldRun>
  readonly forwarders: ReadonlySet<string>
  readonly fed: ReadonlyMap<ACommand, readonly AString[]>
}

/** The runner: a word `node`, or a path to one. */
const isTheRunner = (word: string): boolean => word === 'node' || word.endsWith('/node')

/** The words after the run's own `--test`, when the words hold a run: the runner, then a later `--test`. */
function theArgumentsOfARun(words: readonly string[]): string[] | undefined {
  const runner = words.findIndex(isTheRunner)
  const test = runner === -1 ? -1 : words.indexOf('--test', runner + 1)
  return test === -1 ? undefined : words.slice(test + 1)
}

/** The unbounded runs of a script, starting on `line`; a script whose quoting does not close is one of them. */
function theUnboundedRunsOfAScript(path: string, text: string, line: number, held: ReadonlyMap<string, AHeldRun>): AnUnboundedRun[] {
  try {
    return theUnboundedRunsOfTokens(path, tokensOf(text, line), held)
  } catch (error) {
    if (!(error instanceof AnUnclosedPart)) throw error
    return [{ path, line: error.line, text: error.message, problems: [UNREADABLE] }]
  }
}

function theUnboundedRunsOfTokens(path: string, tokens: readonly AToken[], inherited: ReadonlyMap<string, AHeldRun>): AnUnboundedRun[] {
  const commands = commandsOf(tokens)
  const fed = whatThePipesFeed(commands)
  const reading: AReading = { path, held: new Map([...inherited, ...theHeldRuns(commands)]), forwarders: theForwarders(commands, fed), fed }
  return commands.flatMap((command) => theUnboundedRunsOfACommand(reading, command))
}

/** A command's own run, and every run in what it holds or hands to something that runs it. */
function theUnboundedRunsOfACommand(r: AReading, command: ACommand): AnUnboundedRun[] {
  const words = [...command.words, ...command.targets]
  const strings = [...theStringsItRuns(command, r.forwarders), ...(r.fed.get(command) ?? [])]
  return [
    ...aRunInItsWords(r.path, command),
    ...[...words, ...words.flatMap((word) => word.array ?? [])].flatMap((word) =>
      word.inner.flatMap((tokens) => theUnboundedRunsOfTokens(r.path, tokens, r.held)),
    ),
    ...command.bodies.flatMap((body) => theUnboundedRunsOfAScript(r.path, body.text, body.line, new Map())),
    ...strings.flatMap((string) => theUnboundedRunsOfAScript(r.path, string.text, string.line, r.held)),
    ...theHeldRunsItRuns(r, command),
  ]
}

/** The command's own run, when its words hold one that is not bounded. */
function aRunInItsWords(path: string, command: ACommand): AnUnboundedRun[] {
  const words = command.words.map((word) => word.text)
  const problems = whatAnyRunLacks(words)
  return problems.length === 0 ? [] : [{ path, line: command.words[0]?.line ?? 0, text: words.join(' '), problems }]
}

/** What the run the words hold fails to state; nothing when they hold no run. */
function whatAnyRunLacks(words: readonly string[]): string[] {
  const args = theArgumentsOfARun(words)
  return args === undefined ? [] : whatTheArgumentsLack(args)
}

/** The assignments of a command: its leading ones, and those after a declaration such as `local` or `export`. */
function theAssignments(command: ACommand): AWord[] {
  const program = theProgramsPlace(command)
  const declares = DECLARATIONS.has(command.words[program]?.text ?? '')
  return command.words.filter((word, at) => word.assigns !== undefined && (program === -1 || at < program || declares))
}

/** An assignment's value, as words: an array's elements, or the text after its `=`, split where blanks split it. */
function theValuesWords(word: AWord): string[] {
  const value = word.array?.map((element) => element.text).join(' ') ?? word.text.slice(word.text.indexOf('=') + 1)
  return value.split(/\s+/).filter((part) => part !== '')
}

/** How an assignment reads in a finding. */
const howItReads = (word: AWord): string => (word.array === undefined ? word.text : `${word.text}(${word.array.map((element) => element.text).join(' ')})`)

/** The names a script's assignments give the runner, each with the line of the assignment that last gave it. */
function theHeldRuns(commands: readonly ACommand[]): Map<string, AHeldRun> {
  const values = new Map<string, AHeldRun>()
  for (const word of commands.flatMap(theAssignments)) {
    const before = word.text.includes('+=') ? (values.get(word.assigns ?? '')?.words ?? []) : []
    values.set(word.assigns ?? '', { line: word.line, text: howItReads(word), words: [...before, ...theValuesWords(word)] })
  }
  return new Map([...values].filter(([, held]) => theArgumentsOfARun(held.words) !== undefined))
}

/** The held runs the command runs: an expansion of a name that holds the runner, in a place where the shell runs it. */
function theHeldRunsItRuns(r: AReading, command: ACommand): AnUnboundedRun[] {
  return wherePlacesRun(command, r.forwarders).flatMap((at) => {
    const held = r.held.get(command.words[at]?.whole ?? '')
    const problems = held === undefined ? [] : whatAnyRunLacks(held.words)
    return held === undefined || problems.length === 0 ? [] : [{ path: r.path, line: held.line, text: held.text, problems }]
  })
}
