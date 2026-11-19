// The shell the git guard places, held to what it writes (martha#755): a call of a command no rule reads goes straight
// to the real git, the hook starts the judge only for a transaction a rule could refuse, and the variables the judge
// never takes are kept for the real git rather than dropped. What the script does when it runs is measured in the
// adapter's own test, through the PATH a member's shell has; this test reads the text the launch writes.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { A_BRANCH_REF, THE_COMMANDS_THE_WORKSPACE_RULES_READ } from '../guard_workspace/guard_workspace.ts'
import { THE_COMMANDS_THE_COMMIT_RULE_READS } from '../judge_the_commit_a_member_is_about_to_make/judge_the_commit_a_member_is_about_to_make.ts'
import { PREPARED, theHadNameOf, theKeptNameOf, THE_HOOK_NAME, THE_MEMBER_HAD_IT, WHAT_THE_JUDGE_NEVER_TAKES } from './the_words_the_guard_programs_share.ts'
import { THE_SHIM_NAME } from '../guard_the_git_a_member_runs/the_guard_of_a_launch.ts'
import { theShimFor } from './the_shells_of_a_git_guard.ts'

/** What the launch runs the judge with, and the real git a judged call is handed to: no path of a machine's own. */
const THE_NODE = '/a/node/on/this/machine'
const THE_JUDGE = '/a/launch/guard/src/judge_a_git_call.ts'
const THE_REAL_GIT = '/usr/bin/the-real-git'

const theShim = (): string => theShimFor(THE_SHIM_NAME, THE_NODE, THE_JUDGE, THE_REAL_GIT)
const theHook = (): string => theShimFor(THE_HOOK_NAME, THE_NODE, THE_JUDGE, THE_REAL_GIT)

test('the shim judges exactly the commands its rules read, and hands the real git every other (martha#755)', () => {
  const shim = theShim()
  const theRulesRead = [...THE_COMMANDS_THE_WORKSPACE_RULES_READ, ...THE_COMMANDS_THE_COMMIT_RULE_READS]
  const passedToTheRealGit = theRulesRead.filter((command) => !shim.includes(`'${command}'`))
  assert.deepEqual(passedToTheRealGit, [], `the shim hands the real git a command its rules read: ${passedToTheRealGit.join(', ')}`)
  // And the other way round: a command no rule reads, which the judge could only answer allow to.
  const readByNothing = ['status', 'log', 'diff', 'show'].filter((command) => shim.includes(`'${command}'`))
  assert.deepEqual(readByNothing, [], `the shim starts the judge for a command no rule reads: ${readByNothing.join(', ')}`)
  assert.ok(shim.includes(`exec '${THE_REAL_GIT}' "$@"`), 'the shim does not hand the unjudged call to the real git')
})

test('the hook starts the judge only at prepared, and only when a line deletes a branch (martha#562)', () => {
  const hook = theHook()
  assert.ok(hook.includes(`'${PREPARED}')`), 'the hook does not decide on the state the judge judges')
  assert.ok(hook.includes(`'${A_BRANCH_REF}'*`), 'the hook does not single out a branch delete')
  // The hook is the seam a delete reaches past the shim through, so it never hands anything to the real git: a
  // transaction it lets through ends here, and git itself goes on with it.
  assert.ok(!hook.includes(THE_REAL_GIT), 'the hook hands the call to the real git, which is the shim\'s work alone')
  assert.ok(hook.trimEnd().endsWith('exit 0'), 'the hook does not let a transaction it did not judge through')
})

test('every variable the judge never takes is kept for the real git, and unset while the judge runs (martha#772)', () => {
  for (const program of [theShim(), theHook()]) {
    for (const variable of WHAT_THE_JUDGE_NEVER_TAKES) {
      assert.ok(program.includes(`${theKeptNameOf(variable)}="\${${variable}-}"`), `${variable} is not kept before the judge starts`)
      assert.ok(program.includes(`${theHadNameOf(variable)}="\${${variable}+${THE_MEMBER_HAD_IT}}"`), `${variable} does not say whether the member had it`)
      assert.ok(program.includes(`unset ${variable}`), `${variable} is not unset before the judge starts`)
    }
  }
})
