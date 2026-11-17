// The `write_my_handover` tool (martha#16, #255, #443 part 5): what it is for, the schema of what it takes, and what a
// member's handover does.
//
// The host writes the file at a path it chose and stamps it: a handover a member writes with its own file tool is not one
// and clears nothing. The tools slice (../a_crews_tools) keeps only the table that calls this.

import type { HandoverStampStore } from '../host_contract/host_contract.ts'
import { theVolatileNote, volatilePathsIn } from '../tell_a_citer_of_a_volatile_path/volatile_paths.ts'
import type { HostSession } from '../take_in_a_turn/take_in_a_turn.ts'
import { WRITE_MY_HANDOVER_TOOL, theHandoverAToolWrote, type HandingOverHost } from './write_my_handover.ts'

/** What `write_my_handover` says it is for: the host writes the file, at the path the host chose, and stamps it. */
export const WRITE_MY_HANDOVER_DESCRIPTION =
  'Write your handover — what your successor needs to carry on — as one text. Martha writes and stamps the file at a path it chooses; a handover you write with your own file tool is not one and clears nothing. Answer MARTHA-HANDOVER-WRITTEN when your handover ask is done.'

/** What `write_my_handover` takes, as the mod registers it. */
export const WRITE_MY_HANDOVER_SCHEMA = {
  name: WRITE_MY_HANDOVER_TOOL,
  description: WRITE_MY_HANDOVER_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: { content: { type: 'string', description: 'The whole handover: first rules, what runs, open items, pending decisions, gotchas, and one line per package you hold' } },
    required: ['content'],
  },
}

/** What a handover is written over: the crew's store, its stamps, and the session this call came from. */
export interface TheHandoverAsked {
  readonly host: HandingOverHost
  readonly stamps: HandoverStampStore | undefined
  readonly sessions: { readonly of: (session_id: string) => HostSession | undefined } | undefined
  /** The session the call came from, as the launcher recorded it. */
  readonly session: string
  readonly member: string
  readonly now: () => number
  /** The roots a reboot deletes (martha#314), already in force: the crew's own, or the machine's when it names none. */
  readonly volatile_roots: readonly string[]
}

/** What the tool answers: the file it wrote and stamped, or why nothing was written. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/**
 * `write_my_handover`: the host writes the member's handover where the host chose and stamps it. A launch with no
 * stamps, or a call from a session this launch does not hold, refuses rather than writing a file nothing stamped —
 * which would be a handover no successor could inherit from (martha#16).
 */
export function theHandoverToolOver(asked: TheHandoverAsked, args: Readonly<Record<string, unknown>>): AToolAnswer {
  if (asked.stamps === undefined) return { refused: 'this launch keeps no handover stamps, so it writes no handover' }
  const session = asked.sessions?.of(asked.session)
  if (session === undefined) return { refused: 'this launch does not know the session this call came from, so no handover is stamped for it' }
  const wrote = theHandoverAToolWrote(
    { host: asked.host, stamps: asked.stamps, session, member: asked.member, now: () => new Date(asked.now()) },
    args,
  )
  if (!('answer' in wrote)) return { refused: wrote.refusal }
  // A handover that sends its successor to a path a reboot deletes says so to the member that wrote it, at the moment
  // it hands over (martha#314): the file is written as it always was, and the note is added to the answer.
  const content = args['content']
  const cited = volatilePathsIn(typeof content === 'string' ? content : '', asked.volatile_roots)
  return cited.length === 0 ? wrote : { answer: `${wrote.answer} ${theVolatileNote(cited)}` }
}
