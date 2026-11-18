// What the workspace guard refuses of a tool call a member's host reports (martha#562, port-map step 9, seam a).
//
// The relay answers every tool call the host makes. One of them is the member's shell: the call's own `command` is the
// line the shell will run, and a line reaches git in more ways than one — a `cd` first, a subshell, a `&&` — so the
// line is read by the one reader both the guard and the contract use (../read_the_git_calls_in_a_shell_line), and each
// call it finds is asked about by the glue the three seams share (../ask_git_what_a_member_is_about_to_change).
//
// A call the line does not place is asked about nowhere: the relay answers before the tool runs and does not know the
// member's working directory, so only a directory the line itself names (`cd`, `-C`) is known, and the rules that need
// a place do not fire without one (seams b and c catch those, where the directory is known). A call that is no git
// call, a line that reads as no call, and a crew that declared no workspace layout are all the same answer here:
// nothing is refused, because nothing is being guarded.
//
// This slice is a host adapter rather than a slice of the core: the shell tool's name is the host's own, and a core
// slice may not name it (../claude_code_host imports are an adapter's business).

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import type { CrewStore, TheFilesAndProcesses } from '../host_contract/host_contract.ts'
import { askGitWhatAMemberIsAboutToChange } from '../ask_git_what_a_member_is_about_to_change/ask_git_what_a_member_is_about_to_change.ts'
import type { TheWorkspace } from '../guard_workspace/guard_workspace.ts'
import { readTheGitCallsInAShellLine } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'

/** The call to judge: the host's tool and its input, the member making it, the crew's places, and a host to ask git. */
export interface AToolCallToGuard {
  readonly host: TheFilesAndProcesses
  readonly workspace: TheWorkspace
  readonly member: string
  /** The name the host gives the tool it is reporting, and the arguments the member's model was given for it. */
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
  /** The crew's own store, where what the member's last launch left is kept: a commit carrying it is refused (#693). */
  readonly leftovers?: CrewStore
}

/** The line the member's shell is about to run, when the call is that shell's and it names one. */
const theShellLineOf = (call: AToolCallToGuard): string | undefined => {
  if (call.tool !== CLAUDE_CODE_SHELL_TOOL) return undefined
  const line = call.input['command']
  return typeof line === 'string' && line !== '' ? line : undefined
}

/**
 * The refusal a tool call meets, or undefined when nothing refuses it: the shell's line read into its git calls, each
 * asked about with the facts git alone can say. Every call the line places is judged; a line that places none is judged
 * by nothing and passes.
 */
export async function refuseAGitCallInAMembersShell(call: AToolCallToGuard): Promise<string | undefined> {
  const line = theShellLineOf(call)
  if (line === undefined) return undefined
  const calls = readTheGitCallsInAShellLine(line)
  if (calls.length === 0) return undefined
  return askGitWhatAMemberIsAboutToChange({ host: call.host, calls, workspace: call.workspace, member: call.member, ...(call.leftovers === undefined ? {} : { leftovers: call.leftovers }) })
}
