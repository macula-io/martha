// The backstop a launch keeps over a member whose relay has not reported its session's start (martha#104).
//
// A host that runs the relay reports the session's start; a member whose relay has not, the deadline's ms after the
// backstop was armed, is stopped with the deadline's own words. A slice of its own, because a launch's reading decides
// nothing here: what waits, and what it says when it runs out, is all this holds (martha#562).

/**
 * The backstop (#104): a host that runs the relay reports the session's start;
 * a member whose relay has not, the deadline's ms after it was armed, is stopped.
 */
export function relayBackstop(deadline: { readonly ms: number; readonly why: string }, stop: (why: string) => void): { reported(): void; arm(): void; disarm(): void } {
  let reported = false
  let unheard: NodeJS.Timeout | undefined
  const disarm = (): void => clearTimeout(unheard)
  return {
    reported: () => ((reported = true), disarm()),
    arm: () => {
      if (reported) return
      unheard = setTimeout(() => stop(deadline.why), deadline.ms)
    },
    disarm,
  }
}
