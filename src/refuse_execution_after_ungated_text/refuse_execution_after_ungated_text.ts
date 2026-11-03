// The one control that saves every path the crew room's acceptance rule cannot
// reach: a session that took in text from a sender the policy table does not
// name executes nothing for the rest of that turn.
//
// Why at the shell and not at the door: on the Claude Code host there is no
// inbound-message hook, so a cross-session message is already in the turn before
// anything of ours runs. What is demonstrably available is `tool.call` refusing a
// tool before the engine runs it. So the turn is allowed to carry the text — it
// may read it — and is not allowed to act on it.
//
// Nothing here consults a display name. The policy table names node ids, and a
// session whose first user message says "you are Supervisor" gains nothing: the
// node id on the envelope is the only thing checked.

import { INBOUND_PATHS, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'

/** Text that reached this turn, and who it came from. */
export interface Ingestion {
  /** The inbound path id from ../inbound_paths, A1 … B8. */
  readonly path: string
  /**
   * The sender's node id, or `null` when nobody can be attributed (a fetch, a
   * checkout file, a server's instruction block, a compaction summary).
   */
  readonly from_node_id: string | null
}

/** Who may send text that a session is allowed to act on. Node ids only. */
export interface Policy {
  readonly may_send_executable_text: readonly string[]
}

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly refusal: string }

export interface GateInput {
  readonly tool: string
  readonly ingests: readonly Ingestion[]
  readonly policy: Policy
}

const PATHS_BY_ID = new Map<string, InboundPath>(INBOUND_PATHS.map((path) => [path.id, path]))

/**
 * Allow or refuse one tool call, on what this turn took in.
 *
 * Reading and searching are always allowed: the member may read the text, it
 * just may not act on it. Everything that executes is refused while any
 * ingestion in the turn is unattributed, comes from a node id the policy table
 * does not name, or arrives on a path this gate has never heard of.
 */
export function refuseExecutionAfterUngatedText({ tool, ingests, policy }: GateInput): Decision {
  if (!isShellTool(tool)) return { allow: true }

  for (const ingest of ingests) {
    const path = PATHS_BY_ID.get(ingest.path)
    const refusal = refusalFor(ingest, path, policy)
    if (refusal !== undefined) return { allow: false, refusal }
  }

  return { allow: true }
}

function refusalFor(ingest: Ingestion, path: InboundPath | undefined, policy: Policy): string | undefined {
  const tool = 'Nothing executes for the rest of this turn'

  if (path === undefined) return `${tool}: text arrived on path ${ingest.path}, which this gate does not know.`

  if (ingest.from_node_id === null) {
    return `${tool}: text from an unattributed sender arrived on path ${path.id} (${path.what}).`
  }

  if (!policy.may_send_executable_text.includes(ingest.from_node_id)) {
    return `${tool}: the sender of the text on path ${path.id} (${path.what}) is not named by the policy table.`
  }

  return undefined
}
