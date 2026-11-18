// Every run of the tests that ships is bounded (martha#683).
//
// `npm test` bounds every test: a time limit, force-exit and the guard that fails a file leaving something running
// (every_test_run_ends.ts). A `node --test` typed into a shell script or a workflow gets none of that unless it names
// them, and a run without them leaves a file that waits forever in a child process of its own, to be reparented to the
// user's systemd when the run is stopped — five did on a member's machine on 2026-11-18.
//
// This reads the files the repository ships that start a run — its shell scripts and its workflows — and names every
// run that is missing one of the three. What it does not read, and why: the prose in the documentation (a page that
// describes how the tests are run is not a run), and a line that writes a manifest rather than running anything, which
// the suite's own checks plant on purpose to prove they bite.
//
// The values behind the flags are read from their definitions, never restated here: a run names the flags by the
// variables they live in, or states the flag itself.

export type AShippedFile = { readonly path: string; readonly text: string }

export type AnUnboundedRun = {
  readonly path: string
  readonly line: number
  readonly text: string
  readonly problems: readonly string[]
}

/** The words that start a run: the runner, then its own `--test`. */
const RUNNER = /\bnode\b(?=[^\n]*\s--test\b)/
/** What every run must state, in the flag or in the variable the flag's value lives in. */
const FORCE_EXIT = [ '--test-force-exit', 'FORCE_EXIT_FLAG' ] as const
const TIMEOUT = /\s--test-timeout=/
const GUARD = /--import=[^\s]*fail_a_test_file_that_leaves_something_running/
const GUARD_VARIABLE = 'GUARD_FLAG'

/** Whether a line starts a run at all: a comment or a line that writes a file is not one. */
const startsARun = (text: string): boolean => {
  const trimmed = text.trim()
  if (trimmed.startsWith('#')) return false
  // A line that writes a manifest (the checks plant one to prove they bite) runs nothing.
  if (/\bprintf\b/.test(trimmed) && /package\.json/.test(trimmed)) return false
  return RUNNER.test(trimmed)
}

/** What a line that starts a run fails to state. */
function problemsOf(text: string): string[] {
  return [
    ...(TIMEOUT.test(text) ? [] : ['no --test-timeout=, so a test that hangs never fails (martha#56)']),
    ...(FORCE_EXIT.some((word) => text.includes(word))
      ? []
      : ['no --test-force-exit, so a test file that holds a handle open never exits (martha#56)']),
    ...(GUARD.test(text) || text.includes(GUARD_VARIABLE)
      ? []
      : ['no guard that fails a file leaving something running, so a leak passes silently (martha#56)']),
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

/** Every run the shipped files start that is missing one of the three things that bound it, each named by file and line. */
export function unboundedRunsIn(files: readonly AShippedFile[]): AnUnboundedRun[] {
  return files.flatMap((file) =>
    theLinesAsTheShellReadsThem(file.text).flatMap(({ line, text }) => {
      const problems = startsARun(text) ? problemsOf(text) : []
      return problems.length === 0 ? [] : [{ path: file.path, line, text: text.trim(), problems }]
    }),
  )
}
