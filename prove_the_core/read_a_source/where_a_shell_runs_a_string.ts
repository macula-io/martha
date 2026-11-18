// Where the shell runs a word as a script of its own, and where it runs an expansion as a command (martha#727).
//
// A quoted word is data to the shell, except where a program it hands the word to runs it: `eval`, a shell's `-c`,
// ssh's remote command, `env -S`, a shell that reads the word on its standard input, and a function of the same file
// that forwards its arguments to one of those. Each list here is one named constant, so a program missing from one is
// a one-word change with a planted case beside it. A program on no list reads as data: this is a bound on the
// repository's own scripts, not a sandbox (the known limits are on martha#727).

import type { ACommand, AWord } from './read_a_shell_script.ts'

/** The shells, by the last part of the word that names them. */
export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash'])

/** A shell's options that take the next word as their value; any other `--long` word takes none. */
export const SHELL_VALUE_OPTIONS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file'])

/** The letter of a shell's flag cluster that makes its first word after the options a command string. */
export const A_COMMAND_STRING_FLAG = 'c'

/** ssh's flags that take a value, from its own usage line: the last of a cluster takes the next word, unless attached. */
export const SSH_VALUE_LETTERS = 'BbcDEeFIiJLlmOoPpQRSWw'

/** The programs that run the rest of their words as a command, each with its own options in front of it. */
export const WRAPPERS = ['env', 'exec', 'command', 'nohup', 'timeout', 'sudo', 'xargs', 'podman exec', 'docker exec']

/** The words that run every word after them, joined, as a script. */
export const RUNS_ITS_WORDS = new Set(['eval'])

/** The program that runs a word as a command string: its flag, and its long flag with the value attached or apart. */
const ENV = 'env'
const ENV_SPLIT_FLAG = '-S'
const ENV_SPLIT_LONG = '--split-string'

/** The words that open a command without being its program; the command's program is the next word. */
const NOT_THE_PROGRAM = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', 'time', '{', '('])

/** The words that open a compound command whose next word is never a program: `for x in …`, `case $x in`. */
const NO_PROGRAM_FOLLOWS = new Set(['for', 'case', 'select', 'in', 'esac', 'fi', 'done', 'function', '}'])

/** The builtins whose words after them may be assignments, with any of their flags. */
export const DECLARATIONS = new Set(['local', 'export', 'declare', 'typeset', 'readonly'])

/** A positional parameter, which a function's caller fills: `$@`, `$*`, `$1`…`$9`, `${N}`, `${@}`. */
const A_POSITIONAL = /\$(?:[@*1-9]|\{(?:[@*]|\d+)[^}]*\})/

/** A word the shell runs as a script of its own, and the line it starts on. */
export interface AString {
  readonly text: string
  readonly line: number
}

/** The last part of a word that names a program: `/usr/bin/env` is `env`. */
const programOf = (word: AWord | undefined): string => word?.text.split('/').at(-1) ?? ''

/** The place of a command's program: past its assignments and the words that open a compound command. -1 for none. */
export function theProgramsPlace(command: ACommand): number {
  const at = command.words.findIndex((word) => word.assigns === undefined && !NOT_THE_PROGRAM.has(word.text))
  return at === -1 || NO_PROGRAM_FOLLOWS.has(command.words[at]?.text ?? '') ? -1 : at
}

/** How many words the wrapper at `at` spans (`podman exec` is two), or 0 when none starts there. */
export function aWrapperAt(words: readonly AWord[], at: number): number {
  const wrapper = WRAPPERS.find((one) => one.split(' ').every((part, k) => (k === 0 ? programOf(words[at]) : words[at + k]?.text) === part))
  return wrapper === undefined ? 0 : wrapper.split(' ').length
}

/** A shell's option words, from the word after it: where they end, and the letters of its `-` clusters. */
function theShellsOptions(words: readonly AWord[], shell: number): { readonly end: number; readonly letters: string } {
  let at = shell + 1
  let letters = ''
  for (let width = anOptionsWidth(words[at]?.text); width > 0; width = anOptionsWidth(words[at]?.text)) {
    letters += /^-[A-Za-z]+$/.test(words[at]?.text ?? '') ? (words[at]?.text.slice(1) ?? '') : ''
    at += width
  }
  return { end: at, letters }
}

/** How many words a shell's option word takes: 2 with a value, 1 without, 0 when it is no option. */
function anOptionsWidth(text: string | undefined): number {
  if (text === undefined) return 0
  if (SHELL_VALUE_OPTIONS.has(text)) return 2
  return /^[-+][A-Za-z]+$/.test(text) || /^--[^-]/.test(text) ? 1 : 0
}

/** The command string of each shell word with `c` in a flag cluster, anywhere in the command. */
function theShellsCommandStrings(words: readonly AWord[]): AWord[] {
  return words.flatMap((word, at) => {
    if (!SHELLS.has(programOf(word))) return []
    const { end, letters } = theShellsOptions(words, at)
    const string = words[end]
    return letters.includes(A_COMMAND_STRING_FLAG) && string !== undefined ? [string] : []
  })
}

/** How many words an ssh option word takes: two when its cluster's last letter takes a value not attached to it. */
function anSshOptionsWidth(text: string): number {
  const letters = text.slice(1)
  const value = [...letters].findIndex((letter) => SSH_VALUE_LETTERS.includes(letter))
  return value !== -1 && value === letters.length - 1 ? 2 : 1
}

/** ssh's remote command, anywhere in the command: every word after its host, joined. */
function theRemoteCommands(words: readonly AWord[]): AString[] {
  return words.flatMap((word, at) => {
    if (programOf(word) !== 'ssh') return []
    let host = at + 1
    while (/^-[A-Za-z]/.test(words[host]?.text ?? '')) host += anSshOptionsWidth(words[host]?.text ?? '')
    return joined(words.slice(host + 1))
  })
}

/** Words the shell joins with a space and runs as one script, or nothing when there are none. */
const joined = (words: readonly AWord[]): AString[] =>
  words.length === 0 ? [] : [{ text: words.map((word) => word.text).join(' '), line: words[0]?.line ?? 0 }]

/** What `eval` runs, anywhere in the command: every word after it, joined. */
function whatEvalRuns(words: readonly AWord[]): AString[] {
  return words.flatMap((word, at) => (RUNS_ITS_WORDS.has(programOf(word)) ? joined(words.slice(at + 1)) : []))
}

/** What `env -S` runs, anywhere in the command: its value, attached to the flag or the word after it. */
function whatEnvSplits(words: readonly AWord[]): AString[] {
  return words.flatMap((word, at) => (programOf(word) === ENV ? anEnvSplitString(words, at) : []))
}

function anEnvSplitString(words: readonly AWord[], env: number): AString[] {
  for (let at = env + 1; isEnvsOwn(words[at]); at += 1) {
    const found = aSplitStringAt(words, at)
    if (found !== undefined) return [found]
  }
  return []
}

/** A word env takes for itself: an option, or an assignment it puts in the command's environment. */
const isEnvsOwn = (word: AWord | undefined): boolean => word !== undefined && (word.text.startsWith('-') || word.assigns !== undefined)

/** The value of an `env -S` at `at`, attached to its flag or the word after it. */
function aSplitStringAt(words: readonly AWord[], at: number): AString | undefined {
  const word = words[at]
  if (word === undefined) return undefined
  const attached = new RegExp(`^(?:${ENV_SPLIT_FLAG}|${ENV_SPLIT_LONG}=)(.+)$`).exec(word.text)?.[1]
  if (attached !== undefined) return { text: attached, line: word.line }
  return word.text === ENV_SPLIT_FLAG || word.text === ENV_SPLIT_LONG ? words[at + 1] : undefined
}

/** Whether the command's program, or the program a wrapper in that place runs, is a shell reading its standard input. */
export function readsAScriptOnItsInput(command: ACommand): boolean {
  const { words } = command
  const program = theProgramsPlace(command)
  if (program === -1) return false
  const wrapped = aWrapperAt(words, program) > 0
  const shell = wrapped ? words.findIndex((word, at) => at > program && SHELLS.has(programOf(word))) : program
  if (shell === -1 || !SHELLS.has(programOf(words[shell]))) return false
  const { end, letters } = theShellsOptions(words, shell)
  return !letters.includes(A_COMMAND_STRING_FLAG) && (end === words.length || letters.includes('s'))
}

/** The words a call to a forwarding function hands it: quoted, or an expansion, so the shell may run them. */
function whatAForwarderIsHanded(command: ACommand, forwarders: ReadonlySet<string>): AWord[] {
  const program = theProgramsPlace(command)
  if (program === -1 || !forwarders.has(command.words[program]?.text ?? '')) return []
  return command.words.slice(program + 1).filter((word) => word.quoted || word.text.includes('$'))
}

/**
 * Every word the command runs as a script of its own, besides what its pipeline feeds it: the argument of `eval`, a
 * shell's command string, ssh's remote command, `env -S`'s value, a here-string a shell reads, and what a call to a
 * forwarding function hands it.
 */
export function theStringsItRuns(command: ACommand, forwarders: ReadonlySet<string>): AString[] {
  const { words, herestring } = command
  return [
    ...whatEvalRuns(words),
    ...theShellsCommandStrings(words),
    ...theRemoteCommands(words),
    ...whatEnvSplits(words),
    ...(herestring !== undefined && readsAScriptOnItsInput(command) ? [herestring] : []),
    ...whatAForwarderIsHanded(command, forwarders),
  ]
}

/** What each command of a script is fed by its pipeline: every quoted word before a shell that reads its input. */
export function whatThePipesFeed(commands: readonly ACommand[]): Map<ACommand, AString[]> {
  const fed = new Map<ACommand, AString[]>()
  for (const reader of commands.filter((command) => command.place > 0 && readsAScriptOnItsInput(command))) {
    const before = commands.filter((command) => command.pipeline === reader.pipeline && command.place < reader.place)
    fed.set(reader, before.flatMap((command) => command.words.filter((word) => word.quoted)))
  }
  return fed
}

/**
 * The functions of a script that forward their arguments to something that runs them: a positional parameter in a
 * string one of its commands runs, or handed to another such function, read to a fixed point so a chain is caught.
 */
export function theForwarders(commands: readonly ACommand[], fed: ReadonlyMap<ACommand, readonly AString[]>): Set<string> {
  const forwarders = new Set<string>()
  for (let before = -1; forwarders.size > before; ) {
    before = forwarders.size
    const found = commands.filter((command) => forwardsItsArguments(command, forwarders, fed))
    found.forEach((command) => forwarders.add(command.inFunction ?? ''))
  }
  return forwarders
}

/** Whether a command in a function's body hands a positional parameter to something that runs it. */
function forwardsItsArguments(command: ACommand, forwarders: ReadonlySet<string>, fed: ReadonlyMap<ACommand, readonly AString[]>): boolean {
  if (command.inFunction === undefined) return false
  const strings = [...theStringsItRuns(command, forwarders), ...(fed.get(command) ?? [])]
  return strings.some((string) => A_POSITIONAL.test(string.text))
}

/**
 * The places of the command's words where an expansion runs as a command: its program's place, and every word after a
 * wrapper or a forwarding function there.
 */
export function wherePlacesRun(command: ACommand, forwarders: ReadonlySet<string>): number[] {
  const program = theProgramsPlace(command)
  if (program === -1) return []
  const runsTheRest = aWrapperAt(command.words, program) > 0 || forwarders.has(command.words[program]?.text ?? '')
  return runsTheRest ? command.words.map((_, at) => at).filter((at) => at >= program) : [program]
}
