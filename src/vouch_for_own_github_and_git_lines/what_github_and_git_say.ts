// What GitHub and git say for the vouch, asked as crew-code asks them (martha#987, gap 15; crew-code's register.tsx
// probe and crew_command.ts fork listing, ported).
//
// gh runs with the member's own environment, so the login is the one the member acts as, and each call is bounded by
// the crew's `github.author_probe_ms`. git runs with the member's environment too, less every GIT_ variable, which
// would move the repository it reads. Every failure is the answer the vouch reads as a stranger's: '' or null.

import type { EnvironmentChange, Processes, ProcessRequest } from '../host_contract/host_contract.ts'
import { GIT, GITHUB_CLI } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import type { TheCrewsOwnRepositories, WhatGithubAndGitSay } from './vouch_for_own_github_and_git_lines.ts'

/** What the probe runs through, and what it runs with. */
export interface TheProbesPlace {
  readonly run: Processes['run']
  /** The member's own environment, as its host was started with it. */
  readonly member_env: Readonly<Record<string, string | undefined>>
  /** How long one gh call may take: the declaration's `github.author_probe_ms`. */
  readonly author_probe_ms: number
  /** Where a gh call that names its repository runs: any directory that exists. */
  readonly cwd: string
}

const ORIGIN = 'origin'
/** The one host whose repositories `own_orgs` names. */
const GITHUB_HOST = 'github.com'
/** A prefix every variable name starts with: dropping it starts the environment from nothing. */
const EVERY_NAME = ''
const GIT_VARIABLES = 'GIT_'
/** The variables that move every gh call to another repository or host. */
export const VARIABLES_THAT_MOVE_GH: readonly string[] = ['GH_REPO', 'GH_HOST']
/** crew-code's FORK_LIST_LIMIT: a listing this long may be cut short, so it is no answer. */
export const FORK_LIST_LIMIT = 1000

const REMOTE_FORMS = [
  /^(?:https|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^(?:[^@/]+@)?([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
]

/** `org/repo` of a GitHub remote URL (https, ssh or scp form), or '' for any other host or shape (crew-code's repoOfRemote). */
export function repoOfRemote(url: string): string {
  const match = REMOTE_FORMS.map((form) => form.exec(url.trim())).find((found) => found !== null)
  return match?.[1]?.toLowerCase() === GITHUB_HOST ? `${match[2] ?? ''}/${match[3] ?? ''}` : ''
}

/** The probe over a place: the login asked once per launch, at the first judgement that needs it. */
export function whatGithubAndGitSayIn(place: TheProbesPlace): WhatGithubAndGitSay {
  let login: Promise<string> | undefined
  return {
    originOf: (directory) => originOf(place, directory),
    login: () => (login ??= ghLines(place, ['api', 'user', '--jq', '.login']).then((lines) => lines?.[0] ?? '')),
    authorsOf: (repository, number) => authorsOf(place, repository, number),
  }
}

/**
 * The crew's own repositories for this launch: its orgs, the forks GitHub lists under them, asked now, at launch, and
 * the variables in the member's environment that move every gh call. One org whose forks cannot be listed, or whose
 * listing reaches the limit, makes the whole listing null, and then nothing is own.
 */
export function theCrewsOwnRepositoriesIn(place: TheProbesPlace, own_orgs: readonly string[]): TheCrewsOwnRepositories {
  const moved_by = VARIABLES_THAT_MOVE_GH.filter((name) => (place.member_env[name] ?? '') !== '')
  return { own_orgs, own_forks: own_orgs.length === 0 ? Promise.resolve([]) : forksUnder(place, own_orgs), moved_by }
}

async function forksUnder(place: TheProbesPlace, own_orgs: readonly string[]): Promise<readonly string[] | null> {
  const listed = await Promise.all(
    own_orgs.map((org) => ghLines(place, ['repo', 'list', org, '--fork', '--limit', String(FORK_LIST_LIMIT), '--json', 'nameWithOwner', '--jq', '.[].nameWithOwner'])),
  )
  if (listed.some((forks) => forks === null || forks.length >= FORK_LIST_LIMIT)) return null
  return listed.flatMap((forks) => forks ?? [])
}

/** crew-code's authors probe: the opener and whether it is a pull request, then every comment and review, paginated. */
async function authorsOf(place: TheProbesPlace, repository: string, number: number): Promise<readonly string[] | null> {
  const head = await ghLines(place, ['api', `repos/${repository}/issues/${number}`, '--jq', '.user.login, (.pull_request != null)'])
  if (head === null || head.length < 2) return null
  const [opener = '', is_a_pull_request] = head
  const threads = [`repos/${repository}/issues/${number}/comments`, ...(is_a_pull_request === 'true' ? [`repos/${repository}/pulls/${number}/reviews`, `repos/${repository}/pulls/${number}/comments`] : [])]
  const rest = await Promise.all(threads.map((path) => ghLines(place, ['api', '--paginate', path, '--jq', '.[].user.login'])))
  return rest.some((lines) => lines === null) ? null : [opener, ...rest.flatMap((lines) => lines ?? [])]
}

/** The directory's origin on github.com, where origin is its only remote; '' otherwise. */
async function originOf(place: TheProbesPlace, directory: string): Promise<string> {
  const remotes = await gitLines(place, directory, ['remote'])
  if (remotes?.length !== 1 || remotes[0] !== ORIGIN) return ''
  const url = await gitLines(place, directory, ['remote', 'get-url', ORIGIN])
  return url?.length === 1 ? repoOfRemote(url[0] ?? '') : ''
}

const ghLines = (place: TheProbesPlace, args: readonly string[]) =>
  linesOf(place, { command: GITHUB_CLI, args, cwd: place.cwd, environment: theMembersEnvironment(place.member_env, []), timeout_ms: place.author_probe_ms })

const gitLines = (place: TheProbesPlace, directory: string, args: readonly string[]) =>
  linesOf(place, { command: GIT, args: ['-C', directory, ...args], cwd: place.cwd, environment: theMembersEnvironment(place.member_env, [GIT_VARIABLES]), timeout_ms: place.author_probe_ms })

/** The output's non-empty lines when the process ended with 0; null for anything else, a process that could not start included. */
async function linesOf(place: TheProbesPlace, request: ProcessRequest): Promise<readonly string[] | null> {
  const ran = await place.run(request).catch(() => null)
  return ran?.exit_code === 0 ? ran.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '') : null
}

/** The member's own environment, every variable starting with one of `left_out` dropped. */
function theMembersEnvironment(member_env: TheProbesPlace['member_env'], left_out: readonly string[]): EnvironmentChange {
  const set = Object.fromEntries(
    Object.entries(member_env).filter((entry): entry is [string, string] => entry[1] !== undefined && !left_out.some((prefix) => entry[0].startsWith(prefix))),
  )
  return { drop_prefixes: [EVERY_NAME], set }
}
