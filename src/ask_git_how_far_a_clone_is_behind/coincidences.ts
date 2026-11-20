// The coincidences of ask_git_how_far_a_clone_is_behind: words its own files spell like a constant held elsewhere,
// meaning something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax
// tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { WORKTREES } from '../declare_crew/declare_crew.ts'

export const COINCIDENCES: readonly Exception[] = [
  { value: WORKTREES, file: 'ask_git_how_far_a_clone_is_behind/ask_git_how_far_a_clone_is_behind.ts', reason: 'git\'s own folder for linked worktrees under a common dir, where each keeps its FETCH_HEAD; not the crew\'s worktree place' },
]
