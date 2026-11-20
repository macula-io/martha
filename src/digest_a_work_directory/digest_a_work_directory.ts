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
// Hidden files count: a crew directory is mostly dot files. The crew's own runtime place is left out when it lies
// inside the named directory, since it is state the crew writes as it runs and no two sessions would ever agree on
// it: Martha keeps that place outside every checkout, so this is the rule crew-code applies to `state/`, said the one
// way it can be said here.
//
// The directory is printed as given, so the line a handoff carries reads back the path the owner typed. Nothing is
// opened here: ../a_work_directory_on_this_machine answers every path, and the caller hands it the directory.

import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, sep } from 'node:path'

import type { ATreeEntry, Refused, WorkDirectory } from '../host_contract/host_contract.ts'

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

/** What `martha digest` was asked: the directory as the owner typed it, where the crew's runtime place is, and the
 * directory reader the caller hands in. */
export interface DigestAsked {
  readonly directory: string
  /** The crew's own runtime place, absolute: left out when it lies inside the directory. */
  readonly runtime_place?: string
  readonly read: WorkDirectory
}

/** The line to print, or why there is none. */
export type TheDigest = { readonly line: string } | { readonly refusal: string }

/** Paths compared in byte order, as `LC_ALL=C sort` compares them. */
const inByteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))

/** The name to print and read: the directory as given, with the one trailing slash crew-code strips. */
const asGiven = (directory: string): string => (directory.length > 1 && directory.endsWith(sep) ? directory.slice(0, -1) : directory)

/** What one entry adds to the tree, read; or why it could not be read. A link is a tree no digest can vouch for. */
async function oneEntry(read: WorkDirectory, at: string, entry: ATreeEntry, under: string, skipping: string | undefined): Promise<TheTree | Refused> {
  const nothing = { files: [] as readonly AFileOfTheTree[], links: [] as readonly string[] }
  if (entry.kind === 'link') return { ...nothing, links: [`${FROM_THE_DIRECTORY}/${under}`] }
  const child = join(at, entry.name)
  if (entry.kind === 'directory') return child === skipping ? nothing : theTreeUnder(read, child, under, skipping)
  if (entry.kind !== 'file') return nothing
  const found = await read.modeOf(child)
  return 'refusal' in found ? found : { ...nothing, files: [{ path: `${FROM_THE_DIRECTORY}/${under}`, mode: found.mode }] }
}

/** Every file under `at`, relative to `from`, and every link found on the way; or why the tree could not be read. */
async function theTreeUnder(read: WorkDirectory, at: string, from: string, skipping: string | undefined): Promise<TheTree | Refused> {
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

/** The runtime place skipped while reading, when it lies inside the directory read. */
async function thePlaceToSkip(read: WorkDirectory, directory: string, runtime_place: string | undefined): Promise<string | undefined> {
  if (runtime_place === undefined || !isAbsolute(runtime_place)) return undefined
  const [real, place] = await Promise.all([read.realOf(directory), read.realOf(runtime_place)])
  if (real === undefined || place === undefined) return undefined
  const within = relative(real, place)
  const above = within === '..' || within.startsWith(`..${sep}`)
  return within === '' || above || isAbsolute(within) ? undefined : place
}

/** The manifest's first half: each file's mode and path, in byte order of the line. */
const theModes = (files: readonly AFileOfTheTree[]): string[] => files.map((file) => `${file.mode.toString(8)} ${file.path}`).sort(inByteOrder)

/** The manifest's second half: each file's sha256 and path, in byte order of the path. */
async function theSums(read: WorkDirectory, directory: string, files: readonly AFileOfTheTree[]): Promise<string[] | Refused> {
  const sums: string[] = []
  for (const file of [...files].sort((a, b) => inByteOrder(a.path, b.path))) {
    const held = await read.bytesOf(join(directory, file.path))
    if ('refusal' in held) return held
    sums.push(`${createHash('sha256').update(held.bytes).digest('hex')}${SUMS_SEPARATOR}${file.path}`)
  }
  return sums
}

/**
 * `martha digest <dir>`: the line naming the directory and its digest, or the refusal that says why there is none.
 */
export async function digestOf(asked: DigestAsked): Promise<TheDigest> {
  const directory = asGiven(asked.directory)
  if (directory === '' || /\s/.test(directory)) return { refusal: `digest: ${JSON.stringify(directory)} has whitespace in it; a handoff line cannot name it as one word` }
  const place = await thePlaceToSkip(asked.read, directory, asked.runtime_place)
  const tree = await theTreeUnder(asked.read, (await asked.read.realOf(directory)) ?? directory, '', place)
  if ('refusal' in tree) return { refusal: `digest: ${tree.refusal}` }
  if (tree.links.length > 0) return { refusal: `digest: ${directory} holds symlinks, which a digest cannot vouch for: ${[...tree.links].sort(inByteOrder).join(', ')}` }
  if (tree.files.length === 0) return { refusal: `digest: ${directory} holds no files` }
  const sums = await theSums(asked.read, directory, tree.files)
  if ('refusal' in sums) return { refusal: `digest: ${sums.refusal}` }
  const manifest = `${theModes(tree.files).join('\n')}\n${THE_MANIFEST_SEPARATOR}\n${sums.join('\n')}\n`
  return { line: `${directory}@sha256:${createHash('sha256').update(manifest).digest('hex')}` }
}
