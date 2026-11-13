// The tips a branch removal covers (martha#391).
//
// This exists so a yes to "delete that branch" covers every copy the deletion removes: the clone's own branch and
// origin's. On 2026-11-13 an ask recorded one tip while the branch existed at two, the owner's yes removed one copy,
// the deletion then refused the other, and the owner was asked a second time for the same work.
//
// The two copies are read where each is really held, in the clone the ask names (<clones>/<org>/<repo>): the clone's
// own branch with `rev-parse --verify --quiet refs/heads/<branch>`, and origin's with `ls-remote --heads origin
// refs/heads/<branch>` — the remote itself, never the clone's remote-tracking ref, which is behind the remote as soon
// as anyone pushes and would record a tip the owner's yes cannot remove.
//
// A removal is refused rather than recorded half-read: half a removal (a branch with no repository, or the other way),
// a repository that is not owner/name, a place with no processes or no clones place to read them in, an origin that
// cannot be read, and a branch neither copy holds. What each refusal says is named here, once, and pinned beside this
// file, because the member that asked reads it instead of a queued ask.

import { join } from 'node:path'

import type { HostContract } from '../host_contract/host_contract.ts'
import { REPO } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'

/**
 * A commit id as git prints one: seven characters at the shortest, and whatever length the repository's hash is at the
 * longest. A row that carries anything else is not a tip this launcher read.
 */
export const A_COMMIT_ID = /^[0-9a-f]{7,64}$/

/** The branch an ask would remove, and the tip each copy of it stands at. Either tip may be absent, which says no copy holds it. */
export interface ABranchItRemoves {
  readonly branch: string
  readonly local_tip: string | null
  readonly origin_tip: string | null
}

/** What an ask that removes a branch says of the tips it removes: one line naming every copy, so one yes covers all. */
export function theTipsItRemoves({ branch, local_tip, origin_tip }: ABranchItRemoves): string {
  const local = local_tip === null ? 'no copy of its own' : `this clone at ${local_tip}`
  const origin = origin_tip === null ? 'no copy on origin' : `origin at ${origin_tip}`
  return `It removes ${branch}, and the ask records both tips the yes covers: ${local}, ${origin}.`
}

/** Why half a removal is refused: the words the member that asked is answered with, and the words a test pins. */
export const WHY_HALF_A_REMOVAL =
  'an ask that removes a branch names both repo (as owner/name) and branch together: they say which copy the yes removes'

/** Why a place that cannot read the tips is refused: the launcher reads them, never the member's own guess. */
export const WHY_THE_TIPS_CANNOT_BE_READ =
  'this launch holds no processes or names no clones place, so the tips of the branch this ask removes cannot be read'

/** Why a branch neither copy holds leaves nothing to ask about, in the clone's own name for itself. */
export const theNeitherCopySays = (clone: string, branch: string): string =>
  `neither ${clone} nor origin holds ${branch}, so there is no deletion for the owner to answer`

/**
 * Why a branch the queue would change is refused (martha#391 r=1). Git accepts a name carrying a direction override or a
 * zero-width character, and a name longer than an ask may be; the queue's own text rule would strip or cut it, so the
 * owner would answer yes to a name whose tips were never read. Refused here instead, before git is asked anything.
 */
export const WHY_THE_BRANCH_WOULD_BE_CHANGED =
  "the branch this ask removes is not one the queue keeps as it stands: a name carrying a control or hidden character, or one longer than an ask may be, would reach the owner as a different branch. Name the branch as git names it"

/**
 * What a removal needs to be read: the host's processes, the clones root the crew's declaration names, and the rule the
 * queue holds a branch to. A place may hold no processes and no clones place; it may hold no rule of its own, because
 * the rule is the queue's and is read from that one definition (../queue_the_owners_asks's theBranch).
 */
export interface ThePlaceTheTipsAreRead {
  readonly processes?: HostContract['processes'] | undefined
  readonly clones?: string | null | undefined
  readonly keepsTheBranch: (text: string) => string
}

/** The repository and branch a call names as the removal its ask covers, or nothing when it names neither, or why it will not do. */
function theRemovalACallNames(
  places: ThePlaceTheTipsAreRead,
  args: Readonly<Record<string, unknown>>,
): { readonly repo: string; readonly branch: string } | { readonly refused: string } | undefined {
  const repo = args['repo']
  const branch = args['branch']
  if (repo === undefined && branch === undefined) return undefined
  if (typeof repo !== 'string' || typeof branch !== 'string' || !REPO.test(repo) || branch.trim() === '') {
    return { refused: WHY_HALF_A_REMOVAL }
  }
  if (places.keepsTheBranch(branch) !== branch) return { refused: WHY_THE_BRANCH_WOULD_BE_CHANGED }
  return { repo, branch }
}

/**
 * The branch an ask would remove and the tip each copy of it stands at, or nothing when the ask names no branch; or why
 * the tips cannot be read. Half a removal, a repository that is not owner/name, a branch the queue would change, and a
 * place with no processes or no clones place are refused before git is asked anything, so nothing is recorded half-read
 * and no tip is ever read for a name the owner would not read.
 */
export async function theBranchItRemoves(
  places: ThePlaceTheTipsAreRead,
  args: Readonly<Record<string, unknown>>,
): Promise<ABranchItRemoves | { readonly refused: string } | undefined> {
  const named = theRemovalACallNames(places, args)
  if (named === undefined || 'refused' in named) return named
  const { processes, clones } = places
  if (processes === undefined || clones === undefined || clones === null) return { refused: WHY_THE_TIPS_CANNOT_BE_READ }
  const clone = join(clones, named.repo)
  const local_tip = await theTipTheCloneHolds(processes, clone, named.branch)
  const origin = await theTipTheRemoteHolds(processes, clone, named.branch)
  if ('refused' in origin) return origin
  return local_tip === null && origin.found === null
    ? { refused: theNeitherCopySays(clone, named.branch) }
    : { branch: named.branch, local_tip, origin_tip: origin.found }
}

/** The commit the clone's own branch stands at, or null when the clone has no such branch: a ref git will not resolve is a copy that is not there. */
async function theTipTheCloneHolds(processes: HostContract['processes'], clone: string, branch: string): Promise<string | null> {
  const outcome = await processes.run({ command: 'git', args: marthasOwnGitArgs(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]), cwd: clone })
  const tip = outcome.stdout.trim()
  return outcome.exit_code === 0 && A_COMMIT_ID.test(tip) ? tip : null
}

/**
 * The commit origin's branch stands at, or null when origin has no such branch, or why origin could not be read. A
 * remote that answers nothing has no branch; a remote that fails is not a remote with no branch, and an ask recorded
 * against it would cover one copy of a deletion and cost the owner the second ask this slice exists to prevent.
 */
async function theTipTheRemoteHolds(
  processes: HostContract['processes'],
  clone: string,
  branch: string,
): Promise<{ readonly found: string | null } | { readonly refused: string }> {
  const ref = `refs/heads/${branch}`
  const outcome = await processes.run({ command: 'git', args: marthasOwnGitArgs(['ls-remote', '--heads', 'origin', ref]), cwd: clone })
  if (outcome.exit_code !== 0) {
    const why = outcome.stderr.trim() === '' ? `git ended ${String(outcome.exit_code)}` : outcome.stderr.trim()
    return { refused: `origin could not be read from ${clone}, so an ask that removes ${branch} would cover one copy and is refused: ${why}` }
  }
  const named = outcome.stdout.split('\n').map((line) => line.split('\t')).find(([, held]) => held?.trim() === ref)
  return { found: named?.[0]?.trim() ?? null }
}
