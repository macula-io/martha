// Run the check: node src/check_no_literal_restates_a_value/main.ts [--range <base>..<head>] [--report] [--self-test] [--root <dir>]
//
// Exit 0 clean, 1 findings (one line each, `file:line: '<literal>' restates <module> <NAME>`),
// 2 the check could not be made. It never passes because it could not look.
//
// The gate judges what a change adds, not the whole tree: the lines it adds, and
// every literal equal to a value it defines, revalues or takes away, over the whole
// tree. How a range is read is ./judge_a_change.ts; this file only prints it.
//
// A record marked `satisfies DefinesItsValues` (../host_contract/defines_its_values.ts) the check
// cannot read entry by entry, or a marker anywhere else, is a finding in every
// mode: the marker's claim holds over the whole tree, not only where a change
// touches it.
//
// `--report` runs the same rule over the whole tree and prints how many sites are
// left. That number is a report and never a gate: the cleanup is its own package,
// cut by slice, and the gate turns whole-tree when the count reaches zero.
//
// The range is read as git holds it, so a range whose two ends are the same commit
// adds no line and brings no value: it judges nothing and passes, and says so with
// its own count. Only a range that cannot be read at all — `--range` left out, an
// end missing, or a base of zeroes, which is what a repository's first push hands
// over — falls back to the whole tree.
//
// The coincidences each slice declares in its own `coincidences.ts` are read from
// the tree in both modes (../../prove_the_core/the_coincidences_a_slice_declares.ts),
// never imported. An entry the reader cannot read, an entry about a file outside its
// own slice, and a list that no longer matches the tree are each an error, never a
// pass. The entries belong to this checkout: a tree brought here with `--root` is
// judged without them, because an entry names a file here and says nothing about
// another tree.

import { join } from 'node:path'

import {
  exceptionsNotHeld,
  lineOfAFinding,
  lineOfAMarkerNotHeld,
  markersNotHeld,
  restatementsIn,
  type MarkerNotHeld,
} from '../../prove_the_core/no_literal_restates_a_value.ts'
import { coreSources } from '../../prove_the_core/core_sources.ts'
import { coincidencesIn, lineOfAnUnreadableCoincidence, type DeclaredCoincidence } from '../../prove_the_core/the_coincidences_a_slice_declares.ts'
import { entriesOutsideTheirSlice, lineOfAnEntryOutsideItsSlice } from './a_slice_excuses_only_its_own_files.ts'
import { summaryOf, verdictOf } from './judge_a_change.ts'
import { CORE } from './the_core_the_check_reads.ts'
import { exceptionsThatApply } from './the_exceptions_that_apply.ts'
import { casesThatDoNotBite, PLANTED_CASES } from './the_planted_cases.ts'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** What this check is called, in every line it prints. */
const NAME = 'check_no_literal_restates_a_value'

/** The tree this check lives in: this file's directory, two levels below it. */
const CHECKOUT = join(import.meta.dirname, '..', '..')

/** An exception that matches nothing, planted beside the cases: the list must go red on it. */
function staleExceptionDoesNotBite(): boolean {
  const left = { path: 'a_old/a_old.ts', text: "const name = 'the-old-value'\n" }
  const gone = { value: 'a-value-that-left', file: 'a_old/a_old.ts', reason: 'a word that is no longer there' }
  return exceptionsNotHeld([left], [gone]).length !== 1
}

function runSelfTest(): number {
  const failures = [...casesThatDoNotBite(), ...(staleExceptionDoesNotBite() ? ['an exception that matches nothing'] : [])]
  const all = PLANTED_CASES.length + 1
  for (const failure of failures) console.log(`does not bite: ${failure}`)
  console.log(failures.length === 0 ? `${NAME}: the check bites (${all}/${all}), each planted case on a real range` : `${NAME}: self-test failed`)
  return failures.length === 0 ? 0 : 1
}

function reportStale(stale: readonly DeclaredCoincidence[]): number {
  for (const entry of stale) {
    console.error(`${NAME}: ${entry.declared_in}:${entry.line}: '${entry.value}' in ${entry.file} is declared a coincidence but matches nothing there, or carries no reason, or repeats another entry. Drop it, or say why it stays.`)
  }
  return 2
}

/** The slices' coincidence files cannot be held as written: each place, by name, and the run could not look. */
function reportRefused(refused: readonly string[]): number {
  for (const line of refused) console.error(`${NAME}: ${line}`)
  return 2
}

function reportMarkers(markers: readonly MarkerNotHeld[]): void {
  for (const marker of markers) console.log(lineOfAMarkerNotHeld(marker))
  if (markers.length > 0) console.error(`${NAME}: ${markers.length} marker(s) claim more than the check can read. Mark only a top-level exported record of plain keys and string values, by the marker's own name.`)
}

function runReport(root: string, exceptions: readonly DeclaredCoincidence[]): number {
  const sources = coreSources(join(root, CORE))
  const markers = markersNotHeld(sources)
  reportMarkers(markers)
  const remaining = restatementsIn(sources, { judged: null, exceptions })
  console.log(`${NAME}: ${remaining.length} site(s) remain in the tree. This is a report, not a gate: the cleanup is its own package, cut by slice.`)
  return markers.length === 0 ? 0 : 1
}

function runGate(root: string, exceptions: readonly DeclaredCoincidence[]): number {
  const verdict = verdictOf(root, option('--range'), exceptions)
  if (verdict.stale.length > 0) return reportStale(verdict.stale)
  if (verdict.judged === null) console.log(`${NAME}: no readable range, so the whole tree is judged`)
  reportMarkers(verdict.markers)
  for (const finding of verdict.findings) console.log(lineOfAFinding(finding))
  const summary = summaryOf(NAME, verdict)
  if (summary !== null) console.log(summary)
  if (verdict.findings.length === 0 && verdict.markers.length === 0) {
    console.log(`${NAME}: no literal restates a defined value`)
    return 0
  }
  if (verdict.findings.length > 0) console.error(`${NAME}: ${verdict.findings.length} site(s) restate a value the tree defines. Import the constant, or declare the coincidence, with its reason, in the coincidences.ts of the slice that holds the file.`)
  return 1
}

const main = (): number => {
  if (process.argv.includes('--self-test')) return runSelfTest()
  const root = option('--root') ?? process.cwd()
  const declared = coincidencesIn(coreSources(join(root, CORE)))
  const refused = [...declared.unreadable.map(lineOfAnUnreadableCoincidence), ...entriesOutsideTheirSlice(declared.entries).map(lineOfAnEntryOutsideItsSlice)]
  if (refused.length > 0) return reportRefused(refused)
  const exceptions = exceptionsThatApply(root, CHECKOUT, declared.entries)
  if (process.argv.includes('--report')) {
    const stale = exceptionsNotHeld(coreSources(join(root, CORE)), exceptions)
    return stale.length > 0 ? reportStale(stale) : runReport(root, exceptions)
  }
  return runGate(root, exceptions)
}

try {
  process.exit(main())
} catch (failure) {
  console.error(`${NAME}: the check could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exit(2)
}
