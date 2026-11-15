// Run the leftover-member check (martha#472), over this machine's kernel:
//
//   node src/check_no_member_outlives_its_run/main.ts [--proc <dir>]
//
// Exit 0 looked, and found no member under a run's home; 1 one or more found, or a place this reader could not tell
// about; 2 the check could not be made. It never passes because it could not look: a process whose environment the
// kernel will not give this reader is said and counted, and does not fail the check, since an unreadable environment is
// evidence of nothing (setuid tools and sandboxes of the owner's own run that way).
//
// `--proc` reads another kernel's tree, which is how a test drives this gate: a runner holds no members of its own, and
// the check that bites on a member a run left behind is find_a_member_a_run_left_behind's to prove, over this machine.

import { statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { itFails, theLinesOf, whatARunLeft, type WhatARunLeft } from '../find_a_member_a_run_left_behind/the_leftovers_a_run_left.ts'
import { THE_PLACES_A_STATE_ROOT_KEEPS, theReadingsThisMachineGives } from '../read_a_kernel_and_a_home/read_a_kernel_and_a_home.ts'

const NAME = 'check_no_member_outlives_its_run'

/** Every finding as its line, and the status: a leftover or a place it could not tell about fails it. */
function reportFindings(found: readonly WhatARunLeft[]): number {
  for (const line of theLinesOf(found)) console.error(line)
  const failing = found.filter(itFails)
  const unread = found.length - failing.length
  const said =
    failing.length === 0
      ? 'no member outlives a run'
      : `${failing.length} line(s) above: a member a run left behind, or a place this check could not tell about`
  console.error(`${NAME}: ${said}${unread === 0 ? '' : `, and ${unread} process(es) of yours it could not read`}`)
  return failing.length === 0 ? 0 : 1
}

/** The gate over a kernel: every line, and whether anything was said that fails it. */
function theGate(proc_root: string): number {
  try {
    statSync(join(proc_root, 'self', 'status'))
  } catch {
    console.error(`${NAME}: could not be made: ${proc_root} is not a /proc this reader can read`)
    return 2
  }
  return reportFindings(whatARunLeft(theReadingsThisMachineGives(proc_root, THE_PLACES_A_STATE_ROOT_KEEPS)))
}

/** The value of `name` in the arguments, or undefined when it was not given. */
const option = (name: string): string | undefined => {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

process.exitCode = theGate(option('--proc') ?? '/proc')
