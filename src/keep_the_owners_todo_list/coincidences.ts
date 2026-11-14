// The coincidences of keep_the_owners_todo_list: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { A_DRY_RUN } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'

/**
 * Why the owner's to-do list spells `check` by literal beside land_batch's dry-run argument of that spelling
 * (martha#339): there it is the tag of the DoneBy union, which TypeScript narrows on by literal, and the argument an act's
 * own check is given by, neither of which is a batch's dry run.
 */
const AN_ACTS_OWN_CHECK = 'the to-do list\'s own word for the check that closes an act, a union tag and an argument of its own; land_batch\'s dry-run argument is spelled the same and is not this'

export const COINCIDENCES: readonly Exception[] = [
  // land_batch's dry-run argument (martha#339) is spelled as the to-do list's own `check`, which means something else.
  { value: A_DRY_RUN, file: 'keep_the_owners_todo_list/keep_the_owners_todo_list.ts', reason: AN_ACTS_OWN_CHECK },
  { value: A_DRY_RUN, file: 'keep_the_owners_todo_list/keep_the_owners_todo_list.node-test.ts', reason: AN_ACTS_OWN_CHECK },
]
