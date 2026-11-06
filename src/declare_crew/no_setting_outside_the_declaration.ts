// No setting outside the declaration.
//
// A setting read in two places can disagree: one place reads the environment,
// another a home-relative path, and the crew behaves differently depending on
// which slice asked. So a slice of the running crew takes its settings from
// CrewSettings (declare_crew.ts) and from nowhere else. This check reads every
// slice's source and names each line that reaches for a setting another way: the
// environment, the home directory, or a path written relative to it.
//
// Two kinds of file are not judged. A test is not a slice. A program that CI runs
// on this repository is not part of the running crew either: it takes its inputs
// from CI's environment by design, and is listed by name below so the exception is
// visible and its test fails once the program is gone.

/** The directories under src/ that hold a program CI runs, not a slice of the crew. */
export const PROGRAMS_RUN_BY_CI = ['check_nothing_private_gets_in'] as const

const TEST_FILE = '.node-test.ts'

export interface Source {
  /** Path relative to src/. */
  readonly path: string
  readonly text: string
}

export interface Finding {
  readonly path: string
  readonly line: number
  readonly why: string
}

const REACHES: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bprocess\s*\.\s*env\b|\benv\b[^=]*\}\s*=\s*process\b/, why: 'reads the environment' },
  { pattern: /\bhomedir\b/, why: 'finds the home directory' },
  { pattern: /['"`]~\//, why: 'writes a path relative to the home directory' },
]

const judged = (path: string) =>
  !path.endsWith(TEST_FILE) && !PROGRAMS_RUN_BY_CI.some(program => path.split(/[\\/]/)[0] === program)

/** Every line of a slice that reads a setting from somewhere other than the declaration. */
export function settingsReadOutsideTheDeclaration(sources: readonly Source[]): Finding[] {
  return sources.filter(source => judged(source.path)).flatMap(source =>
    source.text.split('\n').flatMap((text, i) =>
      REACHES.filter(reach => reach.pattern.test(text)).map(reach => ({ path: source.path, line: i + 1, why: reach.why })),
    ),
  )
}
