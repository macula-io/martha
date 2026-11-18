// The git calls a shell line makes, and the directory each of them runs in (martha#562).
//
// Called by ../guard_workspace (and so by every seam that will call the guard) and by
// ../refuse_calls_outside_the_package_contract's act table. Nothing here enforces anything on its own: it reads a line
// and says what it holds.
//
// One reader, because two readers would disagree: the package contract reads a line for the acts it performs and the
// workspace guard reads it for the places it touches, and a line read one way by one and another way by the other is
// exactly the gap a member's cleverest line would find. So the words of a command, where git's own options end, and
// where a call runs all sit here, and both slices import them.
//
// A call is read wherever `git` appears, not only where a command begins: a script's last line, `cd x&&git push`, a
// call behind an assignment or inside `( )`. The cost is the other way round: `echo git push` reads as a push. A
// refusal that is too eager is recoverable; one that is too shy is not, so the reader errs towards reading a call. A
// word it cannot take apart — `sh -c "git push"`, `eval` — is not guessed at.
//
// The directory is the shell's own: the line's starting directory, moved by each `cd` and put back by each `)`, and
// moved for one call by git's own `-C`. It is null when nothing names one: no starting directory, a `cd -` or `cd ~`,
// a `cd` with no path of its own or with an option (`cd`, `cd -P /x`), or a word that is a variable or a glob rather
// than a path. A caller that cannot say where a call runs is told so rather than handed a guess. A `cd` inside `( )`
// stays inside it, so a member's own work after the subshell is not refused for a directory only the subshell was in.
//
// A newline ends a command exactly as a semicolon does, and a `cd` the reader does not see begin a command — behind
// `then`, `do`, `else`, `!`, or the second word of some other command — leaves the directory unknown rather than
// leaving the earlier one in force. Both are the same mistake otherwise: a call that really ran in another member's
// worktree judged as if it ran in the member's own.

import { isAbsolute, join } from 'node:path'

/** One git call as a shell line makes it: git's own options, the command word, its own arguments, and where it runs. */
export interface AGitCall {
  /** The words between `git` and its command word, git's own options and the word each takes: `-C`, `/repo`. */
  readonly options: readonly string[]
  /** The command git runs: `push`, `branch`, `worktree`. Undefined when the line names no command after `git`. */
  readonly command: string | undefined
  /** The words after the command word, up to the one that ends its command. */
  readonly args: readonly string[]
  /** Where the call runs: the directory in force, and null when the line does not say which one that is. */
  readonly directory: string | null
}

/** Where a line is read from: the directory the shell was already in, when the caller can say. */
export interface TheStartingDirectory {
  readonly directory?: string | null
}

/**
 * The words that end one command and begin the next, as the word splitter hands them back: `&&` and `||` are spoken of
 * as one word each, and a lone `&`, `|` or `;` as itself. A newline is handed back as the semicolon it is to a shell.
 */
const A_SEMICOLON = ';'
const A_SEPARATOR = new Set([A_SEMICOLON, '&', '&&', '|', '||'])

/** The character a shell reads as a command's end, exactly as it reads a semicolon. */
const A_NEW_LINE = '\n'

/** The marks a subshell opens and closes with: each a word of its own, and each moving the directory the way the shell does. */
const A_SUBSHELL_OPENS = '('
const A_SUBSHELL_CLOSES = ')'

/** The shell's own way of saying "go here": the command whose word moves the directory. */
const A_CHANGE_OF_DIRECTORY = 'cd'

/** The shell's own words a `cd` may be given instead of a directory: `-P`, `-L`, `--`, and the `-` that names the one
 * before. Each names a directory this reader does not follow. */
const isAShellOption = (word: string): boolean => word.startsWith('-')

/** The shell's own way of writing "my home": a `cd ~/x` names a directory this reader does not expand. Its code point, so
 * no rule that reads a path out of this file mistakes it for one. */
const FROM_THE_OWNERS_HOME = 0x7e

/** The one git option that moves where its command runs, as `cd` would: `git -C /repo push` pushes in /repo. */
const THE_DIRECTORY_OPTION = '-C'

/** The word a shell writes to mean "whatever this names": a variable, a glob, or a bracket expression, none of them a path. */
const NOT_A_PATH = /[$*?[]/

/**
 * The command with every separator spaced from its neighbours, `&&` and `||` as one each: `cd x&&git push` reads as
 * `cd x && git push`. Spacing a separator inside a quote changes nothing the reader reads — a quoted run stays one word.
 */
const withTheSeparatorsSpaced = (command: string): string => command.replace(/(&&|\|\||[;&|()])/g, ' $1 ')

/**
 * The words a command is made of, a quoted run being one word: `echo "git push"` is the words `echo` and `git push`.
 *
 * Outside a quote a separator is a word of its own even when nothing spaced it from its neighbours, so `cd x&&git push`
 * reads as `cd`, `x`, `&&`, `git`, `push` and `git push;` keeps its `;` off the `push`. Inside a quote nothing splits: a
 * commit message that mentions a push is still one word.
 */
export function theWordsOfACommand(command: string): readonly string[] {
  const words: string[] = []
  let word = ''
  let quoted: string | undefined
  const keep = (): void => {
    if (word === '') return
    words.push(word)
    word = ''
  }
  for (const character of withTheSeparatorsSpaced(command)) {
    const inQuotes = quoted !== undefined
    if (inQuotes && character === quoted) quoted = undefined
    else if (inQuotes) word += character
    else if (character === '"' || character === "'") quoted = character
    else if (character === A_NEW_LINE) {
      keep()
      words.push(A_SEMICOLON)
    } else if (/\s/.test(character)) keep()
    else word += character
  }
  keep()
  return words
}

/**
 * git's own options that take the word after them, so the command word sits past it: `git -C <dir> push`,
 * `git -c <key>=<value> push`, `git --git-dir <dir> push`, `git --work-tree <dir> push`, `git --namespace <name> push`
 * and `git --config-env <key>=<value> push` all run push. An option written with `=` takes no word of its own.
 */
const GIT_OPTIONS_THAT_TAKE_A_WORD = new Set([THE_DIRECTORY_OPTION, '-c', '--git-dir', '--work-tree', '--namespace', '--config-env'])

/** The program whose calls are read: the word a shell spells, and the last word of a path to it. */
const THE_PROGRAM = 'git'

/** Whether a word runs git: `git` itself, or a path to it, `/usr/bin/git` and `./git` alike. */
const isGit = (word: string | undefined): boolean => word !== undefined && (word === THE_PROGRAM || word.endsWith(`/${THE_PROGRAM}`))

/** Whether a word is a path this reader can name, rather than a variable or a glob it will not guess at. */
const isAPath = (word: string): boolean => !NOT_A_PATH.test(word)

/** Where a word points from a directory: itself when absolute, past the directory when relative, nowhere when unknown. */
function theDirectoryOf(word: string | undefined, from: string | null): string | null {
  if (word === undefined || !isAPath(word)) return null
  if (isAbsolute(word)) return word
  return from === null ? null : join(from, word)
}

/** Where the shell's directory stands after a `cd`: the word it names, read past the directory it is run from. A `cd`
 * with no word of its own, with an option, or with a separator after it names no directory this reader can follow. */
function theDirectoryAfterACd(word: string | undefined, from: string | null): string | null {
  if (word === undefined || isAShellOption(word) || endsACommand(word)) return null
  if (word.codePointAt(0) === FROM_THE_OWNERS_HOME) return null
  return theDirectoryOf(word, from)
}

/** Whether a word ends the command before it: a separator, or a subshell's own mark, which ends one as it opens another. */
const endsACommand = (word: string): boolean => A_SEPARATOR.has(word) || word === A_SUBSHELL_OPENS || word === A_SUBSHELL_CLOSES

/** The end of the words the command at `command` runs on: the next word that ends it, or the line's end when it has none. */
function theEndOfTheCommand(words: readonly string[], command: number): number {
  const end = words.findIndex((word, index) => index > command && endsACommand(word))
  return end === -1 ? words.length : end
}

/**
 * The git call whose word sits at `at`, read past git's own options: `git -C /repo push origin main` runs `push` with
 * `origin main` in /repo. The options are handed back as they were written, so a caller that recognises a run by its
 * settings reads them here rather than splitting git's arguments a second way.
 */
function theGitCallInTheWords(words: readonly string[], at: number, directory: string | null): AGitCall {
  const options: string[] = []
  let here = directory
  let next = at + 1
  let word = words[next]
  while (word !== undefined && word.startsWith('-')) {
    const takesAWord = GIT_OPTIONS_THAT_TAKE_A_WORD.has(word)
    const value = takesAWord ? words[next + 1] : undefined
    options.push(...(value === undefined ? [word] : [word, value]))
    if (word === THE_DIRECTORY_OPTION) here = theDirectoryOf(value, here)
    next += takesAWord ? 2 : 1
    word = words[next]
  }
  return { options, command: words[next], args: words.slice(next + 1, theEndOfTheCommand(words, next)), directory: here }
}

/** Where the walk through a line stands: the directory in force, and whether the next word begins a command. */
interface TheWalk {
  readonly directory: string | null
  readonly beginsACommand: boolean
}

/**
 * Where the walk stands after one word: a subshell's mark moves the directory into or out of the subshell, a separator
 * begins a command, git begins a call, and any other word begins none — moving the directory when it is a `cd`, and
 * making it unknown when a `cd` sits where no command begins, since the reader cannot see where that one runs.
 */
function theWalkAfterAWord(
  argv: readonly string[],
  at: number,
  walk: TheWalk,
  inside: (string | null)[],
  calls: AGitCall[],
): TheWalk {
  const word = argv[at] ?? ''
  if (word === A_SUBSHELL_OPENS) {
    inside.push(walk.directory)
    return { directory: walk.directory, beginsACommand: true }
  }
  if (word === A_SUBSHELL_CLOSES) return { directory: inside.pop() ?? walk.directory, beginsACommand: false }
  if (A_SEPARATOR.has(word)) return { directory: walk.directory, beginsACommand: true }
  if (isGit(word)) {
    calls.push(theGitCallInTheWords(argv, at, walk.directory))
    return { directory: walk.directory, beginsACommand: false }
  }
  const moved =
    word === A_CHANGE_OF_DIRECTORY ? (walk.beginsACommand ? theDirectoryAfterACd(argv[at + 1], walk.directory) : null) : walk.directory
  return { directory: moved, beginsACommand: false }
}

/**
 * Every git call a run of words makes, in the order it makes them, each with the directory it runs in. The words are a
 * shell line's own or a shim's arguments: both are read the same way, which is what lets a test hold the two to one
 * refusal.
 */
export function theGitCallsInArgv(argv: readonly string[], starting: TheStartingDirectory = {}): readonly AGitCall[] {
  const calls: AGitCall[] = []
  const inside: (string | null)[] = []
  let walk: TheWalk = { directory: starting.directory ?? null, beginsACommand: true }
  for (const [at] of argv.entries()) walk = theWalkAfterAWord(argv, at, walk, inside, calls)
  return calls
}

/** Every git call a shell line makes: the line's words, read the way a shim's arguments are. */
export function readTheGitCallsInAShellLine(command: string, starting: TheStartingDirectory = {}): readonly AGitCall[] {
  return theGitCallsInArgv(theWordsOfACommand(command), starting)
}

/**
 * The git calls a shim's own arguments make (martha#562, seam b): what the `git` a launch put first on a member's PATH
 * was handed. A shell hands a program its arguments without the program's own word, so the word is put back here
 * rather than spelled again by every caller; past that the words are read exactly as a line's are.
 */
export function theGitCallsOfAShim(argv: readonly string[], starting: TheStartingDirectory = {}): readonly AGitCall[] {
  return theGitCallsInArgv([THE_PROGRAM, ...argv], starting)
}
