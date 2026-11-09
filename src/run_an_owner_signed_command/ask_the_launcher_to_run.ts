// `martha run <name>`'s side of a signed run (martha#129, design step 3): ask the launcher on its relay socket,
// and hear exactly a run or a refusal. The member's shell has the socket's path in RELAY_SOCKET_VARIABLE, as the
// relay does. Anything but a Ran is a refusal: no socket, an error, a status other than 200, any other body.

import { request } from 'node:http'
import { isAbsolute } from 'node:path'

import { heardRan, RELAY_DEADLINE_MS, RELAY_ORIGIN, RELAY_SOCKET_VARIABLE, RUN_PATH, type HeardRun } from '../claude_code_relay/hooks/relay_protocol.ts'
import { RUN_DEADLINE_MS } from './run_in_a_sandbox.ts'

/** Why `martha run` refuses outside a member's shell. */
export const NOT_IN_A_MEMBER = `martha run runs only in the shell of a member Martha started: ${RELAY_SOCKET_VARIABLE} names no launcher.`

/** Ask the launcher at the socket `env` names to run `name`: what ran, or why nothing did. */
export function askTheLauncherToRun(env: Readonly<Record<string, string | undefined>>, name: string): Promise<HeardRun> {
  const socketPath = env[RELAY_SOCKET_VARIABLE]
  if (socketPath === undefined || !isAbsolute(socketPath)) return Promise.resolve({ ran: false, why: NOT_IN_A_MEMBER })
  const body = JSON.stringify({ name })
  return new Promise((resolve) => {
    const asked = request(`${RELAY_ORIGIN}${RUN_PATH}`, { socketPath, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: RUN_DEADLINE_MS + RELAY_DEADLINE_MS }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve(heardRan(response.statusCode ?? 0, Buffer.concat(chunks).toString('utf8'))))
      response.on('error', (error) => resolve({ ran: false, why: `the launcher's answer broke off (${error.message})` }))
    })
    asked.on('timeout', () => asked.destroy(new Error('the launcher did not answer in time')))
    asked.on('error', (error) => resolve({ ran: false, why: `the launcher could not be asked (${error.message})` }))
    asked.end(body)
  })
}
