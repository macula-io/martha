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

export const EXCEPTIONS: readonly Exception[] = [
  // The five landing tools' hooks (martha#256). A hooks module runs with no Node and may import only its own files,
  // so the slice's own constant is not reachable here, and the host's plugin validator refuses a tool named by
  // anything but a literal. Each of these words is the slice's name and cannot be imported from this file.
  { value: 'verify_range', file: 'claude_code_relay/hooks/crew.tsx', reason: 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal' },
  { value: 'land_batch', file: 'claude_code_relay/hooks/crew.tsx', reason: 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal' },
  { value: 'fast_forward_after_the_owners_yes', file: 'claude_code_relay/hooks/crew.tsx', reason: 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal' },
  { value: 'worktree_open', file: 'claude_code_relay/hooks/crew.tsx', reason: 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal' },
  { value: 'worktree_finish', file: 'claude_code_relay/hooks/crew.tsx', reason: 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal' },
]
