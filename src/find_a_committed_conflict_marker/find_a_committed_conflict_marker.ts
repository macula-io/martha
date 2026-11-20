// A committed conflict marker, found in a tree before the owner is asked to land it (martha#968, a port of crew-code's
// core/conflict_markers.ts, written after a default branch carried `<<<<<<< HEAD`, `||||||| 895300e`, `=======`
// and `>>>>>>> origin/main` in a CHANGELOG nothing had read).
//
// This exists so verify_range and land_batch refuse the same lines in the same words. A line opening `<<<<<<< `,
// `||||||| ` or `>>>>>>> ` is a marker wherever it stands. A bare `=======` is one only inside a block, between an
// opening `<<<<<<< ` and its `>>>>>>> `: outside one it is a markdown setext heading's underline, which is legitimate.
//
// The finder (markersInText) is pure. The tree reader asks git which files hold an opening marker at a commit, reads
// only those, and hands them to the finder; every run of git carries marthasOwnGitArgs and goes through the contract's
// processes.run.

import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** The three markers that are one wherever a line opens with them and a space. */
export const OPENING_MARKERS = ['<<<<<<<', '|||||||', '>>>>>>>'] as const

/** The marker that is one only inside a block. */
export const DIVIDER = '======='

/** How many findings a refusal names one by one before it counts the rest. */
export const FINDINGS_NAMED = 10

/** One marker line: the file, its line number from 1, and the marker. */
export interface AMarker {
  readonly path: string
  readonly line: number
  readonly marker: string
}

type Step<T> = { readonly ok: T } | { readonly refused: string }

const [BLOCK_OPENS, , BLOCK_CLOSES] = OPENING_MARKERS
const escaped = (marker: string): string => marker.replace(/[|]/g, '[|]')
const AN_OPENING = new RegExp(`^(${OPENING_MARKERS.map(escaped).join('|')}) `)
const A_DIVIDER = new RegExp(`^${DIVIDER}\\r?$`)

/** Every marker line in one file's text, in order. */
export function markersInText(path: string, text: string): readonly AMarker[] {
  const found: AMarker[] = []
  let in_a_block = false
  text.split('\n').forEach((line, index) => {
    const opened = AN_OPENING.exec(line)?.[1]
    const marker = opened ?? (in_a_block && A_DIVIDER.test(line) ? DIVIDER : undefined)
    if (marker === undefined) return
    found.push({ path, line: index + 1, marker })
    if (marker === BLOCK_OPENS) in_a_block = true
    if (marker === BLOCK_CLOSES) in_a_block = false
  })
  return found
}

/** The findings as one clause: `a.md:22, a.md:24, …`, the first ten and a count of the rest. */
export function theMarkersSaid(found: readonly AMarker[]): string {
  const named = found.slice(0, FINDINGS_NAMED).map((one) => `${one.path}:${String(one.line)}`).join(', ')
  return found.length > FINDINGS_NAMED ? `${named} and ${String(found.length - FINDINGS_NAMED)} more` : named
}

/**
 * The one notice verify_range and land_batch give beside their answer when a tree holds marker lines, or nothing when
 * it holds none. A marker is a notice, never a refusal: the refusal cut took it so (martha#601).
 */
export function aConflictMarkerNotice(commit: string, found: readonly AMarker[]): string | undefined {
  return found.length === 0 ? undefined : `the tree at ${commit} holds a committed conflict marker at ${theMarkersSaid(found)}.`
}

/** Every marker line in the tree at `commit` in the clone at `path`, or why git could not say. */
export async function theMarkersAt(host: Pick<HostContract, 'processes'>, path: string, commit: string): Promise<Step<readonly AMarker[]>> {
  const candidates = await git(host, path, ['grep', '-I', '-l', '-z', '--full-name', '-E', AN_OPENING.source, commit, '--', ':(top)'])
  if (candidates.exit_code === 1) return { ok: [] }
  if (candidates.exit_code !== 0) return { refused: `${path} could not be searched for a conflict marker at ${commit}: ${saidBy(candidates)}.` }
  const found: AMarker[] = []
  for (const file of theFilesIn(candidates.stdout, commit)) {
    const read = await git(host, path, ['show', `${commit}:${file}`])
    if (read.exit_code !== 0) return { refused: `${file} at ${commit} could not be read: ${saidBy(read)}.` }
    found.push(...markersInText(file, read.stdout))
  }
  return { ok: found }
}

/**
 * The files a `git grep -l -z` answer names, with the tree it searched taken off each one. Without -z git quotes a name
 * that is not plain ASCII or holds a tab, and `git show` of the quoted name finds no such path, so one marker in
 * `café.md` would turn the notice into a refusal.
 */
function theFilesIn(said: string, commit: string): readonly string[] {
  return said
    .split('\0')
    .filter((line) => line !== '')
    .map((line) => (line.startsWith(`${commit}:`) ? line.slice(commit.length + 1) : line))
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
