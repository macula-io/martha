// The words the guard's three programs spell the same (martha#562, martha#772, martha#755): the state git calls the
// hook with, the name git runs the hook under, and the variables the judge's own node never takes, with the names the
// shells keep them under.
//
// They sit in this slice, apart from the questions and answers of the protocol, because both sides of the guard read
// them: the shells this slice writes, and the judge that is copied out of this tree into a launch's directory. The
// guard carries this file beside the judge for that reason (the copy's places are the launch's own, in
// `guard_the_git_a_member_runs`), so the shell that keeps a variable back and the judge that hands it on cannot spell
// it two ways. Nothing here reaches the machine: every value is a word.

/**
 * The state git calls a `reference-transaction` hook with when only that hook stands between the transaction and its
 * refs: the one state whose refusal stops it, so the one the judge judges (martha#562). The hook script reads it from
 * here too, so the state the shell lets through to node and the state the judge judges are one word (martha#755).
 */
export const PREPARED = 'prepared'

/**
 * The name git runs a `reference-transaction` hook under, and the mode the judge is told when seam (c) asks it
 * (martha#562). The judge reads it from here rather than typing it, and so does the shell that places the hook.
 */
export const THE_HOOK_NAME = 'reference-transaction'

/**
 * What a member's environment carries that would choose the code the judge's own node runs (martha#772): a preload or
 * any node flag, and a compile cache whose entries node runs in place of the judge's files, checked only by a sum anyone
 * can compute. The shim and the hook keep each one, start the judge without it, and the judge hands it back to the real
 * git, so the member's git and everything git starts still get exactly what the member set.
 */
export const WHAT_THE_JUDGE_NEVER_TAKES = ['NODE_OPTIONS', 'NODE_COMPILE_CACHE'] as const

/** The name a variable the judge never takes is kept under while the judge runs, for the real git it hands a call to. */
export const theKeptNameOf = (variable: string): string => `MARTHA_GUARD_KEPT_${variable}`

/** The name that says whether the member had the variable at all, which an empty value alone cannot say. */
export const theHadNameOf = (variable: string): string => `MARTHA_GUARD_HAD_${variable}`

/** What `theHadNameOf` holds when the member had the variable, empty or not; it is unset or empty when it did not. */
export const THE_MEMBER_HAD_IT = '1'
