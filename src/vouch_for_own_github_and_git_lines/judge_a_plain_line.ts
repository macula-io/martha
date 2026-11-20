// Is this shell line nothing but `gh` and git calls? (martha#987, T14 of the threat model, r=2 R1.)
//
// A command's output is A13 because one command can print text from anywhere (../take_in_a_tool_result). The own-repo
// rules (./vouch_for_own_github_and_git_lines.ts) may lift that only for a line whose every program is `gh` or git,
// so this judge answers that one question, strictly, and errs towards A13: anything it does not take apart is no plain
// line. It splits on `&&` and `||` only. A word is unquoted characters from a short plain set, or single-quoted text
// with no newline, or both run together. Everything else the shell gives a meaning to is refused outright: a pipe, `;`,
// `&`, a redirection, `$` in any form, a backtick, a glob, a backslash, a double quote, a subshell or brace group, a
// comment, `~`, a newline, an unbalanced quote. A command's first word is exactly `gh` or `git`; the one other word
// taken is a leading `cd <absolute plain directory> &&`, because that is how the line names where it runs.
//
// `read_the_git_calls_in_a_shell_line` stays as it is, for the refusals it serves: this judge is for the vouch alone.

import { GIT, GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** One `gh` or git call of a plain line: its program and the words after it. */
export interface APlainCall {
  readonly program: typeof GITHUB_CLI | typeof GIT
  readonly words: readonly string[]
}

/** A line the judge took apart: the directory a leading `cd` names, if any, and its calls in order. */
export interface APlainLine {
  readonly directory: string | undefined
  readonly calls: readonly APlainCall[]
}

const CHANGE_DIRECTORY = 'cd'

/** The characters an unquoted word may hold: none of them means anything to the shell. */
const PLAIN_CHARACTER = /[A-Za-z0-9_./:@%+=,-]/
const SINGLE_QUOTE = "'"
const BLANKS = [' ', '\t']
/** The two separators the judge splits on; any other control operator is refused. */
const SEPARATORS = ['&&', '||']
/** A path segment that climbs, which a plain directory does not hold. */
const CLIMB = '..'

type Token = { readonly word: string } | { readonly separator: string }

/**
 * The line as plain `gh` / git calls, or `undefined` when it is anything more. Pure: it reads only the text.
 */
export function judgeAPlainLine(line: string): APlainLine | undefined {
  const tokens = tokensOf(line)
  const commands = tokens === undefined ? undefined : commandsOf(tokens)
  if (commands === undefined) return undefined
  const leading = leadingDirectoryOf(commands)
  if (leading === null) return undefined
  const calls = commands.slice(leading === undefined ? 0 : 1).map(callOf)
  return calls.every((call): call is APlainCall => call !== undefined) ? { directory: leading, calls } : undefined
}

/**
 * The directory a leading `cd` names: `undefined` when the line has none, null when it has one the judge does not take
 * (not exactly `cd <absolute plain directory>`, or nothing after it).
 */
function leadingDirectoryOf(commands: readonly (readonly string[])[]): string | undefined | null {
  const [first = [], ...rest] = commands
  if (first[0] !== CHANGE_DIRECTORY) return undefined
  const [, directory, ...more] = first
  return more.length === 0 && rest.length > 0 && isAPlainDirectory(directory) ? directory : null
}

/** An absolute directory with no climbing segment: the only kind a plain line may name. */
export function isAPlainDirectory(directory: string | undefined): directory is string {
  return directory !== undefined && directory.startsWith('/') && !directory.split('/').includes(CLIMB)
}

function callOf(words: readonly string[]): APlainCall | undefined {
  const [program, ...rest] = words
  return program === GITHUB_CLI || program === GIT ? { program, words: rest } : undefined
}

/** The tokens split into commands at each separator; `undefined` for an empty command, leading, trailing or between. */
function commandsOf(tokens: readonly Token[]): readonly (readonly string[])[] | undefined {
  const commands: string[][] = [[]]
  for (const token of tokens) {
    if ('separator' in token) commands.push([])
    else commands[commands.length - 1]?.push(token.word)
  }
  return commands.every((command) => command.length > 0) ? commands : undefined
}

/** The line as words and separators, or `undefined` at the first character the judge does not take. */
function tokensOf(line: string): readonly Token[] | undefined {
  const pieces = piecesOf(line)
  if (pieces === undefined) return undefined
  const tokens: Token[] = []
  let word: string | undefined
  for (const piece of [...pieces, END_OF_LINE]) {
    if ('text' in piece) word = (word ?? '') + piece.text
    else tokens.push(...closed(word, piece.separator))
    if (!('text' in piece)) word = undefined
  }
  return tokens
}

/** The tokens a break leaves: the word it ends, if any, then its separator, if any. */
function closed(word: string | undefined, separator: string | undefined): readonly Token[] {
  return [...(word === undefined ? [] : [{ word }]), ...(separator === undefined ? [] : [{ separator }])]
}

type APiece = { readonly text: string; readonly next: number } | { readonly separator: string | undefined; readonly next: number }
/** The break the end of the line is: it closes the last word and separates nothing. */
const END_OF_LINE: APiece = { separator: undefined, next: 0 }

/** The line as text pieces and breaks, in order, or `undefined` at the first character the judge does not take. */
function piecesOf(line: string): readonly APiece[] | undefined {
  const pieces: APiece[] = []
  for (let at = 0; at < line.length; ) {
    const piece = breakAt(line, at) ?? segmentAt(line, at)
    if (piece === undefined) return undefined
    pieces.push(piece)
    at = piece.next
  }
  return pieces
}

/** A blank or a separator at `at`, which ends the word before it; `undefined` when there is neither. */
function breakAt(line: string, at: number): { readonly separator: string | undefined; readonly next: number } | undefined {
  const separator = SEPARATORS.find((candidate) => line.startsWith(candidate, at))
  if (separator !== undefined) return { separator, next: at + separator.length }
  return BLANKS.includes(line[at] ?? '') ? { separator: undefined, next: at + 1 } : undefined
}

/** One unquoted character or one single-quoted run at `at`, or `undefined` for anything else. */
function segmentAt(line: string, at: number): { readonly text: string; readonly next: number } | undefined {
  const character = line[at] ?? ''
  if (PLAIN_CHARACTER.test(character)) return { text: character, next: at + 1 }
  if (character !== SINGLE_QUOTE) return undefined
  const end = line.indexOf(SINGLE_QUOTE, at + 1)
  if (end < 0) return undefined
  const text = line.slice(at + 1, end)
  return /[\n\r]/.test(text) ? undefined : { text, next: end + 1 }
}
