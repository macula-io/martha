// The `wait_for_ci` tool (martha#320 package B, #443 part 5): what it takes, and what a wait reads.
//
// A wait names one commit, and every read of it goes through the crew's one GitHub budget: the tools slice
// (../a_crews_tools) builds the spender and keeps only the table that calls this. The tools slice also reads the call's
// arguments first, and asks this launch for its processes only after them (martha#443 part 5 r=2): a call that names no
// repository is answered by that, even in a launch that could not act, which is the order the base's handler had.

import { REPO } from '../open_and_finish_a_worktree/the_repositorys_name.ts'
import type { TheGithubSpender } from '../spend_the_github_budget/spend_the_github_budget.ts'
import { A_COMMIT, A_RUN_ID, WAIT_FOR_CI, WAIT_FOR_CI_DESCRIPTION, theAnswerOf, theNameOf, waitForCi, type TheCiWait } from './wait_for_ci.ts'

/** What `wait_for_ci` takes, as the mod registers it (martha#976: the commit whose runs count, or one run by its id). */
export const WAIT_FOR_CI_TOOL = {
  name: WAIT_FOR_CI,
  description: WAIT_FOR_CI_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'The repository, owner/name' },
      sha: { type: 'string', description: 'The commit whose runs count: the tip you were handed' },
      run_id: {
        type: 'string',
        description: 'With repo, instead of sha: one run by the id GitHub gave it, the digits as the text GitHub gave them',
      },
    },
    required: ['repo'],
  },
}

/** What the tool answers: what the runs on the commit came to, or why the call named no wait. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** `wait_for_ci`: the CI on one sha, or on one run, read through the crew's one GitHub budget, for a wait already read. */
export async function theCiWaitOver(spender: TheGithubSpender, asked: TheCiWait): Promise<AToolAnswer> {
  const outcome = await waitForCi(spender, asked)
  return { answer: theAnswerOf(outcome, theNameOf(asked), spender.zone) }
}

/** The one sentence both refusals open with, and the ways a call can be wrong about it (martha#976). */
const NAME_A_FORM = 'a CI wait names either a commit, as forty hex digits, or a run id'

/** What a call named as `name`, as the text it wrote: a string trimmed, a number as its digits, or '' when it named none. */
function theNamedValue(args: Readonly<Record<string, unknown>>, name: string): string {
  const value = args[name]
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

/**
 * Whether a run id is digits that a number holds exactly: past the largest such number two ids round to one, and the
 * wait would read, and keep a green for, a run nobody named (review r=1).
 */
const aRunIdHeldExactly = (run_id: string): boolean => A_RUN_ID.test(run_id) && Number.isSafeInteger(Number(run_id))

/**
 * Why a run id sent as a number is refused rather than read (review r=2): JSON parses a long digit string into the
 * nearest number, so the id rounds to its neighbour before any line of ours runs, and the wait could keep a green for a
 * run nobody asked for. The digits are held exactly only when they come as text.
 */
const A_RUN_ID_IS_TEXT = 'a run id is sent as the digits GitHub gave it, as text, never as a number: JSON rounds a long id to its neighbour before the wait can hold it, so a number can name a run nobody asked for'

/** Why the run id a call named is refused, or '' when it is text whose digits a number holds exactly (review r=1, r=2). */
function theRunIdRefusal(named: unknown, run_id: string): string {
  if (typeof named === 'number') return `${A_RUN_ID_IS_TEXT}; read ${JSON.stringify(run_id)}.`
  if (!aRunIdHeldExactly(run_id)) return `a run id is a whole number, as GitHub gave it; read ${JSON.stringify(run_id)}.`
  return ''
}

/** The wait a call names, or why it names none: a repository as owner/name, and one of its two forms. */
export function theCiWaitACallNames(args: Readonly<Record<string, unknown>>): { readonly ok: TheCiWait } | { readonly refused: string } {
  const repo = theNamedValue(args, 'repo')
  if (!REPO.test(repo)) return { refused: `a CI wait names its repository as owner/name; read ${JSON.stringify(repo)}.` }
  const sha = theNamedValue(args, 'sha')
  const run_id = theNamedValue(args, 'run_id')
  if (sha !== '' && run_id !== '') return { refused: `${NAME_A_FORM}, not both.` }
  if (sha === '' && run_id === '') return { refused: `${NAME_A_FORM}.` }
  if (run_id !== '') {
    const refusal = theRunIdRefusal(args['run_id'], run_id)
    if (refusal !== '') return { refused: refusal }
    return { ok: { repo, run_id: Number(run_id) } }
  }
  if (!A_COMMIT.test(sha)) return { refused: `a CI wait names the commit whose runs count, as forty hex digits; read ${JSON.stringify(sha)}.` }
  return { ok: { repo, sha } }
}
