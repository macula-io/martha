// The checker itself: lychee, run with the options the workflow gives it, and
// the JSON report it left (martha#231).

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Scan } from './check_every_link_resolves.ts'

/** What to run, with what: the binary, the options CI pins, and the inputs. */
export type Checker = { command: string; options: readonly string[]; inputs: readonly string[] }

const readQuietly = (path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

const scanInto = (checker: Checker, report: string): Scan => {
  const args = [...checker.options, '--format', 'json', '--output', report, ...checker.inputs]
  const run = spawnSync(checker.command, args, { encoding: 'utf8', stdio: ['ignore', 'ignore', 'inherit'] })
  // A binary that is not there, or one a signal ended, has no status: that is
  // "the check could not be made", never a pass.
  return { exitCode: run.status ?? 2, report: readQuietly(report) }
}

/** One run of the checker: its exit status, and the report it wrote. */
export const runLychee = (checker: Checker): Scan => {
  const directory = mkdtempSync(join(tmpdir(), 'martha-links-'))
  try {
    return scanInto(checker, join(directory, 'report.json'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
