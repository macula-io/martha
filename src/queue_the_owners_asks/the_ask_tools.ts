// The owner's asks as tools answer them (martha#313, #391, #443 part 5): the four tools, what each takes, and what each
// does with the queue.
//
// An ask is queued in this member's own name, and the batch it is taken in is a session's: a menu the host closed is what
// a settle stands on, so the menus the launcher keeps are handed in here rather than read again. The tools slice
// (../a_crews_tools) keeps only the table that calls this.

import type { CrewSettings } from '../declare_crew/declare_crew.ts'
import type { Processes } from '../host_contract/host_contract.ts'
import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { theBranchItRemoves } from '../read_the_tips_a_removal_covers/read_the_tips_a_removal_covers.ts'
import {
  LIST_ASKS,
  LIST_ASKS_DESCRIPTION,
  QUEUE_ASK,
  QUEUE_ASK_DESCRIPTION,
  SETTLE_ASKS,
  SETTLE_ASKS_DESCRIPTION,
  TAKE_ASKS,
  TAKE_ASKS_DESCRIPTION,
  listTheAsks,
  queueAnAsk,
  settleTheAsks,
  takeTheAsks,
  theBranch,
  type TheOwnersMenus,
} from './queue_the_owners_asks.ts'

/** What `queue_ask` takes: the question, and the branch when the ask would remove one (martha#391). */
export const QUEUE_ASK_TOOL = {
  name: QUEUE_ASK,
  description: QUEUE_ASK_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      ask: { type: 'string', description: 'The question, answerable yes or no, naming exactly what would be done' },
      repo: { type: 'string', description: 'When the ask would delete a branch: its repository, as owner/name' },
      branch: { type: 'string', description: 'When the ask would delete a branch: the branch, so both tips the yes covers are recorded' },
    },
    required: ['ask'],
  },
}

/** What `list_the_owners_asks` takes: nothing. */
export const LIST_ASKS_TOOL = {
  name: LIST_ASKS,
  description: LIST_ASKS_DESCRIPTION,
  inputSchema: { type: 'object', properties: {} },
}

/** What `take_the_owners_asks` takes: nothing; the batch is this session's. */
export const TAKE_ASKS_TOOL = {
  name: TAKE_ASKS,
  description: TAKE_ASKS_DESCRIPTION,
  inputSchema: { type: 'object', properties: {} },
}

/** What `settle_the_owners_asks` takes: the batch, and the ids the owner ticked. */
export const SETTLE_ASKS_TOOL = {
  name: SETTLE_ASKS,
  description: SETTLE_ASKS_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      batch: { type: 'integer', minimum: 0, description: "The batch's id, as take_the_owners_asks answered it" },
      yes: { type: 'array', items: { type: 'integer', minimum: 0 }, description: 'The ids of the asks the owner ticked' },
    },
    required: ['batch', 'yes'],
  },
}

/** What the asks are answered over: the queue's stream, this member and session, and where a removal's tips are read. */
export interface TheAsksAsked {
  readonly ledger: LedgerHost
  readonly member: string
  readonly settings: CrewSettings
  /** The session the call came from: a batch is taken in it and a menu closes in it. */
  readonly session: string
  readonly menus: TheOwnersMenus | undefined
  readonly processes?: Processes
  /** The owner's clone directory, when the declaration names one, where a removal's two tips are read. */
  readonly clones: string | null | undefined
}

/** What the tools answer: what the queue said, or why this member may not offer or settle. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/**
 * `ask_the_owner`, with the tips a branch removal covers when the ask names one (martha#391). The launcher reads them, in
 * the clone the ask names, and the queue keeps them: an ask that named one copy of a branch and not the other cost the
 * owner a second ask, because the yes covered only what the ask recorded.
 */
export async function queueTheAsk(asked: TheAsksAsked, args: Readonly<Record<string, unknown>>): Promise<AToolAnswer> {
  const removes = await theBranchItRemoves({ processes: asked.processes, clones: asked.clones, keepsTheBranch: theBranch }, args)
  if (removes !== undefined && 'refused' in removes) return removes
  const kept = await queueAnAsk(asked.ledger, args, asked.member, removes)
  return 'told' in kept ? { answer: kept.told } : { refused: kept.refused }
}

/** `list_the_owners_asks`: every ask waiting, and the batch one session has taken. */
export async function listTheOwnersAsks(asked: TheAsksAsked): Promise<AToolAnswer> {
  const listed = await listTheAsks(asked.ledger)
  return 'told' in listed ? { answer: listed.told } : { refused: listed.refused }
}

/** What the two tools that take and settle the owner's asks need: this crew's declaration, and this session's id. */
const theOffering = (asked: TheAsksAsked) => ({
  member: asked.member,
  session: asked.session,
  declaration: asked.settings,
})

/** `take_the_owners_asks`: every waiting ask claimed for one menu, or why nothing was (martha#313). */
export async function theTakeOfTheAsks(asked: TheAsksAsked): Promise<AToolAnswer> {
  const taken = await takeTheAsks(asked.ledger, theOffering(asked))
  return 'told' in taken ? { answer: taken.told } : { refused: taken.refused }
}

/** `settle_the_owners_asks`: the batch off, with the ids the owner ticked, or why not (martha#313). */
export async function theSettlingOfTheAsks(asked: TheAsksAsked, args: Readonly<Record<string, unknown>>): Promise<AToolAnswer> {
  const settled = await settleTheAsks(asked.ledger, { ...theOffering(asked), menus: asked.menus }, args)
  return 'told' in settled ? { answer: settled.told } : { refused: settled.refused }
}
