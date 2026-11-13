// The places that must name a value by literal, with the reason (martha#289).
//
// The rule fails on a literal that restates an exported constant, and a word can
// mean something else in a file that is not about the constant: `'config'` is a
// git subcommand in a test that drives git, `'Bash'` is recorded host data. Each
// such place is declared here by its value and its file, with one line saying why
// the word there is not the constant's.
//
// This list is held to its own standards, so it cannot become a baseline:
//   - the check fails when an entry matches no literal in its file any more;
//   - the check fails when an entry has no reason, or repeats another entry;
//   - it is never generated: an entry is written by hand, for a place a reviewer
//     has read, and it is the only place a word is excused in that file.
//
// Keyed by value and file, so a file that drives git thirty times is one entry.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'

/** Why the five landing tools are named by literal in the hooks module (martha#256), as one wording for all five. */
const A_HOOKS_MODULE = 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal'

export const EXCEPTIONS: readonly Exception[] = [
  // The five landing tools' hooks (martha#256): a hooks module runs with no Node and may import only its own files,
  // so the slice's own constant is not reachable there, and the host's plugin validator refuses a tool named by
  // anything but a literal. Each entry names the constant rather than another copy of its value.
  { value: VERIFY_RANGE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: LAND_BATCH, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: FAST_FORWARD_AFTER_THE_OWNERS_YES, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: WORKTREE_OPEN, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: WORKTREE_FINISH, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
]
