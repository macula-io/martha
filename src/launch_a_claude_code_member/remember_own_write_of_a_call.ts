// The member's own write, read from the disk once a file tool call has run, and kept before the launch is checked again
// (martha#132).
//
// The order is the point: the launcher hears that a call ran, keeps the write, and only then rechecks the launch.
// Rechecking first would take the very write being kept for an outsider's change and stop the member.
//
// The disk is read through the host contract's file tree and never with node:fs (martha#158), so a test host can answer
// these reads, and a host that is not this machine's POSIX one can run them at all.
//
// A write is kept only when all of these hold; otherwise nothing is kept, and the recheck judges the change as
// anyone else's:
//   - the tool is one of Claude Code's file-writing tools (../claude_code_host/claude_code_file_tools.ts);
//   - the file the call names, resolved as the host resolves it (trimmed, a leading `~` against the home, the rest
//     against where the member started), then followed through its links, is under the checkout's top;
//   - it is a regular file now;
//   - for a Write, its bytes are the call's content.

import { isAbsolute, relative } from 'node:path'

import { asTheHostResolves, fileArgumentOf, WHOLE_FILE_CONTENT, WHOLE_FILE_TOOL } from '../claude_code_host/claude_code_file_tools.ts'
import type { LaunchHost } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import { blobAsGitAdds, checkoutTopOf, realOrResolved } from '../refuse_launch_of_unapproved_config/checkout_tree.ts'
import type { ApprovedLaunch } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import { OWN_WRITE_MODES, type OwnWrite, type OwnWriteMode } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'

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

/**
 * The file the call names, under the checkout's top, as the host reads it: its real path, whether its owner may execute
 * it, and its bytes. Undefined when the path is not a regular file there.
 */
function writtenFileUnder(host: LaunchHost, top: string, named: string): { readonly path: string; readonly ownerExecutes: boolean; readonly bytes: Uint8Array } | undefined {
  const real = host.stores.files.realPathOf(named)
  if (real === null || !isUnder(top, real)) return undefined
  const kind = host.stores.files.kindOf(real)
  return kind.kind === 'file' ? { path: real, ownerExecutes: kind.ownerExecutes, bytes: host.stores.files.bytesOf(real) } : undefined
}

/** The file a call names and the call's id, when the tool writes one file and the call says which. */
function namedFileOf(call: CallThatRan): { readonly named: string; readonly tool_use_id: string } | undefined {
  const argument = fileArgumentOf(call.tool)
  const named = argument === undefined ? undefined : call.input[argument]
  const tool_use_id = call.input['tool_use_id']
  if (typeof named !== 'string' || typeof tool_use_id !== 'string' || tool_use_id === '') return undefined
  return { named, tool_use_id }
}

/** The checkout's top, as git reports it from where the member started. */
function checkoutOf(launch: ApprovedLaunch, host: LaunchHost): { readonly cwd: string; readonly top: string } | undefined {
  const cwd = realOrResolved(host, launch.launch_dir)
  const top = checkoutTopOf(cwd, host)
  return top === undefined ? undefined : { cwd, top }
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, at) => byte === b[at])

/** True unless the call writes a whole file and these bytes are not its content. */
function bytesAreTheCalls(call: CallThatRan, bytes: Uint8Array): boolean {
  if (call.tool !== WHOLE_FILE_TOOL) return true
  const content = call.input[WHOLE_FILE_CONTENT]
  return typeof content === 'string' && sameBytes(bytes, new TextEncoder().encode(content))
}

/**
 * The file the call wrote, as git would add it now: its real path and blob. The blob is the one `git add` gives it,
 * not one of the raw bytes, because the tree it is compared with is read by `git add` (#132 r=1). Undefined when the
 * call names no file under the checkout, or the bytes there are not the call's.
 */
function writtenFileOf(call: CallThatRan, named: string, checkout: { readonly cwd: string; readonly top: string }, host: LaunchHost): { readonly path: string; readonly ownerExecutes: boolean; readonly blob: string } | undefined {
  const file = writtenFileUnder(host, checkout.top, asTheHostResolves(named, checkout.cwd, call.home))
  if (file === undefined || !bytesAreTheCalls(call, file.bytes)) return undefined
  const blob = blobAsGitAdds(checkout.top, file.path, host)
  return blob === undefined ? undefined : { path: file.path, ownerExecutes: file.ownerExecutes, blob }
}

/** The own write a call made, read through the host now; or undefined when it is not one. */
export function ownWriteOfCall(launch: ApprovedLaunch, call: CallThatRan, host: LaunchHost, now: Date): OwnWrite | undefined {
  const since = launch.since_approval
  const file = namedFileOf(call)
  if (since === undefined || file === undefined) return undefined
  const written = readTheWrite(launch, file.named, call, host)
  return written === undefined ? undefined : { ...written, tool_use_id: file.tool_use_id, tool: call.tool, session: call.session, launch: since.launch_id, recorded_at: now.toISOString() }
}

/**
 * True when this is the machine's own refusal, which the contract lets a read fail with: an error
 * carrying the system's `code` (EACCES, ENOTDIR...). Anything else is a bug in this decision, and
 * is left to be thrown rather than read as a file that is not the member's write (review r=1).
 */
const isTheMachinesRefusal = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && typeof (error as { readonly code?: unknown }).code === 'string'

/**
 * The file the call wrote and the mode it holds, or undefined when it wrote none. The contract lets a read fail with the
 * machine's own error (EACCES, ENOTDIR), and a file that cannot be read is not an own write: the relay is waiting for an
 * answer, and this must give one rather than throw. A failure that is not the machine's — a bug here — is thrown, so it
 * stays loud instead of being read as someone else's change.
 */
function readTheWrite(launch: ApprovedLaunch, named: string, call: CallThatRan, host: LaunchHost): { readonly path: string; readonly blob: string; readonly mode: OwnWriteMode } | undefined {
  try {
    const checkout = checkoutOf(launch, host)
    const written = checkout === undefined ? undefined : writtenFileOf(call, named, checkout, host)
    return written === undefined ? undefined : { path: written.path, blob: written.blob, mode: written.ownerExecutes ? EXECUTABLE : REGULAR }
  } catch (error) {
    if (!isTheMachinesRefusal(error)) throw error
    return undefined
  }
}

/** Keeps the call's own write, if it made one; or why it could not be kept. */
export function rememberOwnWriteOfCall(launch: ApprovedLaunch, call: CallThatRan, host: LaunchHost): string | undefined {
  const since = launch.since_approval
  const write = ownWriteOfCall(launch, call, host, new Date())
  if (since === undefined || write === undefined) return undefined
  return since.own_writes.append(write)
}
