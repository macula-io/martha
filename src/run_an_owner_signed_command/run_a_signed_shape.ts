// One signed shape, run (martha#129, design step 3): the launcher opens the signed base, reads the checkout once,
// judges the tree and the dependencies, writes exactly the bytes it judged into a fresh run directory, runs the
// shape's argv there in the sandbox, and removes the directory. Any refusal on the way is the answer, and nothing
// runs: a shape the owner did not sign, no sandbox, a base that cannot be opened, a path neither base nor own
// write, a dependency the base lock does not pin.
//
// The own writes are read in the "all" window (#132's registry, every launch of this project). The registry keeps
// absolute paths and the tree rule compares paths under the checkout, so each is named relative to it.

import { realpathSync, rmSync } from 'node:fs'
import { relative, sep } from 'node:path'

import { ownWritesKeptIn, stateSubdirectory, type MarthaState } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import type { CommandShape, SignedBase } from '../keep_the_shell_for_an_owner_signed_command/command_shapes.ts'
import { dependenciesTheRunMaySee, LOCK, MANIFEST } from '../keep_the_shell_for_an_owner_signed_command/exactly_the_lock.ts'
import { treeTheRunMaySee, type BaseEntry, type LiveEntry, type OwnWriteSeen } from '../keep_the_shell_for_an_owner_signed_command/whose_tree.ts'
import { GIT_OBJECT_FORMATS, type GitObjectFormat, type OwnWrite } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { installedLockOf, namesUnder, readPackageOnce, readTheCheckoutOnce, type CheckoutRead, type PackageFile } from './read_the_checkout_once.ts'
import { buildTheRunDirectory, runInTheSandbox, sandboxRefusal, type FileToWrite, type RunEnded } from './run_in_a_sandbox.ts'
import { objectFormatOf, openSignedBase, type OpenedBase } from './signed_base.ts'

/** The folder in the project's state directory that holds the run directories while they run. */
export const RUNS_DIRECTORY = 'runs'

/** What a run needs: the project's state, the checkout, the trusted list's base and shapes, the name typed. */
export interface ShapeToRun {
  readonly state: MarthaState
  readonly checkout: string
  readonly base: SignedBase
  readonly shapes: readonly CommandShape[]
  readonly name: string
  /** The launcher's environment: only PATH (for git) and what the base fetch keeps are read from it. */
  readonly inherited: Readonly<Record<string, string | undefined>>
}

const isObjectFormat = (value: string): value is GitObjectFormat => (GIT_OBJECT_FORMATS as readonly string[]).includes(value)

/** What a judged checkout gives the run: its files and its packages, or why nothing runs. */
type Judged = { readonly files: readonly FileToWrite[]; readonly packages: readonly PackageFile[]; readonly dependencies: ReturnType<typeof dependenciesTheRunMaySee> }

/** Run the named shape on a verified copy in the sandbox; its merged output and status, or why it did not run. */
export async function runASignedShape(run: ShapeToRun): Promise<RunEnded | string> {
  const shape = run.shapes.find((signed) => signed.name === run.name)
  if (shape === undefined) return `the owner signed no shape named ${run.name}`
  const unsandboxed = sandboxRefusal()
  if (unsandboxed !== undefined) return unsandboxed
  const judged = judgeTheCheckout(run)
  if (typeof judged === 'string') return judged
  const runs = stateSubdirectory(run.state, RUNS_DIRECTORY)
  if ('refusal' in runs) return runs.refusal
  const directory = buildTheRunDirectory(runs.path, { files: judged.files, packages: judged.packages, bin_links: judged.dependencies.bin_links })
  if (typeof directory === 'string') return directory
  try {
    return await runInTheSandbox(directory, shape.argv)
  } finally {
    rmSync(directory.root, { recursive: true, force: true })
  }
}

/** The base, the checkout read once, both rules: the bytes the run may see, or every reason it may not run. */
function judgeTheCheckout(run: ShapeToRun): Judged | string {
  const format = objectFormatOf(run.checkout, run.inherited)
  if (!isObjectFormat(format)) return format
  const base = openSignedBase(run.state, run.checkout, run.base, run.inherited)
  if (typeof base === 'string') return base
  const read = readTheCheckoutOnce(run.checkout, format, run.inherited)
  if (typeof read === 'string') return read
  const own = ownWritesKeptIn(run.state).all()
  if ('refusal' in own) return own.refusal
  const tree = treeTheRunMaySee({ base: base.entries, own_writes: ownWritesUnder(run.checkout, own.writes), live: read.live })
  const dependencies = judgeTheDependencies(run.checkout, base, read)
  const refusals = [...tree.refusals.map((refused) => `${refused.path}: ${refused.why}`), ...dependencies.refusals]
  if (refusals.length > 0) return `nothing ran: ${refusals.join('; ')}`
  const packages = readThePackages(run.checkout, dependencies.packages)
  if (typeof packages === 'string') return packages
  return { files: filesToWrite(tree.files, read), packages, dependencies }
}

/**
 * The own writes, named by their path under the checkout. A write outside it is named with a leading `..`, which
 * no path git lists has, so it can vouch for nothing here.
 */
export function ownWritesUnder(checkout: string, writes: readonly OwnWrite[]): readonly OwnWriteSeen[] {
  const top = realpathSync(checkout)
  return writes.map((write) => ({ path: relative(top, write.path).split(sep).join('/'), blob: write.blob, mode: write.mode }))
}

const blobAt = (entries: readonly (BaseEntry | LiveEntry)[], path: string): string | undefined => {
  const entry = entries.find((one) => one.path === path)
  return entry !== undefined && 'blob' in entry ? entry.blob : undefined
}

function judgeTheDependencies(checkout: string, base: OpenedBase, read: CheckoutRead): ReturnType<typeof dependenciesTheRunMaySee> {
  const lock = blobAt(base.entries, LOCK)
  return dependenciesTheRunMaySee({
    base_blobs: { lock, manifest: blobAt(base.entries, MANIFEST) },
    live_blobs: { lock: blobAt(read.live, LOCK), manifest: blobAt(read.live, MANIFEST) },
    base_lock: parsedOrUndefined(lock === undefined ? undefined : base.blob(lock)),
    installed_lock: installedLockOf(checkout),
    namesIn: namesUnder(checkout),
  })
}

function parsedOrUndefined(bytes: Buffer | undefined): unknown {
  if (bytes === undefined) return undefined
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

function readThePackages(checkout: string, keys: readonly string[]): readonly PackageFile[] | string {
  const files: PackageFile[] = []
  for (const key of keys) {
    const read = readPackageOnce(checkout, key)
    if (typeof read === 'string') return `nothing ran: ${read}`
    files.push(...read)
  }
  return files
}

/** The judged files with the bytes read for them; a file the read did not hold is a fault, never an empty file. */
function filesToWrite(files: readonly { readonly path: string; readonly mode: string }[], read: CheckoutRead): readonly FileToWrite[] {
  return files.map((file) => {
    const bytes = read.bytes.get(file.path)
    if (bytes === undefined) throw new Error(`${file.path} was judged but not read`)
    return { path: file.path, mode: file.mode, bytes }
  })
}
