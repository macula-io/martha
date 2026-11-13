// The end of a running turn, carried at a tool boundary (martha#311, Uranus's ruling D).
//
// This exists so ending a member's turn never stops the member. The relay's after-tool gate reports every finished
// tool to the launcher and stops the member when that report is not heard; the host's abort cancels the report of a
// tool still running, so an end carried mid-tool would read as a launcher that could not be heard. The end is
// therefore never carried while a tool is in flight: it is held, a tool that starts while it is held is denied, and
// it is carried once the last tool in flight has been answered yes. The after-tool gate itself is not touched.
//
// The gate (./register.ts) and the crew mod (./crew.tsx) are two registrations of one hooks module, so the one hold
// lives here, in module state both import; a session runs one main turn at a time, so one hold is enough.

/** What the hold carries an end out with: the host's abort, and the report of what became of it, out of the turn. */
export interface TheEndsHands {
  readonly abort: (turn_id: string) => Promise<unknown>
  readonly report: (outcome: Readonly<Record<string, string>>) => Promise<void>
}

/** Why a tool is denied while an end is held: the turn is about to end, and nothing more is started in it. */
export const A_TOOL_WHILE_THE_END_IS_HELD = 'this turn is being ended so the member can hand over; no tool starts in it'

/** The words an ordered end's outcome is reported under, declared in the same exceptions as the orders. */
const THE_TURN_ENDED = 'turn_ended'
const THE_TURN_NOT_ENDED = 'turn_not_ended'

/**
 * Ends the turn the order names with the host's own abort, and reports what became of it (design §5): ended, or
 * refused with the host's reason. The launcher counts only an end that ended.
 */
export async function endTheTurnOnTheHost(abort: TheEndsHands['abort'], report: TheEndsHands['report'], turn_id: string): Promise<void> {
  const outcome = await abort(turn_id).then(
    () => ({ end_outcome: THE_TURN_ENDED }),
    (error: unknown) => ({ end_outcome: THE_TURN_NOT_ENDED, end_refusal: String(error) }),
  )
  await report({ turn_id, ...outcome })
}

/** The hold over the tools in flight and the end ordered: one per hooks module, as the session runs one turn. */
export function holdingTheEnd() {
  let inFlight = 0
  let held: { readonly turn_id: string; readonly hands: TheEndsHands } | null = null
  const carry = async (): Promise<void> => {
    const end = held
    held = null
    if (end !== null) await endTheTurnOnTheHost(end.hands.abort, end.hands.report, end.turn_id)
  }
  return {
    /** The launcher ordered the end: carried now when no tool is in flight, held until the last one is answered. */
    async ordered(turn_id: string, hands: TheEndsHands): Promise<void> {
      held = { turn_id, hands }
      if (inFlight === 0) await carry()
    },
    /** Why a tool may not start now, or undefined when it may; one that may is counted in flight. */
    aToolStarts(): string | undefined {
      if (held !== null) return A_TOOL_WHILE_THE_END_IS_HELD
      inFlight += 1
      return undefined
    },
    /** A tool's report was answered yes: one fewer in flight, and the held end carried after the last. */
    async aToolWasAnswered(): Promise<void> {
      inFlight = Math.max(0, inFlight - 1)
      if (inFlight === 0) await carry()
    },
    /** The turn ended by itself: nothing is in flight in it any more, and no end is left to carry in it. */
    theTurnEnded(): void {
      inFlight = 0
      held = null
    },
  }
}

/** The one hold of this hooks module. */
export const theEnd = holdingTheEnd()
