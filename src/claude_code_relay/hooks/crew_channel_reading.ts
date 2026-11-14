// Reading a crew's channel from inside a member's session (martha#253, slice 2).
//
// This exists so one rule has one home: the channel is read only while the session is IDLE, and only one read runs
// at a time. The host queues every prompt a mod submits into the next main turn it starts, and the launcher counts a
// handed message taken in when that turn starts. A submit made during a turn reaches the model inside the running
// turn, before any turn start the launcher could count it at, so it is never made (martha#253 r=2; the count at the
// turn start is Pluto's ruling (a) on 93437b7, where a raise back through `prompt.submit` proved not to happen for
// every idle submit).
//
// Idle is the host's own word for it, and it is the MAIN turn's word: the host fires `turn.start` and `turn.complete`
// for a subagent's turn as well, and those say nothing about whether the member itself is free. A subagent's end
// therefore changes nothing here — only an event with no `agentId` moves the rule.
//
// `turn.complete` covers a turn that was interrupted or refused: the host fires it with a reason of its own
// (`'answer' | 'aborted' | 'refusal' | 'error'`), so there is no separate hook for an aborted turn, and none is read
// here. `turn.abort` is the cancel request, heard before the turn has ended; acting on it would read while the turn is
// still winding down, and again when its `turn.complete` arrives (Mercurius, r=2).
//
// One read at a time: a timer tick that lands while the end-of-turn read is still in flight must not ask the launcher
// a second time, or both reads are handed the same message and both submit it.

/** The one rule, over the two effects it needs: ask the launcher, and submit what it says. */
export interface ReadingTheChannel {
  /** Asks the launcher for the next message and submits it at once — but only while the session is idle. */
  readWhileIdle(): Promise<void>
  /**
   * A turn began: from here until it ends, nothing is asked for and nothing is submitted. A subagent's turn (an event
   * that carries an `agentId`) is not the member's turn and is ignored.
   */
  aTurnStarted(agentId?: unknown): void
  /**
   * A turn ended (answered, aborted, refused or failed): the session is idle again, and reads at once. A subagent's
   * turn is ignored, as above.
   */
  aTurnEnded(agentId?: unknown): Promise<void>
  /** Whether the session is idle now: the state the two calls above keep. */
  isIdle(): boolean
}

/** Whether an event is a subagent's: the host stamps those with the agent they belong to, and the main turn with none. */
const subagents = (agentId: unknown): boolean => agentId !== undefined

/**
 * Builds the reading. `askTheLauncher` answers the next message the member has not taken in, framed, or null when
 * there is none; `submit` puts the text into the session as a prompt.
 */
export function readingTheChannelWith(
  askTheLauncher: () => Promise<string | null>,
  submit: (text: string) => Promise<unknown>,
): ReadingTheChannel {
  // A session that has just started is idle: it is not in a turn until the host says one began.
  let busy = false
  // One read at a time: claimed before the first await, so a tick that lands mid-read does nothing.
  let reading = false

  const readWhileIdle = async (): Promise<void> => {
    if (busy || reading) return
    reading = true
    try {
      const text = await askTheLauncher()
      if (text === null || text === '') return
      await submit(text)
    } finally {
      reading = false
    }
  }

  return {
    readWhileIdle,
    aTurnStarted: (agentId) => {
      if (subagents(agentId)) return
      busy = true
    },
    aTurnEnded: async (agentId) => {
      if (subagents(agentId)) return
      busy = false
      await readWhileIdle()
    },
    isIdle: () => !busy,
  }
}
