// The `restart_a_member` tool (martha#312, #443 part 5): its name, what it is for, the schema of what it takes, and what
// a restart asks of a stalled member's launcher.
//
// The caller is this launch's member, never a name read out of the call, and the slice decides who may, when, and whom.
// The tools slice (../a_crews_tools) keeps only the table that calls this, and refuses by name a launch given no place
// to ask a restart in.

import { randomUUID } from 'node:crypto'

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import { restartByTool } from './restart_a_member.ts'
import type { StoppingHost } from './stop_and_restart_a_member.ts'

/** The name the Supervisor restarts a stalled member with (martha#312): one act, asked of that member's own launcher. */
export const RESTART_A_MEMBER = 'restart_a_member'

/** What `restart_a_member` says it is for: what a restart does to the member, and what refuses one. */
export const RESTART_A_MEMBER_DESCRIPTION =
  'Restart a stalled member: its session is ended and started again on its own terminal, from its newest handover, or with none when `fresh` is set. A turn it was in is lost; the answer says when it ended mid-turn, so you send that work again. Only a role the declaration grants restart_member may, never for itself, and one member is not restarted twice by a tool inside the refresh storm window. A member that is not running is started with martha wake, not this.'

/** What `restart_a_member` takes, as the mod registers it. */
export const RESTART_A_MEMBER_TOOL = {
  name: RESTART_A_MEMBER,
  description: RESTART_A_MEMBER_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      member: { type: 'string', description: 'Whom to restart: a member of this crew other than you' },
      reason: { type: 'string', description: 'Why, in one line: the member\'s terminal and the ledger keep it' },
      fresh: { type: 'boolean', description: 'Start it with no handover; leave it out to resume from its newest one' },
    },
    required: ['member', 'reason'],
  },
}

/** What a restart is asked over: the member's launcher, this crew's declaration, and what the call said. */
export interface ARestartAsked {
  readonly lifecycle: StoppingHost
  readonly settings: CrewSettings
  /** The member this call came from: the one asking, never the one asked for. */
  readonly member: string
  readonly reason: string
  readonly onto: string
  readonly fresh: boolean
}

/** What the tool answers: what the member's launcher said it did, or why nothing was restarted. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** `restart_a_member`: the act is asked of the member's own launcher, and the call waits for its answer. */
export async function theRestartToolOver(asked: ARestartAsked): Promise<AToolAnswer> {
  if (asked.reason === '') return { refused: 'a restart says why in one line, and this one says nothing' }
  const asking = {
    member: asked.onto,
    by: asked.member,
    reason: asked.reason,
    id: randomUUID(),
    fresh: asked.fresh,
    declaration: asked.settings,
  }
  const said = await restartByTool(asked.lifecycle, asking)
  return said.kind === 'restarted' ? { answer: said.told } : { refused: said.told }
}
