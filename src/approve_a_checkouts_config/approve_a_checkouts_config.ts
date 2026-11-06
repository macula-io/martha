// `martha approve`: the owner reads the config a member would start from, and says yes to it (martha#98).
//
// This exists so a member starts only on config its owner has read and approved by content (the launch gate,
// ../refuse_launch_of_unapproved_config, rule 2), without the owner ever handling a fingerprint by hand.
//
// It reads what the launch gate reads, from the project root up to the owner's home: every file a member's host
// would start something from, and the checkout's work tree. It shows the owner each one (path, kind, sha256),
// the tree and the fingerprint, and asks them to type yes. Only `yes` is a yes. The yes is kept outside the
// checkout (../keep_martha_state_outside_the_checkout) for the next `martha start`.
//
// It asks only on a terminal. A member's shell tool runs with no terminal on its input, so a model that calls
// `martha approve` is refused before anything is read. That is a speed bump, not a boundary: a member runs as
// the owner's OS user and could write the approvals file itself (martha#1 decision 2). `martha start` shows the
// owner the approval it starts on and when it was given, so one the owner never gave is on their screen.
// Under the same residual, a member's shell can swap a file between approve showing it and the owner reading it
// in their editor: the owner approves the bytes approve hashed and showed, and the gate refuses any other, but
// the owner cannot tell those bytes from what they opened. Only a boundary between the member and the owner's
// files closes it (martha#24).
//
// Every line approve shows reaches the owner through the command's escaping (../run_the_martha_command), so a
// path that holds terminal controls is shown as escapes, never acted on.
//
// Nothing is asked when there is nothing to approve (a checkout with no such config needs no approval, rule 5),
// when the config is already approved, or when the gate would refuse the config whatever the owner said (a
// symlink, config outside any checkout): that refusal is shown instead.

import { CLAUDE_CODE } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { thisMachine } from '../linux_process_identity/files_and_processes_on_this_machine.ts'
import {
  appendApproval,
  readApprovals,
  type MarthaState,
} from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import {
  decideLaunch,
  fingerprintOf,
  readLaunchState,
  type ConfigEntry,
  type LaunchState,
} from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'

/** The one answer that approves. */
export const YES = 'yes'

/** Why approve asks nothing: its input is no terminal, as a member's shell tool's never is. */
export const NOT_A_TERMINAL =
  'martha approve asks you on your own terminal, and its input is not one. Run it yourself, in a terminal.'

/** The owner's terminal: whether the input is one, and a question asked on it. */
export interface OwnersTerminal {
  readonly is_terminal: boolean
  ask(question: string): Promise<string>
}

export interface ApproveRequest {
  /** The project's absolute path: where members start. */
  readonly root: string
  /** The owner's home: the launch gate reads no config at it or above it. */
  readonly home: string
  readonly state: MarthaState
  readonly terminal: OwnersTerminal
  tellOwner(line: string): void
  now(): Date
}

export type ApproveOutcome =
  | { readonly kind: 'approved'; readonly fingerprint: string }
  | { readonly kind: 'nothing' }
  | { readonly kind: 'refused'; readonly refusal: string }

/** What approve says when the checkout holds no config that starts code. */
export const NOTHING_TO_APPROVE = 'Nothing to approve: this checkout holds no config that starts code by itself.'
const QUESTION = `Type ${YES} to approve this config for every member of this crew: `

const lineOf = (entry: ConfigEntry): string =>
  `  ${entry.path}  ${entry.kind}${entry.kind === 'file' ? `  sha256 ${entry.sha256}` : ''}`

/** What the owner is shown before they are asked. */
function showConfig(request: ApproveRequest, launch: LaunchState, fingerprint: string): void {
  request.tellOwner('A member started here would start code from:')
  for (const entry of launch.entries.filter((found) => found.kind !== 'absent')) request.tellOwner(lineOf(entry))
  request.tellOwner(`with the checkout's work tree ${launch.tree ?? '(none)'}.`)
  request.tellOwner(`Read those files. Their fingerprint is ${fingerprint}.`)
}

/** Shows the owner the config a member would start from, and keeps their yes to it. */
export async function approveConfig(request: ApproveRequest): Promise<ApproveOutcome> {
  if (!request.terminal.is_terminal) return { kind: 'refused', refusal: NOT_A_TERMINAL }
  const launch = readLaunchState({ host: CLAUDE_CODE, launch_dir: request.root, stop_dir: request.home }, thisMachine)
  if (launch.entries.every((entry) => entry.kind === 'absent')) return { kind: 'nothing' }

  const fingerprint = fingerprintOf(launch)
  const gate = decideLaunch({ host: CLAUDE_CODE, ...launch, approved_fingerprints: [fingerprint] })
  if (!gate.allow) return { kind: 'refused', refusal: gate.refusal }
  const kept = readApprovals(request.state)
  if ('refusal' in kept) return { kind: 'refused', refusal: kept.refusal }
  if (kept.approvals.some((approval) => approval.fingerprint === fingerprint)) return { kind: 'approved', fingerprint }

  showConfig(request, launch, fingerprint)
  const answer = (await request.terminal.ask(QUESTION)).trim()
  if (answer !== YES) return { kind: 'refused', refusal: `Not approved: only ${YES} approves, and nothing was kept.` }
  const unkept = appendApproval(request.state, { fingerprint, approved_at: request.now().toISOString(), ...launch })
  return unkept === undefined ? { kind: 'approved', fingerprint } : { kind: 'refused', refusal: unkept.refusal }
}
