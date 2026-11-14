// What the gate judges in a change, read from git (martha#289).
//
// The gate judges what a change adds, not the whole tree: the lines it adds, and
// every literal equal to a value it defines, revalues or takes away — those are
// judged over the whole tree, because a constant added today makes every old copy
// of its value stale at once, and a revalued, renamed or removed one leaves every
// literal still holding the old value behind (Uranus's R1). The change is read as
// its NET diff against the merge base, never commit by commit: a copy added and
// removed again inside one branch does no harm, and a branch that has merged the
// default branch must not be blamed for the lines the default branch brought.
//
// A marked record (../host_contract/defines_its_values.ts) counts each entry as defined by the
// change when the record carried no marker at the merge base, so marking a record
// judges every one of its values over the whole tree though the change adds only
// the marker's line; otherwise an entry counts when its own line is added.
//
// Every value the merge base held under a name the head no longer holds with that
// value, in any source the change touches — a constant or entry removed, renamed
// or revalued, or one in a source the change deletes — is judged over the whole
// tree as the value it left behind.
//
// The sources a change touches are read with rename detection off, so a source git
// would pair as moved is read at its old path at the merge base and at its new
// path at the head: a constant removed or revalued while its file moves leaves its
// value behind like any other, and one that moves unchanged is still held. The
// lines a change adds keep git's rename detection, so a moved source is not judged
// as if every one of its lines were new.
//
// This module reads git and the disk and never exits, so the self-test and the
// tests drive the same reading the gate runs, on real ranges.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { coreSources } from '../../prove_the_core/core_sources.ts'
import {
  constantsIn,
  exceptionsNotHeld,
  literalSitesJudged,
  markersNotHeld,
  restatementsIn,
  SHORTEST_VALUE,
  type ConstantInSource,
  type DefinedByTheChange,
  type Exception,
  type Finding,
  type MarkerNotHeld,
} from '../../prove_the_core/no_literal_restates_a_value.ts'
import type { CoreSource } from '../host_contract/core_source.ts'
import { isScannedSource } from '../host_contract/core_source.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { CORE } from './the_core_the_check_reads.ts'
import { addedLinesIn, underCore } from './the_lines_a_change_adds.ts'

const ZERO = /^0+$/

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', ['-C', root, ...marthasOwnGitArgs(args)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** The lines the change adds, under the core, read as one net diff against the merge base. */
export function linesTheChangeAdds(root: string, base: string, head: string): Set<string> {
  const settings = ['--no-color', '--no-ext-diff', '--unified=0', '--diff-filter=d']
  return addedLinesIn(git(root, ['diff', ...settings, base, head, '--', CORE]))
}

/** The path of every source under the core that the change touches, deleted ones too, relative to the repository. */
function touchedSources(root: string, merge_base: string, head: string): string[] {
  return git(root, ['diff', '--name-only', '--no-renames', merge_base, head, '--', CORE])
    .split('\n')
    .filter((path) => path !== '' && isScannedSource(basename(path)))
}

/** A file as one commit holds it; empty when that commit does not hold it. */
const readGitFile = (root: string, sha: string, path: string): string => {
  try {
    return git(root, ['show', `${sha}:${path}`])
  } catch {
    return ''
  }
}

/** A file as the checkout holds it; empty when the change deleted it. */
const readCheckedOut = (root: string, path: string): string => (existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '')

const asDefined = (constant: ConstantInSource, module: string): DefinedByTheChange => ({ value: constant.value, module, name: constant.name })

/** Whether the change defines this constant or entry: its line is added, or its record carried no marker before. */
const isDefinedByTheChange = (constant: ConstantInSource, under: string, added: ReadonlySet<string>, markedBefore: ReadonlySet<string>): boolean =>
  constant.exported && (added.has(`${under}:${constant.line}`) || (constant.record !== undefined && !markedBefore.has(constant.record)))

/** Whether the head still holds this value under this name, exported, in any source the change touches. */
const isStillHeld = (was: ConstantInSource, now: readonly ConstantInSource[]): boolean =>
  now.some((each) => each.exported && each.name === was.name && each.value === was.value)

/** One touched source, as the merge base and the head hold it. */
interface BothEnds {
  readonly under: string
  readonly now: readonly ConstantInSource[]
  readonly before: readonly ConstantInSource[]
  /** The change deletes it: with rename detection off, the old side of a move. */
  readonly deleted: boolean
}

function bothEndsOf(root: string, merge_base: string, path: string): BothEnds {
  const under = underCore(path)
  const text = readCheckedOut(root, path)
  return { under, now: constantsIn(text, under), before: constantsIn(readGitFile(root, merge_base, path), under), deleted: text === '' }
}

const recordsMarkedIn = (constants: readonly ConstantInSource[]): string[] => constants.flatMap((constant) => (constant.record === undefined ? [] : [constant.record]))

/**
 * Every value the change defines, revalues or takes away, with the constant it
 * belongs to, judged over the whole tree (martha#289, R1).
 */
export function constantsTheChangeDefines(root: string, merge_base: string, head: string, added: ReadonlySet<string>): DefinedByTheChange[] {
  const touched = touchedSources(root, merge_base, head).map((path) => bothEndsOf(root, merge_base, path))
  const nowAll = touched.flatMap((source) => source.now)
  const markedInADeletedSource = touched.filter((source) => source.deleted).flatMap((source) => recordsMarkedIn(source.before))
  return touched.flatMap(({ under, now, before }) => {
    const markedBefore = new Set([...recordsMarkedIn(before), ...markedInADeletedSource])
    const defines = now.filter((constant) => isDefinedByTheChange(constant, under, added, markedBefore))
    const leaves = before.filter((was) => was.exported && was.value.length >= SHORTEST_VALUE && !isStillHeld(was, nowAll))
    return [...defines, ...leaves].map((constant) => asDefined(constant, under))
  })
}

export interface Judged {
  readonly merge_base: string
  readonly head: string
  readonly asked: string
  readonly added: ReadonlySet<string>
}

const mergeBaseOf = (root: string, base: string, head: string): string | null => {
  try {
    const merge_base = git(root, ['merge-base', base, head]).trim()
    return merge_base === '' ? null : merge_base
  } catch {
    return null
  }
}

/** The range as asked, its merge base and the lines it adds; null when there is no readable range. */
export function rangeOf(root: string, range: string | undefined): Judged | null {
  if (range === undefined) return null
  const [base, head] = range.split('..')
  if (base === undefined || head === undefined || base === '' || head === '' || ZERO.test(base)) return null
  const merge_base = mergeBaseOf(root, base, head)
  return merge_base === null ? null : { merge_base, head, asked: range, added: linesTheChangeAdds(root, merge_base, head) }
}

/** What the gate found in one tree for one range, before anything is printed. */
export interface Verdict<Entry extends Exception = Exception> {
  readonly sources: readonly CoreSource[]
  /** Exceptions that no longer hold: the check could not be made. */
  readonly stale: readonly Entry[]
  readonly markers: readonly MarkerNotHeld[]
  /** Null when there was no readable range and the whole tree was judged. */
  readonly judged: Judged | null
  readonly defined: readonly DefinedByTheChange[]
  readonly findings: readonly Finding[]
}

/** The gate's verdict on `root` for `range`, the whole tree when the range cannot be read. */
export function verdictOf<Entry extends Exception>(root: string, range: string | undefined, exceptions: readonly Entry[]): Verdict<Entry> {
  const sources = coreSources(join(root, CORE))
  const stale = exceptionsNotHeld(sources, exceptions)
  const markers = markersNotHeld(sources)
  const judged = rangeOf(root, range)
  const defined = judged === null ? [] : constantsTheChangeDefines(root, judged.merge_base, judged.head, judged.added)
  const findings = restatementsIn(sources, { judged: judged === null ? null : judged.added, defined, exceptions })
  return { sources, stale, markers, judged, defined, findings }
}

/** The line a gate prints to prove it looked: the range, the literal sites on its lines, and the values judged over the whole tree. */
export const summaryOf = (name: string, verdict: Verdict): string | null =>
  verdict.judged === null
    ? null
    : `${name}: range ${verdict.judged.merge_base}..${verdict.judged.head} (asked ${verdict.judged.asked}), ${literalSitesJudged(verdict.sources, verdict.judged.added)} literal site(s) judged, ${verdict.defined.length} value(s) judged over the whole tree`
