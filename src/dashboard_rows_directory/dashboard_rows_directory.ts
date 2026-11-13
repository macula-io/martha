// The crew's dashboard rows, on disk: the host's store for one member's row, one file per member (martha#254).
//
// This exists so a beat is one whole row and never half of one. The file is written under a staging name beside it,
// every byte counted, then renamed into place, so a reader handed the file mid-write reads the row before it or the
// row after it and never a torn mix. A beat older than the one the file already holds is dropped whole before
// anything is written, which is the rule the core states (`beatAfter`): the writer settles it, not the reader.
//
// It is host glue because it reads and writes a disk, and the core reads no disk. The row's shape, its fields and the
// newest-at rule stay in ../show_dashboard_beat, so a reader and this writer cannot disagree about what a row is.

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { dirname, join } from 'node:path'
import { getuid } from 'node:process'

import {
  beatAfter,
  isDashboardRow,
  memberOfRowFileName,
  rowFileNameOf,
  type DashboardRow,
  type DashboardStore,
} from '../show_dashboard_beat/show_dashboard_beat.ts'

/** Only the owner may read or write a row. */
export const ROW_FILE_MODE = 0o600

/** What starts a row's file while it is still being written, as the state files do. */
const STAGING_PREFIX = '.staging-'

/** What one row is called in a refusal. */
const ONE_ROW = 'dashboard row'

/** The dashboard rows kept in `directory`: one file per member, each a whole row. */
export function dashboardRowsIn(directory: string): DashboardStore {
  return {
    read: (member) => readBeat(join(directory, rowFileNameOf(member))),
    keep: (row) => keepBeat(directory, row),
    all: () => allBeatsIn(directory),
  }
}

/** Keeps `row` as the member's row: the newest beat wins, and the file is written whole. */
function keepBeat(directory: string, row: DashboardRow): { readonly kept: boolean; readonly why?: string } {
  const path = join(directory, rowFileNameOf(row.member))
  const held = readBeat(path)
  const next = beatAfter(held, row)
  if (next === null) {
    return { kept: false, why: `a beat taken at ${held?.at ?? 0} is already here, and this one was taken at ${row.at}` }
  }
  return keepWhole(path, `${JSON.stringify(next, null, 2)}\n`)
}

/** Every member's row the directory holds, by member; a row that cannot be read is left out, never shown as working. */
function allBeatsIn(directory: string): Readonly<Record<string, DashboardRow>> {
  const rows: Record<string, DashboardRow> = {}
  for (const name of namesIn(directory).sort()) {
    const member = memberOfRowFileName(name)
    if (member === undefined) continue
    const row = beatOfOne(join(directory, name))
    if (row !== null) rows[member] = row
  }
  return rows
}

/** The names in a directory, or none when it is not there. */
function namesIn(directory: string): string[] {
  try {
    return fs.readdirSync(directory)
  } catch {
    return []
  }
}

/** One member's row, or null when it cannot be read: a row that cannot be read is a member not shown. */
function beatOfOne(path: string): DashboardRow | null {
  try {
    return readBeat(path)
  } catch {
    return null
  }
}

/** The row at `path`, or null when the file is not there; throws when what is there is not a row of this user's. */
function readBeat(path: string): DashboardRow | null {
  let descriptor: number
  try {
    descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return null
    throw new Error(`${path} could not be read (${String(code ?? error)}).`)
  }
  try {
    const found = fs.fstatSync(descriptor)
    if (!found.isFile() || found.uid !== getuid?.() || (found.mode & 0o077) !== 0) {
      throw new Error(`${path} is not a file only this user may read and write, so Martha does not trust it.`)
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(descriptor, 'utf8'))
    if (!isDashboardRow(parsed)) throw new Error(`${path} does not hold a ${ONE_ROW}.`)
    return parsed
  } finally {
    fs.closeSync(descriptor)
  }
}

/** Writes `text` at `path` whole: under a staging name beside it, every byte counted, then renamed into place. */
function keepWhole(path: string, text: string): { readonly kept: boolean; readonly why?: string } {
  const staged = join(dirname(path), `${STAGING_PREFIX}${randomUUID()}`)
  const refused = writeStaged(staged, text, path)
  if (refused !== undefined) {
    fs.rmSync(staged, { force: true })
    return { kept: false, why: refused }
  }
  fs.renameSync(staged, path)
  return { kept: true }
}

/** `text` written whole to the staging file `staged`, counting every byte; or why it was not. */
function writeStaged(staged: string, text: string, path: string): string | undefined {
  let descriptor: number
  try {
    descriptor = fs.openSync(staged, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, ROW_FILE_MODE)
  } catch (error) {
    return `${path} could not be written (${String((error as NodeJS.ErrnoException).code ?? error)}), so Martha keeps no ${ONE_ROW} in it.`
  }
  try {
    const bytes = Buffer.byteLength(text)
    const written = fs.writeSync(descriptor, text)
    if (written !== bytes) return `${path} kept only ${written} of the ${bytes} bytes of a ${ONE_ROW}, so Martha keeps none of it.`
    fs.fsyncSync(descriptor)
    return undefined
  } finally {
    fs.closeSync(descriptor)
  }
}
