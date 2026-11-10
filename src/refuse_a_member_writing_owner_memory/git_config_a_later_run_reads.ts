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
// refusal rather than a guess.
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

import type { LaunchHost } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'

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
  /** The value as git reads it: quotes and escapes resolved, a comment removed, both ends trimmed. */
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

  const files = [...git_dirs.flatMap((dir) => configFilesIn(dir, host)), ...owner_config_files]
  for (const file of files) {
    readOne(file, top, home, places, seen, hop_cap, reading, host)
    if (reading.refusal !== undefined) return { places: [], refusal: reading.refusal }
  }
  return { places }
}

/** The configuration files one git directory is read from, the second only when git would read it. */
function configFilesIn(git_dir: string, host: LaunchHost): string[] {
  const main = join(git_dir, CONFIG)
  return worktreeConfigIsOn(main, host) ? [main, join(git_dir, CONFIG_WORKTREE)] : [main]
}

/**
 * Whether the git directory's config turns `extensions.worktreeConfig` on. A config
 * this cannot be read from is taken as on, so the second file is read rather than
 * skipped: refusing more is the safe direction.
 */
function worktreeConfigIsOn(file: string, host: LaunchHost): boolean {
  const read = entriesIn(file, host)
  if (read.kind === 'refused') return true
  return read.entries.some((entry) => entry.key === WORKTREE_CONFIG_KEY && entry.value.trim().toLowerCase() === 'true')
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
  const named = placeOfEntry(entry, top, home)
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
function placeOfEntry(entry: ConfigEntry, top: string, home: string): { readonly kind: 'places'; readonly places: readonly ConfigNamedPlace[]; readonly includes: readonly string[] } | { readonly kind: 'refused'; readonly refusal: string } {
  const places: ConfigNamedPlace[] = []
  const includes: string[] = []
  for (const candidate of candidatesIn(entry)) {
    const one = oneCandidate(candidate, entry, top, home)
    if (one.kind === 'refused') return one
    if (isAnInclude(entry)) includes.push(one.path)
    if (one.inside) places.push({ what: one.path, why: whyTheValueIsRefused(entry) })
  }
  return { kind: 'places', places, includes }
}

/** One word of a value, or the value whole: where it lands, and whether that is inside the checkout. */
function oneCandidate(candidate: string, entry: ConfigEntry, top: string, home: string): { readonly kind: 'path'; readonly path: string; readonly inside: boolean } | { readonly kind: 'refused'; readonly refusal: string } {
  if (candidate.includes('%(prefix)')) {
    return {
      kind: 'refused',
      refusal: `${entry.file}:${entry.line} names ${entry.value} under ${entry.key}, and %(prefix) is a path this guard cannot place without asking git about a directory a member chose: a member does not write into that checkout while it stands (martha#192)`,
    }
  }
  const path = resolvedPathOf(candidate, entry, top, home)
  return { kind: 'path', path, inside: insideTheTree(path, top) }
}

/** Why a value's path is refused, in the guard's words: the file and line, and the key and value written there. */
function whyTheValueIsRefused(entry: ConfigEntry): string {
  return `${entry.file}:${entry.line} names ${entry.value} as ${entry.key}, which a later git run of the owner's reads and starts`
}

/**
 * The paths one value could name: the whole value, every word of it, and — for a
 * value git hands to a shell, which an alias writes with a leading `!` — the whole
 * value and its words without that sign, since git runs what follows it and never
 * the word with the sign on it (measured: `alias.fmt = !tools/x.sh` ran
 * `tools/x.sh`, and never `<top>/!tools/x.sh`).
 */
function candidatesIn(entry: ConfigEntry): string[] {
  const whole = entry.value.trim()
  if (whole === '') return []
  const withoutTheSign = whole.startsWith('!') ? whole.slice(1).trim() : whole
  const words = isAnInclude(entry) ? [] : [withoutTheSign, ...withoutTheSign.split(/\s+/)].filter((word) => word !== '')
  return [...new Set([whole, ...(withoutTheSign === whole ? [] : [withoutTheSign]), ...words])]
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
 */
function resolvedPathOf(candidate: string, entry: ConfigEntry, top: string, home: string): string {
  const expanded = expandHome(candidate, home)
  if (isAbsolute(expanded)) return resolve(expanded)
  return resolve(isAnInclude(entry) ? dirname(entry.file) : top, expanded)
}

/** Whether a path is the checkout's top or below it, with the top's own links resolved by the caller. */
function insideTheTree(path: string, top: string): boolean {
  if (path === top) return true
  return path.startsWith(top.endsWith(sep) ? top : `${top}${sep}`)
}

/** The git configuration syntax this guard models, and everything it does not. */
const SECTION = /^\[\s*([A-Za-z0-9.-]+)\s*\]$/
const SECTION_WITH_QUOTED = /^\[\s*([A-Za-z0-9-]+)\s+"([^"\\]*)"\s*\]$/
const KEY = /^[A-Za-z][A-Za-z0-9-]*$/
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', b: '\b', '"': '"', '\\': '\\' }

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

/** The entries a config text holds, or the refusal naming the line this does not model. */
export function entriesInText(file: string, text: string): ConfigRead {
  const entries: ConfigEntry[] = []
  let section = ''
  for (const { line, at } of continued(text)) {
    const read = entryOfLine(file, at, line, section)
    if (read.kind === 'refused') return read
    if (read.kind === 'section') section = read.section
    if (read.kind === 'entry') entries.push(read.entry)
  }
  return { kind: 'entries', entries }
}

/** What one line of a config holds: a section header, an entry, a line to skip, or the refusal. */
function entryOfLine(file: string, at: number, line: string, section: string): { readonly kind: 'section'; readonly section: string } | { readonly kind: 'entry'; readonly entry: ConfigEntry } | { readonly kind: 'skip' } | { readonly kind: 'refused'; readonly refusal: string } {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith(';')) return { kind: 'skip' }
  if (trimmed.startsWith('[')) {
    const named = sectionOf(trimmed)
    return named === undefined ? { kind: 'refused', refusal: unmodelled(file, at) } : { kind: 'section', section: named }
  }
  if (section === '') return { kind: 'refused', refusal: `${file}:${at} holds a key before any section, which no git run takes as configuration: a member does not write into that checkout while it stands (martha#192)` }
  const split = keyAndValue(trimmed)
  if (!KEY.test(split.key)) return { kind: 'refused', refusal: unmodelled(file, at) }
  const value = valueOf(split.value)
  if (value.kind === 'refused') return { kind: 'refused', refusal: `${file}:${at} ${value.refusal}: a member does not write into that checkout while it stands (martha#192)` }
  return { kind: 'entry', entry: { file, line: at, key: `${section}.${split.key.toLowerCase()}`, value: value.text } }
}

/** The line a refusal is about, in the guard's words. */
function unmodelled(file: string, at: number): string {
  return `${file}:${at} holds a form this guard does not model as git configuration, so which paths a later git run of the owner's takes from it cannot be told: a member does not write into that checkout while it stands (martha#192)`
}

/** A section header's key: its name lowercased, and a subsection spelled as git keeps it. */
function sectionOf(line: string): string | undefined {
  const quoted = SECTION_WITH_QUOTED.exec(line)
  if (quoted !== null) return `${quoted[1]!.toLowerCase()}.${quoted[2]!}`
  const plain = SECTION.exec(line)
  if (plain === null) return undefined
  const name = plain[1]!
  const dot = name.indexOf('.')
  // An old-style subsection is part of the name and is lowercased with it; a
  // subsection quoted after the name keeps its case, and is the branch above.
  return dot === -1 ? name.toLowerCase() : `${name.slice(0, dot).toLowerCase()}.${name.slice(dot + 1)}`
}

/** A key line split at its first `=`, or the key alone when it has none. */
function keyAndValue(line: string): { readonly key: string; readonly value: string } {
  const at = line.indexOf('=')
  if (at === -1) return { key: line, value: '' }
  return { key: line.slice(0, at).trim(), value: line.slice(at + 1) }
}

/** git's own reading of a value: quotes, escapes and comments resolved, both ends trimmed, or the refusal. */
function valueOf(raw: string): { readonly kind: 'text'; readonly text: string } | { readonly kind: 'refused'; readonly refusal: string } {
  let text = ''
  let quoted = false
  for (let at = 0; at < raw.length; at += 1) {
    const step = stepOf(raw, at, quoted)
    if (step.kind === 'refused') return step
    text += step.text
    quoted = step.quoted
    at += step.consumed
  }
  return quoted ? { kind: 'refused', refusal: 'holds an unterminated quote, which git itself refuses' } : { kind: 'text', text: text.trim() }
}

/** One letter of a value: what it adds, whether a quote is open, and how many letters after it it consumed. */
function stepOf(raw: string, at: number, quoted: boolean): { readonly kind: 'text'; readonly text: string; readonly quoted: boolean; readonly consumed: number } | { readonly kind: 'refused'; readonly refusal: string } {
  const letter = raw[at]!
  if (letter === '\\') return escapeAt(raw, at, quoted)
  if (letter === '"') return { kind: 'text', text: '', quoted: !quoted, consumed: 0 }
  const endsTheValue = !quoted && (letter === '#' || letter === ';')
  return { kind: 'text', text: endsTheValue ? '' : letter, quoted, consumed: 0 }
}

/** `\x` as git resolves it, or the refusal for an escape git itself refuses. */
function escapeAt(raw: string, at: number, quoted: boolean): { readonly kind: 'text'; readonly text: string; readonly quoted: boolean; readonly consumed: number } | { readonly kind: 'refused'; readonly refusal: string } {
  const next = raw[at + 1]
  const resolved = next === undefined ? undefined : ESCAPES[next]
  if (resolved === undefined) return { kind: 'refused', refusal: `holds the escape \\${next ?? ''}, which git itself refuses` }
  return { kind: 'text', text: resolved, quoted, consumed: 1 }
}

/**
 * The text with its continuation lines joined, each carrying the line number it
 * started on: git drops a trailing backslash and the newline after it, and keeps
 * what follows as it stands (martha#192).
 */
function continued(text: string): readonly { readonly line: string; readonly at: number }[] {
  const raw = text.split('\n').map((line) => line.replace(/\r$/, ''))
  const lines: { line: string; at: number }[] = []
  for (let at = 0; at < raw.length; at += 1) {
    const startedAt = at + 1
    const joined = joinedFrom(raw, at)
    at = joined.at
    lines.push({ line: joined.line, at: startedAt })
  }
  return lines
}

/** A line with every line it continues onto joined, and where reading carries on from. */
function joinedFrom(raw: readonly string[], from: number): { readonly line: string; readonly at: number } {
  let at = from
  let line = raw[at]!
  while (endsInABackslash(line) && at + 1 < raw.length) {
    at += 1
    line = `${line.slice(0, -1)}${raw[at]!}`
  }
  return { line: endsInABackslash(line) ? line.slice(0, -1) : line, at }
}

/** Whether the line continues onto the next one: a backslash that is not itself escaped. */
function endsInABackslash(line: string): boolean {
  let count = 0
  for (let at = line.length - 1; at >= 0 && line[at] === '\\'; at -= 1) count += 1
  return count % 2 === 1
}
