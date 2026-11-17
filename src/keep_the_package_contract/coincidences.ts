// The coincidences of keep_the_package_contract: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289, #522). Read by the restated-values check as a syntax tree,
// never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { LAND } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { KEEP_THE_PACKAGE_CONTRACT } from './keep_the_package_contract.ts'

export const COINCIDENCES: readonly Exception[] = [
  // A contract's allowed actions are Martha's own verbs so that a contract works on every host (martha#513, gate:design
  // 2026-11-16 answer (b)). One of them is `land`, which the landing slice also holds as the name of the act a member
  // does; the contract's list is its own vocabulary and is read by a member as words, not by the landing as its act, so
  // it names the verb here rather than borrowing the landing's constant — a contract that imported it would follow a
  // rename of the landing's act silently, and a member would be told an action the tool no longer knows.
  { value: LAND, file: 'keep_the_package_contract/the_contract_in_a_brief.ts', reason: 'the allowed action `land` a contract names is the verb a member reads, and the contract\'s list is its own vocabulary rather than the landing act\'s constant (martha#513 answer (b))' },
  // An acceptance line names its evidence by the path of the test file, `src/<slice>/<slice>.node-test.ts`. This
  // slice's folder is named after the tool it holds, so the path spells the tool's registered name; the line names a
  // file, not the tool, and building that path from the constant would tie the folder layout to a tool's name.
  { value: KEEP_THE_PACKAGE_CONTRACT, file: 'keep_the_package_contract/keep_the_package_contract.node-test.ts', reason: 'the evidence of an acceptance line is a test file\'s path under src/, whose slice folder is named after the tool; the line names a file, not the registered tool name (martha#437)' },
]
