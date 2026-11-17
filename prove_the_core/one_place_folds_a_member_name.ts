// One place folds a member's name (martha#528).
//
// This exists so a member's name matches the same way everywhere: a `crew:` label, a report, a gate rule and a park all
// agree on who a member is, and changing the rule in one place changes it everywhere. Before #528 a dozen slices folded
// names with their own copy of the rule, some trimming and some not, and nothing failed when a copy drifted.
//
// The rule is mechanical, because whether a fold is "between two member names" is not something a reader of the text
// can tell: every case fold (`toLowerCase`, `toUpperCase` and their locale forms) in a script file under src/ that is not a test is
// named, except in ../src/declare_crew/member_names.ts, which holds the one rule, and in the files the list below
// declares with how many folds each holds and why none of them is a member's name (a node id, a git key, a package).
// A new fold anywhere is named by file and line; one more in a declared file changes its count and is named too, and a
// declared file that folds less than it says is named, so the list cannot go stale.

import type { CoreSource } from '../src/host_contract/core_source.ts'
import { isTestFile } from './declared_in_package_json.ts'

/** The one file a member's name is folded in: the rule the declaration owns. */
export const THE_ONE_RULE = 'declare_crew/member_names.ts'

/** A file that folds case for something that is not a member's name: how many folds it holds, and what they fold. */
export interface AFoldThatIsNotAName {
  readonly path: string
  readonly folds: number
  readonly reason: string
}

/** A node id is hex, compared case-folded by the mesh's own rule: nothing a member names. */
const A_NODE_ID = 'a node id, which is hex and compared case-folded by the mesh; not a member name'

/** Every file that folds case today for something other than a member's name, with its count and its reason. */
export const FOLDS_THAT_ARE_NOT_NAMES: readonly AFoldThatIsNotAName[] = [
  { path: 'admit_a_room_message/admit_a_room_message.ts', folds: 4, reason: A_NODE_ID },
  { path: 'attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts', folds: 2, reason: A_NODE_ID },
  { path: 'check_nothing_private_gets_in/check_nothing_private_gets_in.ts', folds: 6, reason: 'a GitHub owner/repo, which GitHub compares ignoring case' },
  { path: 'find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts', folds: 4, reason: 'a git config section, key or boolean word, which git reads ignoring case' },
  { path: 'know_the_goose_engines_facts/an_engine_source_from_its_facts.ts', folds: 1, reason: "a wire id written back as the Rust variant the engine's source names it by" },
  { path: 'know_the_goose_engines_facts/the_engines_facts_in_its_source.ts', folds: 1, reason: "a Rust variant name, spelled as the engine's serde snake_case puts it on the wire" },
  { path: 'keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts', folds: 1, reason: A_NODE_ID },
  { path: 'keep_the_package_contract/keep_the_package_contract.ts', folds: 2, reason: 'a package, owner/repo#n, which GitHub names ignoring case' },
  { path: 'keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts', folds: 2, reason: 'a package, owner/repo#n, which GitHub names ignoring case' },
  { path: 'name_a_node_by_its_petname/name_a_node_by_its_petname.ts', folds: 1, reason: A_NODE_ID },
  { path: 'prove_a_mesh_answer_is_wordless/prove_a_mesh_answer_is_wordless.ts', folds: 4, reason: A_NODE_ID },
  { path: 'read_a_ring_results_sender/read_a_ring_results_sender.ts', folds: 2, reason: A_NODE_ID },
  { path: 'recover_a_failed_act/recover_a_failed_act.ts', folds: 1, reason: 'the first letter of a sentence, capitalised for the member to read' },
  { path: 'refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts', folds: 1, reason: 'one ASCII letter of a path, folded as the host folds paths' },
  { path: 'refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.ts', folds: 1, reason: 'an npm config name from the environment, which npm reads ignoring case' },
  { path: 'refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts', folds: 2, reason: A_NODE_ID },
  { path: 'run_reviews_on_the_review_model/run_reviews_on_the_review_model.ts', folds: 1, reason: 'the words of a prompt, read for a review word' },
  { path: 'trust_only_signed_lists/trust_only_signed_lists.ts', folds: 2, reason: A_NODE_ID },
  { path: 'who_may_act/who_may_act.ts', folds: 2, reason: A_NODE_ID },
]

/** One fold the rule names: where it stands, and why it is named. */
export interface AFoldNamed {
  readonly path: string
  /** The line of the fold, or 0 when the finding is about the file's count rather than one line. */
  readonly line: number
  readonly why: string
}

/** A case fold, as a script calls one: either half, since a copy that upper-cases both names is the same comparison. */
const A_FOLD = /\.to(?:Locale)?(?:Lower|Upper)Case\s*\(/g

/** The lines of a source that fold case, by number; a line that is only a comment is not code and folds nothing. */
function foldsIn(text: string): readonly number[] {
  return text.split('\n').flatMap((line, index) => {
    const code = line.trimStart()
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return []
    return Array.from(line.matchAll(A_FOLD), () => index + 1)
  })
}

/** What a scan is told: which files the test script runs, and which folds are declared. */
export interface TheFoldScan {
  readonly test_suffixes: readonly string[]
  readonly declared?: readonly AFoldThatIsNotAName[]
}

/**
 * Every case fold the rule names, by file and line: one outside the rule and the declared files, and a declared file
 * whose count is not the one it declares. A test file is skipped: a planted fold is how this rule is proved.
 */
export function theFoldsNamedIn(sources: readonly CoreSource[], scan: TheFoldScan): readonly AFoldNamed[] {
  const declared = new Map((scan.declared ?? FOLDS_THAT_ARE_NOT_NAMES).map((fold) => [fold.path, fold]))
  const seen = new Set<string>()
  const named = sources
    .filter((source) => !isTestFile(scan.test_suffixes, source.path) && source.path !== THE_ONE_RULE)
    .flatMap((source): readonly AFoldNamed[] => {
      const lines = foldsIn(source.text)
      const allowed = declared.get(source.path)
      if (allowed === undefined) return lines.map((line) => ({ path: source.path, line, why: 'folds case outside the one rule' }))
      seen.add(source.path)
      if (lines.length === allowed.folds) return []
      return [{ path: source.path, line: 0, why: `folds case ${String(lines.length)} times, and its declaration says ${String(allowed.folds)}` }]
    })
  const missing = [...declared.keys()].filter((path) => !seen.has(path)).map((path) => ({ path, line: 0, why: 'is declared as folding case, and no such file was read' }))
  return [...named, ...missing]
}

/** What one finding is told: where it stands, and where the rule is. */
export const theFoldTold = (fold: AFoldNamed): string =>
  `${fold.path}${fold.line === 0 ? '' : `:${String(fold.line)}`}: ${fold.why}. Compare member names with sameMemberName or memberNameKey from ` +
  `declare_crew; a fold of something that is not a member's name is declared, with its count and reason, in prove_the_core/one_place_folds_a_member_name.ts.`
