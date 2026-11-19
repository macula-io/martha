// The hints a tool call's own arguments bring into the prompt (martha#801).
//
// The engine's `SubdirectoryHintTracker` (`load_hints.rs:27` at the pin eff9a75e) reads every tool call's arguments and
// notes two of them:
//
//   - `path`, when it is a string: the directory the path's parent is;
//   - `command`, when it is a string: each word of it that is not an option and holds a `/` or a `.`, through its
//     parent directory.
//
// Those parent directories wait. On the next model request the tracker is built fresh, every tool request of the
// conversation is replayed through it (A1: `prompt_parts` does that on every request), and each directory that is new to
// that request and under the working directory — never the working directory itself — has its hints loaded: the hint
// files of the directory itself and of each directory between it and the working directory, root first. Each of those
// files is expanded exactly as the start expands a hint (`read_referenced_files`, with the git root as its reach and an
// EMPTY gitignore: a subdirectory's hints are never judged against the checkout's `.gitignore` files).
//
// So one replay is one request's answer: every directory the calls reached, once, and what each one's hints hold. A
// replay that is taken again reads the bytes again, which is what lets a hint changed inside a session carry its new
// digest.

import { dirname, isAbsolute, join } from 'node:path'

import { isUnderThe, type TheFiles, type TheFilesAHintNames, theExpansionOfAHint, theGitRootOf, NO_GITIGNORE } from '../follow_a_hint_to_the_files_it_names/follow_a_hint_to_the_files_it_names.ts'
import { isADirectory, isAFile, realPathOrNone } from '../follow_a_hint_to_the_files_it_names/the_files_a_hint_is_read_through.ts'
import { theWordsACommandIsSplitInto } from './the_words_a_command_is_split_into.ts'

/** One hint file a tool call's directory holds, and what its text pulls in. */
export interface ASubdirectoryHint {
  /** The hint file's name, as the engine's list of names spells it. */
  readonly file: string
  /** The file read, every link resolved. */
  readonly at: string
  /** The directory the tool call reached, which is why this hint is read at all. */
  readonly reached: string
  /** What the hint's text pulls in (`../follow_a_hint_to_the_files_it_names`), read for this take. */
  readonly expanded: TheFilesAHintNames
}

/** What one replay of a conversation's tool calls reaches: the directories loaded, and the hints they hold. */
export interface TheHintsAReplayReaches {
  /** Every directory the calls reached and this replay loads, in the order the engine loads them, each once. */
  readonly directories: readonly string[]
  /** Every hint file of those directories and of the directories between them and the working directory. */
  readonly hints: readonly ASubdirectoryHint[]
}

/**
 * The directories one tool call's arguments put on the engine's list, in the order it adds them and with a directory
 * named twice listed twice (the engine's own list keeps duplicates; the replay below takes each one once).
 */
export function theDirectoriesAToolCallReaches(rawInput: unknown, workingDir: string): readonly string[] {
  const arguments_ = asTheArgumentsOfAToolCall(rawInput)
  if (arguments_ === undefined) return []
  const reached: string[] = []
  const path = arguments_['path']
  if (typeof path === 'string') addTheParentOfAWord(reached, path, workingDir)
  const command = arguments_['command']
  for (const word of typeof command === 'string' ? theWordsACommandIsSplitInto(command) : []) addACommandWord(reached, word, workingDir)
  return reached
}

/** The directory one command word reaches: not an option, and holding a `/` or a `.` as the engine asks (`:59`). */
function addACommandWord(reached: string[], word: string, workingDir: string): void {
  if (word.startsWith('-') || !(word.includes('/') || word.includes('.'))) return
  addTheParentOfAWord(reached, word, workingDir)
}

/** The parent of the path a word names, resolved from the working directory when it is relative (`:78`). */
function addTheParentOfAWord(reached: string[], word: string, workingDir: string): void {
  const resolved = isAbsolute(word) ? word : join(workingDir, word)
  const parent = dirname(resolved)
  if (parent !== resolved) reached.push(parent)
}

/**
 * One replay: every tool call of the conversation read again, each directory it reaches canonicalised and taken once,
 * and the hints each taken directory holds.
 */
export function theHintsAReplayReaches(rawInputs: readonly unknown[], workingDir: string, hintNames: readonly string[], machine: TheFiles): TheHintsAReplayReaches {
  const directories = theDirectoriesOneReplayLoads(rawInputs, workingDir, machine)
  const hints = directories.flatMap((reached) => theHintsADirectoryHolds(reached, workingDir, hintNames, machine))
  return { directories, hints }
}

/** The directories one replay loads: under the working directory, never it, each once, in the order reached. */
function theDirectoriesOneReplayLoads(rawInputs: readonly unknown[], workingDir: string, machine: TheFiles): readonly string[] {
  const reachable = realPathOrNone(machine, workingDir)
  if (reachable === null) return []
  const loading: string[] = []
  for (const rawInput of rawInputs) addTheDirectoriesOneCallReaches(loading, rawInput, reachable, machine)
  return loading
}

/** One call's directories added to a replay's list, each canonicalised and taken once, never the working directory. */
function addTheDirectoriesOneCallReaches(loading: string[], rawInput: unknown, reachable: string, machine: TheFiles): void {
  for (const pending of theDirectoriesAToolCallReaches(rawInput, reachable)) {
    const directory = realPathOrNone(machine, pending)
    if (directory === null || directory === reachable || !isUnderThe(reachable, directory) || loading.includes(directory)) continue
    loading.push(directory)
  }
}

/**
 * The hints one reached directory loads (`load_hints_from_directory`, `:115`): the hint files of each directory from
 * the reached one up to, but never including, the working directory, root first, each expanded with the git root as its
 * reach and no `.gitignore` at all.
 *
 * A reach that is not a directory under the working directory loads nothing. A hint file the expansion leaves empty is
 * still named: the engine read it, and what it attaches is the caller's to say.
 */
export function theHintsADirectoryHolds(reached: string, workingDir: string, hintNames: readonly string[], machine: TheFiles): readonly ASubdirectoryHint[] {
  if (!isADirectory(machine, reached) || !isAbsolute(reached) || !isUnderThe(workingDir, reached) || reached === workingDir) return []
  const reach = theGitRootOf(workingDir, machine) ?? workingDir
  return theDirectoriesUpToTheWorkingDirectory(reached, workingDir).flatMap((holder) =>
    hintNames.filter((file) => isAFile(machine, join(holder, file))).map((file) => {
      const at = join(holder, file)
      return { file, at, reached, expanded: theExpansionOfAHint(at, reach, NO_GITIGNORE, machine) }
    }),
  )
}

/** The reached directory and each directory above it, up to but never including the working directory, root first. */
function theDirectoriesUpToTheWorkingDirectory(reached: string, workingDir: string): readonly string[] {
  const upToHere: string[] = []
  for (let holder = reached; holder !== workingDir && isUnderThe(workingDir, holder); holder = dirname(holder)) upToHere.push(holder)
  return upToHere.reverse()
}

/** The arguments a tool call is made with, or undefined when it is made with none (`Option<Map>`), as JSON gives them. */
function asTheArgumentsOfAToolCall(rawInput: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof rawInput === 'object' && rawInput !== null && !Array.isArray(rawInput) ? (rawInput as Readonly<Record<string, unknown>>) : undefined
}
