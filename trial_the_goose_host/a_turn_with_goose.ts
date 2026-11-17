// One turn with Goose, and what can be read off it: the text it streamed, the requests it made to the
// model, the tools the model was offered, and whether any planted token was seen on the way.

import type { Received } from './record_what_goose_sends.ts'
import type { GooseOverAcp } from './speak_acp_to_goose.ts'

/** A turn as it ended: why it stopped, and the text the member's model streamed. */
export interface Turn {
  readonly stopReason: string
  readonly text: string
  readonly updates: readonly Record<string, unknown>[]
}

/** Sends one prompt and answers when Goose says the turn ended, or when the cap runs out. */
export function promptOver(acp: GooseOverAcp, sessionId: string, text: string, timeoutMs = 240000): Promise<Turn> {
  const from = acp.updates.length
  const asked = acp.ask('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
  return withTimeout(asked, timeoutMs).then((answer) => ({
    stopReason: String((answer as { stopReason?: string } | undefined)?.stopReason ?? ''),
    text: textsOf(acp.updates.slice(from)),
    updates: acp.updates.slice(from),
  }))
}

/** A promise that fails rather than waits forever: a launch is capped, never left hanging. */
export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((settle, fail) => {
    const timer = setTimeout(() => fail(new Error(`no answer within ${ms} ms`)), ms)
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

/** The bodies of the model requests the proxy recorded, oldest first. */
export function chatsIn(received: readonly Received[]): string[] {
  return received.filter((one) => one.path.includes('chat/completions')).map((one) => one.body)
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
