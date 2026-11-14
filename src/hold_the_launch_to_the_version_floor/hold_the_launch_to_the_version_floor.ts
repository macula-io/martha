// The launch held to this machine's version floor (martha#21, R9 of #84; design issuecomment-6753241669, build
// ruling issuecomment-6868833599).
//
// This exists so that a release placed below the floor this machine holds does not run, even when an older
// installer placed it: the installer's check stops the install, and this one still stands after it. The record is
// found from the launcher's own real path, never from the environment: Node resolves the command through
// ~/.local/bin/martha -> current -> <data>/martha/releases/<version>-sha256-<hex>/martha, and the record is
// <data>/martha/floor, beside releases/. So no XDG_DATA_HOME a caller sets can hide it, and no second copy of the
// installer's rule for where data lives exists to drift. The installer's own write is what this must find; that is
// held by installer/install_a_release/install_the_committed_tree.node-test.mjs, against the real installer.
//
// A tree that is not inside a placed release is a checkout, which is running your own code: no record applies to it
// (R12). A record that is malformed or cannot be read refuses, never read as no floor. The slice reads no disk: the
// launcher resolves the real path and hands it here, with the function that reads a file's text.

import { basename, dirname, join } from 'node:path'

/** A placed release's directory name: the version, then the digest of its manifest. */
const PLACED_RELEASE = /^\d+\.\d+\.\d+-sha256-[0-9a-f]{64}$/
/** The directory every placed release sits in. */
export const RELEASES = 'releases'
/** The record's name, beside RELEASES. */
export const FLOOR_RECORD = 'floor'
/** One X.Y.Z version, its parts captured. */
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/
/** The code Node's read fails with when there is no record yet: no floor, rather than a refusal. */
const NO_RECORD = 'ENOENT'

/** What reading the record gave: its text, or the error code the read failed with. */
export type TheRecordRead = { readonly text: string } | { readonly code: string }

/** What `readText` gave for `record`: its text, or the code the read failed with. */
export function readTheRecord(record: string, readText: (path: string) => string): TheRecordRead {
  try {
    return { text: readText(record) }
  } catch (error) {
    return { code: (error as NodeJS.ErrnoException).code ?? String(error) }
  }
}

/**
 * Where this machine keeps the floor for the release tree at the real path `realTree` (…/releases/<name>/martha);
 * undefined when it is not inside a placed release.
 */
export function floorRecordOf(realTree: string): string | undefined {
  const release = dirname(realTree)
  const releases = dirname(release)
  if (!PLACED_RELEASE.test(basename(release)) || basename(releases) !== RELEASES) return undefined
  return join(dirname(releases), FLOOR_RECORD)
}

/**
 * The version's three parts as whole numbers, exact at any length: a float would read 9007199254740993 as ...992.
 * The installer's compareVersions and the packer's below read them the same way, held by
 * installer/hold_the_version_floor/every_reader_agrees_on_the_floor.node-test.mjs (martha#433).
 */
const partsOf = (version: string): bigint[] => (VERSION.exec(version) ?? []).slice(1).map(BigInt)

/** Whether `a` is a lower version than `b`, compared part by part as whole numbers. */
export function below(a: string, b: string): boolean {
  const [x, y] = [partsOf(a), partsOf(b)]
  const at = x.findIndex((part, i) => part !== y[i])
  return at >= 0 && (x[at] ?? 0n) < (y[at] ?? 0n)
}

/**
 * The floor `record` holds, from what reading it gave; undefined when there is none yet; or why it cannot be read.
 * The installer's machineFloor reads it alike, in the same words (martha#433).
 */
export function recordedFloor(record: string, read: TheRecordRead): string | undefined | { readonly refusal: string } {
  if ('code' in read) {
    if (read.code === NO_RECORD) return undefined
    return { refusal: `${record}, this machine's version floor, could not be read (${read.code}); refused, never read as no floor` }
  }
  const version = read.text.endsWith('\n') ? read.text.slice(0, -1) : ''
  return VERSION.test(version) ? version : { refusal: `${record}, this machine's version floor, is not one X.Y.Z line; refused, never read as no floor` }
}

/**
 * Why a release of `version` may not launch on a machine whose `record` read as `read`; undefined when it may. It
 * names both versions and the line that puts the highest signed release back.
 */
export function launchBelowTheFloor(record: string, read: TheRecordRead, version: string): string | undefined {
  const floor = recordedFloor(record, read)
  if (typeof floor === 'object') return floor.refusal
  if (floor === undefined || !below(version, floor)) return undefined
  return `this is Martha ${version}, below ${floor}, the version floor this machine holds (${record}); refused. Put the highest signed release back with: martha install`
}
