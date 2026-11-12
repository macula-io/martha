// The origin a clone has (martha#256, slices 1 and 2).
//
// This exists so a range check and a landing name the repository and the default branch in the origin's own words rather
// than in a member's: `org/name`, read from the clone's origin URL, and `origin/main`, read from the ref the clone keeps
// for the origin's head. Nothing here writes, and nothing is guessed. A URL whose shape this does not know is refused
// rather than taken for a repository, so a package of another repository is never landed here; and a clone that keeps
// no ref for its origin's head is refused with the command that fixes it.
//
// It stands on its own so the two slices that need it read a URL in one place: git writes an origin in four forms (the
// `git@host:org/name` shorthand, `ssh://`, `https://`, and a local path), and a second copy of that reading would drift
// from this one. The shape of `org/name` itself is not defined here either: it is ../open_and_finish_a_worktree's REPO,
// the one home that name has.

import type { HostContract, ProcessOutcome } from '../host_contract/host_contract.ts'
import { REPO } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** What a clone's origin says about itself: the repository in GitHub's words, and the branch its default is. */
export interface TheOrigin {
  /** `org/name`, as the origin URL names it. */
  readonly repo: string
  /** The origin's default branch as git names it locally: `origin/main`. */
  readonly default_branch: string
}

/** The origin, or why this clone cannot say what it is. */
export type OriginRead = { readonly origin: TheOrigin } | { readonly refused: string }

const GIT_SUFFIX = '.git'

/**
 * The repository an origin URL names, `org/name`; undefined when the URL names none this can read. The last two
 * segments are taken, and the whole of what is left is held to REPO, so a URL carrying `..`, an empty segment or
 * anything that is not a repository name is refused rather than shortened into one.
 */
export function repoOfTheOrigin(url: string): string | undefined {
  const parts = thePathInUrl(url.trim()).split('/').filter((part) => part !== '')
  const [owner, name] = parts.slice(-2)
  if (owner === undefined || name === undefined) return undefined
  const repo = `${owner}/${name}`
  return REPO.test(repo) ? repo : undefined
}

/** The path part of an origin URL, whichever of git's forms it is in; '' when it carries none. */
function thePathInUrl(url: string): string {
  const without_suffix = url.endsWith(GIT_SUFFIX) ? url.slice(0, -GIT_SUFFIX.length) : url
  const shorthand = /^[^/@\s]+@[^:/\s]+:(.*)$/.exec(without_suffix)
  if (shorthand !== null) return shorthand[1] ?? ''
  const after_a_scheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(.*)$/.exec(without_suffix)
  if (after_a_scheme === null) return without_suffix
  // Everything up to the first slash is the authority, and a local URL (file:///clones/org/name) has an empty one, so
  // the slash is kept: from there on is the path either way.
  const rest = after_a_scheme[1] ?? ''
  return rest.includes('/') ? rest.slice(rest.indexOf('/')) : ''
}

/** git run in `cwd`, with Martha's own settings in front of its arguments. */
function git(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<ProcessOutcome> {
  return host.processes.run({ command: GIT, args: marthasOwnGitArgs(args), cwd })
}

/** What git said, when it ended well; undefined when it did not. */
async function gitSaid(host: Pick<HostContract, 'processes'>, cwd: string, args: readonly string[]): Promise<string | undefined> {
  const outcome = await git(host, cwd, args)
  return outcome.exit_code === 0 ? outcome.stdout.trim() : undefined
}

/**
 * The repository and the default branch of the clone at `path`, or why it cannot say: no origin remote, an origin URL
 * that names no repository, or no ref for the origin's head.
 */
export async function readTheOriginACloneHas(host: Pick<HostContract, 'processes'>, path: string): Promise<OriginRead> {
  const url = await gitSaid(host, path, ['remote', 'get-url', 'origin'])
  if (url === undefined) {
    return { refused: `${path} names no origin remote: run git remote add origin <url> there, then try again.` }
  }
  const repo = repoOfTheOrigin(url)
  if (repo === undefined) return { refused: `the origin of ${path} is ${JSON.stringify(url)}, which names no repository as org/name.` }
  const default_branch = await gitSaid(host, path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (default_branch === undefined) {
    return { refused: `${path} cannot say which branch its origin's default is: run git remote set-head origin -a there, then try again.` }
  }
  return { origin: { repo, default_branch } }
}
