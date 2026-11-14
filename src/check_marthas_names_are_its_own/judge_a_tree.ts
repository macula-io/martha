// What one tree spells of crew-code's names, judged once, for the command and for the tests (martha#468).
//
// One path through the judgment, used by the run CI makes and by the tests that plant trees: a test that judged by
// another path would prove nothing about the run that gates a change.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { findingsIn, isAFileTheCheckReads, type Finding } from './findings_in.ts'
import { CREW_CODE_NAMES, type CrewCodeName } from './the_crew_code_names.ts'
import { EXCEPTIONS, type DeclaredException } from './the_exceptions.ts'

/** Directories no name of Martha's is judged in: the machine's own, and prose and pictures, which name a difference
 * rather than spell a name as code. */
const SKIPPED_DIRECTORIES = ['.git', 'node_modules', 'assets', 'docs'] as const

/** Files read by nobody here: a lock file's contents are a package's names, not Martha's; and the check's own two data
 * files are where a crew-code name must stand — the table that holds it and the exceptions that excuse a place still
 * spelling it. Judging those two would be the check judging itself. Nothing else of the slice is skipped. */
const SKIPPED_FILES = [
  'package-lock.json',
  'src/check_marthas_names_are_its_own/the_crew_code_names.ts',
  'src/check_marthas_names_are_its_own/the_exceptions.ts',
] as const

/** A tree, judged. */
export interface Judged {
  /** Every place a crew-code name is spelled and not excused, in the order the tree holds them. */
  readonly findings: readonly Finding[]
  /** Every exception that excused nothing, which says the list has stopped matching the tree. */
  readonly stale: readonly DeclaredException[]
  /** How many files were read; zero means the check could not look, which is never a pass. */
  readonly files: number
}

/** The files under `root` this check reads, with their paths relative to it. */
function theFilesUnder(root: string, reads: (path: string) => boolean): readonly string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .map((path) => relative(root, path))
    .filter((path) => !path.split(/[/\\]/).some((part) => SKIPPED_DIRECTORIES.includes(part as (typeof SKIPPED_DIRECTORIES)[number])))
    .filter((path) => !SKIPPED_FILES.includes(path.split(/[/\\]/).join('/') as (typeof SKIPPED_FILES)[number]))
    .filter(reads)
}

/** Whether an exception excuses this finding: the same file, spelling the same name. A template piece runs on into a
 * value, so a piece beginning with the name and a separator is that name. */
const excuses = (exception: DeclaredException, finding: Finding): boolean =>
  exception.path === finding.path && (finding.text === exception.text || finding.text.startsWith(`${exception.text}/`))

/**
 * Every finding in the tree under `root`, and every exception that excused nothing.
 *
 * The table and the kinds of file read are parameters with the shipped ones as their defaults, so a test plants a tree
 * and judges it by this one path, then judges it again with a table emptied or a file kind dropped and shows that the
 * finding it planted goes missing: the check's bite is proved on its assertion, not on its output.
 */
export function judgeTree(
  root: string,
  exceptions: readonly DeclaredException[] = EXCEPTIONS,
  names: readonly CrewCodeName[] = CREW_CODE_NAMES,
  reads: (path: string) => boolean = isAFileTheCheckReads,
): Judged {
  const files = theFilesUnder(root, reads)
  const spelled = files.flatMap((path) => findingsIn(path, readFileSync(join(root, path), 'utf8'), names))
  const findings = spelled.filter((finding) => !exceptions.some((exception) => excuses(exception, finding)))
  const stale = exceptions.filter((exception) => !spelled.some((finding) => excuses(exception, finding)))
  return { findings, stale, files: files.length }
}
