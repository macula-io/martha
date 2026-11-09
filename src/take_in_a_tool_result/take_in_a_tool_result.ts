// What a session took in when one of its host's own tools ran (martha#127).
//
// This exists so a member that read a stranger's text through a built-in tool
// (a file, a page, a command's output) loses its shell, as one that read it
// through an MCP tool already does.
//
// A host declares, per tool name, what that tool's result is
// (../claude_code_host for Claude Code). The result itself is never read: it is
// placed by what the call asked for, so a stranger cannot word a result into
// another row. Four rules carry it.
//
//   1. A TOOL THE HOST DID NOT PLACE TAKES THE SHELL. Its result is recorded on
//      a path the gate does not know, as a lost record is, so a tool a new host
//      release adds is refused rather than passed.
//
//   2. A COMMAND'S OUTPUT IS ALWAYS A13. One command can print text from
//      anywhere, and nothing tells one part of its output from another. A first
//      word of `gh`, or `git` with a subcommand that prints history, adds the
//      row that names it (B3, B5). A label only ever adds: it changes which row a
//      refusal names, never whether the shell goes.
//
//   3. A READ OF THE TREE THE OWNER APPROVED, AS THE MEMBER STARTED ON IT,
//      RECORDS NOTHING, and only while the checkout still holds that tree. The
//      launcher reads the start state before the host starts and keeps its
//      tree (`approved_start`) only when its fingerprint is one the owner
//      approved: that tree is the one the owner approved to run as the owner,
//      so reading the same bytes grants nothing more. A read is judged against
//      it, never against the live tree, so a `gh pr checkout` or a file another
//      process writes mid-session is a stranger's (#132). A checkout with no
//      config approves nothing, so every read in it counts (decided 2026-11-07,
//      martha#127). What is in the tree is the launcher's question to git,
//      never the model's (`isInTheCheckoutTree`). Git history is not in it:
//      commit messages are B5 even in the member's own checkout.
//
//      THE MEMBER'S OWN WRITES ARE PART OF THAT TREE (martha#132, decided
//      2026-11-07 by Raf): a file this launch's own write left there, unchanged
//      in bytes and mode, is what the member itself put in the checkout, so it
//      is no stranger's text and the exemption stands over it. Only that
//      widens: one path a stranger changed, deleted or put there, or an own
//      write that cannot be read, and every read in the checkout counts again.
//
//   4. A READ THAT NAMES NO PLACE COUNTS. No path, a relative one, or one that
//      is no text: the launcher cannot say what was read, so it was a stranger's.

import { join } from 'node:path'

import type { Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { TurnSource } from '../host_contract/host_contract.ts'
import {
  checkoutTopOf,
  isInTheCheckoutTree,
  readCheckoutTree,
  realOrResolved,
  type LaunchHost,
  type ReadSpan,
} from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import { ownWriteMatches } from '../refuse_launch_of_unapproved_config/pass_a_members_own_writes.ts'
import type { ApprovedLaunch } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { ownWritesOfLaunch } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { recordIngestion, type Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'

/** What a host says one of its tools returned, keyed by the call's own fields. */
export type ToolResultReading =
  /** The file the call's `field` names: B4 unless it is in the tree the owner approved and the member started on. */
  | { readonly reads: 'a_file'; readonly source: 'checkout_file'; readonly field: string }
  /** Every file under the path the call's `field` names: B4 unless all of it is in the tree the owner approved and the member started on. */
  | { readonly reads: 'a_search'; readonly source: 'checkout_file'; readonly field: string }
  /** The output of the command the call's `field` holds: always A13, plus the rows its first words name. */
  | { readonly reads: 'a_command'; readonly source: 'checkout_run'; readonly field: string }
  /** Text from one known source, whatever the call asked. */
  | { readonly reads: 'a_source'; readonly source: TurnSource }

/** How a host places its tools' results, by the tool's name as the host calls it. */
export type ToolResultRows = Readonly<Record<string, ToolResultReading>>

/** What the record holds for a tool result the host did not place. */
export const UNPLACED_TOOL_RESULT: Ingestion = { path: 'tool-result-unplaced', from_node_id: null }

/** The command whose first word names the GitHub CLI: its output is B3's. */
export const GITHUB_CLI = 'gh'
export const GIT = 'git'
/** Git subcommands that print history: commit messages and authors, B5's. */
export const HISTORY_SUBCOMMANDS: readonly string[] = ['log', 'show', 'blame', 'reflog', 'shortlog']

const SPAN_OF: Readonly<Record<'a_file' | 'a_search', ReadSpan>> = { a_file: 'one_file', a_search: 'every_file_below' }

/** What one tool call needs to be placed: the call, the launch it ran in, and the machine git runs on. */
export interface ToolResult {
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
  readonly rows: ToolResultRows
  readonly launch: ApprovedLaunch
  /**
   * The checkout's tree as the launcher read it before the host started, kept
   * only when that start state's fingerprint is one the owner approved; `null`
   * otherwise, and then every read counts.
   */
  readonly approved_start: string | null
  readonly host: LaunchHost
}

/** The session after a tool of its host ran, with what the tool returned recorded. */
export function takeInToolResult(session: HostSession, result: ToolResult, binder: Binder): HostSession {
  const reading = Object.hasOwn(result.rows, result.tool) ? result.rows[result.tool] : undefined
  if (reading === undefined) return { ...session, gate: recordIngestion(session.gate, [UNPLACED_TOOL_RESULT]) }
  return sourcesOf(reading, result).reduce((taken, source) => takeInTurn(taken, { source }, binder), session)
}

function sourcesOf(reading: ToolResultReading, result: ToolResult): readonly TurnSource[] {
  if (reading.reads === 'a_source') return [reading.source]
  const named = result.input[reading.field]
  if (reading.reads === 'a_command') return [reading.source, ...labelsOf(named)]
  return readOfTheApprovedStartTree(named, SPAN_OF[reading.reads], result) ? [] : [reading.source]
}

function readOfTheApprovedStartTree(path: unknown, span: ReadSpan, result: ToolResult): boolean {
  if (typeof path !== 'string') return false
  const { launch, approved_start, host } = result
  if (approved_start === null) return false
  if (!holdsTheApprovedStartTree(launch, approved_start, host)) return false
  return isInTheCheckoutTree(launch.launch_dir, launch.stop_dir, path, span, host)
}

/**
 * Whether the checkout holds the tree the owner approved, or that tree as this member's own writes left it
 * (martha#132): every path that differs from the start tree is a file one of this launch's own writes left there,
 * byte for byte and with the mode it set. What the member wrote itself is not text taken in from a stranger, so the
 * exemption above stands over it too (decided 2026-11-07, Raf, on martha#132).
 *
 * Nothing else widens: a path a stranger changed, deleted, or put there is no own write, and the whole exemption
 * falls with it. No approval means no own writes and no start tree, so every read counts, as before.
 */
function holdsTheApprovedStartTree(launch: ApprovedLaunch, approved_start: string, host: LaunchHost): boolean {
  const read = readCheckoutTree(launch.launch_dir, launch.stop_dir, host, approved_start)
  if (read.kind !== 'tree') return false
  if (read.tree === approved_start) return true
  const since = launch.since_approval
  const top = checkoutTopOf(realOrResolved(host, launch.launch_dir), host)
  if (since === undefined || top === undefined || read.changes === undefined) return false
  const own = ownWritesOfLaunch(since.own_writes, since.launch_id)
  if ('refusal' in own) return false
  const latest = new Map(own.writes.map((write) => [write.path, write]))
  return read.changes.every((change) => ownWriteMatches(latest.get(join(top, change.path)), change))
}

/** The rows a command's first words name. Only ever added to A13, never instead of it. */
export function labelsOf(command: unknown): readonly TurnSource[] {
  if (typeof command !== 'string') return []
  const [first, second] = command.trim().split(/\s+/)
  if (first === GITHUB_CLI) return ['gh']
  if (first === GIT && second !== undefined && HISTORY_SUBCOMMANDS.includes(second)) return ['git_history']
  return []
}
