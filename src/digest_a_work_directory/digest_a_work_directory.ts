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
// manifest, which would name nothing. A path could not be read is a refusal, never a digest of what was readable.
//
// Hidden files count: a crew directory is mostly dot files. The crew's own runtime place is left out when it lies
// inside the named directory, since it is state the crew writes as it runs and no two sessions would ever agree on
// it: Martha keeps that place outside every checkout, so this is the rule crew-code applies to `state/`, said the one
// way it can be said here.
//
// The directory is printed as given, so the line a handoff carries reads back the path the owner typed.

import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

/** The bits of a mode the manifest carries: permissions, and the setuid, setgid and sticky bits find's %m prints. */
export const THE_MODE_BITS_KEPT = 0o7777

/** What stands between the manifest's two halves. */
export const THE_MANIFEST_SEPARATOR = '--'

/** Two spaces, as `sha256sum` writes them between a file's digest and its path. */
const SUMS_SEPARATOR = '  '

/** The prefix every path in the manifest carries, as `find .` writes it. */
const FROM_THE_DIRECTORY = '.'

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

/** What `martha digest` was asked, and where the crew's runtime place is when one is known. */
export interface DigestAsked {
  /** The directory as the owner typed it. */
  readonly directory: string
  /** The crew's own runtime place, absolute: left out when it lies inside the directory. */
  readonly runtime_place?: string
}

/** The line to print, or why there is none. */
export type TheDigest = { readonly line: string } | { readonly refusal: string }

/** Paths compared in byte order, as `LC_ALL=C sort` compares them. */
const inByteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))

/** The name to print and read: the directory as given, with the one trailing slash crew-code strips. */
const asGiven = (directory: string): string => (directory.length > 1 && directory.endsWith(sep) ? directory.slice(0, -1) : directory)

/** One entry read: what it puts in the tree, or why it could not be read. A link is a tree no digest can vouch for. */
async function oneEntry(entry: Dirent, at: string, under: string, skipping: string | undefined): Promise<TheTree | string> {
  const here = { files: [] as readonly AFileOfTheTree[], links: [] as readonly string[] }
  if (entry.isSymbolicLink()) return { ...here, links: [`${FROM_THE_DIRECTORY}/${under}`] }
  if (entry.isDirectory()) return at === skipping ? here : theTreeUnder(at, under, skipping)
  if (!entry.isFile()) return here
  const found = await stat(at).catch(() => undefined)
  return found === undefined ? `${at} could not be read.` : { ...here, files: [{ path: `${FROM_THE_DIRECTORY}/${under}`, mode: found.mode & THE_MODE_BITS_KEPT }] }
}

/** Every file under `at`, relative to `from`, and every link found on the way; or why the tree could not be read. */
async function theTreeUnder(at: string, from: string, skipping: string | undefined): Promise<TheTree | string> {
  const entries = await readdir(at, { withFileTypes: true }).catch((error: unknown) => error)
  if (!Array.isArray(entries)) return `${at} could not be read (${(entries as NodeJS.ErrnoException).code ?? 'unknown'}).`
  const files: AFileOfTheTree[] = []
  const links: string[] = []
  for (const entry of entries) {
    const one = await oneEntry(entry, join(at, entry.name), from === '' ? entry.name : `${from}/${entry.name}`, skipping)
    if (typeof one === 'string') return one
    files.push(...one.files)
    links.push(...one.links)
  }
  return { files, links }
}

/** The runtime place skipped while reading, when it lies inside the directory read. */
async function thePlaceToSkip(directory: string, runtime_place: string | undefined): Promise<string | undefined> {
  if (runtime_place === undefined || !isAbsolute(runtime_place)) return undefined
  const [real, place] = await Promise.all([realpath(directory).catch(() => undefined), realpath(runtime_place).catch(() => undefined)])
  if (real === undefined || place === undefined) return undefined
  const within = relative(real, place)
  return within === '' || within.startsWith('..') || isAbsolute(within) ? undefined : place
}

/** The manifest's first half: each file's mode and path, in byte order of the line. */
const theModes = (files: readonly AFileOfTheTree[]): string[] => files.map((file) => `${file.mode.toString(8)} ${file.path}`).sort(inByteOrder)

/** The manifest's second half: each file's sha256 and path, in byte order of the path. */
async function theSums(directory: string, files: readonly AFileOfTheTree[]): Promise<string[] | string> {
  const sums: string[] = []
  for (const file of [...files].sort((a, b) => inByteOrder(a.path, b.path))) {
    const bytes = await readFile(join(directory, file.path)).catch((error: unknown) => error)
    if (!Buffer.isBuffer(bytes)) return `${join(directory, file.path)} could not be read (${(bytes as NodeJS.ErrnoException).code ?? 'unknown'}).`
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}${SUMS_SEPARATOR}${file.path}`)
  }
  return sums
}

/**
 * `martha digest <dir>`: the line naming the directory and its digest, or the refusal that says why there is none.
 */
export async function digestOf(asked: DigestAsked): Promise<TheDigest> {
  const directory = asGiven(asked.directory)
  if (directory === '' || /\s/.test(directory)) return { refusal: `digest: ${JSON.stringify(directory)} has whitespace in it; a handoff line cannot name it as one word` }
  const is_a_directory = await stat(directory).catch(() => undefined)
  if (is_a_directory?.isDirectory() !== true) return { refusal: `digest: ${directory} is not a directory` }
  const place = await thePlaceToSkip(directory, asked.runtime_place)
  const tree = await theTreeUnder(directory, '', place)
  if (typeof tree === 'string') return { refusal: `digest: ${tree}` }
  if (tree.links.length > 0) return { refusal: `digest: ${directory} holds symlinks, which a digest cannot vouch for: ${[...tree.links].sort(inByteOrder).join(', ')}` }
  if (tree.files.length === 0) return { refusal: `digest: ${directory} holds no files` }
  const sums = await theSums(directory, tree.files)
  if (typeof sums === 'string') return { refusal: `digest: ${sums}` }
  const manifest = `${theModes(tree.files).join('\n')}\n${THE_MANIFEST_SEPARATOR}\n${sums.join('\n')}\n`
  return { line: `${directory}@sha256:${createHash('sha256').update(manifest).digest('hex')}` }
}
