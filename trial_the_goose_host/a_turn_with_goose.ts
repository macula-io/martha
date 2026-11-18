// One turn with Goose, and what can be read off it: the text it streamed, the requests it made to the
// model, the tools the model was offered, and whether any planted token was seen on the way.

import type { Received } from './record_what_goose_sends.ts'
import type { GooseOverAcp } from './speak_acp_to_goose.ts'
import type { TheCapALineGets } from './the_cap_a_line_gets.ts'
import { TheBoundCannotFitTheLaunch, whyTheBoundCannotFit } from './the_cap_a_line_gets.ts'

/** A turn as it ended: why it stopped, and the text the member's model streamed. */
export interface Turn {
  readonly stopReason: string
  readonly text: string
  readonly updates: readonly Record<string, unknown>[]
}

/** The bound the turn in hand is under, set by the driver before the line runs (martha#732). */
let theCapInHand: TheCapALineGets | undefined

/** Sets the bound the next turns are under; undefined leaves them uncapped. */
export function setTheCapInHand(cap: TheCapALineGets | undefined): void {
  theCapInHand = cap
}

/** Sends one prompt and answers when Goose says the turn ended, or when the cap runs out. */
export function promptOver(acp: GooseOverAcp, sessionId: string, text: string, cap: TheCapALineGets | undefined = theCapInHand): Promise<Turn> {
  const from = acp.updates.length
  const asked = acp.ask('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
  return withinTheCap(asked, cap).then((answer) => ({
    stopReason: String((answer as { stopReason?: string } | undefined)?.stopReason ?? ''),
    text: textsOf(acp.updates.slice(from)),
    updates: acp.updates.slice(from),
  }))
}

/**
 * A turn's bound, renewed every time an answer lands (martha#732): the cap is the model's own pace times the
 * requests the line's turn makes, so a turn that keeps working is never cut for being long, and a turn that
 * stalls is cut at the pace the model itself set. Without a cap the turn waits for the launch's own bound.
 */
export function withinTheCap<T>(work: Promise<T>, cap: TheCapALineGets | undefined): Promise<T> {
  if (cap === undefined) return work
  return new Promise<T>((settle, fail) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      const made = cap.made()
      const why = whyTheBoundCannotFit(made)
      if (why !== undefined) {
        // Refused by name rather than run to be reaped by the runner, which would leave no result at all (R2, R4).
        fail(new TheBoundCannotFitTheLaunch(why))
        return
      }
      if (!Number.isFinite(made.ms)) return
      timer = setTimeout(() => fail(new NoAnswerInTime(made.ms)), made.ms)
    }
    const stopListening = cap.pace.onEachAnswer(arm)
    const clear = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      stopListening()
    }
    arm()
    work.then(
      (value) => { clear(); settle(value) },
      (error: Error) => { clear(); fail(error) },
    )
  })
}

/**
 * The cap ran out before Goose answered (martha#612): its own kind of error, so a line that got no answer in time is
 * told apart from every other error by what it is, never by matching its words.
 */
export class NoAnswerInTime extends Error {
  readonly ms: number
  constructor(ms: number) {
    super(`no answer within ${ms} ms`)
    this.name = 'NoAnswerInTime'
    this.ms = ms
  }
}

/** A promise that fails rather than waits forever: a launch is capped, never left hanging. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((settle, fail) => {
    const timer = setTimeout(() => fail(new NoAnswerInTime(ms)), ms)
    work.then(
      (value) => { clearTimeout(timer); settle(value) },
      (error: Error) => { clearTimeout(timer); fail(error) },
    )
  })
}

/** The text the agent streamed, in the order it sent it. */
export function textsOf(updates: readonly Record<string, unknown>[]): string {
  const said: string[] = []
  for (const update of updates) {
    const params = (update.params ?? {}) as { update?: { sessionUpdate?: string; content?: { text?: unknown } } }
    const text = params.update?.content?.text
    if (params.update?.sessionUpdate === 'agent_message_chunk' && typeof text === 'string') said.push(text)
  }
  return said.join('')
}

/** Whether a recorded request is the model being asked to answer, rather than the engine asking about it. */
export function isAModelChat(path: string): boolean {
  return path.includes('chat/completions')
}

/** The bodies of the model requests the proxy recorded, oldest first. */
export function chatsIn(received: readonly Received[]): string[] {
  return received.filter((one) => isAModelChat(one.path)).map((one) => one.body)
}

/** The tool names a model request offered. */
export function toolsIn(body: string): string[] {
  try {
    const parsed = JSON.parse(body) as { tools?: readonly { function?: { name?: string } }[] }
    return (parsed.tools ?? []).map((tool) => tool.function?.name ?? '')
  } catch {
    return []
  }
}

/** Which planted tokens appear in the text handed in. */
export function tokensFound(tokens: readonly string[], ...texts: readonly string[]): string[] {
  return tokens.filter((token) => texts.some((text) => text.includes(token)))
}
