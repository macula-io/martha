// The words one run of the tests gets (martha#723), read from the one place that states them.
//
// `npm test` runs every stage, and the arguments after `npm test --` reach only its last command and land after that
// command's globs. So a member who needs one file copies stage 3 out of package.json by hand and swaps its globs for the
// file: a copy that drifts the moment either changes (martha#669), and a run whose shape is the hand-typed one
// martha#683 exists to stop.
//
// The single-file run (prove_the_relay_loads/run_the_tests_of_one_file.sh) is stage 3's own command with the suite's
// globs replaced by the files it was given. This module is what it asks for those words, so none of them is written a
// second time: the program, the output check, the names that command unsets, its bounds, and the globs that decide which
// files the suite runs at all.
//
//   node prove_the_core/the_words_one_run_gets.ts stage          every word of the command that runs `node --test`
//   node prove_the_core/the_words_one_run_gets.ts unsets         the names that command unsets, one per line
//   node prove_the_core/the_words_one_run_gets.ts picks <path>   the glob that picks the path
//
// Exit 0 answered; 1 the path is one the suite does not run, named with the globs read; 2 the answer could not be read.

import { matchesGlob, relative, resolve, sep } from 'node:path'
import process from 'node:process'

import { manifestOf, testCommandsOf, testGlobsOf } from './declared_in_package_json.ts'

const NAME = 'the_words_one_run_gets'

/** The runner's own word: the command the test script starts its tests with carries it. */
export const THE_RUNNER_WORD = '--test'

/** The repository this module sits in, whose package.json is what is read. */
const THE_REPOSITORY = resolve(import.meta.dirname, '..')

/** A command of the test script: the names it unsets, and its words. */
export interface ACommand {
  readonly unsets: readonly string[]
  readonly words: readonly string[]
}

/**
 * The command the test script runs its tests with: the one whose words carry the runner's own `--test`. There is one
 * such command; a test script with none, or with two, is refused by name rather than guessed at.
 */
export function theSuiteCommandOf(commands: readonly ACommand[]): ACommand {
  const runs = commands.filter((one) => one.words.includes(THE_RUNNER_WORD))
  if (runs.length === 1) return runs[0] as ACommand
  throw new Error(
    runs.length === 0
      ? `${NAME}: the test script runs no command with ${THE_RUNNER_WORD}`
      : `${NAME}: the test script runs ${runs.length} commands with ${THE_RUNNER_WORD}; there must be one`,
  )
}

/** The glob of the suite's that picks a path, or nothing when the suite runs no such file. */
export function theGlobPicking(globs: readonly string[], path: string): string | undefined {
  const spelled = path.split(sep).join('/')
  return globs.find((glob) => matchesGlob(spelled, glob))
}

/** A path as the repository spells it: relative to the top, with `/` for the separator. */
const spelledFromTheTop = (path: string): string => relative(THE_REPOSITORY, resolve(path))

/** Every word of the command that runs the tests, one per line. */
function theStage(): number {
  for (const word of theSuiteCommandOf(testCommandsOf(manifestOf(THE_REPOSITORY))).words) console.log(word)
  return 0
}

/** The names that command unsets, one per line. */
function theUnsets(): number {
  for (const name of theSuiteCommandOf(testCommandsOf(manifestOf(THE_REPOSITORY))).unsets) console.log(name)
  return 0
}

/** The glob that picks a path, printed, or why none does, named with every glob read. */
function thePick(path: string): number {
  const globs = testGlobsOf(manifestOf(THE_REPOSITORY))
  const picked = theGlobPicking(globs, spelledFromTheTop(path))
  if (picked !== undefined) {
    console.log(picked)
    return 0
  }
  console.error(`${NAME}: the suite runs no ${path}; its globs are ${globs.join(', ')}`)
  return 1
}

/** The answer for what was asked, or a refusal naming what can be asked. */
function theAnswer(asked: readonly string[]): number {
  const [what, ...rest] = asked
  if (what === 'stage') return theStage()
  if (what === 'unsets') return theUnsets()
  if (what === 'picks' && rest.length === 1) return thePick(rest[0] as string)
  console.error(`${NAME}: usage: stage | unsets | picks <path>`)
  return 2
}

if (import.meta.main) process.exitCode = theAnswer(process.argv.slice(2))
