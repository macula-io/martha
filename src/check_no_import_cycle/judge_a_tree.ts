// What one tree holds of value-import loops, judged once, for the command and for the tests (martha#525).
//
// One path through the judgment, used by the run CI makes and by the tests that plant trees: a test that judged by
// another path would prove nothing about the run that gates a change.

import { join } from 'node:path'

import { coreSources } from '../../prove_the_core/core_sources.ts'
import { cyclesIn, type Loop } from './the_cycles_in.ts'
import { EXCEPTIONS, type DeclaredCycle } from './the_exceptions.ts'

/** A tree, judged. */
export interface Judged {
  /** Every loop not excused, in the order the tree holds it. */
  readonly findings: readonly Loop[]
  /** Every exception that excused nothing, which says the list has stopped matching the tree. */
  readonly stale: readonly DeclaredCycle[]
  /** How many sources were read; zero means the check could not look, which is never a pass. */
  readonly files: number
}

/** Whether `loop` is the group `exception` names: the same files, whichever order the walk found them in. */
export function isTheLoopOf(loop: Loop, exception: DeclaredCycle): boolean {
  const named = [...exception.files].sort()
  return named.length === loop.files.length && named.every((path, at) => path === loop.files[at])
}

/** Every loop in the core under `root`, and every exception that excused nothing. */
export function judgeTree(root: string, exceptions: readonly DeclaredCycle[] = EXCEPTIONS): Judged {
  const sources = coreSources(join(root, 'src'))
  const loops = cyclesIn(sources)
  return {
    findings: loops.filter((loop) => !exceptions.some((exception) => isTheLoopOf(loop, exception))),
    stale: exceptions.filter((exception) => !loops.some((loop) => isTheLoopOf(loop, exception))),
    files: sources.length,
  }
}
