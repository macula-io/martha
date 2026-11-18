// What a call the guard's two later seams catch is refused for (martha#562, seams b and c).
//
// Seam (a) reads the shell line a tool call carries (../refuse_a_git_call_in_a_members_shell). These two catch a call
// that reached git with no tool call to read: the `git` the launch puts first on the member's PATH, and the clone's own
// reference-transaction hook. Both end in ../ask_git_what_a_member_is_about_to_change, and it ends in
// ../guard_workspace, so all three seams ask the rules one way.
//
// Neither asks a fact the one before it already asked, and neither asks git for anything it alone can say except the
// branch facts seam (b) needs: a transaction's refs are the whole of seam (c)'s question.

import type { CrewStore, HostContract } from '../host_contract/host_contract.ts'
import { askGitWhatAMemberIsAboutToChange } from '../ask_git_what_a_member_is_about_to_change/ask_git_what_a_member_is_about_to_change.ts'
import { refuseARefUpdate, type TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { isAbsolute } from 'node:path'
import { theGitCallsOfAShim } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'

/** A call a `git` on the member's PATH was handed (martha#562, seam b): the words a shell gave it, and where it runs. */
export interface ACallTheShimsGitWasHanded {
  readonly host: Pick<HostContract, 'processes'>
  readonly workspace: TheWorkspace
  readonly member: string
  /** The directory the shell runs the call in, as the shim saw it; a shell that names none asks about nothing. */
  readonly directory: string
  readonly args: readonly string[]
  /** The crew's own store, where what the member's last launch left is kept: a commit carrying it is refused (#693). */
  readonly leftovers?: CrewStore
}

/**
 * The refusal a `git` the launch put first on a member's PATH meets, before it runs (martha#562, seam b). The words are
 * read by the one reader a shell line is read by, so a call written in a line and the same call handed to the shim are
 * asked about alike; a call that names no directory is asked about nowhere, as one in a line the reader cannot place.
 */
export async function refuseAGitCallFromThePath(request: ACallTheShimsGitWasHanded): Promise<string | undefined> {
  const calls = isAbsolute(request.directory) ? theGitCallsOfAShim(request.args, { directory: request.directory }) : []
  return calls.length === 0
    ? undefined
    : askGitWhatAMemberIsAboutToChange({
        host: request.host,
        calls,
        workspace: request.workspace,
        member: request.member,
        ...(request.leftovers === undefined ? {} : { leftovers: request.leftovers }),
      })
}

/**
 * The refusal a clone's ref transaction meets (martha#562, seam c): a delete of a branch another member owns, which
 * reached git by an alias, a hook or git's absolute path, past the shell and past the shim. No fact only git can say is
 * needed here, so nothing is asked of git: the refs the transaction names are the whole of the question.
 */
export function refuseTheRefUpdates(
  updates: readonly { readonly ref: string; readonly deletes: boolean }[],
  workspace: TheWorkspace,
  member: string,
): string | undefined {
  return updates.map((update) => refuseARefUpdate(update, workspace, member)).find((refusal) => refusal !== undefined)
}
