// The lines a change adds, read from the diff of its net change (martha#289).
//
// The gate judges the lines a change adds, so this is the half of the range that
// the rule is held to, and the half that can be held in a test without a
// repository. It is the NET diff's new side, from the merge base: a copy added and
// removed again inside one branch adds nothing, and a branch that has merged the
// default branch is not blamed for the lines the default branch brought.
//
// A hunk names where its new side starts and how many lines it holds; a hunk that
// only removes lines adds none (`+N,0`), and a file the change deletes contributes
// no path at all.

import { CORE } from './the_core_the_check_reads.ts'

/** A path as the findings name it: relative to `src/`, which is the core. */
export const underCore = (path: string): string => (path.startsWith(`${CORE}/`) ? path.slice(CORE.length + 1) : path)

/**
 * The lines a unified diff adds, as `path:line` with the path under the core. The
 * new side of each hunk is what the change wrote; a hunk that only removes lines
 * adds none.
 */
export function addedLinesIn(diff: string): Set<string> {
  const added = new Set<string>()
  let path: string | undefined
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const named = line.slice(4)
      path = named === '/dev/null' ? undefined : underCore(named.replace(/^b\//, ''))
      continue
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (hunk === null || path === undefined) continue
    const first = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    for (let at = first; at < first + count; at += 1) added.add(`${path}:${at}`)
  }
  return added
}
