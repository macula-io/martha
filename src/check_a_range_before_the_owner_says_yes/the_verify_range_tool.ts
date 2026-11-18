// The `verify_range` tool (martha#256, #443 part 5): the schema of what it takes, and what a checked range answers.
//
// The range's own schema pieces sit here because this slice owns the range: the two landing tools take the same clone,
// the same two ends and the same list of packages, and they import them from here rather than spelling them again.
// The tools slice (../a_crews_tools) keeps only the table that calls this.

import type { TheDeclaration } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { mayKeepTheOwnersList } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { A_PACKAGE } from '../keep_the_ledger/the_ledger_tools.ts'
import { VERIFY_RANGE, VERIFY_RANGE_DESCRIPTION, verifyRange, type RangeCheckHost, type TheRange } from './check_a_range_before_the_owner_says_yes.ts'

/** The clone a tool works in (martha#256): where the repository is on this machine, never a URL. */
export const A_CLONE: Readonly<Record<string, unknown>> = { type: 'string', description: 'The clone to work in, as a path on this machine' }

/** The base a range was checked against (martha#256). */
export const A_BASE: Readonly<Record<string, unknown>> = { type: 'string', description: 'The base the range was checked against, as a full sha' }

/** The tip a range ends at (martha#256). */
export const A_TIP: Readonly<Record<string, unknown>> = { type: 'string', description: 'The tip the range ends at, as a full sha' }

/** The work packages a landing or a checked range names (martha#256). */
export const THE_PACKAGES: Readonly<Record<string, unknown>> = {
  type: 'array',
  items: A_PACKAGE,
  description: 'The work packages it lands, each as owner/repo#n',
}

/** What `verify_range` takes, as the mod registers it. */
export const VERIFY_RANGE_TOOL = {
  name: VERIFY_RANGE,
  description: VERIFY_RANGE_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      path: A_CLONE,
      base: A_BASE,
      tip: A_TIP,
      packages: THE_PACKAGES,
    },
    required: ['path', 'base', 'tip'],
  },
}

/** What the tool answers: the one menu line the range came to, or why the call or the range was refused. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** Who asks for a range to be checked: the member the launcher started, and the declaration that says what its role may do. */
export interface TheRangeAsker {
  readonly member: string
  readonly declaration: TheDeclaration
}

/**
 * Why `asker` may not check a range, or undefined when it may (martha#605): checking a range for the owner's yes is the
 * Supervisor's work, so the predicate is the one the crew's other Supervisor tools stand on, `assign_work` read as the
 * owner's list reads it (../keep_the_owners_todo_list). A table that grants that act to the owner alone lets every member
 * check, as the owner's own sessions, so a solo crew keeps the tool.
 */
export function whyTheAskerMayNotCheckARange(asker: TheRangeAsker): string | undefined {
  if (mayKeepTheOwnersList(asker.declaration, asker.member)) return undefined
  const role = asker.declaration.members.find((one) => one.name === asker.member)?.role
  const granted = asker.declaration.mode.may.assign_work ?? []
  return `${asker.member} may not check a range: the declaration grants assign_work to ${granted.join(', ') || 'nobody'}, and ${asker.member}'s role is ${role ?? 'none on this crew'}. Nothing was read.`
}

/**
 * `verify_range`: the range a call names, checked by the slice that reads it and writes nothing (martha#256), for a
 * member the declaration lets check one (martha#605).
 *
 * The call's arguments are handed in already read (theRangeACallNames, above), because the tools slice reads them
 * before it asks this launch for the processes it acts with (martha#443 part 5 r=2): a call whose arguments are wrong
 * is answered by those arguments even in a launch that could not act, which is the order the base's handler had.
 */
export async function verifyTheRangeOver(host: RangeCheckHost, asker: TheRangeAsker, asked: TheRange): Promise<AToolAnswer> {
  const may_not = whyTheAskerMayNotCheckARange(asker)
  if (may_not !== undefined) return { refused: may_not }
  const checked = await verifyRange(host, asked)
  return 'told' in checked ? { answer: checked.told } : { refused: checked.refused }
}
