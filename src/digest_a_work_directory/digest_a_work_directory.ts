// The digest a handoff of work outside git names (martha#985, gap 20 of #957): `martha digest <dir>` prints
// `<dir>@sha256:<hex>` over a manifest of every regular file under `<dir>`.
//
// This exists because a package whose work is not in git — a plan, a recording, a directory of notes — has no sha to
// name it by, and its builder and its reviewer must be able to say they hold the same bytes. The manifest is the one
// crew-code's `bin/crew digest` computes, byte for byte, so a handoff line written by either program names the same
// value: each file's `<mode> <path>` line sorted in byte order of that line, then each file's `<sha256>  <path>` in
// byte order of the path, joined by `--`, and sha256'd whole.
//
// What it refuses, and why. A symlink is refused by name rather than followed or skipped: a digest that left out what
// a link points at would not change when that target did. A name with whitespace is refused, since the handoff line
// could not carry it as one word. A directory holding no files is refused rather than given the digest of an empty
// manifest, which would name nothing. A file that could not be read is a refusal, never a digest of what was readable.
//
// Hidden files count: a crew directory is mostly dot files. A crew directory's own runtime place is left out, by
// crew-code's rule and not by a rule of Martha's own (review r=1): `./state` when the directory holds `crew.json`, and
// `./.crew/state` when it holds `.crew/crew.json`. It is state the crew writes as it runs, not work, and no two sessions
// would ever agree on it; the two programs must name the same value for the same tree, so the rule is the same rule.
//
// The directory is printed as given, so the line a handoff carries reads back the path the owner typed. Nothing is
// opened here: ../a_work_directory_on_this_machine answers every path, and the caller hands it the directory.

import { createHash } from 'node:crypto'
import { join, sep } from 'node:path'

import type { ATreeEntry, Refused, WorkDirectory } from '../host_contract/host_contract.ts'
import { CREW_CODE_DECLARATION_DIRECTORY, CREW_CODE_DECLARATION_FILE } from '../declare_crew/declare_crew.ts'

/** What stands between the manifest's two halves. */
export const THE_MANIFEST_SEPARATOR = '--'

/** Two spaces, as `sha256sum` writes them between a file's digest and its path. */
const SUMS_SEPARATOR = '  '

/** The prefix every path in the manifest carries, as `find .` writes it. */
const FROM_THE_DIRECTORY = '.'

/** crew-code's own declaration, which is what decides where its crew keeps its runtime place (review r=1). */
const A_CREWS_DECLARATION = CREW_CODE_DECLARATION_FILE
const A_CREWS_DECLARATION_DIRECTORY = CREW_CODE_DECLARATION_DIRECTORY
const A_CREWS_RUNTIME_PLACE = 'state'

/** A name `sha256sum` cannot write on one line, so it marks the line and escapes the name (GNU coreutils). */
const NEEDS_ESCAPING = /[\\\n]/

/** A file the manifest names: its path from the directory, and the bits of its mode. */
interface AFileOfTheTree {
  readonly path: string
  readonly mode: number
}

/** Every file under a directory, and every link that refused it. */
interface TheTree {
  readonly files: readonly AFileOfTheTree[]
  readonly links: readonly string[]
}

/** What `martha digest` was asked: the directory as the owner typed it, and the directory reader the caller hands in. */
export interface DigestAsked {
  readonly directory: string
  readonly read: WorkDirectory
}

/** The line to print, or why there is none. */
export type TheDigest = { readonly line: string } | { readonly refusal: string }

/** Paths compared in byte order, as `LC_ALL=C sort` compares them. */
const inByteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))

/** The name to print and read: the directory as given, with the one trailing slash crew-code strips. */
const asGiven = (directory: string): string => (directory.length > 1 && directory.endsWith(sep) ? directory.slice(0, -1) : directory)

/** What one entry adds to the tree, read; or why it could not be read. A link is a tree no digest can vouch for. */
async function oneEntry(read: WorkDirectory, at: string, entry: ATreeEntry, under: string, skipping: readonly string[]): Promise<TheTree | Refused> {
  const nothing = { files: [] as readonly AFileOfTheTree[], links: [] as readonly string[] }
  if (entry.kind === 'link') return { ...nothing, links: [`${FROM_THE_DIRECTORY}/${under}`] }
  const child = join(at, entry.name)
  if (entry.kind === 'directory') return skipping.includes(child) ? nothing : theTreeUnder(read, child, under, skipping)
  if (entry.kind !== 'file') return nothing
  const found = await read.modeOf(child)
  return 'refusal' in found ? found : { ...nothing, files: [{ path: `${FROM_THE_DIRECTORY}/${under}`, mode: found.mode }] }
}

/** Every file under `at`, relative to `from`, and every link found on the way; or why the tree could not be read. */
async function theTreeUnder(read: WorkDirectory, at: string, from: string, skipping: readonly string[]): Promise<TheTree | Refused> {
  const entries = await read.list(at)
  if ('refusal' in entries) return entries
  const files: AFileOfTheTree[] = []
  const links: string[] = []
  for (const entry of entries) {
    const one = await oneEntry(read, at, entry, from === '' ? entry.name : `${from}/${entry.name}`, skipping)
    if ('refusal' in one) return one
    files.push(...one.files)
    links.push(...one.links)
  }
  return { files, links }
}

/** The entries of a directory, or none: a place the rule asks about that cannot be read leaves nothing out. */
const entriesIn = async (read: WorkDirectory, at: string): Promise<readonly ATreeEntry[]> => {
  const entries = await read.list(at)
  return 'refusal' in entries ? [] : entries
}

/** Whether a directory holds a file of that name, as `find`'s own `-f` test reads one. */
const holdsAFile = (entries: readonly ATreeEntry[], name: string): boolean => entries.some((entry) => entry.name === name && entry.kind === 'file')

/**
 * The places crew-code's own `bin/crew digest` leaves out of a crew directory's digest (review r=1): `state` when the
 * directory holds `crew.json`, since that is where a crew's own declaration puts its runtime data, or `.crew/state` when
 * it holds `.crew/crew.json`. The first of the two that answers decides it, exactly as the shell's `if`/`elif` does.
 */
async function theRuntimePlacesIn(read: WorkDirectory, at: string): Promise<readonly string[]> {
  const entries = await entriesIn(read, at)
  if (holdsAFile(entries, A_CREWS_DECLARATION)) return [join(at, A_CREWS_RUNTIME_PLACE)]
  if (!entries.some((entry) => entry.name === A_CREWS_DECLARATION_DIRECTORY && entry.kind === 'directory')) return []
  const inner = await entriesIn(read, join(at, A_CREWS_DECLARATION_DIRECTORY))
  return holdsAFile(inner, A_CREWS_DECLARATION) ? [join(at, A_CREWS_DECLARATION_DIRECTORY, A_CREWS_RUNTIME_PLACE)] : []
}

/** The manifest's first half: each file's mode and path, in byte order of the line, as `find` writes and `sort` orders. */
const theModes = (files: readonly AFileOfTheTree[]): string[] =>
  files.flatMap((file) => `${file.mode.toString(8)} ${file.path}`.split('\n')).sort(inByteOrder)

/**
 * A name written as `sha256sum` writes it: a name holding a backslash or a newline cannot go on one line as it is, so
 * the line is marked with a leading backslash and the name alone is escaped (GNU coreutils, review r=1).
 */
const asSha256sumWrites = (digest: string, path: string): string =>
  NEEDS_ESCAPING.test(path)
    ? `\\${digest}${SUMS_SEPARATOR}${path.replaceAll('\\', '\\\\').replaceAll('\n', '\\n')}`
    : `${digest}${SUMS_SEPARATOR}${path}`

/** The manifest's second half: each file's sha256 and path, in byte order of the path. */
async function theSums(read: WorkDirectory, directory: string, files: readonly AFileOfTheTree[]): Promise<string[] | Refused> {
  const sums: string[] = []
  for (const file of [...files].sort((a, b) => inByteOrder(a.path, b.path))) {
    const held = await read.bytesOf(join(directory, file.path))
    if ('refusal' in held) return held
    sums.push(asSha256sumWrites(createHash('sha256').update(held.bytes).digest('hex'), file.path))
  }
  return sums
}

/**
 * `martha digest <dir>`: the line naming the directory and its digest, or the refusal that says why there is none.
 */
export async function digestOf(asked: DigestAsked): Promise<TheDigest> {
  const directory = asGiven(asked.directory)
  if (directory === '' || /\s/.test(directory)) return { refusal: `digest: ${JSON.stringify(directory)} has whitespace in it; a handoff line cannot name it as one word` }
  const at = (await asked.read.realOf(directory)) ?? directory
  const skipping = await theRuntimePlacesIn(asked.read, at)
  const tree = await theTreeUnder(asked.read, at, '', skipping)
  if ('refusal' in tree) return { refusal: `digest: ${tree.refusal}` }
  if (tree.links.length > 0) return { refusal: `digest: ${directory} holds symlinks, which a digest cannot vouch for: ${[...tree.links].sort(inByteOrder).join(', ')}` }
  if (tree.files.length === 0) return { refusal: `digest: ${directory} holds no files` }
  const sums = await theSums(asked.read, directory, tree.files)
  if ('refusal' in sums) return { refusal: `digest: ${sums.refusal}` }
  const manifest = `${theModes(tree.files).join('\n')}\n${THE_MANIFEST_SEPARATOR}\n${sums.join('\n')}\n`
  return { line: `${directory}@sha256:${createHash('sha256').update(manifest).digest('hex')}` }
}
