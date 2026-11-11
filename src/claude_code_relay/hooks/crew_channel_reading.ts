// Reading a crew's channel from inside a member's session (martha#253, slice 2).
//
// This exists so one rule has one home: the channel is read only while the session is IDLE. The host queues every
// prompt a mod submits, and raises one back through `prompt.submit` only when it was submitted while the host was
// idle; a submit made during a turn reaches the model and is never raised, so it could never be counted as taken in
// (measured on the recorded host, martha#253 r=2: one message handed during a turn, delivered, no taken row). So a
// timer tick during a turn asks the launcher NOTHING and holds no text. "Handed" means "submitted while idle", and
// there is no held copy here: a text the launcher answers with is submitted at once or not asked for at all.
//
// Idle is the host's own word for it: a turn runs from `turn.start` to `turn.complete` (or `turn.abort`), and a
// session that has just started is idle.

/** The one rule, over the two effects it needs: ask the launcher, and submit what it says. */
export interface ReadingTheChannel {
  /** Asks the launcher for the next message and submits it at once — but only while the session is idle. */
  readWhileIdle(): Promise<void>
  /** A turn began: from here until it ends, nothing is asked for and nothing is submitted. */
  aTurnStarted(): void
  /** A turn ended or was aborted: the session is idle again, and reads at once. */
  aTurnEnded(): Promise<void>
  /** Whether the session is idle now: the state the two calls above keep. */
  isIdle(): boolean
}

/**
 * Builds the reading. `askTheLauncher` answers the next message the member has not taken in, framed, or null when
 * there is none; `submit` puts the text into the session as a prompt.
 */
export function readingTheChannelWith(
  askTheLauncher: () => Promise<string | null>,
  submit: (text: string) => Promise<void>,
): ReadingTheChannel {
  // A session that has just started is idle: it is not in a turn until the host says one began.
  let busy = false

  const readWhileIdle = async (): Promise<void> => {
    if (busy) return
    const text = await askTheLauncher()
    if (text === null || text === '') return
    await submit(text)
  }

  return {
    readWhileIdle,
    aTurnStarted: () => void (busy = true),
    aTurnEnded: async () => {
      busy = false
      await readWhileIdle()
    },
    isIdle: () => !busy,
  }
}
