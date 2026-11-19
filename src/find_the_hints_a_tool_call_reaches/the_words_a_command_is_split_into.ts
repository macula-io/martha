// The words one command's text is split into, as the engine's shell splitter splits them (martha#801).
//
// The tracker reads a tool call's `command` through `shell_words::split` (shell-words-1.1, `lib.rs:126`, as the engine's
// Cargo.lock pins it) and gives up on the whole command when it does not parse (`unwrap_or_default()`, `load_hints.rs:65`).
// This file is that splitter ported state for state: quoting, backslash escapes, `#` comments, and the three characters
// it counts as whitespace. A quote or an escape left open is not a word: the whole split is empty, as the engine's is.

/** The states the splitter moves between, one for one with shell-words' own (`lib.rs`). */
type ASplittingState = 'delimiter' | 'unquoted' | 'singleQuoted' | 'doubleQuoted' | 'backslash' | 'unquotedBackslash' | 'doubleQuotedBackslash' | 'comment'

/** The words found so far, the one being read, and where the splitter is. */
interface ACommandBeingSplit {
  readonly words: string[]
  word: string
  state: ASplittingState
}

/** The words of a command, or none when it does not parse — the engine's `split(cmd).unwrap_or_default()`. */
export function theWordsACommandIsSplitInto(command: string): readonly string[] {
  const beingSplit: ACommandBeingSplit = { words: [], word: '', state: 'delimiter' }
  for (const character of command) oneCharacter(beingSplit, character)
  return theWordsAtTheEnd(beingSplit)
}

/** One character read, the state moved on as shell-words moves it. */
function oneCharacter(beingSplit: ACommandBeingSplit, character: string): void {
  if (beingSplit.state === 'delimiter') return fromADelimiter(beingSplit, character)
  if (beingSplit.state === 'unquoted') return inAnUnquotedWord(beingSplit, character)
  if (beingSplit.state === 'singleQuoted') return inSingleQuotes(beingSplit, character)
  if (beingSplit.state === 'doubleQuoted') return inDoubleQuotes(beingSplit, character)
  if (beingSplit.state === 'backslash' || beingSplit.state === 'unquotedBackslash') return afterABackslash(beingSplit, character)
  if (beingSplit.state === 'doubleQuotedBackslash') return afterABackslashInDoubleQuotes(beingSplit, character)
  inAComment(beingSplit, character)
}

/** Between words: a quote opens one, a `#` starts a comment, and whitespace is nothing at all. */
function fromADelimiter(beingSplit: ACommandBeingSplit, character: string): void {
  if (character === "'") beingSplit.state = 'singleQuoted'
  else if (character === '"') beingSplit.state = 'doubleQuoted'
  else if (character === '\\') beingSplit.state = 'backslash'
  else if (character === '#') beingSplit.state = 'comment'
  else if (!isAWhitespaceOfTheSplitter(character)) return addToTheWord(beingSplit, character, 'unquoted')
}

/** Inside a word: whitespace ends it, and a quote or an escape moves the splitter on inside it. */
function inAnUnquotedWord(beingSplit: ACommandBeingSplit, character: string): void {
  if (character === ' ') return finishTheWord(beingSplit)
  if (character === '\t' || character === '\n') return finishTheWord(beingSplit)
  if (character === "'") beingSplit.state = 'singleQuoted'
  else if (character === '"') beingSplit.state = 'doubleQuoted'
  else if (character === '\\') beingSplit.state = 'unquotedBackslash'
  else addToTheWord(beingSplit, character, 'unquoted')
}

/** Inside single quotes nothing is special but the closing quote. */
function inSingleQuotes(beingSplit: ACommandBeingSplit, character: string): void {
  if (character === "'") beingSplit.state = 'unquoted'
  else addToTheWord(beingSplit, character, 'singleQuoted')
}

/** Inside double quotes only a backslash, and the closing quote, are special. */
function inDoubleQuotes(beingSplit: ACommandBeingSplit, character: string): void {
  if (character === '"') beingSplit.state = 'unquoted'
  else if (character === '\\') beingSplit.state = 'doubleQuotedBackslash'
  else addToTheWord(beingSplit, character, 'doubleQuoted')
}

/** After a backslash: a newline continues the line, and any other character is the one it escaped. */
function afterABackslash(beingSplit: ACommandBeingSplit, character: string): void {
  if (character === '\n') {
    beingSplit.state = beingSplit.state === 'backslash' ? 'delimiter' : 'unquoted'
    return
  }
  addToTheWord(beingSplit, character, 'unquoted')
}

/** After a backslash inside double quotes: only `$`, a backtick, a quote and a backslash lose the backslash. */
function afterABackslashInDoubleQuotes(beingSplit: ACommandBeingSplit, character: string): void {
  if (character === '\n') {
    beingSplit.state = 'doubleQuoted'
    return
  }
  if (character === '$' || character === '`' || character === '"' || character === '\\') return addToTheWord(beingSplit, character, 'doubleQuoted')
  addToTheWord(beingSplit, `\\${character}`, 'doubleQuoted')
}

/** In a comment, everything up to the newline that ends it. */
function inAComment(beingSplit: ACommandBeingSplit, character: string): void {
  beingSplit.state = character === '\n' ? 'delimiter' : 'comment'
}

/** One character added to the word being read, the splitter then in `next`. */
function addToTheWord(beingSplit: ACommandBeingSplit, text: string, next: ASplittingState): void {
  beingSplit.word += text
  beingSplit.state = next
}

/** One word finished at whitespace, the splitter back between words. */
function finishTheWord(beingSplit: ACommandBeingSplit): void {
  beingSplit.words.push(beingSplit.word)
  beingSplit.word = ''
  beingSplit.state = 'delimiter'
}

/** The words at the end of the command, or none when a quote or an escape was left open (`ParseError`). */
function theWordsAtTheEnd(beingSplit: ACommandBeingSplit): readonly string[] {
  if (beingSplit.state === 'singleQuoted' || beingSplit.state === 'doubleQuoted') return []
  if (beingSplit.state === 'unquoted') return [...beingSplit.words, beingSplit.word]
  if (beingSplit.state === 'backslash' || beingSplit.state === 'unquotedBackslash') return [...beingSplit.words, `${beingSplit.word}\\`]
  return beingSplit.words
}

/** The three characters shell-words counts as whitespace between words: a tab, a space and a newline. */
function isAWhitespaceOfTheSplitter(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n'
}
