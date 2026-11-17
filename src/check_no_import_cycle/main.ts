// Run the check: node src/check_no_import_cycle/main.ts [--root <dir>]
//
// Exit 0 no group of the core's files loads each other in a loop, 1 a loop (the whole path, one line) or an exception
// that excused nothing, 2 the check could not look. It never passes because it could not look.
//
// What it reads: every value import between the core's sources, from the syntax tree, so an import written inside a
// string or a comment is text and a real import split over lines is still an import. `import type` and the other
// type-only references close no loop, because they are erased at run time. An `export … from`, a dynamic `import()`
// and a `require()` do run, and each is followed like an `import`. A `node:` specifier, a package and a `.json` beside
// the sources leave the walk: a loop needs two modules of the core that load each other.
//
// What it cannot see, stated: a module a file loads by a name built at run time (the check that every import is a
// plain one, prove_the_core/imports_beyond_the_core, refuses those by name), and a loop that runs through a file of the
// repository outside `src/`, which is not a module of the core.
//
// The exception list (./the_exceptions.ts) names the groups allowed to keep a loop, one entry per group of files, each
// with the package that untangles it. An entry that excuses nothing is a finding of its own, so the list cannot go on
// excusing files that no longer load each other.

import { join } from 'node:path'

import { judgeTree, type Judged } from './judge_a_tree.ts'
import type { DeclaredCycle } from './the_exceptions.ts'

const NAME = 'check_no_import_cycle'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** One loop as a red run prints it: the whole path, from its first file round to it again. */
const theLoop = (paths: readonly string[]): string => paths.map((path) => `src/${path}`).join(' -> ')

/** The verdict over the tree, in the words a red run prints. */
const judge = (judged: Judged): number => {
  if (judged.files === 0) {
    console.error(`${NAME}: the check could not look: no source was found under src/`)
    return 2
  }
  for (const loop of judged.findings) {
    console.error(`${NAME}: ${loop.files.length} file(s) of the core load each other in a loop: ${theLoop(loop.through)}`)
  }
  for (const exception of judged.stale as readonly DeclaredCycle[]) {
    console.error(`${NAME}: ${exception.files.length} file(s) are excused by nothing (${exception.reason}; removed by ${exception.removed_by})`)
  }
  const said = judged.findings.length + judged.stale.length
  if (said > 0) {
    console.error(`${NAME}: ${said} finding(s)`)
    return 1
  }
  console.log(`${NAME}: ${judged.files} source(s) read, no loop of value imports in the core`)
  return 0
}

/** The repository this check lives in: this file's directory, two levels below it. */
const CHECKOUT = join(import.meta.dirname, '..', '..')

try {
  process.exitCode = judge(judgeTree(option('--root') ?? CHECKOUT))
} catch (failure) {
  console.error(`${NAME}: the check could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exitCode = 2
}
