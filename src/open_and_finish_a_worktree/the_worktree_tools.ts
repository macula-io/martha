// The `worktree_open` and `worktree_finish` tools (martha#256, #443 part 5): the schema of what each takes, and what
// each answers.
//
// The slice's own answer keeps the told/refused split, and it is carried through as it is: wrapping every string as
// `{ answer }` would hand a member a refusal — a dirty worktree, an unpushed commit, another member's branch — as a
// success. The tools slice (../a_crews_tools) builds the request and keeps only the table that calls this.

import { A_PACKAGE } from '../keep_the_ledger/the_ledger_tools.ts'
import {
  WORKTREE_FINISH,
  WORKTREE_FINISH_DESCRIPTION,
  WORKTREE_OPEN,
  WORKTREE_OPEN_DESCRIPTION,
  type WorktreeAnswer,
  type WorktreesRequest,
} from './open_and_finish_a_worktree.ts'

/** The repository a worktree is made in or removed from (martha#256). */
export const A_REPOSITORY: Readonly<Record<string, unknown>> = { type: 'string', description: 'The repository, org/name' }

/** What a worktree is for: the slug its path and branch carry (martha#256). */
export const A_SLUG: Readonly<Record<string, unknown>> = {
  type: 'string',
  description: 'What the worktree is for, as lowercase letters, digits and hyphens',
}

/** The ignored entries a finish may throw away, by the name git gives them (martha#915). */
export const A_DISCARD_LIST: Readonly<Record<string, unknown>> = {
  type: 'array',
  items: { type: 'string' },
  description:
    'The ignored entries standing in the worktree that this finish may throw away, each as git names it (for example "node_modules/"). Every ignored entry must be named here, or the finish refuses and names the ones it was not told about.',
}

/** What `worktree_open` takes, as the mod registers it. */
export const WORKTREE_OPEN_TOOL = {
  name: WORKTREE_OPEN,
  description: WORKTREE_OPEN_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: A_REPOSITORY,
      slug: A_SLUG,
    },
    required: ['repo', 'slug'],
  },
}

/** The id of an ask the owner answered yes to, when a finish stands on one (martha#973). */
export const A_THE_OWNERS_YES: Readonly<Record<string, unknown>> = {
  type: 'string',
  description:
    "The id of an ask the owner answered yes to about removing this very repository's branch, as see_the_owners_asks prints it. The owner's yes covers the tip the ask recorded, and nothing else. Leave it out and the branch stays unless the default branch holds its work.",
}

/**
 * What `worktree_finish` takes: the worktree (or the branch a finished worktree left), the package it closes, what it may
 * throw away, and the owner's ask it may stand on (martha#962, martha#915, martha#973).
 */
export const WORKTREE_FINISH_TOOL = {
  name: WORKTREE_FINISH,
  description: WORKTREE_FINISH_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      repo: A_REPOSITORY,
      slug: A_SLUG,
      branch: {
        type: 'string',
        description: 'With repo, instead of slug: a branch whose worktree is already gone, like hygiea/183',
      },
      package: A_PACKAGE,
      owner_ok: {
        type: 'number',
        description:
          "1 when another member has said the package is closed, from a session whose role the crew's table grants finish_a_members_worktree: it closes that member's worktree or branch. Never set for one's own, and never by a member whose role the table does not grant it.",
      },
      discard_ignored: A_DISCARD_LIST,
      ask: A_THE_OWNERS_YES,
    },
    required: ['repo', 'package'],
  },
}

/** What the two tools answer: what the worktree's own slice said, told or refused. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/**
 * `worktree_open` and `worktree_finish`, over the request the launcher built; or the refusal of a place that can act in
 * none (martha#256), answered as it is, so the tools slice keeps only the table (martha#710).
 */
export async function theWorktreeToolOver(
  request: WorktreesRequest | { readonly refused: string },
  act: (request: WorktreesRequest, args: Readonly<Record<string, unknown>>) => Promise<WorktreeAnswer>,
  args: Readonly<Record<string, unknown>>,
): Promise<AToolAnswer> {
  if ('refused' in request) return request
  const answer = await act(request, args)
  return 'told' in answer ? { answer: answer.told } : { refused: answer.refused }
}
