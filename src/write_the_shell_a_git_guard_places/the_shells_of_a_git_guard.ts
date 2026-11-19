// The shell the git guard places: the member's `git` shim and the clone's `reference-transaction` hook (martha#562,
// seams b and c; martha#755).
//
// A slice of its own because the decisions in these programs are the guard's judgement, not its placement: which of
// git's calls are worth starting the judge for, and which transaction a hook can refuse (martha#755). The adapter
// (`guard_the_git_a_member_runs`) writes what this returns into the launch's own directory; it decides nothing here.
//
// Two filters keep a judge start for the calls and transactions a rule could refuse, and for nothing else (martha#755):
//
//   - The shim hands a call of a command no rule reads straight to the real git. Git's own options all begin with `-`,
//     so a first word that begins with no `-` is git's command word, and one that is not a command a rule reads cannot
//     be refused. Anything else — `-c`, `-C`, no word at all — is judged, so a shim that cannot tell starts the judge.
//   - The hook starts node only for `prepared`, and only when the transaction deletes a branch: the one thing seam (c)
//     refuses. Git calls it for every state of every transaction and writes its refs on its input, `<old> <new> <ref>`
//     a line, with a delete writing no object; a line this cannot read whole starts the judge rather than passing. What
//     is refused is unchanged, which is why the count falls and no verdict moves.
//
// The node is started with the member's own environment put aside either way (martha#772), and a call handed to the real
// git by the first filter is handed it untouched, since the judge never ran to have to give it back.
//
// The words these shells and the judge must spell the same are beside this file, in
// `the_words_the_guard_programs_share.ts`: the guard carries that file with the judge into a launch's directory, so the
// shell that keeps a variable back and the judge that hands it on cannot spell it two ways (martha#755).

import { A_BRANCH_REF, THE_COMMANDS_THE_WORKSPACE_RULES_READ } from '../guard_workspace/guard_workspace.ts'
import { THE_COMMANDS_THE_COMMIT_RULE_READS } from '../judge_the_commit_a_member_is_about_to_make/judge_the_commit_a_member_is_about_to_make.ts'
import { PREPARED, THE_HOOK_NAME, THE_MEMBER_HAD_IT, theHadNameOf, theKeptNameOf, WHAT_THE_JUDGE_NEVER_TAKES } from './the_words_the_guard_programs_share.ts'

/**
 * The git commands a judge start can be spent on: every command a rule behind the guard reads, and nothing else
 * (martha#755). Built from the rules' own lists, so a rule that starts reading a command the shim passes straight to the
 * real git is a command the shim starts judging, and the two cannot drift apart.
 */
export const THE_COMMANDS_THE_JUDGE_CAN_REFUSE: readonly string[] = [
  ...new Set([...THE_COMMANDS_THE_WORKSPACE_RULES_READ, ...THE_COMMANDS_THE_COMMIT_RULE_READS]),
].sort()

/**
 * The shell script the member's git and the clone's hook are: the launch's own node, the judge, and the mode, then the
 * words the caller handed it unchanged. A shell script rather than a shebang on the judge, because the node a launch
 * runs on can stand anywhere, and a script's first line is the one place a path with no length limit is safe.
 *
 * `mode` is the name the program is placed under: the hook's own name makes the hook, and any other makes the shim.
 */
export function theShimFor(mode: string, node: string, judge: string, realGit: string): string {
  const exec = `exec ${singleQuoted(node)} ${singleQuoted(judge)} ${singleQuoted(mode)} "$@"`
  const keptAndCleared = WHAT_THE_JUDGE_NEVER_TAKES.flatMap(keptAndClearedLines)
  return mode === THE_HOOK_NAME
    ? ['#!/bin/sh', ...theScriptsPreamble(), ...keptAndCleared, ...theHooksFilter(node, judge)].join('\n')
    : ['#!/bin/sh', ...theScriptsPreamble(), theShimsFilter(realGit), ...keptAndCleared, exec, ''].join('\n')
}

/** The lines every guard program opens with: what it is, and what its node takes from the member and what it does not. */
const theScriptsPreamble = (): readonly string[] => [
  `# Martha's git guard (martha#562): the judge decides, and the real git runs what it allows.`,
  `# The judge's node takes none of these from the member; each is kept for the real git (martha#772).`,
]

/**
 * The shim's first words: a call of a command no rule reads is handed to the real git here, before anything the judge
 * would have had to do, so the member's own environment reaches it exactly as the member set it (martha#772, martha#755).
 */
const theShimsFilter = (realGit: string): string =>
  [
    '# A command word no rule reads cannot be refused, so no judge is started for one (martha#755).',
    'case "$1" in',
    `${THE_COMMANDS_THE_JUDGE_CAN_REFUSE.map(singleQuoted).join('|')}) ;;`,
    `*) exec ${singleQuoted(realGit)} "$@" ;;`,
    'esac',
  ].join('\n')

/**
 * The hook's filter: git's input, read once, and the judge started only when the transaction can be refused — a delete
 * of a branch (martha#562). Every line is read as git writes it, `<old> <new> <ref>`; a line this cannot place starts
 * the judge, so a transaction nothing here understands is judged rather than passed.
 */
const theHooksFilter = (node: string, judge: string): readonly string[] => [
  'case "$1" in',
  `${singleQuoted(PREPARED)})`,
  '  # Git writes the transaction on the hook input, one ref a line; a delete names no new object (all zeros).',
  '  the_input=$(cat)',
  '  the_judged=',
  `  while IFS=' ' read -r the_old the_new the_ref; do`,
  '    [ -z "$the_old$the_new$the_ref" ] && continue',
  '    case "$the_old$the_new" in *[!0-9a-f]*) the_judged=1; continue ;; esac',
  '    [ -z "$the_ref" ] && { the_judged=1; continue; }',
  '    case "$the_new" in *[!0]*) continue ;; esac',
  `    case "$the_ref" in ${singleQuoted(A_BRANCH_REF)}*) the_judged=1 ;; esac`,
  '  done <<EOF',
  '$the_input',
  'EOF',
  '  if [ -n "$the_judged" ]; then',
  `    printf '%s\\n' "$the_input" | ${singleQuoted(node)} ${singleQuoted(judge)} ${singleQuoted(THE_HOOK_NAME)} "$@"`,
  '    exit $?',
  '  fi',
  '  ;;',
  'esac',
  'exit 0',
  '',
]

/** The shim's lines for one variable the judge never takes: its value and whether it was set, kept, then it is unset. */
function keptAndClearedLines(variable: string): readonly string[] {
  const kept = theKeptNameOf(variable)
  const had = theHadNameOf(variable)
  return [`${kept}="\${${variable}-}" ${had}="\${${variable}+${THE_MEMBER_HAD_IT}}"`, `export ${kept} ${had}`, `unset ${variable}`]
}

/** One word as a shell reads it as itself: in single quotes, the quote it holds ended and started again. */
const singleQuoted = (word: string): string => `'${word.replaceAll("'", `'\\''`)}'`
