// The `who_is_free` tool's answer (martha#319 package A): who may ask, and what the Supervisor is told.
//
// The tools slice (../a_crews_tools) only gathers the rows and the park markers; every decision of this tool is here,
// so the adapter decides nothing. Who may ask is the declaration's own table, as for parking (#255 r=3): the launch's
// member, never a name read out of the call, and only when its role is allowed `assign_work`. A solo crew's one member
// and a team's Supervisor both pass; a builder does not, because choosing who takes work is not its act.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { ThePark } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import type { CrewRow } from '../see_the_crew/see_the_crew.ts'
import { mayTakeAPackage, seeWhoIsFree, theAnswerToMayTake } from './see_who_is_free.ts'

/** The name the tool is registered under. */
export const WHO_IS_FREE = 'who_is_free'

/** What the tool says it is for. */
export const WHO_IS_FREE_DESCRIPTION =
  `Before you give a member a package: every member's model, state, context, what it holds, its step, how old its last report and its last beat are, and what stands in its way. ` +
  `Name a member to ask one question: may it take a package now? A no says why and names the members that fit instead, the same provider first. ` +
  `Only a role the declaration allows assign_work may ask.`

/** What the tool is handed: the declaration, who asks, the rows, how to read a park, the time, and whom it asks about. */
export interface WhoIsFreeAsked {
  readonly settings: Pick<CrewSettings, 'members' | 'mode'>
  readonly asker: string
  readonly rows: readonly CrewRow[]
  readonly parkOf: (member: string) => ThePark
  readonly now: number
  /** The member asked about, or '' for every member's row. */
  readonly member: string
}

/** The tool's answer: every row as JSON, or the one question answered in words; or why the asker may not ask. */
export function whoIsFreeOver(asked: WhoIsFreeAsked): { readonly answer: string } | { readonly refused: string } {
  const refused = whyTheAskerMayNot(asked.settings, asked.asker)
  if (refused !== null) return { refused }
  const crew = {
    rows: asked.rows,
    declared_models: Object.fromEntries(asked.settings.members.map((member) => [member.name, member.model])),
    parkOf: asked.parkOf,
    now: asked.now,
  }
  if (asked.member === '') return { answer: JSON.stringify(seeWhoIsFree(crew)) }
  const answer = mayTakeAPackage(crew, asked.member, asked.asker)
  return 'refused' in answer ? answer : { answer: theAnswerToMayTake(answer) }
}

/** Why `asker` may not ask who is free, or null when its declared role is allowed to assign work: choosing who takes work is assigning it. */
function whyTheAskerMayNot(settings: Pick<CrewSettings, 'members' | 'mode'>, asker: string): string | null {
  const granted = settings.mode.may.assign_work
  const role = settings.members.find((member) => member.name === asker)?.role
  if (role !== undefined && granted.includes(role)) return null
  return `${asker} may not ask who is free: the declaration allows assign_work to ${granted.join(', ') || 'nobody'}, and ${asker}'s role is ${role ?? 'none on this crew'}.`
}
