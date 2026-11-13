// `log_a_milestone`, `what_was_sent` and `note_what_became_of_an_act`: the ledger, loaded (martha#254, #25's
// remainder).
//
// This exists so what a member did on a package outlives its session. The ledger itself landed with #25 — an
// append-only stream per package, a milestone row kept as work happens, an act's row written before the act runs and
// its outcome after — but nothing read it back, because no live host was wired to it. This slice is that wiring: the
// launcher hands the ledger the crew's own store, so a milestone kept by one session is read by the next, and a
// successor that starts on a package is handed the acts of that package that were sent and never concluded.
//
// Nothing here sends an act. The slices that send pushes, handoffs, room messages and tags route them through
// sendOutwardAct when they land; until then the read is proved on acts a test's own store holds, which is honest:
// the ledger is loaded, and it fills as the senders arrive.

import {
  actsAwaitingOutcome,
  concludeAct,
  noteMilestone,
  type ActAwaitingOutcome,
  type LedgerHost,
  type Milestone,
} from '../log_ledger/log_ledger.ts'

/** The milestone names the crew's own tool uses, and the ledger's name for each. */
export const CREW_LOG_EVENTS = ['checkpoint', 'review_round', 'release', 'fix_after_ship'] as const
export type CrewLogEvent = (typeof CREW_LOG_EVENTS)[number]

export const MILESTONE_OF_EVENT: Readonly<Record<CrewLogEvent, Milestone>> = {
  checkpoint: 'checkpoint_reached',
  review_round: 'review_round_closed',
  release: 'release_shipped',
  fix_after_ship: 'fix_shipped_after_release',
}

/** Who is keeping something, and on which package. */
export interface AWorker {
  readonly package: string
  readonly member: string
}

/** Keeps one milestone of a package; resolves to what the member is told. */
export async function keepTheMilestone(
  host: LedgerHost,
  input: AWorker & { readonly event: unknown; readonly note: unknown },
): Promise<{ readonly told: string }> {
  const event = CREW_LOG_EVENTS.find((candidate) => candidate === input.event)
  if (event === undefined) {
    return { told: `Not recorded: ${JSON.stringify(input.event)} is not a milestone the crew keeps (${CREW_LOG_EVENTS.join(', ')}).` }
  }
  if (typeof input.note !== 'string' || input.note.trim() === '') {
    return { told: `Not recorded: a ${event} needs a note saying what it was, in one short line.` }
  }
  await noteMilestone(host, { package: input.package, member: input.member, milestone: MILESTONE_OF_EVENT[event], note: input.note.trim() })
  return { told: `Kept: ${event} on ${input.package}.` }
}

/** Every act of a package that was sent and has no outcome, oldest first, and what the member is told. */
export async function whatWasSent(host: LedgerHost, package_name: string): Promise<{ readonly acts: readonly ActAwaitingOutcome[]; readonly told: string }> {
  const acts = await actsAwaitingOutcome(host, package_name)
  if (acts.length === 0) return { acts, told: `Nothing was sent on ${package_name} and left without an outcome.` }
  const lines = acts.map((act) => `row ${act.announced_at}: a ${act.act.kind} (${act.act.what}) sent by ${act.member}`)
  return { acts, told: [`${package_name} was sent ${acts.length === 1 ? 'this act' : `these ${acts.length} acts`} with no outcome recorded:`, ...lines].join('\n') }
}

/** Records what a member found became of an act left awaiting; a second outcome for one act is refused by the store. */
export async function noteWhatBecameOfAnAct(
  host: LedgerHost,
  input: AWorker & { readonly announced_at: unknown; readonly succeeded: unknown; readonly detail: unknown },
): Promise<{ readonly told: string }> {
  const outcome = outcomeOf(input)
  if (typeof outcome === 'string') return { told: `Not recorded: ${outcome}` }
  const { announced_at, succeeded, detail } = outcome
  try {
    await concludeAct(host, { package: input.package, member: input.member, announced_at, outcome: { succeeded, detail: detail.trim() } })
  } catch (error) {
    return { told: `Not recorded: ${error instanceof Error ? error.message : String(error)}.` }
  }
  return { told: `Kept: the act at row ${announced_at} of ${input.package} is concluded, ${succeeded ? 'and it happened' : 'and it did not happen'}.` }
}

/** The outcome an argument names, or why it names none: the row, whether it happened, and what was found. */
function outcomeOf(input: { readonly announced_at: unknown; readonly succeeded: unknown; readonly detail: unknown }): { announced_at: number; succeeded: boolean; detail: string } | string {
  if (typeof input.announced_at !== 'number' || !Number.isInteger(input.announced_at) || input.announced_at < 0) {
    return 'name the act by the row it was announced at, as what_was_sent shows it.'
  }
  if (typeof input.succeeded !== 'boolean' || typeof input.detail !== 'string' || input.detail.trim() === '') {
    return 'say whether it happened (succeeded) and what you found (detail), in one line.'
  }
  return { announced_at: input.announced_at, succeeded: input.succeeded, detail: input.detail }
}

/** The line a session starting on a package is handed, once, or null when that package has nothing waiting. */
export function theLineAStartingSessionIsHanded(package_name: string, acts: readonly ActAwaitingOutcome[]): string | null {
  if (acts.length === 0) return null
  const what = acts.map((act) => `row ${act.announced_at}: a ${act.act.kind} by ${act.member}`).join('; ')
  return (
    `${package_name} has ${acts.length} act${acts.length === 1 ? '' : 's'} sent with no outcome recorded (${what}). ` +
    'Check what became of each before sending anything again, then record it with note_what_became_of_an_act.'
  )
}

/** The name the crew registers this tool under (martha#343): one milestone of a package, in the crew's ledger. */
export const LOG_A_MILESTONE = 'log_a_milestone'

/** The description of log_a_milestone, as the crew's mod registers it. */
export const CREW_LOG_DESCRIPTION =
  `Log a work package milestone in the crew's ledger, which the owner and every later session of this crew reads. ` +
  `The events are ${CREW_LOG_EVENTS.join(', ')}. Every later session on the package reads back what you kept.`

/** The description of what_was_sent, as the crew's mod registers it. */
export const WHAT_WAS_SENT_DESCRIPTION =
  `Read the acts of a work package that were sent and have no outcome recorded, oldest first. ` +
  'A session starting on a package is handed this list once; ask for it again when you need to.'

/** The description of note_what_became_of_an_act, as the crew's mod registers it. */
export const NOTE_WHAT_BECAME_DESCRIPTION =
  `Record what you found became of an act that was sent and left without an outcome, naming it by the row ` +
  `what_was_sent shows. A second outcome for one act is refused, so nothing is recorded twice.`
