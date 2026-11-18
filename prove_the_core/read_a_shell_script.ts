// A shell script read the way the shell reads it, closely enough to tell a run from a value (martha#727).
//
// The bounded-runs check (every_run_of_the_tests_is_bounded.ts) asks one question of a script: where do the runner's
// words stand as words of a command, and where are they only text inside one quoted word? A line-by-line read cannot
// tell, so a fixture that writes `"test": "node --test"` into a manifest read as a run of our tests. This reads the
// script into its simple commands, each with its words as the shell hands them over: quotes taken off, an expansion
// or a substitution kept as it was written, so the rule can still see a `$RUN` or a `$(…)` for what it is.
//
// It reads: '…', "…" (with its escapes and the $(…), `…` and ${…} it still opens), $'…', a backslash, a
// backslash-newline, a comment, $(…), $((…)), ${…}, `…`, an array assignment, here-documents (<<, <<-, quoted or bare)
// and here-strings (<<<). A part that never closes is thrown as AnUnclosedPart, named by the line it opened on, so
// the check fails closed: a script this cannot follow never passes.

/** One word of a command, as the shell hands it to the program. */
export interface AWord {
  /** The word with its quotes taken off; an expansion or a substitution is kept as it was written. */
  readonly text: string
  /** The line the word starts on. */
  readonly line: number
  /** Some of it was quoted or escaped. */
  readonly quoted: boolean
  /** The name, when the word is exactly one parameter expansion: `$NAME`, `${NAME}`, `"${NAME[@]}"`. */
  readonly whole: string | undefined
  /** What each of its `$(…)` and `` `…` `` runs. */
  readonly inner: readonly (readonly AToken[])[]
  /** The elements, when the word is an array assignment `NAME=(…)`. */
  readonly array: readonly AWord[] | undefined
  /** The name, when the word starts, unquoted, with `NAME=` or `NAME+=`: an assignment where the shell takes one. */
  readonly assigns: string | undefined
}

/** A here-document's body: the text between its opening line and its delimiter, and the line it starts on. */
export interface ABody {
  readonly text: string
  readonly line: number
}

/** A token of the script: a word, or an operator (a newline is one), with the body a here-document took. */
export type AToken =
  | { readonly kind: 'word'; readonly word: AWord }
  | { readonly kind: 'op'; readonly op: string; readonly line: number; readonly heredoc: { body: ABody | undefined } | undefined }

/** A part of the script that opens and never closes: the shell refuses the script, and so does the check. */
export class AnUnclosedPart extends Error {
  readonly line: number
  readonly what: string
  constructor(line: number, what: string) {
    super(`${what} opened on line ${line} does not close`)
    this.line = line
    this.what = what
  }
}

interface Pending {
  readonly delimiter: string
  readonly strip: boolean
  readonly line: number
  readonly into: { body: ABody | undefined }
}

interface State {
  readonly src: string
  at: number
  line: number
  readonly pending: Pending[]
}

interface Building {
  text: string
  readonly line: number
  quoted: boolean
  /** Some of it is literal text the shell never expands: single quotes, $'…' or an escape. */
  literal: boolean
  readonly inner: (readonly AToken[])[]
  array: readonly AWord[] | undefined
  assigns: string | undefined
}

/** The operators, longest first, so `<<<` is never read as `<<` and `<`. */
const OPERATORS = ['<<<', '<<-', '&>>', '&&', '||', ';;', '|&', '<<', '>>', '>&', '<&', '&>', '>|', '<>', '|', ';', '&', '(', ')', '<', '>', '\n']

/** The operators that open a here-document. */
export const HEREDOC_OPERATORS = new Set(['<<', '<<-'])

/** The characters that end a word outside quotes. */
const ENDS_A_WORD = new Set([' ', '\t', '\n', ';', '&', '|', '<', '>', '(', ')'])

/** A word that is one parameter expansion and nothing else. */
const ONE_EXPANSION = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)(?:\[[^\]]*\])?(?:[:#%/^,][^}]*)?\})$/

/** What a word holds before its `=` when it is an assignment: a name, unquoted, and `+` for an append. */
const A_NAME_SO_FAR = /^[A-Za-z_]\w*\+?$/

/** The start of an array assignment: `NAME=(` or `NAME+=(`. */
const AN_ARRAY_OPENS = /^[A-Za-z_]\w*\+?=$/

const newState = (src: string, line: number): State => ({ src, at: 0, line, pending: [] })

/** Moves `n` characters on, counting the lines it passes. */
function advance(s: State, n: number): void {
  for (const c of s.src.slice(s.at, s.at + n)) if (c === '\n') s.line += 1
  s.at += n
}

const ahead = (s: State, n: number): string => s.src.slice(s.at, s.at + n)

/** Blanks, backslash-newlines and comments skipped; whether a token follows. Newlines are tokens unless `newlines`. */
function skipToAToken(s: State, newlines = false): boolean {
  for (;;) {
    const c = s.src[s.at]
    if (c === ' ' || c === '\t' || (newlines && c === '\n')) advance(s, 1)
    else if (ahead(s, 2) === '\\\n') advance(s, 2)
    else if (c === '#') skipAComment(s)
    else return s.at < s.src.length
  }
}

/** A comment passed over, up to the newline that ends it, which stays a token. */
function skipAComment(s: State): void {
  const end = s.src.indexOf('\n', s.at)
  advance(s, (end === -1 ? s.src.length : end) - s.at)
}

/** A script's tokens, read to its end. */
export function tokensOf(text: string, line: number): AToken[] {
  const s = newState(text, line)
  const tokens = lexTokens(s, undefined)
  const left = s.pending[0]
  if (left !== undefined) throw new AnUnclosedPart(left.line, `a here-document to ${left.delimiter}`)
  return tokens
}

/** Tokens up to the end of the text, or, inside a `$(` opened on line `opened`, up to its own `)`. */
function lexTokens(s: State, opened: number | undefined): AToken[] {
  const tokens: AToken[] = []
  let depth = 0
  while (skipToAToken(s)) {
    const token = aToken(s)
    const op = token.kind === 'op' ? token.op : ''
    if (op === ')' && opened !== undefined && depth === 0) return tokens
    depth += BRACKETS[op] ?? 0
    tokens.push(token)
    if (op === '\n') readTheBodies(s)
  }
  if (opened !== undefined) throw new AnUnclosedPart(opened, 'a $(…)')
  return tokens
}

/** How an operator moves the depth of the parentheses a `$(…)` holds. */
const BRACKETS: Readonly<Record<string, number>> = { '(': 1, ')': -1 }

function aToken(s: State): AToken {
  const fd = /^\d+(?=[<>])/.exec(s.src.slice(s.at, s.at + 12))
  if (fd !== null) advance(s, fd[0].length)
  const op = OPERATORS.find((one) => s.src.startsWith(one, s.at))
  if (op === undefined) return { kind: 'word', word: readWord(s) }
  const line = s.line
  advance(s, op.length)
  return { kind: 'op', op, line, heredoc: HEREDOC_OPERATORS.has(op) ? aHeredoc(s, op, line) : undefined }
}

/** A here-document's delimiter read; its body is read at the end of the line. */
function aHeredoc(s: State, op: string, line: number): { body: ABody | undefined } {
  skipToAToken(s)
  const delimiter = readWord(s).text
  const into: { body: ABody | undefined } = { body: undefined }
  s.pending.push({ delimiter, strip: op === '<<-', line, into })
  return into
}

/** The bodies of the here-documents the line just ended opened, in order. */
function readTheBodies(s: State): void {
  for (let p = s.pending.shift(); p !== undefined; p = s.pending.shift()) readABody(s, p)
}

function readABody(s: State, p: Pending): void {
  const lines: string[] = []
  const first = s.line
  for (;;) {
    if (s.at >= s.src.length) throw new AnUnclosedPart(p.line, `a here-document to ${p.delimiter}`)
    const end = s.src.indexOf('\n', s.at)
    const text = s.src.slice(s.at, end === -1 ? s.src.length : end)
    advance(s, text.length + (end === -1 ? 0 : 1))
    if ((p.strip ? text.replace(/^\t+/, '') : text) === p.delimiter) break
    lines.push(text)
  }
  p.into.body = { text: lines.join('\n'), line: first }
}

function readWord(s: State): AWord {
  const w: Building = { text: '', line: s.line, quoted: false, literal: false, inner: [], array: undefined, assigns: undefined }
  while (s.at < s.src.length && !ENDS_A_WORD.has(s.src[s.at] ?? '')) readAPart(s, w)
  if (s.src[s.at] === '(' && !w.quoted && AN_ARRAY_OPENS.test(w.text)) {
    advance(s, 1)
    w.array = readArray(s, w.line)
  }
  const whole = theWholeName(w)
  return { text: w.text, line: w.line, quoted: w.quoted, whole, inner: w.inner, array: w.array, assigns: w.assigns }
}

/** The name a word expands, when it is one parameter expansion and nothing else. */
function theWholeName(w: Building): string | undefined {
  const one = w.literal ? null : ONE_EXPANSION.exec(w.text)
  return one === null ? undefined : (one[1] ?? one[2])
}

function readArray(s: State, opened: number): AWord[] {
  const elements: AWord[] = []
  while (skipToAToken(s, true)) {
    if (s.src[s.at] === ')') {
      advance(s, 1)
      return elements
    }
    elements.push(readWord(s))
  }
  throw new AnUnclosedPart(opened, 'an array')
}

/** What reads a part of a word that starts with each character the shell treats specially there. */
const A_PART_THAT_STARTS_WITH: Readonly<Record<string, (s: State, w: Building) => void>> = {
  '\\': (s, w) => readAnEscape(s, w),
  "'": (s, w) => readSingle(s, w),
  '"': (s, w) => readDouble(s, w),
  $: (s, w) => readDollar(s, w, false),
  '`': (s, w) => readBackticks(s, w),
}

function readAPart(s: State, w: Building): void {
  const c = s.src[s.at] ?? ''
  const special = A_PART_THAT_STARTS_WITH[c]
  if (special !== undefined) return special(s, w)
  if (c === '=' && w.assigns === undefined && !w.quoted && A_NAME_SO_FAR.test(w.text)) w.assigns = w.text.replace(/\+$/, '')
  w.text += c
  advance(s, 1)
}

function readAnEscape(s: State, w: Building): void {
  const next = s.src[s.at + 1]
  if (next === '\n') return advance(s, 2)
  w.text += next ?? '\\'
  w.quoted = true
  w.literal = true
  advance(s, next === undefined ? 1 : 2)
}

function readSingle(s: State, w: Building): void {
  const end = s.src.indexOf("'", s.at + 1)
  if (end === -1) throw new AnUnclosedPart(s.line, 'a single quote')
  w.text += s.src.slice(s.at + 1, end)
  w.quoted = true
  w.literal = true
  advance(s, end + 1 - s.at)
}

function readDouble(s: State, w: Building): void {
  const opened = s.line
  advance(s, 1)
  w.quoted = true
  while (s.at < s.src.length && s.src[s.at] !== '"') readADoublePart(s, w)
  if (s.at >= s.src.length) throw new AnUnclosedPart(opened, 'a double quote')
  advance(s, 1)
}

function readADoublePart(s: State, w: Building): void {
  const c = s.src[s.at]
  if (c === '\\') return readADoubleEscape(s, w)
  if (c === '$') return readDollar(s, w, true)
  if (c === '`') return readBackticks(s, w)
  w.text += c
  advance(s, 1)
}

/** Inside "…" a backslash escapes only $, `, ", \ and a newline; before anything else it is itself. */
function readADoubleEscape(s: State, w: Building): void {
  const next = s.src[s.at + 1] ?? ''
  if (next === '\n') return advance(s, 2)
  if (!'$`"\\'.includes(next) || next === '') {
    w.text += '\\'
    return advance(s, 1)
  }
  w.text += next
  w.literal = true
  advance(s, 2)
}

function readDollar(s: State, w: Building, inDouble: boolean): void {
  const next = ahead(s, 3)
  if (next.startsWith("$'") && !inDouble) return readAnsi(s, w)
  if (next === '$((') return readArithmetic(s, w)
  if (next.startsWith('$(')) return readSubstitution(s, w)
  if (next.startsWith('${')) return readBraced(s, w)
  w.text += '$'
  advance(s, 1)
}

/** $'…', where a backslash escapes the next character, a quote included. */
function readAnsi(s: State, w: Building): void {
  const opened = s.line
  let at = s.at + 2
  while (at < s.src.length && s.src[at] !== "'") at += s.src[at] === '\\' ? 2 : 1
  if (at >= s.src.length) throw new AnUnclosedPart(opened, "a $'…'")
  w.text += s.src.slice(s.at + 2, at).replace(/\\(.)/gs, '$1')
  w.quoted = true
  w.literal = true
  advance(s, at + 1 - s.at)
}

/** $((…)), arithmetic: no command runs in it, so it is kept as text. */
function readArithmetic(s: State, w: Building): void {
  const opened = s.line
  let at = s.at + 3
  for (let depth = 2; depth > 0; at += 1) {
    if (at >= s.src.length) throw new AnUnclosedPart(opened, 'a $((…))')
    depth += s.src[at] === '(' ? 1 : s.src[at] === ')' ? -1 : 0
  }
  w.text += s.src.slice(s.at, at)
  advance(s, at - s.at)
}

function readSubstitution(s: State, w: Building): void {
  const start = s.at
  const opened = s.line
  advance(s, 2)
  w.inner.push(lexTokens(s, opened))
  w.text += s.src.slice(start, s.at)
}

/** ${…}, with the quotes it may hold read as quotes. */
function readBraced(s: State, w: Building): void {
  const start = s.at
  const opened = s.line
  const scratch: Building = { text: '', line: s.line, quoted: false, literal: false, inner: [], array: undefined, assigns: undefined }
  advance(s, 2)
  for (let depth = 1; depth > 0; ) {
    const c = s.src[s.at]
    if (c === undefined) throw new AnUnclosedPart(opened, 'a ${…}')
    if (c === "'" || c === '"' || c === '\\') readAPart(s, scratch)
    else {
      depth += c === '{' ? 1 : c === '}' ? -1 : 0
      advance(s, 1)
    }
  }
  w.text += s.src.slice(start, s.at)
}

/** `…`, an old command substitution: its own script, with \` read as `. */
function readBackticks(s: State, w: Building): void {
  const opened = s.line
  let at = s.at + 1
  while (at < s.src.length && s.src[at] !== '`') at += s.src[at] === '\\' ? 2 : 1
  if (at >= s.src.length) throw new AnUnclosedPart(opened, 'a `…`')
  w.inner.push(tokensOf(s.src.slice(s.at + 1, at).replace(/\\([`\\$])/g, '$1'), opened))
  w.text += s.src.slice(s.at, at + 1)
  advance(s, at + 1 - s.at)
}

/** One simple command: its words as the shell hands them over, and what feeds it. */
export interface ACommand {
  /** Its words, assignments first, without the words its redirections name. */
  readonly words: readonly AWord[]
  /** The words its redirections name, a here-string's among them: they are never a word of the command. */
  readonly targets: readonly AWord[]
  /** The word a here-string (`<<<`) feeds it on its standard input. */
  readonly herestring: AWord | undefined
  /** The bodies of the here-documents it reads. */
  readonly bodies: readonly ABody[]
  /** The function whose body it is in, if any. */
  readonly inFunction: string | undefined
  /** Its pipeline, and its place there: 0 is the first element, which nothing feeds. */
  readonly pipeline: number
  readonly place: number
}

/** The operators that take the next word as what they redirect to or from. */
const REDIRECTIONS = new Set(['<', '>', '>>', '&>', '&>>', '>&', '<&', '>|', '<>', '<<<'])

/** The operators that feed one command's output to the next. */
const PIPES = new Set(['|', '|&'])

/** A function's name as the shell takes one. */
const A_NAME = /^[A-Za-z_][\w-]*$/

interface Assembling {
  readonly commands: ACommand[]
  words: AWord[]
  targets: AWord[]
  herestring: AWord | undefined
  bodies: ABody[]
  pipeline: number
  place: number
  /** The functions whose bodies are open, innermost last, each with the braces it still has open. */
  readonly frames: { readonly name: string; depth: number }[]
  /** A function's header read (`f()` or `function f`), its body's `{` still to come. */
  defining: string | undefined
  /** The redirection whose word comes next. */
  redirection: string | undefined
  /** The `)` of a function's `()`, still to be passed over. */
  closing: boolean
}

/** A script's tokens put together into its simple commands, in order. */
export function commandsOf(tokens: readonly AToken[]): ACommand[] {
  const a: Assembling = {
    commands: [], words: [], targets: [], herestring: undefined, bodies: [], pipeline: 0, place: 0,
    frames: [], defining: undefined, redirection: undefined, closing: false,
  }
  tokens.forEach((token, at) => (token.kind === 'word' ? takeAWord(a, token.word) : takeAnOperator(a, token, tokens[at + 1])))
  endTheCommand(a)
  return a.commands
}

/** The name a function header gives: `f` before `()`, or `function f`. */
function aFunctionsName(words: readonly AWord[]): string | undefined {
  const [first, second] = words
  if (words.length === 1 && first !== undefined && !first.quoted && A_NAME.test(first.text)) return first.text
  if (words.length === 2 && first?.text === 'function' && second !== undefined) return second.text
  return undefined
}

const isUnquoted = (word: AWord, text: string): boolean => !word.quoted && word.text === text

function takeAWord(a: Assembling, word: AWord): void {
  if (a.redirection !== undefined) return takeATarget(a, word)
  if (isUnquoted(word, '{') && a.words.length === 0) return openABrace(a, a.defining)
  if (isUnquoted(word, '{') && a.words[0]?.text === 'function') return openABrace(a, aFunctionsName(a.words))
  if (isUnquoted(word, '}') && a.words.length === 0) return closeABrace(a)
  a.words.push(word)
}

function takeATarget(a: Assembling, word: AWord): void {
  if (a.redirection === '<<<') a.herestring = word
  a.targets.push(word)
  a.redirection = undefined
}

/** A `{` that opens a command group, or the body of the function `name` when a header came before it. */
function openABrace(a: Assembling, name: string | undefined): void {
  a.words = []
  a.defining = undefined
  const innermost = a.frames.at(-1)
  if (name !== undefined) a.frames.push({ name, depth: 1 })
  else if (innermost !== undefined) innermost.depth += 1
}

function closeABrace(a: Assembling): void {
  const innermost = a.frames.at(-1)
  if (innermost === undefined) return
  innermost.depth -= 1
  if (innermost.depth === 0) a.frames.pop()
}

function takeAnOperator(a: Assembling, token: AToken & { kind: 'op' }, next: AToken | undefined): void {
  const { op } = token
  if (REDIRECTIONS.has(op)) a.redirection = op
  else if (token.heredoc !== undefined) takeABody(a, token.heredoc.body)
  else if (opensAFunctionsParens(a, op, next)) startAFunction(a)
  else if (op === ')' && a.closing) a.closing = false
  else if (PIPES.has(op)) feedTheNext(a)
  else if (!continuesAPipe(a, op)) endThePipeline(a)
}

/** `(` right after a function's name, with its `)` next: `f()`. */
const opensAFunctionsParens = (a: Assembling, op: string, next: AToken | undefined): boolean =>
  op === '(' && next?.kind === 'op' && next.op === ')' && aFunctionsName(a.words) !== undefined

/** A newline right after a `|`: the pipe goes on onto the next line. */
const continuesAPipe = (a: Assembling, op: string): boolean => op === '\n' && a.words.length === 0 && a.place > 0

function takeABody(a: Assembling, body: ABody | undefined): void {
  if (body !== undefined) a.bodies.push(body)
}

function startAFunction(a: Assembling): void {
  a.defining = aFunctionsName(a.words)
  a.words = []
  a.closing = true
}

function feedTheNext(a: Assembling): void {
  endTheCommand(a)
  a.place += 1
}

function endThePipeline(a: Assembling): void {
  endTheCommand(a)
  a.pipeline += 1
  a.place = 0
}

function endTheCommand(a: Assembling): void {
  if (a.words.length > 0 || a.targets.length > 0 || a.bodies.length > 0) {
    const { words, targets, herestring, bodies, pipeline, place } = a
    a.commands.push({ words, targets, herestring, bodies, inFunction: a.frames.at(-1)?.name, pipeline, place })
  }
  a.words = []
  a.targets = []
  a.herestring = undefined
  a.bodies = []
}
