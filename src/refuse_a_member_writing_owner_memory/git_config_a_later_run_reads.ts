// The paths a git configuration names inside the checkout (martha#192).
//
// A later git run of the owner's reads a value and starts, or reads, what it names:
// `core.hooksPath` and a hook's `command` name a program, `alias.<name> = !cmd` a
// shell command, `filter.<name>.clean` a filter, `include.path` a file of more
// config, and `core.attributesFile` a file of attributes. The keys are not what this
// module knows — git adds keys, and a list of them trails git — so every value of
// every key is asked the same question: does one of its words, or the value whole,
// name a path inside the checkout? A word is a shell word, so a path value taken
// whole (`core.hooksPath = "my hooks"`) and a value taken word by word
// (`core.pager = less -R`) are both covered.
//
// Resolution is git's own: a relative value resolves against the top of the work
// tree, except an include path, which resolves against the directory of the file
// that holds it; `~/` expands from the home the guard was given; `%(prefix)` is a
// path this module cannot place without asking git, so a value holding it is a
// refusal rather than a guess. So is a variable or a command substitution with
// nothing written before it (martha#192 r=2, r=3): the path is worked out when the
// shell runs, so it is not in the file, and a rule that cannot read the path refuses
// rather than passing it. One the owner cannot steer is let through: a positional or
// special parameter (`$1`, `$@`, `$$`, …) is the owner's own argument or shell
// state, and the alias `!f() { git checkout "$1"; }; f` is the standard way to write
// an alias that takes one. Anything else the shell works out — another variable, a
// command substitution, a glob, or a brace expansion (r=4: git runs an alias with
// /bin/sh, which is bash on many Linux machines, and `{x,y}` is a name there) —
// protects the folder written before it: a word names one name in a folder, and that
// folder is what a member would have to write into to steer it. A line the outer
// shell hands a second one (`!sh -c '<line>'`) is read by that shell's words too
// (r=4), so a glob, quote or substitution inside it is not text.
//
// The parser models a measured subset of git's syntax — the section and key forms,
// the comments, the continuation, the quoting and the escape set git itself takes —
// and anything else is a refusal. A parser that disagrees with git without saying
// so fails open, which is the one failure this guard cannot have: a config it
// cannot read refuses every write into the checkout, with the file and line named.
//
// It reads bytes through the host contract and never runs git on a directory a
// member chose: asking git about the member's config would be the thing refused.

import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { realOrResolved, type LaunchHost } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'

/** The file name a git directory holds its main configuration in. */
export const CONFIG = 'config'

/** The second configuration file a git directory reads when `extensions.worktreeConfig` is on. */
export const CONFIG_WORKTREE = 'config.worktree'

/** The key that turns the second file on. */
const WORKTREE_CONFIG_KEY = 'extensions.worktreeconfig'

/** The section an include lives in, and the section that includes one under a condition. */
const INCLUDE = 'include'
const INCLUDE_IF = 'includeif'

/** The key both include sections name their target with. */
const INCLUDE_KEY = 'path'

/** A path a config names, and the words that named it. */
export interface ConfigNamedPlace {
  /** The path inside the checkout, as it resolves. */
  readonly what: string
  /** Why it is refused: the key and value that named it, and the file they are in. */
  readonly why: string
}

/** What the configuration of a checkout's git runs came to: the paths it names inside the checkout, or a refusal. */
export interface WhatALaterGitRunReads {
  readonly places: readonly ConfigNamedPlace[]
  /** A config the parser could not read: every write into the checkout is refused while it stands. */
  readonly refusal?: string
}

/** One `key = value` a config file holds, with where it was read. */
export interface ConfigEntry {
  readonly file: string
  /** The line the key stands on, counting from 1. */
  readonly line: number
  /** The key as git reads it: its section and key lowercased, its quoted subsection as spelled. */
  readonly key: string
  /** The value as git reads it: quotes and escapes resolved, a comment removed, the whitespace outside the quotes trimmed and the spaces inside them kept. */
  readonly value: string
}

/** What reading one config file came to. */
export type ConfigRead = { readonly kind: 'entries'; readonly entries: readonly ConfigEntry[] } | { readonly kind: 'refused'; readonly refusal: string }

/**
 * Every path the configuration names inside the checkout at `top`, or the refusal
 * that stands for the whole checkout when a file the reader must read cannot be
 * read as git reads it (martha#192).
 */
export function whatALaterGitRunReads(
  top: string,
  git_dirs: readonly string[],
  owner_config_files: readonly string[],
  home: string,
  hop_cap: number,
  host: LaunchHost,
): WhatALaterGitRunReads {
  const places: ConfigNamedPlace[] = []
  const seen = new Set<string>()
  const reading = { refusal: undefined as string | undefined }

  const files = [...configFilesOf(git_dirs, host), ...owner_config_files]
  for (const file of files) {
    readOne(file, top, home, places, seen, hop_cap, reading, host)
    if (reading.refusal !== undefined) return { places: [], refusal: reading.refusal }
  }
  return { places }
}

/**
 * The configuration files the checkout's git directories are read from, the second
 * file only when git would read it.
 *
 * git reads `config.worktree` from the directory the work tree's own git directory
 * is — the first one here, which for a linked worktree is `<main>/.git/worktrees/<name>`
 * — and decides whether to read it at all from `extensions.worktreeConfig`, which
 * lives in the shared config (r=2, R2). A guard that looked for the extension beside
 * the second file finds no config there in the common case, a member working in a
 * linked worktree, and skips the very file `git config --worktree` writes.
 */
function configFilesOf(git_dirs: readonly string[], host: LaunchHost): string[] {
  const on = git_dirs.some((dir) => worktreeConfigIsOn(join(dir, CONFIG), host))
  return git_dirs.flatMap((dir, at) => (on && at === 0 ? [join(dir, CONFIG), join(dir, CONFIG_WORKTREE)] : [join(dir, CONFIG)]))
}

/**
 * Whether the git directory's config turns `extensions.worktreeConfig` on, read as
 * git reads a boolean: `true`, `yes` and `on` in any case, a key with no value, and
 * any number but zero (r=2, R2). A config this cannot be read from, and a value git
 * itself would refuse as no boolean, are taken as on: the second file is read rather
 * than skipped, which is the safe direction.
 */
function worktreeConfigIsOn(file: string, host: LaunchHost): boolean {
  const read = entriesIn(file, host)
  if (read.kind === 'refused') return true
  return read.entries.some((entry) => entry.key === WORKTREE_CONFIG_KEY && !isAGitFalse(entry.value))
}

/** Whether a value git reads where a boolean is wanted is false, in the forms git accepts as false. */
function isAGitFalse(value: string): boolean {
  const word = value.toLowerCase()
  if (word === 'false' || word === 'no' || word === 'off') return true
  return /^[+-]?\d+$/.test(word) && Number(word) === 0
}

/** One file, its includes followed, its paths and those of every file it chains to collected. */
function readOne(
  file: string,
  top: string,
  home: string,
  places: ConfigNamedPlace[],
  seen: Set<string>,
  hops_left: number,
  reading: { refusal: string | undefined },
  host: LaunchHost,
): void {
  if (reading.refusal !== undefined || seen.has(file)) return
  seen.add(file)
  const read = entriesIn(file, host)
  if (read.kind === 'refused') {
    reading.refusal = read.refusal
    return
  }
  for (const entry of read.entries) {
    if (reading.refusal !== undefined) return
    collectFrom(entry, top, home, places, seen, hops_left, reading, host)
  }
}

/** What one entry adds: its paths, then the files it includes, read as config in their turn. */
function collectFrom(entry: ConfigEntry, top: string, home: string, places: ConfigNamedPlace[], seen: Set<string>, hops_left: number, reading: { refusal: string | undefined }, host: LaunchHost): void {
  const named = placeOfEntry(entry, top, home, host)
  if (named.kind === 'refused') {
    reading.refusal = named.refusal
    return
  }
  if (isAnInclude(entry) && hops_left <= 0) {
    reading.refusal = `${entry.file}:${entry.line} includes ${entry.value}, one hop past the includes this guard follows (the cap the link rule uses), so which paths a later git run of the owner's reads cannot be told: a member does not write into that checkout while it stands (martha#192)`
    return
  }
  places.push(...named.places)
  for (const target of named.includes) readOne(target, top, home, places, seen, hops_left - 1, reading, host)
}

/** Whether the entry is an include, whose value is a path of more config rather than a word of a command. */
function isAnInclude(entry: ConfigEntry): boolean {
  const section = entry.key.slice(0, entry.key.indexOf('.'))
  return (section === INCLUDE || section === INCLUDE_IF) && entry.key.slice(entry.key.lastIndexOf('.') + 1) === INCLUDE_KEY
}

/** What one entry names: the places it names inside the checkout, and the config files it includes. */
function placeOfEntry(entry: ConfigEntry, top: string, home: string, host: LaunchHost): { readonly kind: 'places'; readonly places: readonly ConfigNamedPlace[]; readonly includes: readonly string[] } | { readonly kind: 'refused'; readonly refusal: string } {
  const places: ConfigNamedPlace[] = []
  const includes: string[] = []
  const read = wordsTakenByAShell(withoutTheSignIn(entry.value))
  if (read.kind === 'pastTheCap') return { kind: 'refused', refusal: pastTheCapIn(entry) }
  for (const candidate of candidatesIn(entry, read.words)) {
    const one = oneCandidate(candidate, entry, top, home, host)
    if (one.kind === 'refused') return one
    if (isAnInclude(entry)) includes.push(one.path)
    if (one.inside) places.push({ what: one.path, why: whyTheValueIsRefused(entry) })
  }
  const computed = computedPlacesIn(entry, read.words, top, home, host)
  if (computed.kind === 'refused') return computed
  places.push(...computed.places)
  return { kind: 'places', places, includes }
}

/**
 * The folders a value's shell words work a path out in, and the refusal that stands
 * when nothing is written before one of them (martha#192 r=3, r=4). A word names one
 * name in the folder written before the character the shell resolves, so that folder —
 * and, when the folder holds the checkout rather than standing inside it, the
 * checkout with it — is what a member would have to write into to steer the word.
 * A word with nothing written before it (`$HOME/x`, `$(dirname x)/…`, `*.sh`) names
 * a thing the guard cannot place at all, and refusing every write into that checkout
 * is the direction that cannot fail open.
 *
 * The words are those of every shell the value reaches: the outer one, and each line one
 * shell hands the next (r=4, r=5) — a glob there names its folder as a glob at the outer
 * level does.
 */
function computedPlacesIn(entry: ConfigEntry, words: readonly ShellWord[], top: string, home: string, host: LaunchHost): { readonly kind: 'places'; readonly places: readonly ConfigNamedPlace[] } | { readonly kind: 'refused'; readonly refusal: string } {
  const places: ConfigNamedPlace[] = []
  for (const word of words) {
    if (word.computed === undefined) continue
    const { writtenBefore, what } = word.computed
    if (writtenBefore === '') {
      return {
        kind: 'refused',
        refusal: `${entry.file}:${entry.line} names ${entry.value} as ${entry.key}, which holds ${what} with nothing written before it: a path worked out when the shell runs is one this guard cannot follow, so a member does not write into that checkout while it stands (martha#192)`,
      }
    }
    const folder = resolvedPathOf(folderWrittenBefore(writtenBefore), entry, top, home, host)
    if (reachesTheTree(folder, top)) places.push({ what: folder, why: whyTheValueIsRefused(entry) })
  }
  return { kind: 'places', places }
}

/**
 * The folder a word's literal prefix stands in: a shell works the character out as a
 * name, so a prefix ending in a separator names its own folder (`tools/` is `tools`)
 * and one that does not names a name in the folder that holds it (`tools/x` is
 * `tools`). A prefix with no separator names something in the top of the work tree.
 */
function folderWrittenBefore(prefix: string): string {
  const withoutTrailingSeparators = prefix.replace(/\/+$/, '')
  if (withoutTrailingSeparators !== prefix) return withoutTrailingSeparators
  const cut = prefix.lastIndexOf('/')
  return cut < 0 ? '' : prefix.slice(0, cut)
}

/**
 * Whether a folder is the checkout, stands inside it, or holds it: an expansion in
 * any of the three can name the checkout or something in it (`/$X` names the
 * checkout when the checkout is a name in `/`).
 */
function reachesTheTree(folder: string, top: string): boolean {
  return insideTheTree(folder, top) || insideTheTree(top, folder)
}

/** One word of a value, or the value whole: where it lands, and whether that is inside the checkout. */
function oneCandidate(candidate: string, entry: ConfigEntry, top: string, home: string, host: LaunchHost): { readonly kind: 'path'; readonly path: string; readonly inside: boolean } | { readonly kind: 'refused'; readonly refusal: string } {
  if (candidate.includes('%(prefix)')) {
    return {
      kind: 'refused',
      refusal: `${entry.file}:${entry.line} names ${entry.value} under ${entry.key}, and %(prefix) is a path this guard cannot place without asking git about a directory a member chose: a member does not write into that checkout while it stands (martha#192)`,
    }
  }
  const path = resolvedPathOf(candidate, entry, top, home, host)
  return { kind: 'path', path, inside: insideTheTree(path, top) }
}

/** Why a value's path is refused, in the guard's words: the file and line, and the key and value written there. */
function whyTheValueIsRefused(entry: ConfigEntry): string {
  return `${entry.file}:${entry.line} names ${entry.value} as ${entry.key}, which a later git run of the owner's reads and starts`
}

/**
 * One word of a value as a shell would run it, and the first character in it the
 * shell works out at run time (martha#192 r=3).
 */
interface ShellWord {
  /** The word with its quoted pieces joined: `tools/x''.sh` is the word `tools/x.sh`. */
  readonly text: string
  /** The first thing in it the shell works out, and the text written before that. */
  readonly computed: { readonly writtenBefore: string; readonly what: string } | undefined
}

/** The characters a shell ends a word at, outside quotes: the whitespace and the operators. */
const SHELL_SPACE = /[ \t\n\v\f\r]/
const SHELL_OPERATOR = ';&|()<>'

/** The characters a backslash protects inside double quotes, as POSIX spells them. */
const DOUBLE_QUOTE_ESCAPES = '"\\$`'

/** The characters a shell expands into a name, outside quotes: the globs. */
const SHELL_GLOB = '*?['

/** The characters that quote text for a shell. */
const SHELL_QUOTES = '\'"'

/**
 * How many shells deep one value's words are read (martha#192 r=5). A word handed to
 * `sh -c` is a line a second shell reads, and a word of that line is again a line for
 * a third, so the reading repeats until no new word appears. Past this many readings
 * the guard refuses the whole checkout rather than read a line it cannot vouch for.
 */
export const SHELL_DEPTH_CAP = 8

/**
 * The words a shell would run from a value (martha#192 r=3). A word is not a split on
 * punctuation: a quote joins the text on either side of it into one word
 * (`tools/x''.sh` is `tools/x.sh`, and `'tools/my x.sh'` is one word with a space in
 * it), and only the whitespace and the operators outside quotes end one. Each word
 * also carries the first thing in it the shell works out rather than reads: a
 * variable, a command substitution, or a glob, and the text written before it, which
 * is what a member would have to write into to steer it.
 *
 * A positional or special parameter is not one of those: `$1` .. `$9`, `$@`, `$*`,
 * `$#`, `$?`, `$$`, `$!`, `$-` and `$0` are the owner's own argument or shell state,
 * which a member cannot write (an alias taking `"$1"` is the standard way to spell
 * one, and refusing it refused every write into every checkout). A `$` or a glob
 * inside single quotes is a shell's literal text, not an expansion.
 */
function shellWordsIn(value: string): ShellWord[] {
  const words: ShellWord[] = []
  const word: WordUnderScan = { text: '', computed: undefined, quote: undefined }
  for (let at = 0; at < value.length; at += stepThrough(value, at, word, words)) continue
  finishWord(word, words)
  return words
}

/** A word while it is being read, and the quote the next character is read in. */
interface WordUnderScan {
  text: string
  computed: ShellWord['computed']
  quote: "'" | '"' | undefined
}

/** Read the character at `at` and say how many it took: two when a backslash took the next one as text. */
function stepThrough(value: string, at: number, word: WordUnderScan, words: ShellWord[]): number {
  if (word.quote === "'") return stepInSingleQuotes(value, at, word)
  if (word.quote === '"') return stepInDoubleQuotes(value, at, word)
  return stepOutsideQuotes(value, at, word, words)
}

/** Outside any quote: a space or an operator ends the word, and a quote opens one. */
function stepOutsideQuotes(value: string, at: number, word: WordUnderScan, words: ShellWord[]): number {
  const letter = value.charAt(at)
  if (SHELL_SPACE.test(letter) || SHELL_OPERATOR.includes(letter)) {
    finishWord(word, words)
    return 1
  }
  if (letter === "'" || letter === '"') {
    word.quote = letter
    return 1
  }
  return letter === '\\' ? takeLiteral(value, at, word) : takeLetter(value, at, word)
}

/** In single quotes every character is text: a shell reads no name, substitution or glob there. */
function stepInSingleQuotes(value: string, at: number, word: WordUnderScan): number {
  if (value.charAt(at) === "'") word.quote = undefined
  else word.text += value.charAt(at)
  return 1
}

/** In double quotes: a name and a substitution are still the shell's, and a glob is text. */
function stepInDoubleQuotes(value: string, at: number, word: WordUnderScan): number {
  const letter = value.charAt(at)
  if (letter === '"') {
    word.quote = undefined
    return 1
  }
  if (letter === '\\' && DOUBLE_QUOTE_ESCAPES.includes(value.charAt(at + 1))) return takeLiteral(value, at, word)
  return takeLetter(value, at, word)
}

/**
 * One character as a shell hands it on, and how many it took: the names and
 * substitutions it works out are recorded first, and a whole parameter is taken at
 * once, so the `*` of `$*` is never read as a glob of its own.
 */
function takeLetter(value: string, at: number, word: WordUnderScan): number {
  if (worksOutAt(value, at)) recordComputation(value, at, word)
  const parameter = value.charAt(at) === '$' ? ownerParameterAt(value, at) : 0
  if (parameter === 0) {
    word.text += value.charAt(at)
    return 1
  }
  word.text += value.slice(at, at + parameter)
  return parameter
}

/** A backslash and the character it protects, taken as text: two characters read. */
function takeLiteral(value: string, at: number, word: WordUnderScan): number {
  word.text += value.charAt(at + 1)
  return 2
}

/** Whether a shell works a name out at this character rather than reading it: a substitution, a variable, a glob or a brace expansion. */
function worksOutAt(value: string, at: number): boolean {
  const letter = value.charAt(at)
  if (letter === '`') return true
  if (letter === '$') return ownerParameterAt(value, at) === 0
  if (letter === '{') return beginsABraceExpansion(value, at)
  return SHELL_GLOB.includes(letter)
}

/**
 * Whether a `{` starts a brace expansion in the word it stands in (martha#192 r=4). git runs
 * an alias with `/bin/sh`, which is bash on this machine and on many Linux machines, and
 * bash expands `{x,y}` and `{a..c}` into a name while any other brace is text — the `{`
 * that opens an alias's function body is one of those, so it names nothing.
 *
 * The word is bash's own: a space or an operator ends it, outside quotes, and a quote keeps
 * what stands between them (`{"my x",y}` is one word). A `}` after it holds a comma or a
 * range, and it is the closing brace of the expansion only when what stands between holds
 * one of those; `{x}` and `{}` are text.
 */
function beginsABraceExpansion(value: string, at: number): boolean {
  let quote: string | undefined
  for (let step = at + 1; step < value.length; step += 1) {
    const letter = value.charAt(step)
    if (quote !== undefined) {
      quote = letter === quote ? undefined : quote
      continue
    }
    if (SHELL_QUOTES.includes(letter)) quote = letter
    else if (letter === '}') return holdsABraceList(value.slice(at + 1, step))
    else if (SHELL_SPACE.test(letter) || SHELL_OPERATOR.includes(letter)) return false
  }
  return false
}

/** Whether the text between a brace expansion's braces is a list (`x,y`) or a range (`a..c`). */
function holdsABraceList(inside: string): boolean {
  return inside.includes(',') || inside.includes('..')
}

/** The first thing a word works out, and everything written before it in that word. */
function recordComputation(value: string, at: number, word: WordUnderScan): void {
  if (word.computed !== undefined) return
  word.computed = { writtenBefore: word.text, what: computedTokenAt(value, at) }
}

/** End the word being read, and start the next one. */
function finishWord(word: WordUnderScan, words: ShellWord[]): void {
  if (word.text !== '') words.push({ text: word.text, computed: word.computed })
  word.text = ''
  word.computed = undefined
}

/**
 * How many characters a `$` at `at` takes when it names the owner's own argument or
 * shell state, and 0 when it names something else the shell works out.
 */
function ownerParameterAt(value: string, at: number): number {
  const next = value[at + 1]
  if (next === undefined) return 0
  if ('0123456789@*#?$!-'.includes(next)) return 2
  const close = value.indexOf('}', at + 2)
  if (next !== '{' || close < 0) return 0
  return /^[0-9]+$/.test(value.slice(at + 2, close)) ? close - at + 1 : 0
}

/** The name or substitution a character the shell works out at `at` starts, as the value spells it. */
function computedTokenAt(value: string, at: number): string {
  if (value.charAt(at) === '`') return upToClosingBacktick(value, at)
  if (value.charAt(at) === '$') return dollarTokenAt(value, at)
  return value.slice(at)
}

/** A `$` and what it names: a command substitution, a bracketed name, or a bare one. */
function dollarTokenAt(value: string, at: number): string {
  if (value.charAt(at + 1) === '(') return upToMatchingParen(value, at)
  if (value.charAt(at + 1) === '{') return upToClosingBracket(value, at + 2, '}')
  let end = at + 1
  while (end < value.length && /[A-Za-z0-9_]/.test(value.charAt(end))) end += 1
  return value.slice(at, end)
}

/** A substitution from its backtick to the one that closes it. */
function upToClosingBacktick(value: string, at: number): string {
  return upToClosingBracket(value, at + 1, '`')
}

/** The text from `at` to the first `close` after it, or to the end when there is none. */
function upToClosingBracket(value: string, from: number, close: string): string {
  const end = value.indexOf(close, from)
  return end < 0 ? value.slice(from - 1) : value.slice(from - 1, end + 1)
}

/** A command substitution from its `$` to the bracket that closes it, counting the ones inside it. */
function upToMatchingParen(value: string, at: number): string {
  let depth = 0
  for (let step = at + 1; step < value.length; step += 1) {
    if (value[step] === '(') depth += 1
    if (value[step] !== ')') continue
    depth -= 1
    if (depth === 0) return value.slice(at, step + 1)
  }
  return value.slice(at)
}

/**
 * The words every shell a value reaches would run from it (martha#192 r=4, r=5): the
 * outer shell's words, and each word read again as a line a shell hands another one.
 * What runs is sometimes a word the shell splits again — `sh -c 'sh tools/*.sh'` hands
 * `sh` a line of its own words, and `tools/*.sh` is what the second shell expands — so
 * both readings are taken, and the second is the tokenizer's own with its quotes
 * joining and its globs, variables and substitutions marking the folder written before
 * them. A line can hide the next one the same way (`sh -c "sh -c 'sh tools/*.sh'"`), so
 * the reading repeats until no new word appears, and `SHELL_DEPTH_CAP` bounds how many
 * times: a value that outlasts it is one whose next shell the guard cannot vouch for,
 * and `pastTheCap` says so rather than stopping short. A rule that names too much
 * refuses too much, which is the direction this guard takes; one that names too little
 * fails open.
 *
 * A word is new when its whole self is new, and not when its text is (r=6): a text a
 * shell reads literally is a glob to the next one, so `sh -c 'tools/*.sh'` is two words
 * — the quoted literal, which computes nothing, and the shell's own, which writes its
 * name in `tools/`. Remembered by its text alone, the second would be dropped as the
 * first, and the folder it names would go unprotected.
 */
function wordsTakenByAShell(value: string): WordsAValueIsReadAs {
  const words = new Map<string, ShellWord>()
  let fresh = shellWordsIn(value)
  for (let depth = 0; fresh.length > 0; depth += 1) {
    if (depth >= SHELL_DEPTH_CAP) return { kind: 'pastTheCap' }
    for (const word of fresh) words.set(wholeOf(word), word)
    fresh = fresh.flatMap((word) => shellWordsIn(word.text)).filter((word) => !words.has(wholeOf(word)))
  }
  return { kind: 'words', words: [...words.values()] }
}

/** A word as the reading remembers it: what it says and what its shell works out of it, which is what makes it that word. */
function wholeOf(word: ShellWord): string {
  return JSON.stringify([word.text, word.computed?.writtenBefore ?? null, word.computed?.what ?? null])
}

/** What reading a value through the shells it reaches came to: every word it runs, or the cap run out. */
type WordsAValueIsReadAs = { readonly kind: 'words'; readonly words: readonly ShellWord[] } | { readonly kind: 'pastTheCap' }

/** The refusal for a value nested deeper than the shells this guard reads through (martha#192 r=5). */
function pastTheCapIn(entry: ConfigEntry): string {
  return `${entry.file}:${entry.line} names ${entry.value} as ${entry.key}, one shell past the ${SHELL_DEPTH_CAP} shells a value is read through, so what the next one runs cannot be told: a member does not write into that checkout while it stands (martha#192)`
}

/**
 * The paths one value could name: the value whole as git read it, every word of it,
 * and — for a value git hands to a shell, which an alias writes with a leading `!` —
 * the value and its words without that sign, since git runs what follows it and
 * never the word with the sign on it (measured: `alias.fmt = !tools/x.sh` ran
 * `tools/x.sh`, and never `<top>/!tools/x.sh`).
 *
 * The words are the shell's own, and not a whitespace split: `!sh -c 'tools/x.sh'`
 * runs `tools/x.sh`, so the quotes join and the operators end a word as they do for
 * a shell (r=2, R3; a quoted piece joins the text on either side of it, r=3). The
 * value whole keeps the spaces git keeps, so a path that starts with one
 * (`hooksPath = " hk"`) is the folder `<top>/ hk` and not `<top>/hk`.
 *
 * A word is also taken as the line a second shell would read it as, and that line's
 * words as a third's (r=4, r=5): `sh -c 'sh tools/h.sh --fix'` hands `sh` a line of
 * its own words, and `tools/h.sh` is what runs, however that line spells it — a glob,
 * a quote or a substitution there is the shell's that reads it, not text. The words
 * come from the caller, which has already read the value through every shell it
 * reaches and refused it when it outlasts `SHELL_DEPTH_CAP`.
 */
function candidatesIn(entry: ConfigEntry, words: readonly ShellWord[]): string[] {
  const whole = entry.value
  if (whole === '') return []
  const withoutTheSign = withoutTheSignIn(whole)
  const named = isAnInclude(entry) ? [] : words.map((word) => word.text)
  return [...new Set([whole, ...(withoutTheSign === whole ? [] : [withoutTheSign]), ...named])]
}

/** A value git hands to a shell, which an alias writes with a leading `!`, and the words without that sign. */
function withoutTheSignIn(value: string): string {
  return value.startsWith('!') ? value.slice(1) : value
}

/** `~/x` as the home the guard was given, and anything else as it stands. */
function expandHome(value: string, home: string): string {
  if (value === '~') return home
  return value.startsWith(`~${sep}`) || value.startsWith('~/') ? join(home, value.slice(2)) : value
}

/**
 * Where one word of a value lands: an absolute word as it stands, an include path
 * against the directory of the file that holds it, and every other word against the
 * top of the work tree, which is where a later git run of the owner's starts it.
 *
 * The answer is here as the write guard compares it — every link resolved through
 * the nearest directory that exists (martha#79). The top it is compared with is
 * already resolved that way, so a value spelled through a link to the checkout
 * (`/tmp -> /private/tmp`, or a link the owner made) would otherwise miss it.
 */
function resolvedPathOf(candidate: string, entry: ConfigEntry, top: string, home: string, host: LaunchHost): string {
  const expanded = expandHome(candidate, home)
  if (isAbsolute(expanded)) return realOrResolved(host, resolve(expanded))
  return realOrResolved(host, resolve(isAnInclude(entry) ? dirname(entry.file) : top, expanded))
}

/** Whether a path is the checkout's top or below it, with the top's own links resolved by the caller. */
function insideTheTree(path: string, top: string): boolean {
  if (path === top) return true
  return path.startsWith(top.endsWith(sep) ? top : `${top}${sep}`)
}

/** Whether a line, or what is left of one, is a comment: the two characters git reads one from. */
function isAComment(text: string): boolean {
  return text.startsWith('#') || text.startsWith(';')
}

/** The git configuration syntax this guard models, and everything it does not. */
const SECTION = /^\[\s*([A-Za-z0-9.-]+)\s*\]/
const SECTION_WITH_QUOTED = /^\[\s*([A-Za-z0-9-]+)\s+"([^"\\]*)"\s*\]/
const KEY = /^[A-Za-z][A-Za-z0-9-]*$/
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', b: '\b', '"': '"', '\\': '\\' }

/** The whitespace git itself takes as space (C's isspace), and never the other spaces JavaScript's `trim` also drops. */
const GIT_SPACE = ' \t\n\v\f\r'

/** Whether a letter is one of git's own spaces (`isspace` in the C locale, which a value's whitespace is trimmed by). */
function isGitSpace(letter: string): boolean {
  return GIT_SPACE.includes(letter)
}

/**
 * The entries one config file holds, read as git reads them, or the refusal that
 * stands for every write into the checkout when it holds a form this does not model
 * (martha#192). A file that is not there holds nothing.
 */
export function entriesIn(file: string, host: LaunchHost): ConfigRead {
  let bytes: Buffer
  try {
    const kind = host.stores.files.kindOf(file).kind
    if (kind === 'absent') return { kind: 'entries', entries: [] }
    bytes = Buffer.from(host.stores.files.bytesOf(file))
  } catch {
    return { kind: 'refused', refusal: `${file} cannot be read, so which paths a later git run of the owner's takes from it cannot be told: a member does not write into that checkout while it stands (martha#192)` }
  }
  return entriesInText(file, bytes.toString('utf8'))
}

/**
 * The entries a config text holds, or the refusal naming the line this does not
 * model. The lines are git's own: a blank line and a comment are skipped whole, and
 * a backslash continues a value alone — a comment continues nothing, and the key on
 * the line after it is git's to read (martha#192).
 */
export function entriesInText(file: string, text: string): ConfigRead {
  const entries: ConfigEntry[] = []
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''))
  let section = ''
  let at = 0
  while (at < lines.length) {
    const read = lineAt(file, lines, at, section)
    if (read.kind === 'refused') return read
    if (read.kind === 'section') section = read.section
    if (read.kind === 'entry') {
      entries.push(read.entry)
      section = read.opened ?? section
    }
    at = read.next
  }
  return { kind: 'entries', entries }
}

/** One line of a config: a section header, an entry, a line to skip, or the refusal, and where reading goes next. */
type ALineRead =
  | { readonly kind: 'section'; readonly section: string; readonly next: number }
  | { readonly kind: 'entry'; readonly entry: ConfigEntry; readonly next: number; readonly opened: string | undefined }
  | { readonly kind: 'skip'; readonly next: number }
  | { readonly kind: 'refused'; readonly refusal: string }

/** What one line of a config holds, and where the line after it is. */
function lineAt(file: string, lines: readonly string[], at: number, section: string): ALineRead {
  const number = at + 1
  const line = withoutLeadingSpace(lines[at]!)
  const next = at + 1
  if (line === '' || isAComment(line)) return { kind: 'skip', next }
  if (line.startsWith('[')) return headerLine(file, line, number, lines, next)
  if (section === '') return { kind: 'refused', refusal: `${file}:${number} holds a key before any section, which no git run takes as configuration: a member does not write into that checkout while it stands (martha#192)` }
  return entryLine(file, line, section, number, lines, next, undefined)
}

/** A line that opens sections, and the entry git reads on it when anything follows the last one. */
function headerLine(file: string, line: string, number: number, lines: readonly string[], next: number): ALineRead {
  const opened = headersOn(line)
  if (opened === undefined) return { kind: 'refused', refusal: unmodelled(file, number) }
  const section = opened.sections[opened.sections.length - 1]!
  if (opened.rest === '' || isAComment(opened.rest)) return { kind: 'section', section, next }
  return entryLine(file, opened.rest, section, number, lines, next, section)
}

/** A key and its value, read from the text after a section's name whether it stands on its own line or the header's, and the section the line opened. */
function entryLine(file: string, text: string, section: string, number: number, lines: readonly string[], next: number, opened: string | undefined): ALineRead {
  const split = keyAndValue(text)
  if (!KEY.test(split.key)) return { kind: 'refused', refusal: unmodelled(file, number) }
  const value = valueFrom(split.value, lines, next)
  if (value.kind === 'refused') return { kind: 'refused', refusal: `${file}:${number} ${value.refusal}: a member does not write into that checkout while it stands (martha#192)` }
  return { kind: 'entry', entry: { file, line: number, key: `${section}.${split.key.toLowerCase()}`, value: value.text }, next: next + value.taken, opened }
}

/** The line with git's leading whitespace dropped, and everything after it kept as written. */
function withoutLeadingSpace(line: string): string {
  let at = 0
  while (at < line.length && isGitSpace(line[at]!)) at += 1
  return line.slice(at)
}

/** The line a refusal is about, in the guard's words. */
function unmodelled(file: string, at: number): string {
  return `${file}:${at} holds a form this guard does not model as git configuration, so which paths a later git run of the owner's takes from it cannot be told: a member does not write into that checkout while it stands (martha#192)`
}

/** A section header's key, and the text after it on the same line, or undefined when the line opens no header. */
function headerOf(line: string): { readonly section: string; readonly rest: string } | undefined {
  const quoted = SECTION_WITH_QUOTED.exec(line)
  if (quoted !== null) return { section: `${quoted[1]!.toLowerCase()}.${quoted[2]!}`, rest: line.slice(quoted[0].length) }
  const plain = SECTION.exec(line)
  if (plain === null) return undefined
  const name = plain[1]!
  // An old-style subsection is part of the name and is lowercased with it; a
  // subsection quoted after the name keeps its case, and is the branch above.
  return { section: name.toLowerCase(), rest: line.slice(plain[0].length) }
}

/**
 * The sections a line opens, and what follows them: a `[name]` header is a whole
 * line to this guard, but git reads what follows one as configuration too, so
 * `[core] hooksPath = .hk` is the entry `core.hooksPath = .hk` (measured on
 * git 2.56.0), and `[core] [alias]` opens `alias`.
 */
function headersOn(line: string): { readonly sections: readonly string[]; readonly rest: string } | undefined {
  const sections: string[] = []
  let rest = withoutLeadingSpace(line)
  while (rest.startsWith('[')) {
    const header = headerOf(rest)
    if (header === undefined) return undefined
    sections.push(header.section)
    rest = withoutLeadingSpace(header.rest)
  }
  return { sections, rest }
}

/** A key line split at its first `=`, or the key alone when it has none. */
function keyAndValue(line: string): { readonly key: string; readonly value: string } {
  const at = line.indexOf('=')
  if (at === -1) return { key: line, value: '' }
  return { key: line.slice(0, at).trim(), value: line.slice(at + 1) }
}

/** Where the reading of a value is up to: what it has, the whitespace waiting for a letter after it, and git's own three states. */
interface ValueState {
  readonly text: string
  readonly pending: string
  readonly quoted: boolean
  readonly comment: boolean
  readonly continuing: boolean
}

/** What reading a value came to: the letters git keeps, and how many of the following lines it took. */
type AValueRead = { readonly kind: 'text'; readonly text: string; readonly taken: number } | { readonly kind: 'refused'; readonly refusal: string }

/**
 * git's own reading of a value (`parse_value`, git 2.56.0): the double quotes
 * resolved, the escapes expanded, a comment ended, the whitespace outside the quotes
 * trimmed and every letter inside them kept — a space a quote holds is part of the
 * path (`hooksPath = " hk"` is the folder ` hk`, measured), and a character
 * JavaScript's `trim` also drops (a non-breaking space) is not whitespace to git.
 *
 * A backslash at the end of a line continues the value onto the next one, whether or
 * not a quote is open; a comment continues nothing, so the key below a comment
 * ending in a backslash is git's to read. Every letter beyond that is kept as
 * written, so the value judged here is the string git hands where it runs one.
 */
function valueFrom(first: string, lines: readonly string[], after: number): AValueRead {
  let state: ValueState = { text: '', pending: '', quoted: false, comment: false, continuing: false }
  let piece = first
  let column = 0
  let taken = 0
  for (;;) {
    const outcome = nextOutcome(state, piece, column, taken, lines, after)
    if (outcome.kind !== 'read-on') return outcome
    state = outcome.state
    piece = outcome.piece
    column = outcome.column
    taken = outcome.taken
  }
}

/** What reading a value came to next: the refusal, the value ended, or where the reading stands one letter on. */
type ANextRead =
  | { readonly kind: 'refused'; readonly refusal: string }
  | { readonly kind: 'text'; readonly text: string; readonly taken: number }
  | { readonly kind: 'read-on'; readonly state: ValueState; readonly piece: string; readonly column: number; readonly taken: number }

/** The next thing in a value: a letter at this position, or the end of the line it is on. */
function nextOutcome(state: ValueState, piece: string, column: number, taken: number, lines: readonly string[], after: number): ANextRead {
  if (column >= piece.length) return afterTheLine(state, taken, lines[after + taken])
  const stepped = afterTheLetter(state, piece, column)
  if ('refusal' in stepped) return { kind: 'refused', refusal: stepped.refusal }
  return { kind: 'read-on', state: stepped.state, piece, column: stepped.column, taken }
}

/** What the end of a value's line does: continue onto the line after it, end the value, or the refusal. */
function afterTheLine(state: ValueState, taken: number, next: string | undefined): ANextRead {
  const ended = lineEnded(state, next)
  if (ended.kind === 'refused') return { kind: 'refused', refusal: ended.refusal }
  if (ended.kind === 'done') return { kind: 'text', text: state.text, taken }
  return { kind: 'read-on', state: ended.state, piece: ended.piece, column: 0, taken: taken + 1 }
}

/** Where the reading stands after the letter at `column`, or the refusal for an escape git itself refuses. */
function afterTheLetter(state: ValueState, piece: string, column: number): { readonly state: ValueState; readonly column: number } | { readonly refusal: string } {
  const step = letterTaken(state, piece[column]!, column + 1 < piece.length ? piece[column + 1] : undefined)
  if ('refusal' in step) return step
  return { state: step.state, column: column + 1 + step.consumed }
}

/** What one letter did: the state after it, and how many letters after it it took with it. */
interface AStep {
  readonly state: ValueState
  readonly consumed: number
}

/**
 * What one letter of a value does: the state after it and the letters after it it
 * took with it, or the refusal for an escape git itself refuses.
 */
function letterTaken(state: ValueState, letter: string, next: string | undefined): AStep | { readonly refusal: string } {
  if (state.comment) return { state, consumed: 0 }
  if (state.quoted) return kept(state, letter, next)
  if (isGitSpace(letter)) return { state: { ...state, pending: state.text === '' ? '' : `${state.pending}${letter}` }, consumed: 0 }
  if (letter === '#' || letter === ';') return { state: { ...state, comment: true }, consumed: 0 }
  return kept(state, letter, next)
}

/** A letter git keeps as written, or the two that are not: a quote, and an escape. */
function kept(state: ValueState, letter: string, next: string | undefined): AStep | { readonly refusal: string } {
  if (letter === '"') return { state: { ...state, quoted: !state.quoted }, consumed: 0 }
  if (letter !== '\\') return { state: { ...state, text: `${state.text}${state.pending}${letter}`, pending: '' }, consumed: 0 }
  // git empties its waiting whitespace before it reads an escape, so `hooksPath = hk \`
  // is the folder `hk ` and not `hk` (measured at a continuation, and at the end of a
  // file): the space is before the backslash and belongs to the value.
  const flushed = { ...state, text: `${state.text}${state.pending}`, pending: '' }
  return next === undefined ? { state: { ...flushed, continuing: true }, consumed: 0 } : escapeTaken(flushed, next)
}

/** `\x` as git resolves it, with the whitespace before it kept, or the refusal for an escape git itself refuses. */
function escapeTaken(state: ValueState, next: string): AStep | { readonly refusal: string } {
  const resolved = ESCAPES[next]
  if (resolved === undefined) return { refusal: `holds the escape \\${next}, which git itself refuses` }
  return { state: { ...state, text: `${state.text}${state.pending}${resolved}`, pending: '' }, consumed: 1 }
}

/**
 * What the end of a line does: continue onto the line after it, end the value, or
 * the refusal for a quote git itself refuses to leave open at a line's end.
 */
function lineEnded(state: ValueState, next: string | undefined): { readonly kind: 'refused'; readonly refusal: string } | { readonly kind: 'done' } | { readonly kind: 'continue'; readonly state: ValueState; readonly piece: string } {
  if (state.continuing) return next === undefined ? { kind: 'done' } : { kind: 'continue', state: { ...state, continuing: false }, piece: next }
  if (state.quoted) return { kind: 'refused', refusal: 'holds an unterminated quote, which git itself refuses' }
  return { kind: 'done' }
}

