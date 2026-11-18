// What a launcher answers when a member's `git` or its clone's transaction asks it about a call (martha#562, seams b
// and c).
//
// Both questions arrive on the launch's own socket from a program running in the member's shell, so both are read into
// the shape the workspace guard already judges — a directory and git's words, or the refs a transaction names — and the
// crew's own places decide. A body that is not that shape is not a refusal: the shim and the hook fail open on it and
// write the miss down (the Supervisor's ruling of 2026-11-17), so it is answered as no answer at all, never as a yes.

import { isAbsolute } from 'node:path'

import { ALLOW, type Verdict } from '../claude_code_relay/hooks/relay_protocol.ts'

/** What a guard's question is answered with: the verdict, which is exactly `{"allow":1}` or `{"deny":"<why>"}`, or why
 * this launcher cannot read the question. The second is not a refusal — the shim fails open on it — so it is answered
 * with a status the shim reads as no answer at all. */
export type AGuardsAnswer = { readonly verdict: Verdict } | { readonly refused: string }

/** Why a guard's question is one this launcher does not answer: the body is not the shape the shim or the hook posts. */
export const THE_GUARD_ASK_UNREADABLE = 'the launcher could not read the call it was asked about'

/** The crew's places these two seams ask, as the tools hand them on: a place given none refuses nothing. */
export interface TheGuardsPlaces {
  readonly refusesTheGitOnThePath?: (call: {
    readonly directory: string
    readonly args: readonly string[]
  }) => Promise<string | undefined>
  readonly refusesTheRefUpdate?: (updates: readonly { readonly ref: string; readonly deletes: boolean }[]) => string | undefined
}

/** The `git` on a member's PATH asking about a call it is about to run (martha#562, seam b): the crew's verdict, or why
 * this launcher cannot read the question. */
export async function theGitCallJudged(places: TheGuardsPlaces | undefined, body: unknown): Promise<AGuardsAnswer> {
  const call = aCallTheShimAskedAbout(body)
  if (call === undefined) return { refused: THE_GUARD_ASK_UNREADABLE }
  const refused = await places?.refusesTheGitOnThePath?.(call)
  return refused === undefined ? { verdict: ALLOW } : { verdict: { deny: refused } }
}

/** The clone's reference-transaction hook asking about the refs a transaction would update (martha#562, seam c). */
export function theRefTransactionJudged(places: TheGuardsPlaces | undefined, body: unknown): AGuardsAnswer {
  const updates = theRefsATransactionAskedAbout(body)
  if (updates === undefined) return { refused: THE_GUARD_ASK_UNREADABLE }
  const refused = places?.refusesTheRefUpdate?.(updates)
  return refused === undefined ? { verdict: ALLOW } : { verdict: { deny: refused } }
}

/** The status and the body a guard's answer is sent with: a yes on 200, and no answer at all on 400. */
export function theAnswerAGuardHears(answered: AGuardsAnswer): { readonly status: number; readonly body: unknown } {
  return 'refused' in answered ? { status: 400, body: answered } : { status: 200, body: answered.verdict }
}

/** The git call a shim asked about (martha#562, seam b): an absolute directory and git's own words, or undefined. */
function aCallTheShimAskedAbout(body: unknown): { readonly directory: string; readonly args: readonly string[] } | undefined {
  if (!isABody(body)) return undefined
  const { cwd, args } = body
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return undefined
  if (!Array.isArray(args) || args.some((word: unknown) => typeof word !== 'string')) return undefined
  return { directory: cwd, args: args as readonly string[] }
}

/** The refs a transaction asked about (martha#562, seam c): one ref and whether it is a delete, each, or undefined. */
function theRefsATransactionAskedAbout(body: unknown): readonly { readonly ref: string; readonly deletes: boolean }[] | undefined {
  if (!isABody(body) || !Array.isArray(body['updates'])) return undefined
  const updates = body['updates'].flatMap((update: unknown) => anUpdateAskedAbout(update) ?? [])
  return updates.length === body['updates'].length ? updates : undefined
}

/** One ref a transaction asked about, or undefined when it is not the shape the hook posts. */
function anUpdateAskedAbout(update: unknown): { readonly ref: string; readonly deletes: boolean } | undefined {
  if (!isABody(update)) return undefined
  const { ref, deletes } = update
  return isText(ref) && typeof deletes === 'boolean' ? { ref, deletes } : undefined
}

/** Whether a body is a JSON object to read a field from. */
function isABody(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a value is a text with something in it. */
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
