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
//   - a shell script or a workflow, line by line, where a line ended with a backslash continues;
//   - a package folder's script, which is one line by construction;
//   - a page of prose only inside its code blocks: a sentence that mentions the runner is not a run.
//
// A line that only writes a manifest (the checks plant one to prove they bite) is not a run either.
//
// What a run must state, it states as the word the runner receives: the flag itself, or the variable the flag's value
// lives in, as an argument after `--test`. A variable named anywhere else on the line, printed or mentioned, bounds
// nothing and is not counted.

import { FORCE_EXIT_FLAG, TIMEOUT_FLAG } from './every_test_run_ends.ts'

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
function problemsOf(text: string): string[] {
  const words = theRunsArguments(text)
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

/** A page of prose's text, with every line outside a code block made empty so only what a block holds can run. */
function onlyItsCodeBlocks(text: string): string {
  let inside = false
  return text
    .split('\n')
    .map((line) => {
      if (A_CODE_FENCE.test(line)) {
        inside = !inside
        return ''
      }
      return inside ? line : ''
    })
    .join('\n')
}

/** The lines of a shipped file a run can be on, in the shape that file really has. */
function theLinesThatCanRun(file: AShippedFile): Array<{ readonly line: number; readonly text: string }> {
  return theLinesAsTheShellReadsThem(file.kind === 'a page of prose' ? onlyItsCodeBlocks(file.text) : file.text)
}

/** Every run the shipped files start that is missing one of the three things that bound it, each named by file and line. */
export function unboundedRunsIn(files: readonly AShippedFile[]): AnUnboundedRun[] {
  return files.flatMap((file) =>
    theLinesThatCanRun(file).flatMap(({ line, text }) => {
      const problems = startsARun(text) ? problemsOf(text) : []
      return problems.length === 0 ? [] : [{ path: file.path, line, text: text.trim(), problems }]
    }),
  )
}
