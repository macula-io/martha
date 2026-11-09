// The launch, checked again on a running member, with the member's own file writes told from anyone else's change
// (martha#132).
//
// This exists so a member started in an approved checkout can do its work there: before, its first Write moved the
// work tree off the approved one, and the recheck after that very call stopped it.
//
// The live checkout passes when it is what the owner approved (the gate's own check, unchanged). Otherwise every
// path that differs between the tree the owner approved and the live tree (`git diff-tree -r --no-renames`) must be
// deleted, or a regular file whose blob and mode are the ones this launch's last own write at that path left
// (../remember_a_members_own_writes). A deleted file plants nothing to run. A link or a gitlink is never an own
// write. A config entry that changed passes only when it is gone, or a file whose path passed as an own write: a
// config file git ignores is outside the tree, so no own write can pass it. Anything the gate refuses whatever was
// approved (an unknown host, a link or an unreadable config entry, an unread file) is refused here too.
//
// It fails closed: an approved tree the checkout no longer holds, own writes that cannot be read, or a checkout git
// cannot read refuse.
//
// Residuals, stated: a second writer to the same path during the one call that writes it is recorded as the
// member's, and the approved tree is read from the checkout's object store by its id. Either is a write as the
// owner's OS user, which a member already is (A13).

import { join, relative } from 'node:path'

import { ownWritesOfLaunch } from '../remember_a_members_own_writes/remember_a_members_own_writes.ts'
import { checkoutTopOf, realOrResolved, type LaunchHost, type TreeChange } from './checkout_tree.ts'
import {
  decideLaunch,
  fingerprintOf,
  readLaunchState,
  type ApprovedLaunch,
  type ConfigEntry,
  type LaunchDecision,
  type LaunchState,
  type SinceApproval,
} from './refuse_launch_of_unapproved_config.ts'

/** What the owner does when a running member's checkout moved off what they approved. */
export const approveAgain = (member: string): string =>
  `Run martha approve, read what it shows, and answer yes; then martha start ${member}.`

const moved = (paths: readonly string[], member: string): LaunchDecision => ({
  allow: false,
  refusal: `The checkout changed since the owner approved it, and not by this member's own file writes: ${paths.join(', ')}. ${approveAgain(member)}`,
})

const unreadTree = (tree: string, member: string): LaunchDecision => ({
  allow: false,
  refusal: `The tree the owner approved (${tree}) can no longer be read from the checkout, so the member's own writes cannot be told from anyone else's. ${approveAgain(member)}`,
})

const noCheckout = (member: string): LaunchDecision => ({
  allow: false,
  refusal: `The checkout no longer matches what the owner approved, and git can no longer read it as a checkout below the owner's home, so the member's own writes cannot be told from anyone else's. ${approveAgain(member)}`,
})

/**
 * The launch, checked again before and after every tool call: what the owner approved, or that plus this launch's
 * own writes. A launch started on no approval is checked as the gate checks it.
 */
export function recheckLaunchPassingOwnWrites(launch: ApprovedLaunch, host: LaunchHost): LaunchDecision {
  const live = readLaunchState(launch, host, launch.since_approval?.approved.tree ?? launch.approved_tree)
  const since = launch.since_approval
  if (since === undefined) return decideLaunch({ ...live, host: launch.host, approved_fingerprints: launch.approved_fingerprints })
  if (live.the_approved_tree_is_gone === true) return approvedTreeGone(since)
  const fingerprint = fingerprintOf(live)
  const shape = decideLaunch({ ...live, host: launch.host, approved_fingerprints: [fingerprint] })
  if (!shape.allow) return shape
  // Not the gate's "no config needs no approval": on a running member started on an approval, the hooks it loaded
  // run on after the checkout drops its config, so what changed is judged all the same (martha#142).
  if (launch.approved_fingerprints.includes(fingerprint)) return { allow: true }
  return judgedAgainstApproval(launch, since, live, host)
}

/** What an own write left at a path: the two things `ownWriteMatches` reads of one. */
export interface OwnWriteLeft {
  readonly blob: string
  readonly mode: string
}

/** True when this change is the bytes and the mode the member's own write left at that path (martha#132). */
export const ownWriteMatches = (write: OwnWriteLeft | undefined, change: TreeChange): boolean =>
  write !== undefined && !change.deleted && write.blob === change.blob && write.mode === change.mode

/** What is said when the tree the owner approved is no longer in the checkout at all. */
function approvedTreeGone(since: SinceApproval): LaunchDecision {
  return since.approved.tree === null ? noCheckout(since.member) : unreadTree(since.approved.tree, since.member)
}

/** The decision on a live checkout that differs from the approved one. */
function judgedAgainstApproval(launch: ApprovedLaunch, since: SinceApproval, live: LaunchState, host: LaunchHost): LaunchDecision {
  const approved_tree = since.approved.tree
  const top = checkoutTopOf(realOrResolved(host, launch.launch_dir), host)
  if (approved_tree === null || live.tree === null || top === undefined) return noCheckout(since.member)
  const changes = live.changes
  if (changes === undefined) return unreadTree(approved_tree, since.member)
  const own = ownWritesOfLaunch(since.own_writes, since.launch_id)
  if ('refusal' in own) return { allow: false, refusal: `${own.refusal} ${approveAgain(since.member)}` }
  const latest = new Map(own.writes.map((write) => [write.path, write]))
  const passed = new Set(changes.filter((change) => ownWriteMatches(latest.get(join(top, change.path)), change)).map((change) => join(top, change.path)))
  const outsiders = changes.filter((change) => !change.deleted && !passed.has(join(top, change.path))).map((change) => change.path)
  const entries = movedEntries(launch, since.approved.entries, live.entries, passed, host).map((path) => relative(top, path))
  const paths = [...new Set([...outsiders, ...entries])]
  return paths.length === 0 ? { allow: true } : moved(paths, since.member)
}

/**
 * The real paths of the config entries that changed and did not pass: neither gone, nor a directory (which runs
 * nothing; the files in it are entries of their own), nor a file an own write left.
 */
function movedEntries(
  launch: ApprovedLaunch,
  approved: readonly ConfigEntry[],
  live: readonly ConfigEntry[],
  passed: ReadonlySet<string>,
  host: LaunchHost,
): string[] {
  const was = new Map(approved.map((entry) => [entry.path, JSON.stringify(entry)]))
  return live
    .filter((entry) => was.get(entry.path) !== JSON.stringify(entry) && entry.kind !== 'absent' && entry.kind !== 'directory')
    .map((entry) => realOrResolved(host, join(launch.launch_dir, entry.path)))
    .filter((path) => !passed.has(path))
}
