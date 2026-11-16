// The coincidences of find_the_unheld_work: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { BACKLOG } from '../declare_crew/declare_crew.ts'

/** Why `backlog` is spelled here: it is a label on GitHub, chosen by the people who triage issues. */
const A_GITHUB_LABEL = 'the GitHub label `backlog` marks an issue as queued work; it is the label people put on issues, not the declaration key that happens to share the word'

export const COINCIDENCES: readonly Exception[] = [
  { value: BACKLOG, file: 'find_the_unheld_work/find_the_unheld_work.ts', reason: A_GITHUB_LABEL },
  { value: BACKLOG, file: 'find_the_unheld_work/find_the_unheld_work.node-test.ts', reason: A_GITHUB_LABEL },
]
