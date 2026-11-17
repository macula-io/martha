// Run the check: node src/check_marthas_names_are_its_own/main.ts [--root <dir>]
//
// Exit 0 no file spells a name crew-code owns, 1 one such name (one line each, `path:line: '<name>' is <what crew-code
// calls it>`) or an exception that excused nothing, 2 the check could not look. It never passes because it could not
// look.
//
// What it reads, and what it does not: a source is read as the parser reads it, so a comment naming a crew-code name is
// silent and a string or a template piece naming one is a finding; a fixture or a shell script is read as text, a name
// found where it stands between characters that cannot be part of one. Prose and pictures are not read, because a
// document explains the difference between the two programs and must be free to name them.
//
// The exception list (./the_exceptions.ts) is the only place a name may stand until its rename lands, one entry per
// file and name, each naming the PR that removes it. An exception that excuses nothing is a finding of its own.
//
// Two files are not read at all, and they are the only two: the table (./the_crew_code_names.ts) and that exception
// list, which are where a crew-code name must stand. Everything else of the slice is judged like the rest of the tree.
//
// What it cannot see, stated: a name built from pieces at run time, a bare word that is also Martha's own (`crew` is a
// crew, in this program, everywhere), and a name only a host composes. It catches the names the inventory lists and
// mistakes besides; review guards the rest.

import { join } from 'node:path'

import { judgeTree, type Judged } from './judge_a_tree.ts'
import type { DeclaredException } from './the_exceptions.ts'

const NAME = 'check_marthas_names_are_its_own'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** The verdict over the tree, in the words a red run prints. */
const judge = (judged: Judged): number => {
  if (judged.files === 0) {
    console.error(`${NAME}: the check could not look: no file of a kind it reads was found under the tree`)
    return 2
  }
  for (const finding of judged.findings) console.error(`${finding.path}:${finding.line}: '${finding.text}' is ${finding.what}`)
  for (const exception of judged.stale as readonly DeclaredException[]) {
    console.error(`${exception.path}: '${exception.text}' is excused by nothing (${exception.reason}; removed by ${exception.removed_by})`)
  }
  const said = judged.findings.length + judged.stale.length
  if (said > 0) {
    console.error(`${NAME}: ${said} finding(s)`)
    return 1
  }
  console.log(`${NAME}: ${judged.files} file(s) read, no name of crew-code's is Martha's`)
  return 0
}

/** The repository this check lives in: this file's directory, two levels below it. */
const CHECKOUT = join(import.meta.dirname, '..', '..')

const run = (root: string): number => judge(judgeTree(root))

try {
  process.exitCode = run(option('--root') ?? CHECKOUT)
} catch (failure) {
  console.error(`${NAME}: the check could not be made: ${failure instanceof Error ? failure.message : String(failure)}`)
  process.exitCode = 2
}
