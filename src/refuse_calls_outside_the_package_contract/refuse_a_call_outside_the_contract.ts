// What a member is told when a call does an act its package's contract leaves out (martha#513 slice 2, martha#511).
//
// This was a refusal; under the owner's cut of 2026-11-20 (martha#601, rows 109-116) it is a notice. A contract stops
// none of the three harms a refusal is kept for: a leaked key or token, lost work, or a push to main without the
// owner's yes, and a landing still needs that yes wherever it happens. So the call runs, and the member is told in one
// line which act the contract left out, so it can say so in its hand-off.
//
// A package with no contract, or one the ledger could not read back, is told nothing: there is no list to compare the
// call with (rows 109 and 111, removed).
//
// The notice names the act, the contract's version and the acts it does allow, so the member reading it knows what the
// contract was without asking.

import { theActsOfACall, type AContractAct, type AReadableCall, type TheOwnNameOf } from './the_acts_of_a_call.ts'

/** A package's contract as its calls are held to it: the package, the version, its kind, and the acts it allows. */
export interface TheContractInForce {
  readonly package: string
  readonly version: number
  readonly kind: 'bounded' | 'unbounded'
  /** The acts a bounded contract allows. An unbounded contract allows every act, and this is not read. */
  readonly allowed: readonly AContractAct[]
}

/** What a caller hands: the contract in force for the package this member holds, or none. */
export type TheContractHanded = TheContractInForce | undefined

/** The acts this call is that the contract leaves out, in the contract's own words. */
export function theActsNotAllowed(
  call: AReadableCall,
  contract: TheContractInForce,
  ownNameOf?: TheOwnNameOf,
): readonly AContractAct[] {
  if (contract.kind === 'unbounded') return []
  return theActsOfACall(call, contract.package, ownNameOf).filter((act) => !contract.allowed.includes(act))
}

/** How a contract names what it allows, as the notice quotes it: its acts with "only", or that it allows none at all. */
const theAllowedSaid = (contract: TheContractInForce): string =>
  contract.allowed.length === 0 ? 'no act at all' : `${contract.allowed.join(', ')} only`

/** The verbs a notice says the call performs, one per act, so the sentence reads as English. */
const THE_VERB: Readonly<Record<AContractAct, string>> = { push: 'pushes', tag: 'tags', handoff: 'hands off', land: 'lands' }

/** The call's acts as verbs: `pushes`, or `pushes and tags` when it is both. */
const theVerbsOf = (acts: readonly AContractAct[]): string => acts.map((act) => THE_VERB[act]).join(' and ')

/** Whether the sentence takes a plural: one act is, two acts are. */
const theIsOrAre = (acts: readonly AContractAct[]): string => (acts.length === 1 ? 'is' : 'are')

/** The one line a member is told when its call does acts the contract leaves out: the call still runs. */
const theNoticeSaid = (acts: readonly AContractAct[], contract: TheContractInForce): string =>
  `Notice: this call ${theVerbsOf(acts)}, and package ${contract.package}'s contract (version ${String(contract.version)}) allows ` +
  `${theAllowedSaid(contract)}, so ${acts.join(' and ')} ${theIsOrAre(acts)} not in it. The call runs; ` +
  'say so in your hand-off, and a landing still waits for the owner\'s yes.'

/**
 * The notice this call gets from the package's contract, or undefined when there is none to give: no contract, an
 * unbounded one, a call that is no act, or acts the contract allows.
 */
export function theNoticeOfACallOutsideTheContract(
  call: AReadableCall,
  contract: TheContractHanded,
  ownNameOf?: TheOwnNameOf,
): string | undefined {
  if (contract === undefined) return undefined
  const left_out = theActsNotAllowed(call, contract, ownNameOf)
  return left_out.length === 0 ? undefined : theNoticeSaid(left_out, contract)
}
