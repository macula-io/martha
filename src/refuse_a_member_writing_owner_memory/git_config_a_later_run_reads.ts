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
// refusal rather than a guess. So is a value a shell computes a path from — a
// variable, a command substitution (martha#192 r=2): the path is not in the file,
// and a rule that cannot read the path refuses rather than passing it.
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
  const computed = whatComputesAPath(entry.value)
  if (computed !== undefined) {
    return {
      kind: 'refused',
      refusal: `${entry.file}:${entry.line} names ${entry.value} as ${entry.key}, which ${computed}: a path worked out when the shell runs is one this guard cannot follow, so a member does not write into that checkout while it stands (martha#192)`,
    }
  }
  const places: ConfigNamedPlace[] = []
  const includes: string[] = []
  for (const candidate of candidatesIn(entry)) {
    const one = oneCandidate(candidate, entry, top, home, host)
    if (one.kind === 'refused') return one
    if (isAnInclude(entry)) includes.push(one.path)
    if (one.inside) places.push({ what: one.path, why: whyTheValueIsRefused(entry) })
  }
  return { kind: 'places', places, includes }
}

/**
 * What a value holds that computes a path at run time, in the guard's words, or
 * undefined when every path it names is written out in it. A variable and a command
 * substitution are answered by a shell when it runs, so the path they name is not in
 * the file the guard reads; refusing is the direction that cannot fail open.
 */
function whatComputesAPath(value: string): string | undefined {
  if (value.includes('$')) return 'holds a variable or a command substitution'
  if (value.includes('`')) return 'holds a command substitution'
  return undefined
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

/** The characters a shell breaks a word at: the quotes, the operators, the redirections, and the spaces. */
const SHELL_BREAK = /[ \t\n\v\f\r'"`;&|()<>]+/

/**
 * The paths one value could name: the value whole as git read it, every word of it,
 * and — for a value git hands to a shell, which an alias writes with a leading `!` —
 * the value and its words without that sign, since git runs what follows it and
 * never the word with the sign on it (measured: `alias.fmt = !tools/x.sh` ran
 * `tools/x.sh`, and never `<top>/!tools/x.sh`).
 *
 * The words are the shell's own, and not a whitespace split: `!sh -c 'tools/x.sh'`
 * runs `tools/x.sh`, so the quotes and the operators are breaks here as they are to
 * a shell (r=2, R3). The value whole keeps the spaces git keeps, so a path that
 * starts with one (`hooksPath = " hk"`) is the folder `<top>/ hk` and not `<top>/hk`.
 */
function candidatesIn(entry: ConfigEntry): string[] {
  const whole = entry.value
  if (whole === '') return []
  const withoutTheSign = whole.startsWith('!') ? whole.slice(1) : whole
  const words = isAnInclude(entry) ? [] : shellWordsIn(withoutTheSign)
  return [...new Set([whole, ...(withoutTheSign === whole ? [] : [withoutTheSign]), ...words])]
}

/** The words a shell would run from a value, its quotes and its operators dropped. */
function shellWordsIn(value: string): string[] {
  return value.split(SHELL_BREAK).filter((word) => word !== '')
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
  if (line === '' || line.startsWith('#') || line.startsWith(';')) return { kind: 'skip', next }
  if (line.startsWith('[')) return headerLine(file, line, number, lines, next)
  if (section === '') return { kind: 'refused', refusal: `${file}:${number} holds a key before any section, which no git run takes as configuration: a member does not write into that checkout while it stands (martha#192)` }
  return entryLine(file, line, section, number, lines, next, undefined)
}

/** A line that opens sections, and the entry git reads on it when anything follows the last one. */
function headerLine(file: string, line: string, number: number, lines: readonly string[], next: number): ALineRead {
  const opened = headersOn(line)
  if (opened === undefined) return { kind: 'refused', refusal: unmodelled(file, number) }
  const section = opened.sections[opened.sections.length - 1]!
  if (opened.rest === '') return { kind: 'section', section, next }
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

