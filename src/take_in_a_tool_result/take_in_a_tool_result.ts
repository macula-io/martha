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
//   3. A READ OF THE TREE THE MEMBER STARTED ON RECORDS NOTHING, and only
//      while the checkout still holds that tree. The launcher reads it before
//      the host starts (`started_on`); a read is judged against it, never
//      against the live tree, so a `gh pr checkout` or a file another process
//      writes mid-session is a stranger's (martha#127, #132). Where the
//      checkout has config, that tree is the one the owner approved to run as
//      the owner, so reading the same bytes grants nothing more. Where it has
//      none, nothing was approved: whether a read of the start tree is then
//      exempt is the owner's choice, open on martha#127. What is in the tree
//      is the launcher's question to git, never the model's
//      (`isInTheCheckoutTree`). Git history is not in it: commit messages are
//      B5 even in the member's own checkout.
//
//   4. A READ THAT NAMES NO PLACE COUNTS. No path, a relative one, or one that
//      is no text: the launcher cannot say what was read, so it was a stranger's.

import type { Binder } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'
import type { TurnSource } from '../host_contract/host_contract.ts'
import {
  isInTheCheckoutTree,
  readCheckoutTree,
  type LaunchHost,
  type ReadSpan,
} from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import type { ApprovedLaunch } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { recordIngestion, type Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'
import { takeInTurn, type HostSession } from '../take_in_a_turn/take_in_a_turn.ts'

/** What a host says one of its tools returned, keyed by the call's own fields. */
export type ToolResultReading =
  /** The file the call's `field` names: B4 unless it is in the approved tree. */
  | { readonly reads: 'a_file'; readonly source: 'checkout_file'; readonly field: string }
  /** Every file under the path the call's `field` names: B4 unless all of it is in the approved tree. */
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
  /** The checkout's tree as the launcher read it before the host started; `null` when it had none. */
  readonly started_on: string | null
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
  return readOfTheApprovedTree(named, SPAN_OF[reading.reads], result) ? [] : [reading.source]
}

function readOfTheApprovedTree(path: unknown, span: ReadSpan, { launch, started_on, host }: ToolResult): boolean {
  if (typeof path !== 'string' || started_on === null) return false
  if (readCheckoutTree(launch.launch_dir, launch.stop_dir, host) !== started_on) return false
  return isInTheCheckoutTree(launch.launch_dir, launch.stop_dir, path, span, host)
}

/** The rows a command's first words name. Only ever added to A13, never instead of it. */
export function labelsOf(command: unknown): readonly TurnSource[] {
  if (typeof command !== 'string') return []
  const [first, second] = command.trim().split(/\s+/)
  if (first === GITHUB_CLI) return ['gh']
  if (first === GIT && second !== undefined && HISTORY_SUBCOMMANDS.includes(second)) return ['git_history']
  return []
}
