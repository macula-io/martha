// The member's own write, read from disk once a file tool call has run, and kept before the launch is checked again
// (martha#132).
//
// The order is the point: the launcher hears that a call ran, keeps the write, and only then rechecks the launch.
// Rechecking first would take the very write being kept for an outsider's change and stop the member.
//
// A write is kept only when all of these hold; otherwise nothing is kept, and the recheck judges the change as
// anyone else's:
//   - the tool is one of Claude Code's file-writing tools (../claude_code_host/claude_code_file_tools.ts);
//   - the file the call names, resolved as the host resolves it (trimmed, a leading `~` against the home, the rest
//     against where the member started), then followed through its links, is under the checkout's top;
//   - it is a regular file now;
//   - for a Write, its bytes are the call's content.

import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'

import { asTheHostResolves, fileArgumentOf, WHOLE_FILE_CONTENT, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import type { LaunchHost } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import { checkoutTopOf, objectFormatOf, realOrResolved } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import type { ApprovedLaunch } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import {
  GIT_OBJECT_FORMATS,
  gitBlobIdOf,
  OWN_WRITE_MODES,
  type GitObjectFormat,
  type OwnWrite,
} from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'

/** The bit git reads a file's mode from: executable by its owner. */
const OWNER_EXECUTES = 0o100

const [REGULAR, EXECUTABLE] = OWN_WRITE_MODES

/** One tool call that has run, as the relay names it. */
export interface CallThatRan {
  readonly tool: string
  readonly input: Readonly<Record<string, unknown>>
  readonly session: string
  /** The host's home, which a leading `~` in the call's path names. */
  readonly home: string
}

const isUnder = (top: string, path: string): boolean => {
  const rest = relative(top, path)
  return rest !== '' && rest !== '..' && !rest.startsWith('../') && !isAbsolute(rest)
}

const isObjectFormat = (format: string | undefined): format is GitObjectFormat =>
  (GIT_OBJECT_FORMATS as readonly (string | undefined)[]).includes(format)

/** The real path of a file the call names, under the checkout's top, or undefined. */
function realFileUnder(top: string, named: string): string | undefined {
  try {
    const real = realpathSync(named)
    return isUnder(top, real) && lstatSync(real).isFile() ? real : undefined
  } catch {
    return undefined
  }
}

/** The file a call names and the call's id, when the tool writes one file and the call says which. */
function namedFileOf(call: CallThatRan): { readonly named: string; readonly tool_use_id: string } | undefined {
  const argument = fileArgumentOf(call.tool)
  const named = argument === undefined ? undefined : call.input[argument]
  const tool_use_id = call.input['tool_use_id']
  if (typeof named !== 'string' || typeof tool_use_id !== 'string' || tool_use_id === '') return undefined
  return { named, tool_use_id }
}

/** The checkout's top and object format, as git reports them from where the member started. */
function checkoutOf(launch: ApprovedLaunch, host: LaunchHost): { readonly cwd: string; readonly top: string; readonly format: GitObjectFormat } | undefined {
  const cwd = realOrResolved(host, launch.launch_dir)
  const top = checkoutTopOf(cwd, host)
  const format = objectFormatOf(cwd, host)
  return top === undefined || !isObjectFormat(format) ? undefined : { cwd, top, format }
}

/** True unless the call writes a whole file and these bytes are not its content. */
function bytesAreTheCalls(call: CallThatRan, bytes: Buffer): boolean {
  if (call.tool !== WHOLE_FILE_TOOL) return true
  const content = call.input[WHOLE_FILE_CONTENT]
  return typeof content === 'string' && bytes.equals(Buffer.from(content))
}

/** The own write a call made, read from disk now; or undefined when it is not one. */
export function ownWriteOfCall(launch: ApprovedLaunch, call: CallThatRan, host: LaunchHost, now: Date): OwnWrite | undefined {
  const since = launch.since_approval
  const file = namedFileOf(call)
  const checkout = since === undefined || file === undefined ? undefined : checkoutOf(launch, host)
  if (since === undefined || file === undefined || checkout === undefined) return undefined
  const path = realFileUnder(checkout.top, asTheHostResolves(file.named, checkout.cwd, call.home))
  if (path === undefined) return undefined
  const bytes = readFileSync(path)
  if (!bytesAreTheCalls(call, bytes)) return undefined
  return {
    path,
    blob: gitBlobIdOf(bytes, checkout.format),
    mode: (lstatSync(path).mode & OWNER_EXECUTES) === 0 ? REGULAR : EXECUTABLE,
    tool: call.tool,
    tool_use_id: file.tool_use_id,
    session: call.session,
    launch: since.launch_id,
    recorded_at: now.toISOString(),
  }
}

/** Keeps the call's own write, if it made one; or why it could not be kept. */
export function rememberOwnWriteOfCall(launch: ApprovedLaunch, call: CallThatRan, host: LaunchHost): string | undefined {
  const since = launch.since_approval
  const write = ownWriteOfCall(launch, call, host, new Date())
  if (since === undefined || write === undefined) return undefined
  return since.own_writes.append(write)
}
