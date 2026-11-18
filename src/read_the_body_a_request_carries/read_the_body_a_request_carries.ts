// The body a request to the launcher carries (martha#41).
//
// Every endpoint of the launcher's socket reads its body one way: whole, up to a size the launcher sets, and as JSON.
// How large a body may be is the launcher's decision rather than one endpoint's, which is why it lives here and not
// beside the endpoints that read it: a tool call carries its input whole, a file the model writes among others, and
// every other request is small.

import type { IncomingMessage } from 'node:http'

/**
 * The largest body the launcher reads. A tool call carries its input whole (a file the model writes, among others);
 * past this the call is refused.
 */
export const LARGEST_RELAY_BODY = 32 * 1024 * 1024

/** The body a request carries, or undefined when it is larger than the launcher reads or is not JSON. */
export async function theBodyOf(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > LARGEST_RELAY_BODY) return undefined
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    return undefined
  }
}
