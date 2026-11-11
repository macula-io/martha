// The one control that saves every path the crew room's acceptance rule cannot
// reach: a session that took in text from a sender the policy table does not
// name executes nothing, for as long as that text is still readable.
//
// Why at the shell and not at the door: on the Claude Code host there is no
// inbound-message hook, so a cross-session message is already in the turn before
// anything of ours runs. What is demonstrably available is `tool.call` refusing a
// tool before the engine runs it. So the turn is allowed to carry the text — it
// may read it — and is not allowed to act on it.
//
// Why the whole session and not the turn: the text does not leave the context
// when the turn ends. A model that read it can act on it next turn, and a
// one-turn rule would allow exactly that. The record therefore accumulates on
// the session and is dropped only when the session itself is replaced — a fresh
// session with no inherited context. Handover files (A8) and compaction
// summaries (A12) carry the text forward, so they are ingests like any other
// and re-taint the session they arrive in.
//
// Nothing here consults a display name. The policy table names node ids, and a
// session whose first user message says "you are Supervisor" gains nothing: the
// node id on the delivery is the only thing compared. Comparison lowercases
// both sides, because the crew's own code lowercases node ids.
//
// The owner may switch the whole gate off, from the crew's declaration
// (`house_rules.strict_gate`, martha#259): a member is a trusted helper, and the
// safety the owner chose is review plus a yes on every push. The switch reaches
// this function as an argument, never read here; absent means on, so a caller
// that has not heard of it cannot lose the guard.

import { INBOUND_PATHS, type InboundPath } from '../inbound_paths/inbound_paths.ts'
import { isShellTool } from '../shell_tools/shell_tools.ts'

/** Text that reached this session, and who it came from. */
export interface Ingestion {
  /** The inbound path id from ../inbound_paths, A1 … B8. */
  readonly path: string
  /**
   * The sender's node id, or `null` when nobody can be attributed (a fetch, a
   * checkout file, a server's instruction block, a compaction summary).
   */
  readonly from_node_id: string | null
  /**
   * Why the recorder could not attribute it, when it knows (martha#247): a ring's
   * answer says which branch carried no id, so the refusal names it rather than
   * leaving the member to guess. Never a party to the decision, only its wording.
   */
  readonly why?: string
}

/**
 * The identity a turn the owner typed at the member's own terminal carries
 * (martha#51). It is not a node id, so no signed list can name it, and it is
 * admitted only on the row the host's engine attests (`host-engine`): the owner
 * signs the policy, so the owner is its root, not an entry in it.
 */
export const OWNER_AT_THE_TERMINAL = 'the-owner-at-the-terminal'

/** Who may send text that a session is allowed to act on. Node ids only. */
export interface Policy {
  readonly may_send_executable_text: readonly string[]
}

/**
 * A session, carrying everything it has taken in that it has not yet cleared.
 *
 * The only way to clear it is to replace the session: there is deliberately no
 * "dismiss" — a member that has read a stranger's text cannot decide that it is
 * safe, because deciding is the model's job and the model is what was reached.
 */
export interface Session {
  readonly ingested: readonly Ingestion[]
}

export type Decision =
  | { readonly allow: true }
  | { readonly allow: false; readonly refusal: string }

export interface GateInput {
  readonly tool: string
  readonly session: Session
  readonly policy: Policy
  /**
   * Whether the owner turned the strict gate on in the crew's declaration (martha#259). Absent means on: a caller
   * that has not heard of the setting must not lose the guard, and the owner's off comes from the declaration
   * (../declare_crew) through the launcher, never from here.
   */
  readonly strict_gate?: boolean
}

/**
 * What clears a taint, said in every refusal. A `/clear` the crew's mod runs
 * for a refresh does not, because the successor inherits the record; only a
 * fresh start that reads no handover does.
 */
export const WHAT_CLEARS_IT =
  'Only a fresh start that reads no handover clears it: a crew refresh carries it to the successor.'

const PATHS_BY_ID = new Map<string, InboundPath>(INBOUND_PATHS.map((path) => [path.id, path]))

/** A session that has taken in nothing. The only state in which everything is allowed. */
export function startFreshSession(): Session {
  return { ingested: [] }
}

/** The session after a turn, carrying what arrived in it. */
export function recordIngestion(session: Session, arrived: readonly Ingestion[]): Session {
  return { ingested: [...session.ingested, ...arrived] }
}

/**
 * Allow or refuse one tool call, on everything this session has taken in.
 *
 * Reading and searching are always allowed: the member may read the text, it
 * just may not act on it. Everything that executes is refused while any
 * ingestion is unattributed, comes from a node id the policy table does not
 * name, or arrives on a path this gate has never heard of. The owner's typed
 * turn is the one ingestion admitted without the policy: the owner's mark on
 * the row the host's engine attests, and that mark nowhere else.
 */
export function refuseExecutionAfterUngatedText({ tool, session, policy, strict_gate = true }: GateInput): Decision {
  if (!isShellTool(tool)) return { allow: true }
  // The gate is off unless the owner asked for it (martha#259): the record is still kept, and nothing reads it.
  if (!strict_gate) return { allow: true }

  for (const ingest of session.ingested) {
    const refusal = refusalFor(ingest, PATHS_BY_ID.get(ingest.path), policy)
    if (refusal !== undefined) return { allow: false, refusal }
  }

  return { allow: true }
}

function refusalFor(ingest: Ingestion, path: InboundPath | undefined, policy: Policy): string | undefined {
  const tool = 'Nothing executes in this session'

  if (path === undefined) {
    return `${tool}: text arrived on path ${ingest.path}, which this gate does not know. ${WHAT_CLEARS_IT}`
  }

  if (path.attestation === 'host-engine') {
    if (ingest.from_node_id === OWNER_AT_THE_TERMINAL) return undefined
    return `${tool}: text on path ${path.id} (${path.what}) does not carry the owner's mark, the only sender that path admits. ${WHAT_CLEARS_IT}`
  }

  if (ingest.from_node_id === OWNER_AT_THE_TERMINAL) {
    return `${tool}: text on path ${path.id} (${path.what}) carries the owner's mark, which only the host's engine attests, on its own path. ${WHAT_CLEARS_IT}`
  }

  if (ingest.from_node_id === null) {
    const why = ingest.why === undefined ? '' : `: ${ingest.why}`
    return `${tool}: text from an unattributed sender arrived on path ${path.id} (${path.what})${why} and is still readable here. ${WHAT_CLEARS_IT}`
  }

  const sender = ingest.from_node_id.toLowerCase()
  if (!policy.may_send_executable_text.some((node_id) => node_id.toLowerCase() === sender)) {
    return `${tool}: the sender of the text on path ${path.id} (${path.what}) is not named by the policy table. ${WHAT_CLEARS_IT}`
  }

  return undefined
}
