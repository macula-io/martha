// Where the shell runs a word as a script of its own, and where it runs an expansion as a command (martha#727).
//
// A quoted word is data to the shell, except where a program it hands the word to runs it: `eval`, a shell's `-c`,
// ssh's remote command, `env -S`, a shell that reads the word on its standard input, and a function of the same file
// that forwards its arguments to one of those. Each list here is one named constant, so a program missing from one is
// a one-word change with a planted case beside it. A program on no list reads as data: this is a bound on the
// repository's own scripts, not a sandbox (the known limits are on martha#727).

import type { ACommand, AWord } from './read_a_shell_script.ts'

/** The shells, by the last part of the word that names them. */
export const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'fish'])

/** A shell's options that take the next word as their value; any other `--long` word takes none. */
export const SHELL_VALUE_OPTIONS = new Set(['-o', '+o', '-O', '+O', '--rcfile', '--init-file'])

/** The letter of a shell's flag cluster that makes its first word after the options a command string. */
export const A_COMMAND_STRING_FLAG = 'c'

/** ssh's flags that take a value, from its own usage line: the last of a cluster takes the next word, unless attached. */
export const SSH_VALUE_LETTERS = 'BbcDEeFIiJLlmOoPpQRSWw'

/** The programs that run the rest of their words as a command, each with its own options in front of it. */
export const WRAPPERS = ['env', 'exec', 'command', 'nohup', 'timeout', 'sudo', 'xargs', 'podman exec', 'docker exec']

/**
 * The programs whose own option hands its value to a shell to run (martha#759), and the option that carries it: su runs
 * its command string in the target user's shell, flock, script and npm run it through one of their own.
 */
export const RUNS_ITS_OPTIONS_STRING: Readonly<Record<string, { readonly short: string; readonly long: string }>> = {
  su: { short: 'c', long: '--command' },
  runuser: { short: 'c', long: '--command' },
  flock: { short: 'c', long: '--command' },
  script: { short: 'c', long: '--command' },
  'npm exec': { short: 'c', long: '--call' },
  'npm x': { short: 'c', long: '--call' },
  npx: { short: 'c', long: '--call' },
}

/** The programs that join their own words and hand them to a shell, with the options that say to run them as a command line instead. */
export const RUNS_ITS_WORDS_THROUGH_A_SHELL: Readonly<Record<string, readonly string[]>> = { watch: ['-x', '--exec'] }

/**
 * The programs that run their arguments as shell command lines, with the words that separate the template from the
 * arguments: the words before the first separator are one string, and with no template each word after a separator is
 * a command of its own. A separator of four or more colons names file names, which run nothing.
 */
export const RUNS_ITS_ARGUMENTS_AS_COMMANDS: Readonly<Record<string, readonly string[]>> = {
  parallel: [':::', '::::', ':::+', '::::+'],
}

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

/** The name out of `names` that starts at `at` (`podman exec` is two words), or undefined when none does. */
function aNameAt(names: readonly string[], words: readonly AWord[], at: number): string | undefined {
  return names.find((one) => one.split(' ').every((part, k) => (k === 0 ? programOf(words[at]) : words[at + k]?.text) === part))
}

/** How many words the wrapper at `at` spans (`podman exec` is two), or 0 when none starts there. */
export function aWrapperAt(words: readonly AWord[], at: number): number {
  const wrapper = aNameAt(WRAPPERS, words, at)
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

/** A flag cluster: `-c`, `-qc`, `-euc`. */
const A_FLAG_CLUSTER = /^-[A-Za-z]+$/

/** The program's own option words, from `from` up to the `--` that ends them. */
function theOptionsOf(words: readonly AWord[], from: number): readonly AWord[] {
  const end = words.findIndex((word, at) => at >= from && word.text === '--')
  return end === -1 ? words.slice(from) : words.slice(from, end)
}

/** The string the option word at `at` carries, or nothing: attached to its flag, or the word after it. */
function aValueTheOptionCarries(words: readonly AWord[], at: number, options: { readonly short: string; readonly long: string }): AString[] {
  const word = words[at]
  if (word === undefined) return []
  const value = new RegExp(`^-[A-Za-z]*${options.short}(.+)$`).exec(word.text)?.[1] ?? new RegExp(`^${options.long}=(.+)$`).exec(word.text)?.[1]
  if (value !== undefined) return [{ text: value, line: word.line }]
  const apart = A_FLAG_CLUSTER.test(word.text) ? word.text.endsWith(options.short) : word.text === options.long
  return apart ? words.slice(at + 1, at + 2) : []
}

/** The string of the option-string program at `at`: the value of the option that hands a shell one, when it carries one. */
function anOptionString(words: readonly AWord[], at: number): AString[] {
  const name = aNameAt(Object.keys(RUNS_ITS_OPTIONS_STRING), words, at)
  const options = name === undefined ? undefined : RUNS_ITS_OPTIONS_STRING[name]
  if (name === undefined || options === undefined) return []
  const its = theOptionsOf(words, at + name.split(' ').length)
  return its.flatMap((_, k) => aValueTheOptionCarries(its, k, options)).slice(0, 1)
}

/** The words a program joins and hands a shell, when none of its own options says to run them as a command line instead. */
function aJoinedWordsString(words: readonly AWord[], at: number): AString[] {
  const name = aNameAt(Object.keys(RUNS_ITS_WORDS_THROUGH_A_SHELL), words, at)
  const runsThemAsALine = name === undefined ? undefined : RUNS_ITS_WORDS_THROUGH_A_SHELL[name]
  if (name === undefined || runsThemAsALine === undefined) return []
  const after = words.slice(at + name.split(' ').length)
  if (after.some((word) => runsThemAsALine.includes(word.text))) return []
  const first = after.findIndex((word) => !word.text.startsWith('-'))
  return joined(first === -1 ? [] : after.slice(first))
}

/** Whether a separator names file names rather than commands: four or more colons. */
const namesFiles = (separator: string): boolean => separator.replace(/[^:]/g, '').length >= 4

/** The words before the first separator, past the program's own options, joined into one string. */
function itsTemplate(after: readonly AWord[], separators: readonly string[]): AString[] {
  const first = after.findIndex((word) => !word.text.startsWith('-'))
  if (first === -1) return []
  const end = after.findIndex((word) => separators.includes(word.text))
  return joined(after.slice(first, end === -1 ? after.length : end))
}

/** Each word a separator marks as a command line of its own. */
function itsSeparatedCommands(after: readonly AWord[], separators: readonly string[]): AString[] {
  const commands: AString[] = []
  let aCommandFollows = false
  for (const word of after) {
    if (separators.includes(word.text)) {
      aCommandFollows = !namesFiles(word.text)
      continue
    }
    if (aCommandFollows) commands.push({ text: word.text, line: word.line })
  }
  return commands
}

/** The strings of the arguments-as-commands program at `at`: its template, and each command a separator marks. */
function theArgumentCommandStrings(words: readonly AWord[], at: number): AString[] {
  const name = aNameAt(Object.keys(RUNS_ITS_ARGUMENTS_AS_COMMANDS), words, at)
  const separators = name === undefined ? undefined : RUNS_ITS_ARGUMENTS_AS_COMMANDS[name]
  if (name === undefined || separators === undefined) return []
  const after = words.slice(at + name.split(' ').length)
  return [...itsTemplate(after, separators), ...itsSeparatedCommands(after, separators)]
}

/** The strings the command's own programs hand a shell, anywhere in the command (martha#759). */
function whatAProgramHandsAShell(words: readonly AWord[]): AString[] {
  return words.flatMap((_, at) => [...anOptionString(words, at), ...aJoinedWordsString(words, at), ...theArgumentCommandStrings(words, at)])
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
    ...whatAProgramHandsAShell(words),
    ...(herestring !== undefined && readsAScriptOnItsInput(command) ? [herestring] : []),
    ...whatAForwarderIsHanded(command, forwarders),
  ]
}

/**
 * Whether a script on the command's standard input is read as one: the command itself, or a later command of its
 * pipeline (martha#759's amendment B). `cat <<'EOF' | bash` is bash reading the body, though cat writes it.
 */
export function aShellReadsOnItsInput(commands: readonly ACommand[], command: ACommand): boolean {
  return commands.some((one) => one.pipeline === command.pipeline && one.place >= command.place && readsAScriptOnItsInput(one))
}

/**
 * Whether the command runs a command line it reads on its standard input: a shell, or the arguments-as-commands
 * program with no template and no separator, whose input lines each become a command (martha#759).
 */
function readsACommandLineOnItsInput(command: ACommand): boolean {
  if (readsAScriptOnItsInput(command)) return true
  const program = theProgramsPlace(command)
  const name = aNameAt(Object.keys(RUNS_ITS_ARGUMENTS_AS_COMMANDS), command.words, program)
  const separators = name === undefined ? undefined : RUNS_ITS_ARGUMENTS_AS_COMMANDS[name]
  if (name === undefined || separators === undefined) return false
  const after = command.words.slice(program + name.split(' ').length)
  return !after.some((word) => !word.text.startsWith('-') || separators.includes(word.text))
}

/** What each command of a script is fed by its pipeline: every quoted word before a program that runs its input. */
export function whatThePipesFeed(commands: readonly ACommand[]): Map<ACommand, AString[]> {
  const fed = new Map<ACommand, AString[]>()
  for (const reader of commands.filter((command) => command.place > 0 && readsACommandLineOnItsInput(command))) {
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
