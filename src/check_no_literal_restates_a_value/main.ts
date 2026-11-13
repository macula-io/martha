// Run the check: node src/check_no_literal_restates_a_value/main.ts [--range <base>..<head>] [--report] [--self-test] [--root <dir>]
//
// Exit 0 clean, 1 findings (one line each, `file:line: '<literal>' restates <module> <NAME>`),
// 2 the check could not be made. It never passes because it could not look.
//
// The gate judges what a change adds, not the whole tree: the lines it adds, and
// every literal equal to a value it defines or revalues — those are judged over
// the whole tree, because a constant added today makes every old copy of its value
// stale at once, and a revalued one leaves every literal still holding the old
// value behind (martha#289, Uranus's R1). The change is read as its NET diff
// against the merge base, never commit by commit: a copy added and removed again
// inside one branch does no harm, and a branch that has merged the default branch
// must not be blamed for the lines the default branch brought.
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
// The exceptions (`./exceptions.ts`) are read in both modes, and a list that no
// longer matches the tree is an error, never a pass. They belong to this checkout:
// a tree brought here with `--root` is judged without them, because an entry names
// a file here and says nothing about another tree.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { coreSources } from '../../prove_the_core/core_sources.ts'
import {
  constantsIn,
  exceptionsNotHeld,
  lineOfAFinding,
  literalSitesJudged,
  restatementsIn,
  SHORTEST_VALUE,
  type ConstantInSource,
  type DefinedByTheChange,
  type Exception,
  type Finding,
  type Rule,
} from '../../prove_the_core/no_literal_restates_a_value.ts'
import type { CoreSource } from '../host_contract/core_source.ts'
import { EXCEPTIONS } from './exceptions.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { CORE } from './the_core_the_check_reads.ts'
import { exceptionsThatApply } from './the_exceptions_that_apply.ts'
import { addedLinesIn, underCore } from './the_lines_a_change_adds.ts'

const ZERO = /^0+$/

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', ['-C', root, ...marthasOwnGitArgs(args)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** The lines the change adds, under the core, read as one net diff against the merge base. */
export function linesTheChangeAdds(root: string, base: string, head: string): Set<string> {
  const settings = ['--no-color', '--no-ext-diff', '--unified=0', '--diff-filter=d']
  return addedLinesIn(git(root, ['diff', ...settings, base, head, '--', CORE]))
}

/** The path of every source under the core that the change touches, relative to the repository. */
function touchedSources(root: string, merge_base: string, head: string): string[] {
  const scanned = new Set(coreSources(join(root, CORE)).map((source) => join(CORE, source.path)))
  return git(root, ['diff', '--name-only', '--diff-filter=d', merge_base, head, '--', CORE])
    .split('\n')
    .filter((path) => scanned.has(path))
}

/** The values one constant brings when the change defines or revalues it: its value now, and the one it held. */
function valuesOneConstantBrings(constant: ConstantInSource, before: readonly ConstantInSource[], under: string): DefinedByTheChange[] {
  const now = { value: constant.value, module: under, name: constant.name }
  const was = before.find((each) => each.name === constant.name)
  if (was === undefined || was.value === constant.value || was.value.length < SHORTEST_VALUE) return [now]
  return [now, { value: was.value, module: under, name: constant.name }]
}

/** The values one changed file brings: each of its exported constants whose value is written on a line the change adds. */
function valuesOneFileBrings(root: string, merge_base: string, path: string, added: ReadonlySet<string>): DefinedByTheChange[] {
  const under = underCore(path)
  const now = constantsIn(readFileSync(join(root, path), 'utf8'), under)
  const before = constantsIn(readGitFile(root, merge_base, path), under)
  return now
    .filter((constant) => constant.exported && added.has(`${under}:${constant.line}`))
    .flatMap((constant) => valuesOneConstantBrings(constant, before, under))
}

/**
 * Every value the change defines or revalues, with the constant it belongs to,
 * judged over the whole tree: a constant added today makes every old copy of its
 * value stale at once, and a revalued one leaves every literal holding the value
 * it had before behind (martha#289, R1).
 */
export function constantsTheChangeDefines(root: string, merge_base: string, head: string, added: ReadonlySet<string>): DefinedByTheChange[] {
  return touchedSources(root, merge_base, head).flatMap((path) => valuesOneFileBrings(root, merge_base, path, added))
}

/** A file as one commit holds it; empty when that commit does not hold it. */
const readGitFile = (root: string, sha: string, path: string): string => {
  try {
    return git(root, ['show', `${sha}:${path}`])
  } catch {
    return ''
  }
}

const report = (findings: readonly Finding[]): void => {
  for (const finding of findings) console.log(lineOfAFinding(finding))
}

/** The five planted ways a copy gets in, each of which must be named for the self-test to pass. */
function selfTest(): string[] {
  const exporter = { path: 'a_tool/a_tool.ts', text: "export const TOOL = 'the-tool'\n" }
  const everyLine = (one: { path: string; text: string }) => new Set(one.text.split('\n').map((_line, index) => `${one.path}:${index + 1}`))
  const added = { path: 'a_new/a_new.ts', text: "export const FRESH = 'a-fresh-value'\n" }
  const stale = { path: 'a_old/a_old.ts', text: "const name = 'a-fresh-value'\n" }
  const renamed = { path: 'a_old/a_old.ts', text: "const name = 'the-old-value'\n" }
  const privateCopy = { path: 'a_copy/a_copy.ts', text: "const DEPENDENCIES = 'the-tool'\n" }
  const cases: readonly { readonly what: string; readonly found: Finding[]; readonly rule: Rule }[] = [
    { what: 'a new literal', found: restatementsIn([exporter, { path: 'a_user/a_user.ts', text: "call('the-tool')\n" }], { judged: new Set(['a_user/a_user.ts:1']) }), rule: 'restates_a_constant' },
    { what: 'a constant the change adds', found: restatementsIn([added, stale], { judged: everyLine(added), defined: [{ value: 'a-fresh-value', module: 'a_new/a_new.ts', name: 'FRESH' }] }), rule: 'restates_a_value_the_change_defines' },
    { what: 'a value the change renames', found: restatementsIn([renamed], { judged: new Set<string>(), defined: [{ value: 'the-old-value', module: 'a_tool/a_tool.ts', name: 'TOOL' }] }), rule: 'restates_a_value_the_change_defines' },
    { what: 'a local redefinition of an exported value', found: restatementsIn([exporter, privateCopy], { judged: everyLine(privateCopy) }), rule: 'defines_an_exported_value' },
  ]
  const failures = cases.filter((one) => one.found.length !== 1 || one.found[0]!.rule !== one.rule).map((one) => one.what)
  const gone = { value: 'a-value-that-left', file: 'a_old/a_old.ts', reason: 'a word that is no longer there' }
  if (exceptionsNotHeld([renamed], [gone]).length !== 1) failures.push('an exception that matches nothing')
  return failures
}

/** What this check is called, in every line it prints. */
const NAME = 'check_no_literal_restates_a_value'

/** The tree this check lives in: this file's directory, two levels below it. */
const CHECKOUT = join(import.meta.dirname, '..', '..')

const main = (): number => {
  const root = option('--root') ?? process.cwd()
  const sources = coreSources(join(root, CORE))
  if (process.argv.includes('--self-test')) return runSelfTest()
  const exceptions = exceptionsThatApply(root, CHECKOUT, EXCEPTIONS)
  const stale = exceptionsNotHeld(sources, exceptions)
  if (stale.length > 0) return reportStale(stale)
  if (process.argv.includes('--report')) return runReport(sources, exceptions)
  return runGate(root, sources, exceptions)
}

function runSelfTest(): number {
  const failures = selfTest()
  for (const failure of failures) console.log(`does not bite: ${failure}`)
  console.log(failures.length === 0 ? `${NAME}: the check bites (5/5)` : `${NAME}: self-test failed`)
  return failures.length === 0 ? 0 : 1
}

function reportStale(stale: readonly Exception[]): number {
  for (const entry of stale) {
    console.error(`${NAME}: '${entry.value}' in ${entry.file} is declared an exception but matches nothing there, or carries no reason, or repeats another entry. Drop it, or say why it stays.`)
  }
  return 2
}

function runReport(sources: readonly CoreSource[], exceptions: readonly Exception[]): number {
  const remaining = restatementsIn(sources, { judged: null, exceptions })
  console.log(`${NAME}: ${remaining.length} site(s) remain in the tree. This is a report, not a gate: the cleanup is its own package, cut by slice.`)
  return 0
}

function runGate(root: string, sources: readonly CoreSource[], exceptions: readonly Exception[]): number {
  const judged = rangeOf(root, option('--range'))
  if (judged === null) console.log(`${NAME}: no readable range, so the whole tree is judged`)
  const defined = judged === null ? [] : constantsTheChangeDefines(root, judged.merge_base, judged.head, judged.added)
  const findings = restatementsIn(sources, { judged: judged === null ? null : judged.added, defined, exceptions })
  report(findings)
  if (judged !== null) console.log(`${NAME}: range ${judged.merge_base}..${judged.head} (asked ${judged.asked}), ${literalSitesJudged(sources, judged.added)} literal site(s) judged, ${defined.length} value(s) judged over the whole tree`)
  if (findings.length === 0) {
    console.log(`${NAME}: no literal restates a defined value`)
    return 0
  }
  console.error(`${NAME}: ${findings.length} site(s) restate a value the tree defines. Import the constant, or declare the coincidence in src/check_no_literal_restates_a_value/exceptions.ts with its reason.`)
  return 1
}

interface Judged {
  readonly merge_base: string
  readonly head: string
  readonly asked: string
  readonly added: ReadonlySet<string>
}

/** The range as asked, its merge base and the lines it adds; null when there is no readable range. */
function rangeOf(root: string, range: string | undefined): Judged | null {
  if (range === undefined) return null
  const [base, head] = range.split('..')
  if (base === undefined || head === undefined || base === '' || head === '' || ZERO.test(base)) return null
  const merge_base = mergeBaseOf(root, base, head)
  return merge_base === null ? null : { merge_base, head, asked: range, added: linesTheChangeAdds(root, merge_base, head) }
}

const mergeBaseOf = (root: string, base: string, head: string): string | null => {
  try {
    const merge_base = git(root, ['merge-base', base, head]).trim()
    return merge_base === '' ? null : merge_base
  } catch {
    return null
  }
}

try {
  process.exit(main())
} catch (failure) {
  console.error(`${NAME}: the check could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exit(2)
}
