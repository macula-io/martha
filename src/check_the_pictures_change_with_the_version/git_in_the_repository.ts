// git, as the picture check runs it in the repository it reads (martha#627).
//
// Every run carries Martha's own settings in front (../run_marthas_own_git). This holds that once, so the check never
// spells it again.

import { spawnSync } from 'node:child_process'

import { marthasOwnGitArgs } from '../run_marthas_own_git/run_marthas_own_git.ts'
import { GIT } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** How a run ended, as the program reads it. */
export interface Ran {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/** git run in the repository, however it ends. */
export function gitRan(repository: string, args: readonly string[]): Ran {
  const ran = spawnSync(GIT, [...marthasOwnGitArgs(args)], { cwd: repository, encoding: 'utf8' })
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr }
}

/** What git in this clone says, when it ends well. */
export function gitSaid(repository: string, args: readonly string[]): string | undefined {
  const ran = gitRan(repository, args)
  return ran.status === 0 ? ran.stdout.trim() : undefined
}

/** What a run said, as one line: its own words, or the status it ended with when it said none. */
export function saidBy(program: string, ran: Ran): string {
  const first = (ran.stderr.trim() === '' ? ran.stdout.trim() : ran.stderr.trim()).split('\n')[0] ?? ''
  return first === '' ? `${program} ended with ${String(ran.status)}` : first
}
