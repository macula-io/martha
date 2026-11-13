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
import { CREW_REFRESH } from '../carry_taint_across_a_refresh/carry_taint_across_a_refresh.ts'
import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { WHOLE_FILE_CONTENT } from '../claude_code_host/claude_code_file_tools.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'

/**
 * Why the relay's mod names these three by literal (martha#255): the host installs
 * the relay as a copy of its own folder, and a hooks module may import only its own
 * files, so no constant of the core is reachable from inside it.
 */
const THE_RELAY_CANNOT_IMPORT = 'the host installs the relay as a copy of its own folder, so a hooks module there imports only its own files and the name it asks is held by literal'

/** Why the five landing tools are named by literal in the hooks module (martha#256), as one wording for all five. */
const A_HOOKS_MODULE = 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal'

/**
 * Why the handover's one argument is named by literal (martha#255): it is the
 * argument the host's Write call takes, and the constant holding it sits in the
 * host glue, which a slice may not import (prove_the_core keeps that boundary).
 * The word is too common to define again: defining it would make every `content`
 * in the tree stale at once, and a member's tool call is not worth that.
 */
const THE_ARGUMENT_OF_A_WRITE = 'the host\'s own name for the argument that holds a whole file, which lives in the host glue a slice may not import'

export const EXCEPTIONS: readonly Exception[] = [
  // The one rule in src/check_no_literal_restates_a_value makes an entry name its
  // value, so the value is written as the constant that holds it: a literal here
  // would be the same copy the rule exists to catch, in the very file that excuses it.
  { value: THE_REFRESH_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: WRITE_MY_HANDOVER_TOOL, file: 'claude_code_relay/hooks/crew.tsx', reason: `the name of a tool this mod answers and registers; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: CREW_REFRESH, file: 'claude_code_relay/hooks/crew.tsx', reason: `the name of the other tool this mod answers and registers; ${THE_RELAY_CANNOT_IMPORT}` },
  // The five landing tools' hooks (martha#256): a hooks module runs with no Node and may import only its own files,
  // so the slice's own constant is not reachable there, and the host's plugin validator refuses a tool named by
  // anything but a literal. Each entry names the constant rather than another copy of its value.
  { value: VERIFY_RANGE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: LAND_BATCH, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: FAST_FORWARD_AFTER_THE_OWNERS_YES, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: WORKTREE_OPEN, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: WORKTREE_FINISH, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: WHOLE_FILE_CONTENT, file: 'a_crews_tools/a_crews_tools.ts', reason: `the one argument the handover tool takes; ${THE_ARGUMENT_OF_A_WRITE}` },
  { value: WHOLE_FILE_CONTENT, file: 'write_my_handover/write_my_handover.ts', reason: `the one argument this tool reads; ${THE_ARGUMENT_OF_A_WRITE}` },
]

