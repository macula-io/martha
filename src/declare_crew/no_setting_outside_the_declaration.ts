// No setting outside the declaration.
//
// A setting read in two places can disagree: one place reads the environment,
// another a home-relative path, and the crew behaves differently depending on
// which slice asked. So a slice of the running crew takes its settings from
// CrewSettings (declare_crew.ts) and from nowhere else.
//
// The check judges what a slice names, not how a line happens to be spelled, so
// an alias, a computed key or a line break does not get past it:
//
// - imports, read with the core's own import reader (imports_beyond_the_core.ts):
//   a slice may not import the process or os modules, under either spelling, nor
//   any module by a computed name, which could be either;
// - identifiers, in the code with its comments, strings and regular expressions
//   blanked out: a slice may not name the global `process`, nor the global
//   object (`globalThis`, `global`) through which it can be reached. A slice runs
//   a process through the host contract's processes part;
// - string literals: a slice may not write a path that starts at the home
//   directory, as `~` alone or `~/…`.
//
// Which files are slices is the caller's to say: the test derives the files that
// are not (tests, and the programs CI runs) from package.json, where they are
// declared.

import { COMPUTED_SPECIFIER, specifiersOf } from '../host_contract/imports_beyond_the_core.ts'

/** The modules that hand a slice the environment or the home directory. */
export const MODULES_A_SLICE_MAY_NOT_IMPORT = ['node:process', 'process', 'node:os', 'os'] as const

/** The globals through which a slice could reach the environment. */
export const GLOBALS_A_SLICE_MAY_NOT_NAME = ['process', 'globalThis', 'global'] as const

/** A path whose first segment is the home directory: `~` alone, or `~/…`. */
export const STARTS_AT_HOME = /^~(?:\/|$)/

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

interface Lexed {
  /** The text with every comment, string, template and regular expression blanked to spaces; newlines kept. */
  readonly code: string
  /** Every string and template literal's raw contents, with the offset it starts at. */
  readonly strings: readonly { readonly at: number; readonly text: string }[]
}

// After one of these characters (or at the start), a `/` opens a regular
// expression rather than dividing.
const BEFORE_A_REGEX = new Set(['', ...'(,=:[!&|?{};+-*%<>^~'])

const blank = (text: string) => text.replace(/[^\n]/g, ' ')

function lex(text: string): Lexed {
  const strings: { at: number; text: string }[] = []
  let code = ''
  let previous = ''
  // Reads text[from, to) into code and strings, and returns where it stopped.
  // Inside a template's substitution, `stopAt` is the closing brace.
  const read = (from: number, stopAtBrace: boolean): number => {
    let i = from
    let depth = 0
    const take = (end: number, keep: boolean) => {
      const part = text.slice(i, end)
      code += keep ? part : blank(part)
      i = end
    }
    while (i < text.length) {
      const c = text[i] ?? ''
      const next = text[i + 1] ?? ''
      if (stopAtBrace && c === '}' && depth === 0) return i
      if (c === '/' && next === '/') {
        const end = text.indexOf('\n', i)
        take(end === -1 ? text.length : end, false)
      } else if (c === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2)
        take(end === -1 ? text.length : end + 2, false)
      } else if (c === "'" || c === '"') {
        const end = closingQuote(text, i, c)
        strings.push({ at: i, text: text.slice(i + 1, end - 1) })
        take(end, false)
        previous = 'x'
      } else if (c === '`') {
        i = readTemplate(i)
        previous = 'x'
      } else if (c === '/' && BEFORE_A_REGEX.has(previous)) {
        take(closingSlash(text, i), false)
        previous = 'x'
      } else {
        if (c === '{') depth += 1
        if (c === '}') depth -= 1
        if (!/\s/.test(c)) previous = /[\w$)\]]/.test(c) ? 'x' : c
        take(i + 1, true)
      }
    }
    return i
  }
  // A template's literal parts are strings; each substitution is code, read as such.
  const readTemplate = (from: number): number => {
    code += ' '
    let i = from + 1
    let part = i
    const literal = (end: number) => {
      strings.push({ at: part, text: text.slice(part, end) })
      code += blank(text.slice(part, end))
    }
    while (i < text.length && text[i] !== '`') {
      if (text[i] === '\\') {
        i += 2
      } else if (text[i] === '$' && text[i + 1] === '{') {
        literal(i)
        code += '  '
        previous = '('
        i = read(i + 2, true)
        if (i < text.length) code += ' '
        i += 1
        part = i
      } else {
        i += 1
      }
    }
    literal(Math.min(i, text.length))
    if (i < text.length) code += ' '
    return Math.min(i + 1, text.length)
  }
  read(0, false)
  return { code, strings }
}

// The offset just past the quote that closes the one at `from`.
function closingQuote(text: string, from: number, quote: string): number {
  let i = from + 1
  while (i < text.length && text[i] !== quote && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1
  return Math.min(i + 1, text.length)
}

function closingSlash(text: string, from: number): number {
  let i = from + 1
  let inClass = false
  while (i < text.length && text[i] !== '\n') {
    const c = text[i]
    if (c === '\\') i += 1
    else if (c === '[') inClass = true
    else if (c === ']') inClass = false
    else if (c === '/' && !inClass) break
    i += 1
  }
  return Math.min(i + 1, text.length)
}

const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length

const IDENTIFIER = /[A-Za-z_$][\w$]*/g

function findingsIn(source: Source): Finding[] {
  const { code, strings } = lex(source.text)
  const found = (offset: number, why: string): Finding => ({ path: source.path, line: lineAt(source.text, offset), why })

  const specifiers = specifiersOf(source.text)
  const imports = specifiers
    .filter(specifier => (MODULES_A_SLICE_MAY_NOT_IMPORT as readonly string[]).includes(specifier))
    .map(specifier => found(source.text.search(new RegExp(`['"\`]${specifier}['"\`]`)), `imports ${specifier}`))
  // A module whose name is computed could be any of them, so it is refused too.
  const computed = specifiers
    .filter(specifier => specifier.startsWith(COMPUTED_SPECIFIER))
    .map(specifier => found(0, `imports a module by a computed name ${specifier}`))

  const globals = [...code.matchAll(IDENTIFIER)]
    .filter(match => (GLOBALS_A_SLICE_MAY_NOT_NAME as readonly string[]).includes(match[0]))
    .filter(match => !isPropertyName(code, match.index))
    .map(match => found(match.index, `names the global ${match[0]}`))

  const home = strings
    .filter(literal => STARTS_AT_HOME.test(literal.text))
    .map(literal => found(literal.at, 'writes a path that starts at the home directory'))

  return [...imports, ...computed, ...globals, ...home].sort((a, b) => a.line - b.line)
}

// `host.processes` and `a?.process` name a property, not the global.
const isPropertyName = (code: string, at: number): boolean => code.slice(0, at).trimEnd().endsWith('.')

/** Every place in these slices that reaches for a setting other than through the declaration. */
export function settingsReadOutsideTheDeclaration(slices: readonly Source[]): Finding[] {
  return slices.flatMap(findingsIn)
}
