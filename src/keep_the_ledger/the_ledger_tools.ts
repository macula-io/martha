// The ledger's three tools (martha#254, #443 part 5): the names the mod registers, what each is for, the schema of what
// each takes, and what each answers. The tools slice (../a_crews_tools) keeps only the table that calls them (martha#443).
//
// A_PACKAGE sits here because every one of these tools names a work package, and a report, a model switch and a
// worktree's finish take that same argument: one wording, imported, rather than four copies of one description.

import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import {
  CREW_LOG_DESCRIPTION,
  CREW_LOG_EVENTS,
  LOG_A_MILESTONE,
  NOTE_WHAT_BECAME_DESCRIPTION,
  WHAT_WAS_SENT_DESCRIPTION,
  keepTheMilestone,
  noteWhatBecameOfAnAct,
  whatWasSent,
} from './keep_the_ledger.ts'

/** The name the ledger's second reader is registered under; only this file's tool record names it, so it is not exported. */
const WHAT_WAS_SENT = 'what_was_sent'

/** The name the act's outcome is recorded under, held as the one above is. */
const NOTE_WHAT_BECAME = 'note_what_became_of_an_act'

/** The schema shared by the tools that name a work package, which every one of the ledger's tools does. */
export const A_PACKAGE: Readonly<Record<string, unknown>> = { type: 'string', description: 'The work package, owner/repo#n, as the issue is named' }

/** What `log_a_milestone` takes, as the mod registers it. */
export const LOG_A_MILESTONE_TOOL = {
  name: LOG_A_MILESTONE,
  description: CREW_LOG_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      package: A_PACKAGE,
      event: { type: 'string', enum: [...CREW_LOG_EVENTS] },
      note: { type: 'string', description: 'One short line: what happened' },
    },
    required: ['package', 'event', 'note'],
  },
}

/** What `what_was_sent` takes: the package whose ledger is read back. */
export const WHAT_WAS_SENT_TOOL = {
  name: WHAT_WAS_SENT,
  description: WHAT_WAS_SENT_DESCRIPTION,
  inputSchema: { type: 'object', properties: { package: A_PACKAGE }, required: ['package'] },
}

/** What `note_what_became_of_an_act` takes: the act, named by the row it was announced at, and what became of it. */
export const NOTE_WHAT_BECAME_TOOL = {
  name: NOTE_WHAT_BECAME,
  description: NOTE_WHAT_BECAME_DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      package: A_PACKAGE,
      announced_at: { type: 'integer', minimum: 0, description: 'The row the act was announced at, as what_was_sent shows it' },
      succeeded: { type: 'boolean', description: 'Whether the act happened' },
      detail: { type: 'string', description: 'What you found, in one line' },
    },
    required: ['package', 'announced_at', 'succeeded', 'detail'],
  },
}

/** What a ledger tool answers: the line the member is told, or why nothing was written. */
type AToolAnswer = { readonly answer: string } | { readonly refused: string }

/** What a ledger tool is handed: the ledger this launch keeps, and the member its launcher started. */
export interface TheLedgerAsked {
  readonly ledger: LedgerHost
  readonly member: string
}

/** `log_a_milestone`: one row on the package, in the member's own name; a `resume` only for whoever the nudges go to. */
export async function logTheMilestone(
  asked: TheLedgerAsked,
  row: { readonly package: string; readonly event: unknown; readonly note: unknown },
  whoMayResume: () => Promise<readonly string[]>,
): Promise<AToolAnswer> {
  const { told } = await keepTheMilestone(asked.ledger, { package: row.package, member: asked.member, event: row.event, note: row.note }, whoMayResume)
  return { answer: told }
}

/** `what_was_sent`: every act of the package still waiting for its outcome. */
export async function whatTheMemberSent(asked: TheLedgerAsked, package_name: string): Promise<AToolAnswer> {
  return { answer: (await whatWasSent(asked.ledger, package_name)).told }
}

/** `note_what_became_of_an_act`: the outcome of one act, recorded once. */
export async function noteTheActsOutcome(
  asked: TheLedgerAsked,
  acted: { readonly package: string; readonly announced_at: unknown; readonly succeeded: unknown; readonly detail: unknown },
): Promise<AToolAnswer> {
  const { told } = await noteWhatBecameOfAnAct(asked.ledger, { ...acted, member: asked.member })
  return { answer: told }
}
