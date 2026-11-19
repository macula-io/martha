// One line of a `.gitignore`, compiled the way the engine's own matcher compiles it (martha#801).
//
// The engine reads a checkout's `.gitignore` files through the `ignore` crate: `GitignoreBuilder::add` reads one line at
// a time, and each line becomes a glob built by `globset` with `literal_separator(true)`, `backslash_escape(true)`,
// `case_insensitive(false)` and `allow_unclosed_class(true)` (ignore-0.4.34 `gitignore.rs:466`-`535`, globset-0.4.20
// `glob.rs`, both as the engine's Cargo.lock pins them at eff9a75e). This file is that line and that glob grammar
// ported, not an approximation of it:
//
//   - a `#` line, and a line that is blank after its trailing space is trimmed (unless the space is escaped), are
//     nothing; `\!` and `\#` are literals; `!` whitelists; a leading `/` anchors; a trailing `/` marks the line
//     directory-only;
//   - a line with no slash matches anywhere, so it gets a `**/` prefix; a line ending `/**` gains a `/*`;
//   - `?`, `*`, `**`, `[...]` (with `!`/`^` negation, ranges and a literal `]` first), `{a,b}` and `\` escapes are
//     globset's grammar, ported construct for construct.
//
// A line globset itself cannot compile (an unclosed alternation, a range that ends before it starts, a dangling
// escape) is DROPPED, as `GitignoreBuilder::add` drops it and keeps the rest of the file: the engine's matcher never
// holds that line, so a record that attached by a different rule would claim an answer the engine does not give.
//
// The matcher is compiled over BYTES, as globset's is: its regex is `(?-u)`, so `?` is one byte and a pattern naming a
// non-ASCII character names the bytes of its own encoding. This port reproduces that by matching the pattern's bytes
// against the path's UTF-8 bytes held in a latin1 string. A line holding a non-ASCII character is REFUSED by name rather
// than guessed at: globset's answer there lives in byte ranges (a multi-byte class member is a set of its bytes, not a
// character) that this record will not stand behind, and a refusal says so where a guess would claim text the launcher
// cannot point at.

/** A glob fragment, one for one with globset's `Token` (`glob.rs:270`). */
type AToken =
  | { readonly of: 'one' }
  | { readonly of: 'anyRun' }
  | { readonly of: 'recursivePrefix' }
  | { readonly of: 'recursiveSuffix' }
  | { readonly of: 'recursiveAnyRun' }
  | { readonly of: 'literal'; readonly character: string }
  | { readonly of: 'class'; readonly negated: boolean; readonly ranges: readonly (readonly [string, string])[] }
  | { readonly of: 'alternates'; readonly branches: readonly (readonly AToken[])[] }

/** A pattern one line of a `.gitignore` compiles to. */
export interface AGitignorePattern {
  /** The line as written, for a message that names it. */
  readonly line: string
  /** A `!` line: it takes a path back out of what an earlier line ignored. */
  readonly isWhitelist: boolean
  /** A line ending in `/`: it would only ever match a directory, and the engine never asks about one. */
  readonly isOnlyDirectory: boolean
  /** The glob after the prefix rules, as globset compiles it. */
  readonly glob: string
  /** Whether this pattern matches a path, given as the latin1 string of its UTF-8 bytes. */
  readonly matchesBytes: (candidate: string) => boolean
}

/** What one line of a `.gitignore` is: nothing, a pattern, a line the engine drops, or a line this port refuses. */
export type AParsedGitignoreLine =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'pattern'; readonly pattern: AGitignorePattern }
  | { readonly kind: 'dropped'; readonly why: string }
  | { readonly kind: 'refused'; readonly refusal: string }

/** What a line means once its flags are taken off it. */
interface ALineWithItsFlags {
  readonly glob: string
  readonly whitelist: boolean
  readonly onlyDirectory: boolean
  readonly anchored: boolean
}

/** The characters Rust's `char::is_whitespace` trims. JavaScript's `trimEnd` trims the byte-order mark and not U+0085. */
const RUST_WHITESPACE = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000])

/** The characters `regex_syntax::escape` escapes (`regex-syntax-0.8`, `is_meta_character`). */
const REGEX_META_CHARACTERS = new Set(['\\', '.', '+', '*', '?', '(', ')', '|', '[', ']', '{', '}', '^', '$', '#', '&', '-', '~'])

/** Nothing a `.gitignore` line says that the engine's matcher takes. */
const NOTHING: AParsedGitignoreLine = { kind: 'nothing' }

/** A pattern the port cannot compile: it becomes a refusal, never a silent skip. */
class AGlobThatCannotBeCompiled extends Error {}

/**
 * The pattern one line of a `.gitignore` holds, or that it holds nothing the engine's matcher takes, or the refusal for
 * a line whose meaning this port will not guess at.
 */
export function aGitignoreLine(line: string): AParsedGitignoreLine {
  if (line.startsWith('#')) return NOTHING
  const trimmed = line.endsWith('\\ ') ? line : trimmedRightByRust(line)
  if (trimmed === '') return NOTHING
  return aLineWithItsFlagsTaken(trimmed)
}

/** The line with its flags taken off it, and the glob compiled, or dropped or refused as the engine and this port each do. */
function aLineWithItsFlagsTaken(line: string): AParsedGitignoreLine {
  const flags = theFlagsOfALine(line)
  const glob = theGlobThatMatchesAnywhere(flags)
  if (!isAscii(glob)) {
    return { kind: 'refused', refusal: `the line "${line}" names a non-ASCII character, whose bytes globset matches as bytes` }
  }
  try {
    return { kind: 'pattern', pattern: aCompiledPattern(line, glob, flags) }
  } catch (error) {
    if (error instanceof AGlobThatCannotBeCompiled) return { kind: 'dropped', why: error.message }
    return { kind: 'refused', refusal: `the line "${line}" could not be compiled (${String(error)})` }
  }
}

/** The line's whitelisting, anchoring and trailing-slash flags, and the glob left once they are off (ignore `add_line`). */
function theFlagsOfALine(text: string): ALineWithItsFlags {
  const literal = text.startsWith('\\!') || text.startsWith('\\#')
  const unescaped = literal ? text.slice(1) : text
  const whitelist = !literal && unescaped.startsWith('!')
  const afterBang = whitelist ? unescaped.slice(1) : unescaped
  const anchored = afterBang.startsWith('/')
  const unanchored = !literal && anchored ? afterBang.slice(1) : afterBang
  const onlyDirectory = unanchored.endsWith('/')
  const glob = onlyDirectory ? unanchored.slice(0, -1).replace(/\\$/, '') : unanchored
  return { glob, whitelist, onlyDirectory, anchored }
}

/** The glob as globset receives it: unanchored with no slash matches anywhere, and a trailing `/**` is everything inside. */
function theGlobThatMatchesAnywhere(flags: ALineWithItsFlags): string {
  const matchesAnywhere = !flags.anchored && !flags.glob.includes('/') && flags.glob !== '**' && !flags.glob.startsWith('**/')
  const prefixed = matchesAnywhere ? `**/${flags.glob}` : flags.glob
  return prefixed.endsWith('/**') ? `${prefixed}/*` : prefixed
}

/** The pattern a compiled glob is: its bytes matched against a path's bytes, as globset's non-Unicode regex does. */
function aCompiledPattern(line: string, glob: string, flags: ALineWithItsFlags): AGitignorePattern {
  const tokens = new AGlobBeingRead(glob).tokens()
  const only = tokens.length === 1 ? tokens[0] : undefined
  const source = only?.of === 'recursivePrefix' ? '^[^\\n]*$' : `^${tokens.map(aTokenAsRegex).join('')}$`
  const regex = new RegExp(source)
  return { line, isWhitelist: flags.whitelist, isOnlyDirectory: flags.onlyDirectory, glob, matchesBytes: (candidate: string) => regex.test(candidate) }
}

/** One token as the regex globset emits for it. `.` is written `[^\n]`, since globset's regex is a byte regex. */
function aTokenAsRegex(token: AToken): string {
  if (token.of === 'literal') return anEscapedByte(token.character)
  if (token.of === 'one') return '[^/]'
  if (token.of === 'anyRun') return '[^/]*'
  if (token.of === 'recursivePrefix') return '(?:/?|[^\\n]*/)'
  if (token.of === 'recursiveSuffix') return '/[^\\n]*'
  if (token.of === 'recursiveAnyRun') return '(?:/|[^\\n]*/)'
  if (token.of === 'class') return aClassAsRegex(token)
  return anAlternationAsRegex(token.branches)
}

/** A character class, each member written as globset writes it, a literal `-` and `]` included. */
function aClassAsRegex(token: Extract<AToken, { readonly of: 'class' }>): string {
  const members = token.ranges.map(([from, to]) => (from === to ? anEscapedByte(from) : `${anEscapedByte(from)}-${anEscapedByte(to)}`))
  return `[${token.negated ? '^' : ''}${members.join('')}]`
}

/** An `{a,b}` alternation: empty branches are left out, as globset leaves them out with `empty_alternates` off. */
function anAlternationAsRegex(branches: readonly (readonly AToken[])[]): string {
  const parts = branches.map((branch) => branch.map(aTokenAsRegex).join('')).filter((part) => part !== '')
  return parts.length === 0 ? '' : `(?:${parts.join('|')})`
}

/** One ASCII character as a regex literal, escaped where `regex_syntax::escape` escapes it. */
function anEscapedByte(character: string): string {
  return REGEX_META_CHARACTERS.has(character) ? `\\${character}` : character
}

/** Whether every character is ASCII, which is the only alphabet this port compiles. */
function isAscii(text: string): boolean {
  return !/[^\x00-\x7f]/.test(text)
}

/** The line without the whitespace Rust trims, which is not the set JavaScript trims. */
function trimmedRightByRust(text: string): string {
  let end = text.length
  while (end > 0 && isRustWhitespace(text.charCodeAt(end - 1))) end -= 1
  return text.slice(0, end)
}

/** Whether a code point is Unicode `White_Space`, the set Rust's `char::is_whitespace` counts (`\s` in its regexes). */
function isRustWhitespace(code: number): boolean {
  return RUST_WHITESPACE.has(code) || (code >= 0x2000 && code <= 0x200a)
}

/** globset's parser, one method per production, over the characters of one glob (`glob.rs:823`-`1124`). */
class AGlobBeingRead {
  private at = 0
  private previous: string | undefined
  private current: string | undefined
  private readonly branches: AToken[][] = [[]]
  private readonly alternationsOpenedAt: number[] = []
  private foundUnclosedClass = false

  private readonly glob: string

  constructor(glob: string) {
    this.glob = glob
  }

  /** Every token of the glob, or a refusal where globset refuses the pattern. */
  tokens(): readonly AToken[] {
    while (this.at < this.glob.length) this.oneToken()
    if (this.alternationsOpenedAt.length > 0) throw new AGlobThatCannotBeCompiled('an alternation is left open')
    return this.branches[0] ?? []
  }

  /** The token the next character is. */
  private oneToken(): void {
    const character = this.bump()
    if (character === undefined) return
    if (!this.aSpecialToken(character)) this.push({ of: 'literal', character })
  }

  /** The token a character that does not stand for itself starts; answers whether it started one. */
  private aSpecialToken(character: string): boolean {
    if (character === '?') this.push({ of: 'one' })
    else if (character === '*') this.star()
    else if (character === '[' && !this.foundUnclosedClass) this.characterClass()
    else if (character === '{') this.openAlternation()
    else if (character === '}') this.closeAlternation()
    else if (character === ',') this.comma()
    else if (character === '\\') this.escapedCharacter()
    else return false
    return true
  }

  /** A `*`, which is a run of anything or, with a second `*`, one of globset's three recursive forms. */
  private star(): void {
    const before = this.previous
    if (this.peek() !== '*') return this.push({ of: 'anyRun' })
    this.bump()
    if (!this.hasTokens()) return this.starAtTheStart()
    if (!this.starAfter(before)) return this.twoRuns()
    const isSuffix = this.starIsSuffix()
    if (isSuffix === undefined) return this.twoRuns()
    this.aRecursiveToken(isSuffix)
  }

  /** Whether a `**` with tokens behind it may be recursive at all: after a separator, or after `,`/`{` inside an alternation. */
  private starAfter(before: string | undefined): boolean {
    if (before === '/') return true
    return this.branches.length > 1 && (before === ',' || before === '{')
  }

  /** A `**` with no token before it: a recursive prefix at a separator, and two plain runs inside a name. */
  private starAtTheStart(): void {
    const next = this.peek()
    if (next !== undefined && next !== '/') return this.twoRuns()
    this.push({ of: 'recursivePrefix' })
    if (this.peek() === '/') this.bump()
  }

  /** Whether the `**` runs to the end of the path (`true`), to a separator (`false`), or is neither (`undefined`). */
  private starIsSuffix(): boolean | undefined {
    const next = this.peek()
    if (next === undefined) return true
    if ((next === ',' || next === '}') && this.branches.length >= 2) return true
    if (next !== '/') return undefined
    this.bump()
    return false
  }

  /** The recursive token a `**` leaves behind, which may merge with the recursive token before it. */
  private aRecursiveToken(isSuffix: boolean): void {
    const before = this.branches[this.branches.length - 1]?.pop()
    if (before?.of === 'recursivePrefix') return this.push({ of: 'recursivePrefix' })
    if (before?.of === 'recursiveSuffix') return this.push({ of: 'recursiveSuffix' })
    this.push({ of: isSuffix ? 'recursiveSuffix' : 'recursiveAnyRun' })
  }

  private twoRuns(): void {
    this.push({ of: 'anyRun' })
    this.push({ of: 'anyRun' })
  }

  /** A `[...]` class; an unclosed one falls back to a literal `[`, which globset allows (`allow_unclosed_class`). */
  private characterClass(): void {
    const saved = { at: this.at, previous: this.previous, current: this.current }
    const negated = this.peek() === '!' || this.peek() === '^'
    if (negated) this.bump()
    const beingBuilt: AClassBeingBuilt = { ranges: [], first: true, inRange: false }
    if (!this.readClass(beingBuilt)) return this.unclosedClass(saved)
    if (beingBuilt.inRange) beingBuilt.ranges.push(['-', '-'])
    this.push({ of: 'class', negated, ranges: beingBuilt.ranges })
  }

  /** Reads a class's characters; answers whether one closed it before the glob ran out. */
  private readClass(beingBuilt: AClassBeingBuilt): boolean {
    for (;;) {
      const character = this.bump()
      if (character === undefined) return false
      if (this.aClassCharacter(beingBuilt, character)) return true
      beingBuilt.first = false
    }
  }

  /** A class character: `]` closes (a first `]` is a literal), `-` opens or closes a range, anything else is a member. */
  private aClassCharacter(beingBuilt: AClassBeingBuilt, character: string): boolean {
    if (character === ']' && !beingBuilt.first) return true
    if (character === ']') beingBuilt.ranges.push([']', ']'])
    else if (character === '-') this.aHyphen(beingBuilt)
    else this.aMember(beingBuilt, character)
    return false
  }

  private aHyphen(beingBuilt: AClassBeingBuilt): void {
    if (beingBuilt.first) return void beingBuilt.ranges.push(['-', '-'])
    if (beingBuilt.inRange) return this.widenLastRange(beingBuilt, '-')
    beingBuilt.inRange = true
  }

  private aMember(beingBuilt: AClassBeingBuilt, character: string): void {
    if (beingBuilt.inRange) return this.widenLastRange(beingBuilt, character)
    beingBuilt.ranges.push([character, character])
  }

  /** The last range widened to `to`, refused when the range would end before it starts. */
  private widenLastRange(beingBuilt: AClassBeingBuilt, to: string): void {
    const last = beingBuilt.ranges[beingBuilt.ranges.length - 1]
    if (last === undefined || to < last[0]) throw new AGlobThatCannotBeCompiled(`the range ending ${to} ends before it starts`)
    beingBuilt.ranges[beingBuilt.ranges.length - 1] = [last[0], to]
    beingBuilt.inRange = false
  }

  /** The class ran out of characters: globset allows it, so the `[` is a literal and the rest is read again as text. */
  private unclosedClass(saved: { readonly at: number; readonly previous: string | undefined; readonly current: string | undefined }): void {
    this.at = saved.at
    this.previous = saved.previous
    this.current = saved.current
    this.foundUnclosedClass = true
    this.push({ of: 'literal', character: '[' })
  }

  private openAlternation(): void {
    this.alternationsOpenedAt.push(this.branches.length)
    this.branches.push([])
  }

  private closeAlternation(): void {
    const start = this.alternationsOpenedAt.pop()
    if (start === undefined) throw new AGlobThatCannotBeCompiled('an alternation closes without one opening')
    this.push({ of: 'alternates', branches: this.branches.splice(start) })
  }

  private comma(): void {
    if (this.alternationsOpenedAt.length === 0) return this.push({ of: 'literal', character: ',' })
    this.branches.push([])
  }

  private escapedCharacter(): void {
    const character = this.bump()
    if (character === undefined) throw new AGlobThatCannotBeCompiled('an escape ends the line')
    this.push({ of: 'literal', character })
  }

  private push(token: AToken): void {
    this.branches[this.branches.length - 1]?.push(token)
  }

  private hasTokens(): boolean {
    return (this.branches[this.branches.length - 1] ?? []).length > 0
  }

  private peek(): string | undefined { return this.at < this.glob.length ? this.glob[this.at] : undefined }

  private bump(): string | undefined {
    this.previous = this.current
    this.current = this.peek()
    this.at += 1
    return this.current
  }
}

/** A class while it is being read: its ranges, whether nothing is in it yet, and whether a `-` is waiting for its end. */
interface AClassBeingBuilt {
  readonly ranges: [string, string][]
  first: boolean
  inRange: boolean
}
