// Why a call is refused by the package contract it runs under (martha#513 slice 2).
//
// This exists so a member's contract narrows what it may do, and never widens it: the check is one more refusal at the
// end of the gate's own list, so a call refused for other reasons keeps saying the more serious one, and a contract can
// only turn a yes into a no. It refuses nothing when the member holds no contract (slice 1's rule: a package with no
// contract is told so, never refused) and nothing for an unbounded one, which is the owner's word that this package
// needs no contract at all.
//
// The refusal names the act, the contract's version and the acts it does allow, because the model that read the call is
// the one that has to stop, and "not allowed" without the list only invites a second guess.

import { theActsOfACall, type AContractAct, type AReadableCall } from './the_acts_of_a_call.ts'

/** A package's contract as its calls are held to it: the package, the version, its kind, and the acts it allows. */
export interface TheContractInForce {
  readonly package: string
  readonly version: number
  readonly kind: 'bounded' | 'unbounded'
  /** The acts a bounded contract allows. An unbounded contract allows every act, and this is not read. */
  readonly allowed: readonly AContractAct[]
}

/** The acts this call is that the contract leaves out, in the contract's own words. */
export function theActsNotAllowed(call: AReadableCall, contract: TheContractInForce): readonly AContractAct[] {
  if (contract.kind === 'unbounded') return []
  return theActsOfACall(call, contract.package).filter((act) => !contract.allowed.includes(act))
}

/** How a contract names what it allows, as the refusal quotes it: its acts with "only", or that it allows none at all. */
const theAllowedSaid = (contract: TheContractInForce): string =>
  contract.allowed.length === 0 ? 'no act at all' : `${contract.allowed.join(', ')} only`

/** The verbs a refusal says the call performs, one per act, so the sentence reads as English. */
const THE_VERB: Readonly<Record<AContractAct, string>> = { push: 'pushes', tag: 'tags', handoff: 'hands off', land: 'lands' }

/**
 * Why this call does not run, or undefined when it does: the acts it is that the package's contract leaves out, named
 * with the contract, its version and what it does allow.
 */
export function refuseACallOutsideTheContract(call: AReadableCall, contract: TheContractInForce | undefined): string | undefined {
  if (contract === undefined) return undefined
  const not_allowed = theActsNotAllowed(call, contract)
  if (not_allowed.length === 0) return undefined
  const performs = not_allowed.map((act) => THE_VERB[act]).join(' and ')
  const left_out = not_allowed.join(' and ')
  const is_or_are = not_allowed.length === 1 ? 'is' : 'are'
  return (
    `this call ${performs}, and package ${contract.package}'s contract (version ${String(contract.version)}) allows ` +
    `${theAllowedSaid(contract)}, so ${left_out} ${is_or_are} not in it and the call does not run. ` +
    'Do what the contract allows, or ask the owner for a new version of it.'
  )
}
