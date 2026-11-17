// The `park_a_member` and `wake_a_member` tools (martha#343, #443 part 5): their names, what each is for, the schema of
// what each takes, and what a park does.
//
// Both read the same arguments — a reason, and whose park it is — so what a call must say is written once, and the act a
// call moves is the tool's, never an argument's. The tools slice (../a_crews_tools) keeps only the table that calls this.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { returnedForTrigger, type TheTriggerPlace } from '../switch_a_members_model/the_switch_tools.ts'
import { parkAMember, type ParkingHost } from './park_and_wake_a_member.ts'

/** The name a member parks with (martha#343): one act, and it says which by being this tool. */
export const PARK_A_MEMBER = 'park_a_member'

/** The name a member wakes another with (martha#343): the other half of the park, as a tool of its own. */
export const WAKE_A_MEMBER = 'wake_a_member'

/** What `park_a_member` says it is for: the design's own words, and what a park does and does not do. */
export const PARK_A_MEMBER_DESCRIPTION =
  'Park a member, so it is not refreshed between tasks and is never started by Martha on its own. A member may always park itself; parking another needs the declaration\'s table, and a refusal names the act that would have allowed it. Leave `member` out to park yourself.'

/** What `wake_a_member` says it is for: the other half, and what a wake does with the marker it finds. */
export const WAKE_A_MEMBER_DESCRIPTION =
  'Bring a member out of a park, so it is refreshed between tasks again. The marker is written, not removed, so the reason stays readable. A member may always wake itself; waking another needs the declaration\'s table, and a refusal names the act that would have allowed it. Leave `member` out to wake yourself.'

/** What `park_a_member` takes, as the mod registers it. */
export const PARK_A_MEMBER_TOOL = {
  name: PARK_A_MEMBER,
  description: PARK_A_MEMBER_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why you park, in one line: the owner reads it, and so does whoever wakes you' },
      member: { type: 'string', description: 'Whose park to set; leave it out for your own' },
    },
    required: ['reason'],
  },
}

/** What `wake_a_member` takes: the same arguments as a park, and the reason is read on the marker. */
export const WAKE_A_MEMBER_TOOL = {
  name: WAKE_A_MEMBER,
  description: WAKE_A_MEMBER_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why you wake it, in one line: the owner reads it on the marker' },
      member: { type: 'string', description: 'Whose park to clear; leave it out for your own' },
    },
    required: ['reason'],
  },
}

/** The declaration as parking reads it: each member's name and role, and the table of who may what. */
/** What a park or a wake is handed: the crew's store, this member, the declaration, and what the call said. */
export interface AParkAsked {
  readonly stores: TheCrewFilesStores
  readonly member: string
  readonly settings: CrewSettings
  readonly now: number
  /** Where a switch is recorded, for the return a park makes (martha#315). */
  readonly switching: TheTriggerPlace
  /** The reason, as the call wrote it. */
  readonly reason: string
  /** The member the call names, or '' for this launch's own. */
  readonly onto: string
}

/** What the tool answers: what landed, or why no park moved. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/**
 * `park_a_member` and `wake_a_member`: one act each over the crew's marker, and the member is told what landed. The act
 * a call moves is the tool's, never an argument's (martha#343): the `parked` flag this replaces was the only reason one
 * tool could be asked for two things, and a flag the tool could not read had to be refused (martha#255 part 2 r=1 R3).
 */
export async function theParkToolOver(asked: AParkAsked, act: typeof parkAMember): Promise<AToolAnswer> {
  if (asked.reason === '') return { refused: 'a park or a wake says why in one line, and this one says nothing' }
  const member = asked.onto === '' ? asked.member : asked.onto
  const names = asked.settings.members.map((one) => one.name)
  if (!names.includes(member)) return { refused: `${member} is not on this crew (its members are ${names.join(', ')}), so there is no park to move.` }
  const said = act({ stores: asked.stores } satisfies ParkingHost, {
    actor: asked.member,
    member,
    reason: asked.reason,
    at: new Date(asked.now),
    declaration: asked.settings,
  })
  if ('refusal' in said) return { refused: said.refusal }
  const told = `${said.parked ? 'parked' : 'not parked'}: ${member} — ${said.reason}`
  const home = await theParkReturnsIt(asked, act === parkAMember, said.parked)
  return { answer: home === null ? told : `${told} ${home}` }
}

/**
 * The return a park makes of it (martha#315): a member that parks is back on its own model, and the return happens on
 * the next turn's order rather than inside this call, because a host command cannot run inside a turn. Null when this
 * was a wake, or when the park was refused.
 */
const theParkReturnsIt = async (asked: AParkAsked, isAPark: boolean, parked: boolean): Promise<string | null> =>
  isAPark && parked ? await returnedForTrigger(asked.switching, 'you parked') : null
