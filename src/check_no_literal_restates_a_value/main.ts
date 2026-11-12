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
// The exceptions (`./exceptions.ts`) are read in both modes, and a list that no
// longer matches the tree is an error, never a pass.

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
  type DefinedByTheChange,
  type Finding,
  type Rule,
} from '../../prove_the_core/no_literal_restates_a_value.ts'
import { EXCEPTIONS } from './exceptions.ts'
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

/**
 * Every constant the change defines or revalues, with the value it holds now and,
 * for a revalued one, the value it held before — both judged over the whole tree.
 */
export function constantsTheChangeDefines(root: string, merge_base: string, head: string, added: ReadonlySet<string>): DefinedByTheChange[] {
  const defined: DefinedByTheChange[] = []
  for (const path of touchedSources(root, merge_base, head)) {
    const under = underCore(path)
    const now = constantsIn(readFileSync(join(root, path), 'utf8'), under)
    const before = constantsIn(readGitFile(root, merge_base, path), under)
    for (const constant of now) {
      if (!constant.exported) continue
      if (!added.has(`${under}:${constant.line}`)) continue
      const was = before.find((each) => each.name === constant.name)
      defined.push({ value: constant.value, module: under, name: constant.name })
      if (was !== undefined && was.value !== constant.value && was.value.length >= SHORTEST_VALUE) {
        defined.push({ value: was.value, module: under, name: constant.name })
      }
    }
  }
  return defined
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

const main = (): number => {
  const root = option('--root') ?? process.cwd()
  const sources = coreSources(join(root, CORE))

  if (process.argv.includes('--self-test')) {
    const failures = selfTest()
    for (const failure of failures) console.log(`does not bite: ${failure}`)
    console.log(failures.length === 0 ? 'check_no_literal_restates_a_value: the check bites (5/5)' : 'check_no_literal_restates_a_value: self-test failed')
    return failures.length === 0 ? 0 : 1
  }

  const stale = exceptionsNotHeld(sources, EXCEPTIONS)
  if (stale.length > 0) {
    for (const entry of stale) console.error(`check_no_literal_restates_a_value: '${entry.value}' in ${entry.file} is declared an exception but matches nothing there, or carries no reason, or repeats another entry. Drop it or say why it stays.`)
    return 2
  }

  if (process.argv.includes('--report')) {
    const remaining = restatementsIn(sources, { judged: null, exceptions: EXCEPTIONS })
    console.log(`check_no_literal_restates_a_value: ${remaining.length} site(s) remain in the tree. This is a report, not a gate: the cleanup is its own package, cut by slice.`)
    return 0
  }

  const range = option('--range')
  const [base, head] = range === undefined ? ['', ''] : range.split('..')
  const judged = range === undefined || base === undefined || head === undefined || ZERO.test(base) || base === '' || head === '' ? null : mergeBaseRange(root, base, head)
  if (judged === null) {
    console.log('check_no_literal_restates_a_value: no readable range, so the whole tree is judged')
  }
  const defined: DefinedByTheChange[] = judged === null || base === undefined || head === undefined ? [] : constantsTheChangeDefines(root, judged.merge_base, head, judged.added)
  const findings = restatementsIn(sources, { judged: judged === null ? null : judged.added, defined, exceptions: EXCEPTIONS })
  report(findings)
  if (judged !== null) console.log(`check_no_literal_restates_a_value: range ${judged.merge_base}..${head} (asked ${base}..${head}), ${literalSitesJudged(sources, judged.added)} literal site(s) judged, ${defined.length} value(s) judged over the whole tree`)
  if (findings.length > 0) {
    console.error(`check_no_literal_restates_a_value: ${findings.length} site(s) restate a value the tree defines. Import the constant, or declare the coincidence in src/check_no_literal_restates_a_value/exceptions.ts with its reason.`)
    return 1
  }
  console.log('check_no_literal_restates_a_value: no literal restates a defined value')
  return 0
}

interface Judged {
  readonly merge_base: string
  readonly added: ReadonlySet<string>
}

/** The merge base of the range and the lines it adds; null when git cannot answer. */
function mergeBaseRange(root: string, base: string, head: string): Judged | null {
  let merge_base: string
  try {
    merge_base = git(root, ['merge-base', base, head]).trim()
  } catch {
    return null
  }
  if (merge_base === '') return null
  return { merge_base, added: linesTheChangeAdds(root, merge_base, head) }
}

try {
  process.exit(main())
} catch (failure) {
  console.error(`check_no_literal_restates_a_value: the check could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exit(2)
}
