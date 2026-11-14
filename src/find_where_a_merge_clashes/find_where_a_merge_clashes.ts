// Where a merge clashes, read without merging anything into a checkout (martha#339).
//
// This exists so a batch says which passed pull requests land together before the owner is asked, and names, for one
// that clashes by hand, what it clashes with. `git merge-tree --write-tree` merges two commits in memory: it writes the
// merged tree's objects and no ref, index or working file, and even when it exits 1 it prints the three stages of every
// path it could not settle. This reads that answer in one place, for the batch's dry run, for a landing that leaves a
// pull request out, and for the redo program's judge of a landing merge, so its shape is never read twice.
//
// It also finds, for each path a head clashes in, the first of a list of commits at which it clashes: the batch's
// earlier heads merged in turn, or the default branch's own first-parent commits since the head branched. The caller
// names the commits; this only merges and reads.
//
// Every run of git carries marthasOwnGitArgs (../run_marthas_own_git) and goes through the contract's processes.run.

import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** The three stages of one path a merge could not settle: a blob id each, absent when that side has no such file. */
export interface TheStages {
  readonly base?: string | undefined
  readonly ours?: string | undefined
  readonly theirs?: string | undefined
}

/** What `git merge-tree --write-tree` answered: the tree it wrote, and each path it could not settle, in its order. */
export interface AMergeInMemory {
  readonly tree: string
  readonly clashed: ReadonlyMap<string, TheStages>
}

/** One commit a head is merged onto when its clashes are traced, with what an answer calls it. */
export interface AStep {
  readonly commit: string
  readonly label: string
}

type Step<T> = { readonly ok: T } | { readonly refused: string }

/** A stage line merge-tree prints for a path it could not settle: `<mode> <blob> <stage>\t<path>`. */
const A_STAGE_LINE = /^\d+ ([0-9a-f]+) ([123])\t(.+)$/

/** The names merge-tree's stage numbers stand for. */
const THE_STAGES: Readonly<Record<string, keyof TheStages>> = { '1': 'base', '2': 'ours', '3': 'theirs' }

/**
 * merge-tree's answer, read: its first line is the tree, and the lines up to the first empty one are the stages of the
 * paths it could not settle. A clean merge prints the tree alone.
 */
export function whatAMergeTreeWrote(stdout: string): AMergeInMemory {
  const [tree = '', ...rest] = stdout.split('\n')
  const clashed = new Map<string, TheStages>()
  for (const line of rest) {
    if (line === '') break
    const found = A_STAGE_LINE.exec(line)
    if (found === null) continue
    const [, blob = '', stage = '', path = ''] = found
    clashed.set(path, { ...clashed.get(path), [THE_STAGES[stage] ?? 'base']: blob })
  }
  return { tree: tree.trim(), clashed }
}

/** Two commits merged in memory, with any options merge-tree takes before them; refused when git could not merge them. */
export async function mergedInMemory(
  host: Pick<HostContract, 'processes'>,
  path: string,
  into: string,
  landed: string,
  options: readonly string[] = [],
): Promise<Step<AMergeInMemory>> {
  const ran = await git(host, path, ['merge-tree', '--write-tree', ...options, into, landed])
  if (ran.exit_code === 0 || ran.exit_code === 1) return { ok: whatAMergeTreeWrote(ran.stdout) }
  return { refused: `git merge-tree could not merge ${into} and ${landed}: ${saidBy(ran)}` }
}

/**
 * For each path, the first step a head clashes in it at, merged onto that step's commit; a path no step clashes in is
 * left out of the answer. Refused when git could not merge one step.
 */
export async function theFirstStepEachPathClashesAt(
  host: Pick<HostContract, 'processes'>,
  path: string,
  head: string,
  steps: readonly AStep[],
  paths: readonly string[],
): Promise<Step<ReadonlyMap<string, AStep>>> {
  const found = new Map<string, AStep>()
  for (const step of steps) {
    if (found.size === paths.length) break
    const merged = await mergedInMemory(host, path, step.commit, head)
    if ('refused' in merged) return merged
    noteWhatFirstClashesAt(found, step, merged.ok.clashed, paths)
  }
  return { ok: found }
}

/** Each path of `paths` that clashes at this step, noted at it unless an earlier step already holds it. */
function noteWhatFirstClashesAt(found: Map<string, AStep>, step: AStep, clashed: ReadonlyMap<string, TheStages>, paths: readonly string[]): void {
  for (const one of paths.filter((each) => !found.has(each) && clashed.has(each))) found.set(one, step)
}

/** A first-parent commit of a branch: its sha and its subject, oldest first. */
export interface AFirstParent {
  readonly commit: string
  readonly subject: string
}

/** The first-parent commits of `tip` since a head branched from it, oldest first: where a clash with the branch came in. */
export async function theFirstParentsSince(
  host: Pick<HostContract, 'processes'>,
  path: string,
  tip: string,
  head: string,
): Promise<Step<readonly AFirstParent[]>> {
  const base = await git(host, path, ['merge-base', tip, head])
  if (base.exit_code !== 0) return { refused: `${head} shares no history with ${tip}: ${saidBy(base)}` }
  const listed = await git(host, path, ['log', '--first-parent', '--reverse', '--format=%H %s', `${base.stdout.trim()}..${tip}`])
  if (listed.exit_code !== 0) return { refused: `the commits since ${head} branched could not be read: ${saidBy(listed)}` }
  return { ok: listed.stdout.split('\n').filter((line) => line !== '').map(aFirstParent) }
}

/**
 * What each path a head clashes in clashes with, as a label: the first step of `chain` it clashes at, where the chain's
 * first step is the default branch and each later one an earlier head of the batch merged onto it. A path that clashes
 * already with the default branch is traced along that branch's first-parent commits since the head branched, and
 * labelled as `nameAFirstParent` names the commit it first clashes at; one that clashes nowhere keeps the branch's label.
 */
export async function whatEachPathClashesWith(
  host: Pick<HostContract, 'processes'>,
  path: string,
  head: string,
  chain: readonly AStep[],
  paths: readonly string[],
  nameAFirstParent: (commit: AFirstParent) => string,
): Promise<Step<ReadonlyMap<string, string>>> {
  const [the_branch] = chain
  if (the_branch === undefined) return { refused: 'a clash is traced along a chain that starts at the default branch' }
  const first = await theFirstStepEachPathClashesAt(host, path, head, chain, paths)
  if ('refused' in first) return first
  const labels = new Map([...first.ok].filter(([, step]) => step !== the_branch).map(([clashed, step]) => [clashed, step.label]))
  const on_the_branch = paths.filter((clashed) => !labels.has(clashed))
  if (on_the_branch.length === 0) return { ok: labels }
  const traced = await alongTheBranch(host, path, head, the_branch, on_the_branch, nameAFirstParent)
  if ('refused' in traced) return traced
  for (const clashed of on_the_branch) labels.set(clashed, traced.ok.get(clashed)?.label ?? the_branch.label)
  return { ok: labels }
}

/** The first commit of the default branch since the head branched at which each path clashes. */
async function alongTheBranch(
  host: Pick<HostContract, 'processes'>,
  path: string,
  head: string,
  the_branch: AStep,
  paths: readonly string[],
  nameAFirstParent: (commit: AFirstParent) => string,
): Promise<Step<ReadonlyMap<string, AStep>>> {
  const parents = await theFirstParentsSince(host, path, the_branch.commit, head)
  if ('refused' in parents) return parents
  const steps = parents.ok.map((commit) => ({ commit: commit.commit, label: nameAFirstParent(commit) }))
  return theFirstStepEachPathClashesAt(host, path, head, steps, paths)
}

/** One line of `--format=%H %s` as the commit it names. */
function aFirstParent(line: string): AFirstParent {
  const space = line.indexOf(' ')
  return space === -1 ? { commit: line, subject: '' } : { commit: line.slice(0, space), subject: line.slice(space + 1) }
}

/** git run in `cwd`, with Martha's own settings in front of its arguments. */
function git(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  return host.processes.run({ command: GIT, args: marthasOwnGitArgs(args), cwd })
}

/** What git said, as one line. */
function saidBy(outcome: ProcessOutcome): string {
  const words = outcome.stderr.trim() === '' ? outcome.stdout.trim() : outcome.stderr.trim()
  return words === '' ? `it ended with ${String(outcome.exit_code)}` : (words.split('\n')[0] ?? words)
}
