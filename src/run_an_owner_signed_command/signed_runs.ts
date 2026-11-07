// The launcher's side of `martha run <name>` for one member (martha#129, design steps 3 and 3.7).
//
// The relay's tool_called for a `Bash` call whose command is exactly `martha run <name>`, once the launcher
// allowed it, is the call a run binds to: its tool_use_id is the relay's, never the client's. The client then
// posts RUN_PATH naming the shape; the launcher runs it only when that one call is pending, keeps the receipt for
// it, and sends the output and status back. At tool_answered the receipt is taken, once.

import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import type { Ran, Refused } from '../claude_code_relay/hooks/relay_protocol.ts'
import { keepsTheShell, runNameOf, type RecordedResultShape, type ShellDecision } from '../keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'
import type { Receipts } from './receipts.ts'
import type { RunEnded } from './run_in_a_sandbox.ts'

type Input = Readonly<Record<string, unknown>>

export interface SignedRuns {
  /** A tool call the launcher allowed: a pending run when it is `martha run <name>` on the shell tool. */
  callAllowed(tool: string, input: Input): void
  /**
   * A tool call that ran, with the answer the host showed for it: whether that answer keeps the shell. The receipt is
   * taken here whatever the answer, since a receipt outlives no call (martha#129). Undefined for a call that is not a
   * run of a shape at all, which is every other call.
   */
  callAnswered(tool: string, input: Input, answer: unknown): ShellDecision | undefined
  /** The client's request to run a shape: what ran, or why nothing did. */
  run(body: unknown): Promise<Ran | Refused>
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

/**
 * Signed runs over `receipts`, each run by `runShape` (runASignedShape, on the list the owner signed now), with the
 * names that list holds now read by `signedNames`, and the host's own answers as `shapes`.
 */
export function signedRunsOf(
  receipts: Receipts,
  runShape: (name: string) => Promise<RunEnded | string>,
  signedNames: () => readonly string[],
  shapes: readonly RecordedResultShape[],
): SignedRuns {
  return {
    callAllowed: (tool, input) => {
      const name = tool === CLAUDE_CODE_SHELL_TOOL ? runNameOf(input) : undefined
      if (name !== undefined && isText(input['tool_use_id'])) receipts.callPending(input['tool_use_id'], name)
    },
    callAnswered: (tool, input, answer) => {
      const receipt = isText(input['tool_use_id']) ? receipts.take(input['tool_use_id']) : undefined
      // Read the signed list only for a call that asks to run a shape at all: every other `Bash` call is decided by
      // #127's table, and opening a signed list to answer it would be work with no decision in it.
      if (tool !== CLAUDE_CODE_SHELL_TOOL || !isText(input['tool_use_id']) || runNameOf(input) === undefined) return undefined
      return keepsTheShell(
        { tool_use_id: input['tool_use_id'], command: input['command'], run_in_background: input['run_in_background'], answer },
        signedNames(),
        receipt,
        shapes,
      )
    },
    run: async (body) => {
      const name = typeof body === 'object' && body !== null ? (body as Input)['name'] : undefined
      if (!isText(name)) return { refused: 'the request names no shape' }
      const bound = receipts.claim(name)
      if (typeof bound === 'string') return { refused: bound }
      const ended = await runShape(name)
      if (typeof ended === 'string') return { refused: ended }
      receipts.keep(bound.tool_use_id, name, ended)
      return { ran: 1, status: ended.status, output: ended.output.toString('base64') }
    },
  }
}
