// The beat a member's running turn is asked about on (martha#311).
//
// This exists so a member in one long turn is still asked what it should do: the mod asks the launcher at a session's
// start and at every turn's end, and a turn that never ends reaches neither, so its handover would wait behind it for
// ever. While the MAIN turn runs, this asks on a fixed beat, carrying that turn's id, which the host stamps on
// `turn.start` and on nothing a timer can read.
//
// Only the main turn beats. The host fires `turn.start` and `turn.complete` for a subagent's turn as well, stamped with
// its `agentId`; a subagent's turn is never ended, and a subagent finishing inside the member's turn must not stop the
// beat for it, so an event with an agent moves nothing here — the rule ./crew_channel_reading.ts keeps for the channel.

/** How often the running main turn is asked about: the draft crew's one-minute beat. */
export const REFRESH_BEAT_MS = 60_000

/**
 * The beat over the host's timer and the question it asks for the running turn. `aTurnStarted` keeps a main turn's id
 * and asks about it every beat until `aTurnEnded`; a subagent's start or end moves nothing.
 */
export function beatingTheTurnWith(every: (ms: number, fn: () => void) => { cancel(): void }, ask: (turn_id: string) => Promise<void>) {
  let beating: { cancel(): void } | undefined
  return {
    aTurnStarted(agentId: unknown, turn_id: string): void {
      if (agentId !== undefined || turn_id === '') return
      beating?.cancel()
      beating = every(REFRESH_BEAT_MS, () => void ask(turn_id).catch(() => undefined))
    },
    aTurnEnded(agentId: unknown): void {
      if (agentId === undefined) beating?.cancel()
    },
  }
}
