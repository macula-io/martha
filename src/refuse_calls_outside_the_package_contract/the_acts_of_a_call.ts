// What act a tool call is, in the words a package's contract allows (martha#513 slice 2).
//
// This exists so a contract's `allowed` line can be held against every tool call without the gate knowing what a host
// calls its tools. The table is closed: a call that is not on it is not an act, and no contract notices it. Every act is
// read from what the call itself says, never from a name given to it — the same rule the shell gate reads text by.
//
//   land     the crew's own tools that move the default branch, under whatever name the host calls them by
//   push     a shell command that runs `git push`, wherever in its words that sits and however git is named
//   tag      a shell command that runs `git tag`; `git push --tags` is both, and needs both allowed
//   handoff  a message whose first line readACrewLine reads as a HANDOFF for the package this member holds
//
// A push is read wherever `git` appears rather than only where a command begins: a member writes it as the last line of
// a script, behind `cd x&&`, inside `( )`, after an `&`, behind an assignment or behind git's own `-C` and `-c`. Reading
// only a command's first word missed every one of those. The cost is the other way round: `echo git push` is read as a
// push and refused, where the quoted `echo "git push"` is one word and no act at all. A refusal that is too eager is
// recoverable; one that is too shy is not, so the table errs towards refusing. `sh -c "git push"` and `eval` stay out:
// a word the reader cannot take apart is a word it does not guess at.
//
// Writing a handover is deliberately not an act and is never refused: it is how a member outlives its context, and a
// contract that could refuse it could trap a member whose context runs out (martha#513 slice 2, Mercurius's ruling).

import { CONTRACT_ACTIONS, type ContractAction } from '../keep_the_package_contract/the_contract_in_a_brief.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { readTheGitCallsInAShellLine, type AGitCall } from '../read_the_git_calls_in_a_shell_line/read_the_git_calls_in_a_shell_line.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'

/** The acts a contract's `allowed` line may name: slice 1's own list, so the two vocabularies cannot drift apart. */
export const CONTRACT_ACTS = CONTRACT_ACTIONS
export type AContractAct = ContractAction

/** A call as the act table reads it: the tool it names, and the arguments it carries. */
export interface AReadableCall {
  readonly tool: string
  readonly input?: Readonly<Record<string, unknown>> | undefined
}

/**
 * The name a tool's own server gave it (`host_contract.ts`'s ownNameOf): a land arrives as `land_batch` under one host
 * and `mcp__martha__land_batch` under another, so the table asks the host rather than spelling either. A caller with no
 * split of its own says the called name is the own one.
 */
export type TheOwnNameOf = (called: string) => string

/** The default split: the name a call arrives under is the tool's own, which is right for a host with no server names. */
const itsOwnName: TheOwnNameOf = (called) => called

/** The acts one git call is: `tag` alone, `push` alone, and a push carrying `--tags` is both. */
function theActsOfAGitCall(call: AGitCall): readonly AContractAct[] {
  if (call.command === 'tag') return ['tag']
  if (call.command !== 'push') return []
  return call.args.includes('--tags') ? ['push', 'tag'] : ['push']
}

/** The acts a shell call is, by the calls the line makes: none for a command that runs no git act, none when it has none. */
function theActsOfAShellCall(call: AReadableCall): readonly AContractAct[] {
  if (!isShellTool(call.tool)) return []
  const command = call.input?.['command']
  return typeof command === 'string' ? readTheGitCallsInAShellLine(command).flatMap(theActsOfAGitCall) : []
}

/** Whether the call's text is a HANDOFF line for this package, as readACrewLine reads it. */
function isAHandoffFor(call: AReadableCall, held_package: string): boolean {
  const text = call.input?.['text']
  if (typeof text !== 'string') return false
  const reading = readACrewLine(text)
  if (!('line' in reading) || reading.line === null) return false
  return reading.line.verb === 'HANDOFF' && reading.line.package === held_package
}

/** Every act this call is, in the contract's own words: deduplicated, and none for a call the table does not name. */
export function theActsOfACall(call: AReadableCall, held_package: string, ownNameOf: TheOwnNameOf = itsOwnName): readonly AContractAct[] {
  const acts: AContractAct[] = [...theActsOfAShellCall(call)]
  const own_name = ownNameOf(call.tool)
  if (own_name === LAND_BATCH || own_name === FAST_FORWARD_AFTER_THE_OWNERS_YES) acts.push(LAND)
  if (isAHandoffFor(call, held_package)) acts.push('handoff')
  return [...new Set(acts)]
}
