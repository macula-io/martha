// The receipts the launcher keeps for signed runs (martha#129, design step 3.7), in memory, for one member.
//
// The tool_use_id a receipt is bound to comes from the relay's own tool_called for the exact command
// `martha run <name>`, which arrives before the shell runs it. Nothing the `martha run` client sends is trusted
// for it: the client names a shape, and the launcher runs it only when exactly one such call is pending, for that
// name. Two pending calls at once refuse the run, so a second call cannot take the first one's receipt.
//
// A receipt is used once: taking it at tool_answered removes it, and a call answered without a run removes its
// pending entry, so nothing outlives the call it was kept for.

import { sha256Of, type Receipt } from '../keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'
import type { RunEnded } from './run_in_a_sandbox.ts'

/** Why a run is refused while more than one signed call is pending. */
export const TWO_PENDING = 'more than one martha run call is pending, so no run is bound to a call'

export interface Receipts {
  /** The relay's tool_called for `martha run <name>`, allowed: the call this run may be bound to. */
  callPending(tool_use_id: string, name: string): void
  /** The client asks to run `name`: the one pending call it binds to, or why there is none. */
  claim(name: string): { readonly tool_use_id: string } | string
  /** What the run gave, kept for the call it was bound to. */
  keep(tool_use_id: string, name: string, ended: RunEnded): void
  /** At tool_answered: the receipt for this call, removed, or undefined; the pending entry goes either way. */
  take(tool_use_id: string): Receipt | undefined
}

export function receiptsInMemory(): Receipts {
  const pending = new Map<string, string>()
  const claimed = new Map<string, string>()
  const kept = new Map<string, Receipt>()
  return {
    callPending: (tool_use_id, name) => void pending.set(tool_use_id, name),
    claim: (name) => {
      if (pending.size > 1) return TWO_PENDING
      const [entry] = [...pending]
      if (entry === undefined || entry[1] !== name) return `no martha run ${name} call is pending`
      pending.delete(entry[0])
      claimed.set(entry[0], name)
      return { tool_use_id: entry[0] }
    },
    keep: (tool_use_id, name, ended) => {
      if (claimed.get(tool_use_id) !== name) return
      claimed.delete(tool_use_id)
      const output = ended.output.toString('utf8')
      kept.set(tool_use_id, { tool_use_id, name, status: ended.status, output, output_sha256: sha256Of(output) })
    },
    take: (tool_use_id) => {
      pending.delete(tool_use_id)
      claimed.delete(tool_use_id)
      const receipt = kept.get(tool_use_id)
      kept.delete(tool_use_id)
      return receipt
    },
  }
}
