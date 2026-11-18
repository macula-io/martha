// What a member's `git` and its clone's `reference-transaction` hook ask the launcher, and what they hear back
// (martha#562, seams b and c).
//
// This sits with the guard rather than with the relay's own protocol because the judge is copied out of this tree into
// a launch's directory and carries this file beside it: the two questions and their one answer shape travel with the
// program that asks them. The strict reading of an answer is the relay's (../claude_code_relay/hooks/relay_protocol.ts),
// so a yes is the exact shape or it is no, and a body that is not one of the two is a miss the caller fails open on.

import { exactKeys, isReason, jsonObjectOf } from '../claude_code_relay/hooks/relay_protocol.ts'

/**
 * Where the `git` first on a member's PATH asks about the call it is about to run (martha#562, seam b). Not a hook
 * event: the shim runs in the member's shell, and the launcher judges the call from its own declaration.
 */
export const GIT_CALL_PATH = '/judge-a-git-call'

/**
 * Where the clone's `reference-transaction` hook asks about the refs a transaction would update (martha#562, seam c):
 * a delete that reached git by an alias, a hook or git's absolute path, past the shell and past the shim.
 */
export const REF_TRANSACTION_PATH = '/judge-a-ref-transaction'

/** A git call as the shim posts it: where the shell runs it, and git's own words unchanged. */
export function gitCallBody(cwd: string, args: readonly string[]): Readonly<Record<string, unknown>> {
  return { cwd, args }
}

/** One ref a transaction touches: its full name, and whether the transaction deletes it. */
export interface ARefUpdate {
  readonly ref: string
  readonly deletes: boolean
}

/** A transaction as the clone's hook posts it: every ref it would update. */
export function refTransactionBody(updates: readonly ARefUpdate[]): Readonly<Record<string, unknown>> {
  return { updates }
}

/**
 * A guard's verdict, as the shim and the hook hear it. `allow` runs the call and `deny` is a refusal the decision
 * actually returned, which stops it; everything else — a status, a body that is not the exact yes or no, a launcher
 * that did not answer in time — is `unreadable`, which is a miss the caller fails open on and writes down
 * (martha#562, the Supervisor's ruling on seam b's fail-open).
 */
export type HeardGitVerdict =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly why: string }
  | { readonly kind: 'unreadable'; readonly why: string }

/** Why a guard reads an answer as no answer at all: the two shapes it knows are the only ones. */
const NOT_ONE_OF_ITS_TWO = 'the launcher answered in a shape the guard does not know'

const UNREADABLE = (why: string): HeardGitVerdict => ({ kind: 'unreadable', why })

/** A guard's verdict, as the shim hears it: exactly `{"allow":1}` or `{"deny":"<why>"}`, and nothing else is a yes or a no. */
export function heardGitVerdict(status: number, text: string): HeardGitVerdict {
  if (status !== 200) return UNREADABLE(`the launcher answered with status ${status}`)
  const value = jsonObjectOf(text)
  if (value === undefined) return UNREADABLE(NOT_ONE_OF_ITS_TWO)
  if (exactKeys(value, ['allow']) && value.allow === 1) return { kind: 'allow' }
  if (exactKeys(value, ['deny']) && isReason(value.deny)) return { kind: 'deny', why: value.deny }
  return UNREADABLE(NOT_ONE_OF_ITS_TWO)
}

/**
 * How long a shim waits for the launcher before it gives the call to the real git (martha#562). The launcher answers
 * from git itself — a clone's branches, its default branch and its worktrees — so the wait is long enough for three
 * reads of a large checkout and short enough that a member's shell does not hang on a launcher that has gone.
 */
export const THE_GUARDS_DEADLINE_MS = 5_000
