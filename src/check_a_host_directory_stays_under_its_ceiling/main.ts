// Run the check: node src/check_a_host_directory_stays_under_its_ceiling/main.ts
//                     [--repository <path>] [--measure | --record]
//
// Every directory package.json declares under martha.hostAdapters or
// martha.hostGlue carries a ceiling in martha.hostCeilings: how many lines of
// code it may hold. A directory over its ceiling is a decision that hid where no
// core check reads it, and this fails it by name (martha#322).
//
// --measure prints each declared directory's count and judges nothing: what a
// member reads when a directory shrank and a ceiling could come down, or when a
// new directory is declared and its first ceiling has to be chosen by hand.
// --record brings an existing ceiling down to its count, and never raises one and
// never invents one, which is why it is the only way the map is written.
//
// Exit 0 every directory under its ceiling, 1 a directory over it, a declared
// directory with no ceiling, or a ceiling no list declares a directory for, 2 the
// check could not be made. It never passes because it could not look.

import { readFileSync, writeFileSync } from 'node:fs'

import { manifestPathOf } from '../../prove_the_core/declared_in_package_json.ts'
import { describe } from './check_a_host_directory_stays_under_its_ceiling.ts'
import { judgeTheTree, type Judged } from './judge_the_tree.ts'
import { withLoweredCeilings } from './record_the_ceilings.ts'

const NAME = 'check_a_host_directory_stays_under_its_ceiling'

const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

/** Exit 2, in the words the run prints: the check could not be made, and says why. */
const unreadable = (why: string): number => {
  console.error(`${NAME}: the check could not be made: ${why}`)
  return 2
}

/** The counts, one line each: what a member reads to choose or lower a ceiling. */
const measure = (judged: Judged): number => {
  for (const { list, directory } of judged.declared) {
    console.log(`${String(judged.code[directory] ?? 0).padStart(6)}  ${directory}  (${list})`)
  }
  return 0
}

/** Brings a ceiling down to its count: the map's only writer, and it never raises one. */
const record = (repository: string, code: Readonly<Record<string, number>>): number => {
  const path = manifestPathOf(repository)
  const text = readFileSync(path, 'utf8')
  const recorded = withLoweredCeilings(text, code)
  if (recorded.lowered.length === 0) {
    console.log(`${NAME}: no ceiling stands above its directory's count, so nothing was written`)
    return 0
  }
  // A text edit of a JSON file is checked to parse before it replaces the file: a
  // number is cheap to redo, a package.json that no longer loads is not.
  JSON.parse(recorded.text)
  writeFileSync(path, recorded.text)
  for (const { directory, from, to } of recorded.lowered) console.log(`${directory}: ceiling ${from} -> ${to}`)
  return 0
}

/** The verdict over the tree, in the words a red run prints. */
const judge = (judged: Judged): number => {
  for (const finding of judged.findings) console.error(describe(finding))
  if (judged.findings.length > 0) {
    console.error(`${NAME}: ${judged.findings.length} finding(s)`)
    return 1
  }
  console.log(`${NAME}: ${judged.declared.length} host director(ies) under their ceilings`)
  return 0
}

async function main(): Promise<number> {
  const repository = option('--repository') ?? '.'
  const judged = await judgeTheTree(repository)
  if (process.argv.includes('--measure')) return measure(judged)
  if (process.argv.includes('--record')) return record(repository, judged.code)
  return judge(judged)
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (failure: unknown) => {
    process.exitCode = unreadable(failure instanceof Error ? failure.message : String(failure))
  },
)
