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

/** What `worktree_finish` takes: the worktree, and the package it closes. */
export const WORKTREE_FINISH_TOOL = {
  name: WORKTREE_FINISH,
  description: WORKTREE_FINISH_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: { repo: A_REPOSITORY, slug: A_SLUG, package: A_PACKAGE },
    required: ['repo', 'slug', 'package'],
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
