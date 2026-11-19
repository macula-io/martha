// The coincidences of wait_for_ci: words its own files spell like a constant held elsewhere, meaning something else
// by them, each with its reason (martha#289, #437). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { RUNS_DIRECTORY } from '../run_an_owner_signed_command/run_a_signed_shape.ts'

export const COINCIDENCES: readonly Exception[] = [
  // A test asserts which endpoint the wait read: `actions/runs` is GitHub's REST path for a repository's workflow-run
  // collection, spelled as the API spells it. The constant holds the folder a signed shape's runs sit in, under
  // Martha's own state directory, which no part of this read touches.
  { value: RUNS_DIRECTORY, file: 'wait_for_ci/wait_for_ci.node-test.ts', reason: 'the `runs` of `actions/runs` is GitHub\'s REST collection for workflow runs, read from the API\'s own path; the constant holds the folder a signed shape\'s runs sit in (martha#437)' },
]
