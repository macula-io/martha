// The `wait_for_ci` tool (martha#320 package B, #443 part 5): what it takes, and what a wait reads.
//
// A wait names one commit, and every read of it goes through the crew's one GitHub budget: the tools slice
// (../a_crews_tools) builds the spender and keeps only the table that calls this. A launch that holds no processes
// refuses the tool before it reaches here (martha#256).

import { REPO } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import type { TheGithubSpender } from '../spend_the_github_budget/spend_the_github_budget.ts'
import { A_COMMIT, WAIT_FOR_CI, WAIT_FOR_CI_DESCRIPTION, theAnswerOf, waitForCi, type TheCiWait } from './wait_for_ci.ts'

/** What `wait_for_ci` takes, as the mod registers it. */
export const WAIT_FOR_CI_TOOL = {
  name: WAIT_FOR_CI,
  description: WAIT_FOR_CI_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'The repository, owner/name' },
      sha: { type: 'string', description: 'The commit whose runs count: the tip you were handed' },
    },
    required: ['repo', 'sha'],
  },
}

/** What the tool answers: what the runs on the commit came to, or why the call named no wait. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** `wait_for_ci`: the CI on one sha, read through the crew's one GitHub budget. */
export async function theCiWaitOver(spender: TheGithubSpender, args: Readonly<Record<string, unknown>>): Promise<AToolAnswer> {
  const asked = theCiWaitACallNames(args)
  if ('refused' in asked) return { refused: asked.refused }
  const outcome = await waitForCi(spender, asked.ok)
  return { answer: theAnswerOf(outcome, asked.ok.sha) }
}

/** The wait a call names, or why it names none: a repository as owner/name, and a commit of forty hex digits. */
function theCiWaitACallNames(args: Readonly<Record<string, unknown>>): { readonly ok: TheCiWait } | { readonly refused: string } {
  const repo = typeof args['repo'] === 'string' ? args['repo'].trim() : ''
  const sha = typeof args['sha'] === 'string' ? args['sha'].trim() : ''
  if (!REPO.test(repo)) return { refused: `a CI wait names its repository as owner/name; read ${JSON.stringify(repo)}.` }
  if (!A_COMMIT.test(sha)) return { refused: `a CI wait names the commit whose runs count, as forty hex digits; read ${JSON.stringify(sha)}.` }
  return { ok: { repo, sha } }
}
