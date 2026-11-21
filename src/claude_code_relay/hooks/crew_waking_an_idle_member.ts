// Waking an idle member from inside its session (martha#959, the Claude Code side of crew-code's `wakeWhenIdle`).
//
// This exists so one rule has one home: the launcher is asked for a wake only while the session is IDLE, and only a wake
// the session is still idle for is submitted. A submit made during a turn reaches the model inside that turn, before any
// turn start the launcher could count at, and a wake is for a session with nothing in hand. A turn can also start while
// the ask is in flight — the answer takes a trip through the launcher — so the session is asked again before the submit.
//
// An empty answer is the launcher's word for "no wake is due", and submits nothing. The decision itself is not here: what
// counts as idle, what counts as work to wake for, and the clock that backs off are the launcher's, and the text comes
// back from it whole (../wake_an_idle_member).
//
// A hooks module runs with no Node and may import only its own files, so nothing of the core is reachable here: the ask's
// name is spelled out, as the relay's own module spells every ask it makes.

/** What the mod asks the launcher for, on the channel read's own clock and only while the session is idle (martha#959). */
export const THE_WAKE_ASK = 'wake_this_idle_session'

/** The one rule, over the three effects it needs: whether the session is idle, the launcher's answer, and the submit. */
export interface WakingAnIdleMember {
  /** Asks the launcher and submits what it answers — but only while the session is idle, and never twice on one look. */
  wakeWhileIdle(): Promise<void>
}

/** Builds the reading of the wake, for one session. */
export function wakingAnIdleMemberWith(
  isIdle: () => boolean,
  askTheLauncher: () => Promise<string>,
  submit: (text: string) => Promise<unknown>,
): WakingAnIdleMember {
  return {
    wakeWhileIdle: async () => {
      if (!isIdle()) return
      const text = await askTheLauncher()
      if (text === '') return
      if (!isIdle()) return
      await submit(text)
    },
  }
}
