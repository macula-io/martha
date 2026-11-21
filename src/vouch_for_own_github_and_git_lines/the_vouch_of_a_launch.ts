// The vouch one launch holds (martha#987): built once, when the launch's crew tools are, so the forks under the crew's
// orgs are listed at launch, and the login is asked once for the launch. A launch that cannot ask — no processes, no
// member environment, no declaration — or a crew that owns no org, holds no vouch, and every command result records
// as it always did.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { Processes } from '../host_contract/host_contract.ts'
import { vouchForTheLine } from './vouch_for_own_github_and_git_lines.ts'
import { theCrewsOwnRepositoriesIn, whatGithubAndGitSayIn } from './what_github_and_git_say.ts'

/** What a launch hands the vouch: its processes, the member's own environment, the declaration, and its checkout. */
export interface TheVouchesPlace {
  readonly processes?: Pick<Processes, 'run'> | undefined
  readonly member_env?: Readonly<Record<string, string | undefined>> | undefined
  readonly settings?: Pick<CrewSettings, 'own_orgs' | 'github'> | undefined
  /** A directory that exists, where a gh call that names its repository runs. */
  readonly root: string
}

/** The vouch a launch's crew tools carry, or none. */
export interface TheVouch {
  /** Whether a shell line is crew text: nothing but `gh` and git reads of the crew's own repositories. */
  readonly vouchesForTheLine?: (line: string) => Promise<boolean>
}

export function theVouchOfALaunch(place: TheVouchesPlace): TheVouch {
  const { processes, member_env, settings } = place
  if (processes === undefined || member_env === undefined || settings === undefined || settings.own_orgs.length === 0) return {}
  const probes = { run: (request: Parameters<Processes['run']>[0]) => processes.run(request), member_env, author_probe_ms: settings.github.author_probe_ms, cwd: place.root }
  const own = theCrewsOwnRepositoriesIn(probes, settings.own_orgs)
  const say = whatGithubAndGitSayIn(probes)
  return { vouchesForTheLine: (line) => vouchForTheLine(line, own, say) }
}
