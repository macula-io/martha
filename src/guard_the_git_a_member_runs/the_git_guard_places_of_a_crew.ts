// The three places the workspace guard is asked through, as a crew that declared a layout hands them to its tools
// (martha#562).
//
// One place per seam, built here so the launcher's own wiring is a line rather than three, and so the guard's questions
// are read one way whoever asks them: the relay's tool_called (seam a), the `git` first on a member's PATH (seam b), and
// the clone's own reference-transaction hook (seam c). A crew that declared no layout hands none of the three.

import type { CrewToolPlaces } from '../a_crews_tools/a_crews_tools.ts'
import type { HostContract } from '../host_contract/host_contract.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { refuseAGitCallInAMembersShell } from '../refuse_a_git_call_in_a_members_shell/refuse_a_git_call_in_a_members_shell.ts'
import { refuseAGitCallFromThePath, refuseTheRefUpdates } from './a_call_the_guards_seams_ask_about.ts'

/** The places the guard is asked through, each ending in ../ask_git_what_a_member_is_about_to_change. */
export type TheGitGuardPlaces = Pick<CrewToolPlaces, 'refusesTheGitCall' | 'refusesTheGitOnThePath' | 'refusesTheRefUpdate'>

/**
 * The guard's three places for `member`, in `workspace`, on `host`: undefined when the crew declared no layout, which is
 * a crew whose git is guarded by nothing.
 */
export function theGitGuardPlacesOf(
  workspace: TheWorkspace | undefined,
  member: string,
  host: Pick<HostContract, 'processes'>,
): TheGitGuardPlaces | undefined {
  if (workspace === undefined) return undefined
  const at = { host, workspace, member }
  return {
    refusesTheGitCall: (call) => refuseAGitCallInAMembersShell({ ...at, ...call }),
    refusesTheGitOnThePath: (call) => refuseAGitCallFromThePath({ ...at, ...call }),
    refusesTheRefUpdate: (updates) => refuseTheRefUpdates(updates, workspace, member),
  }
}
