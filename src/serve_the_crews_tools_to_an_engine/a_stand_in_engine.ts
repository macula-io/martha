// A stand-in for the Goose engine's side of the crew's tool server, for the tests beside this file (martha#541,
// packages 7-8 part C, C1).
//
// This exists so a test starts the server the way the engine starts it, from the entry the launch writes, and speaks
// to it as the engine does: one JSON-RPC request per line on its stdin, one reply per line on its stdout. It also
// serves the launch's relay on a real socket, in a directory made the way a launch makes it, with a launcher a test
// scripts, so every answer the engine hears has crossed the same socket, token and reader a launch's would.

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { TestContext } from 'node:test'

import type { MemberRelay } from '../answer_the_relay/answer_the_relay.ts'
import { shortRelayRoot } from '../drive_the_recorded_host/short_relay_root.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { THE_PATH_A_LAUNCH_GIVES } from '../launch_a_goose_member/launch_a_goose_member.ts'
import { makeRelayDirectory } from '../serve_the_relay_to_a_launch/relay_directory.ts'
import { serveTheRelay, type RelayServer } from '../serve_the_relay_to_a_launch/serve_the_relay.ts'
import { theToolServersEntry, type AnEntrysValue, type TheToolServersEntry } from './the_tool_servers_entry.ts'
import { mintALaunchToken } from '../serve_the_relay_to_a_launch/the_launchs_token.ts'

/** How long a test waits for the server: for one reply, for it to start, or for it to be gone. */
export const A_TESTS_WAIT_MS = 9_000

/** A tool call the launcher was asked, as the relay handed it over. */
export type AskedOfTheLauncher = Readonly<Record<string, unknown>>

/** What a test's launcher answers a call with: the core's answer, or a refusal. */
export type TheLaunchersAnswer = { readonly answer: string } | { readonly refused: string }

/** A launch's relay with a scripted launcher, served on its own socket, and what it was asked. */
export interface AScriptedRelay {
  readonly socket_path: string
  readonly token: string
  readonly checkout: string
  readonly asked: AskedOfTheLauncher[]
  readonly server: RelayServer
}

/** One value of the entry, by its key, or a throw: a test reads the entry the launch wrote, never one of its own. */
export function theEntrysValue(entry: TheToolServersEntry, key: string): AnEntrysValue {
  const found = entry.find(([each]) => each === key)
  if (found === undefined) throw new Error(`the entry has no ${key}`)
  return found[1]
}

/**
 * A launch's relay, served on a socket made the way a launch makes it, with `token` and a launcher that answers every
 * tool call with `answering(body)`; the other questions a relay hears are not this server's, and throw.
 */
export async function aScriptedRelay(t: TestContext, answering: (body: AskedOfTheLauncher) => TheLaunchersAnswer): Promise<AScriptedRelay> {
  // A socket address holds about a hundred bytes, and CI runs the suite under a long TMPDIR on purpose (martha#79).
  const scratch = shortRelayRoot(t)
  const made = makeRelayDirectory(join(scratch, 'a-launchs-relay'))
  if (!made.made) throw new Error(made.refusal)
  const checkout = mkdtempSync(join(scratch, 'checkout-'))
  const asked: AskedOfTheLauncher[] = []
  const notThisServers = (): never => {
    throw new Error("the crew's tool server asked the relay something other than a tool call")
  }
  const relay: MemberRelay = {
    answer: async () => notThisServers(),
    run: async () => notThisServers(),
    judgeAGitCall: async () => notThisServers(),
    judgeARefTransaction: async () => notThisServers(),
    answerTool: async (body) => {
      asked.push(body as AskedOfTheLauncher)
      return answering(body as AskedOfTheLauncher)
    },
  }
  const token = mintALaunchToken()
  const server = await serveTheRelay(relay, made.socket_path, token)
  t.after(() => server.close())
  return { socket_path: made.socket_path, token, checkout, asked, server }
}

/** The engine's side of one running server: a request, and the reply to it. */
export interface AStandInEngine {
  readonly child: ChildProcess
  ask(method: string, params?: Readonly<Record<string, unknown>>): Promise<Readonly<Record<string, unknown>>>
  /** What the server wrote to its standard error, so far. */
  readonly errors: () => string
}

/**
 * Starts the server from the entry the launch writes for `relay`, as the engine does: `cmd` with `args`, on the
 * launch's own narrow PATH and the entry's `envs`, and nothing else of this process's environment.
 */
export function aStandInEngine(t: TestContext, relay: AScriptedRelay): AStandInEngine {
  const entry = theToolServersEntry(RECORDED_GOOSE_ENGINE.stdio_extension, relay)
  const cmd = theEntrysValue(entry, 'cmd') as string
  const args = theEntrysValue(entry, 'args') as readonly string[]
  const envs = theEntrysValue(entry, 'envs') as Readonly<Record<string, string>>
  const child = spawn(cmd, [...args], { env: { PATH: THE_PATH_A_LAUNCH_GIVES, ...envs }, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  t.after(async () => {
    child.kill('SIGKILL')
    await exited
    for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe.destroy()
  })
  let errors = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (part: string) => (errors += part))
  const waiting = new Map<number, (reply: Readonly<Record<string, unknown>>) => void>()
  createInterface({ input: child.stdout }).on('line', (line) => {
    const reply = JSON.parse(line) as Readonly<Record<string, unknown>>
    waiting.get(reply['id'] as number)?.(reply)
  })
  let next = 0
  return {
    child,
    errors: () => errors,
    ask: (method, params = {}) => {
      const id = ++next
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      return new Promise((resolve, reject) => {
        const late = setTimeout(() => reject(new Error(`no reply to ${method} in ${String(A_TESTS_WAIT_MS)} ms; the server said: ${errors}`)), A_TESTS_WAIT_MS)
        waiting.set(id, (reply) => {
          clearTimeout(late)
          resolve(reply)
        })
      })
    },
  }
}
