// How long a recorded-host run may go without doing anything, before the wait gives up on it (martha#210).
//
// This was a deadline on the whole run, moved here from the driver so a test can drive it. A real model request rides
// inside that run, so on a busy hosted runner the runner's speed decided the verdict: run 42747883703 went red on
// `No model request 3 within 120000 ms` for a diff that job never runs, and the same tree passed on a re-run. A budget
// counted from the start therefore measures the machine, not the relay (the same reason martha#90 gave for a wait that
// holds no deadline of its own).
//
// So the budget is spent on silence: every new thing the host shows — output on its terminal, or a model request
// arriving — refills it, and only a host that shows nothing new for the whole budget is given up on. A slow machine
// that is still working is never cut off by how long it has taken. A run that draws forever is ended by the harness's
// own --test-timeout, which is named where these cases run, and which reports itself as the harness timeout.

/** How long the wait sleeps between looks: short enough that an event is noticed at once. */
export const POLL_MS = 100

/** What a run gives the wait: what the host has shown so far, and how many model requests it has sent. */
export interface HostWhileWaiting {
  /** Everything the host has shown so far: its terminal. More than last time is the host working. */
  readonly shown: () => string
  /** How many model requests the host has sent so far. More than last time is the host working. */
  readonly heard: () => number
}

/** One wait: what it waits for, how it is ended, and the run it is watching. */
export interface ProgressWait extends HostWhileWaiting {
  /** What the wait is for, as a person reading a failure reads it. */
  readonly what: string
  /** Whether the thing waited for has happened. */
  readonly holds: () => boolean
  /** Why the thing can no longer come, once something has ruled it out. */
  readonly cannotHappen?: () => string | undefined
  /** How long the host may show nothing new before the wait gives up on it. */
  readonly silence_ms: number
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
}

const wentSilent = (what: string, silence_ms: number, taken: number): string =>
  `No ${what} for ${silence_ms} ms: the host showed nothing new in that time, and the run has taken ${taken} ms in all`

/**
 * Waits for `wait.holds`, and gives up when the host has shown nothing new for `wait.silence_ms`. The message names
 * the silence and reports how long the run had taken in all, so a reader can tell a slow machine — which is never cut
 * off — from a host that stopped working.
 */
export async function waitWhileTheHostKeepsShowing(wait: ProgressWait): Promise<void> {
  const started = wait.now()
  // What the host has shown only ever grows, so its length is enough to see it moved, and costs nothing to compare.
  let seen = wait.shown().length
  let heard = wait.heard()
  let last_shown_at = started
  while (!wait.holds()) {
    const ruledOut = wait.cannotHappen?.()
    if (ruledOut !== undefined) throw new Error(ruledOut)
    const now = wait.now()
    const showing = wait.shown().length
    const hearing = wait.heard()
    const advanced = showing !== seen || hearing !== heard
    seen = showing
    heard = hearing
    if (advanced) last_shown_at = now
    if (now - last_shown_at > wait.silence_ms) throw new Error(wentSilent(wait.what, wait.silence_ms, now - started))
    await wait.sleep(POLL_MS)
  }
}
