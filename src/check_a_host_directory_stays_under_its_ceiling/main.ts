// Run the check: node src/check_a_host_directory_stays_under_its_ceiling/main.ts
//                     [--repository <path>] [--measure | --record]
//
// Every directory package.json declares under martha.hostAdapters or
// martha.hostGlue carries a ceiling in martha.hostCeilings: how many lines of
// code it may hold. A directory over its ceiling is a decision that hid where no
// core check reads it, and this fails it by name (martha#322). A ceiling above
// its directory's count fails too: it is room for that decision to grow back
// unseen, so the change that shrinks a directory brings its ceiling down with
// --record (martha#341).
//
// --measure prints each declared directory's count and judges nothing: what a
// member reads when a new directory is declared and its first ceiling has to be
// chosen by hand.
// --record brings an existing ceiling down to its count, and never raises one and
// never invents one, which is why it is the only way the map is written.
//
// Every core slice (every directory under src not declared a host directory,
// src/host_contract included) is held to martha.sliceCap, and the few above it to
// their own ceiling in martha.sliceCeilings, judged the same way (martha#415).
// --record also lowers those, and takes out an exception whose slice is now at or
// under the cap.
//
// Exit 0 every directory at its ceiling and every slice within what it may hold,
// 1 a directory over its ceiling, a ceiling above its directory, a declared
// directory with no ceiling, a ceiling no list declares a directory for, no cap,
// or a slice over the cap or its own ceiling, under it, or an exception that is
// stale, 2 the check could not be made. It never passes because it could not look.

import { readFileSync, writeFileSync } from 'node:fs'

import { manifestPathOf } from '../../prove_the_core/declared_in_package_json.ts'
import { describe } from './check_a_host_directory_stays_under_its_ceiling.ts'
import { describeASlice } from './the_core_slices_under_the_cap.ts'
import { judgeTheTree, type Judged } from './judge_the_tree.ts'
import { withLoweredCeilings, withLoweredSliceCeilings } from './record_the_ceilings.ts'

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
  for (const [slice, code] of Object.entries(judged.slices)) console.log(`${String(code).padStart(6)}  ${slice}  (core slice)`)
  return 0
}

/** Brings a ceiling down to its count, and takes out a slice's exception at or under the cap: the maps' only writer, and
 * it never raises a number nor invents one. */
const record = (repository: string, judged: Judged): number => {
  const path = manifestPathOf(repository)
  const hosts = withLoweredCeilings(readFileSync(path, 'utf8'), judged.code)
  const slices = withLoweredSliceCeilings(hosts.text, judged.slices)
  const lowered = [...hosts.lowered, ...slices.lowered]
  const removed = slices.removed ?? []
  if (lowered.length === 0 && removed.length === 0) {
    console.log(`${NAME}: no ceiling stands above its directory's count, so nothing was written`)
    return 0
  }
  // A text edit of a JSON file is checked to parse before it replaces the file: a
  // number is cheap to redo, a package.json that no longer loads is not.
  JSON.parse(slices.text)
  writeFileSync(path, slices.text)
  for (const { directory, from, to } of lowered) console.log(`${directory}: ceiling ${from} -> ${to}`)
  for (const slice of removed) console.log(`${slice}: at or under the cap, its exception taken out`)
  return 0
}

/** The verdict over the tree, in the words a red run prints. */
const judge = (judged: Judged): number => {
  const said = [...judged.findings.map(describe), ...judged.slice_findings.map(describeASlice)]
  for (const line of said) console.error(line)
  if (said.length > 0) {
    console.error(`${NAME}: ${said.length} finding(s)`)
    return 1
  }
  console.log(`${NAME}: ${judged.declared.length} host director(ies) at their ceilings, ${Object.keys(judged.slices).length} core slice(s) within what they may hold`)
  return 0
}

async function main(): Promise<number> {
  const repository = option('--repository') ?? '.'
  const judged = await judgeTheTree(repository)
  if (process.argv.includes('--measure')) return measure(judged)
  if (process.argv.includes('--record')) return record(repository, judged)
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
