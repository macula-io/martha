// Why a call is refused by the package contract it runs under (martha#513 slice 2).
//
// This exists so a member's contract narrows what it may do, and never widens it: the check is one more refusal at the
// end of the gate's own list, so a call refused for other reasons keeps saying the more serious one, and a contract can
// only turn a yes into a no. It refuses nothing when the member holds no contract (slice 1's rule: a package with no
// contract is told so, never refused) and nothing for an unbounded one, which is the owner's word that this package
// needs no contract at all.
//
// A contract the ledger cannot read back is the third case: the acts of that call are refused and nothing else is, with
// the reason said out loud. The alternative — answering no contract, or letting the read's failure out — either lets an
// act through on a contract nobody read, or denies every call the member makes, writing its handover included
// (martha#513 slice 2, round 2).
//
// The refusal names the act, the contract's version and the acts it does allow, because the model that read the call is
// the one that has to stop, and "not allowed" without the list only invites a second guess.

import { theActsOfACall, type AContractAct, type AReadableCall, type TheOwnNameOf } from './the_acts_of_a_call.ts'

/** A package's contract as its calls are held to it: the package, the version, its kind, and the acts it allows. */
export interface TheContractInForce {
  readonly package: string
  readonly version: number
  readonly kind: 'bounded' | 'unbounded'
  /** The acts a bounded contract allows. An unbounded contract allows every act, and this is not read. */
  readonly allowed: readonly AContractAct[]
}

/** A package whose contract the ledger could not answer for: its acts are refused, and no other call is touched. */
export interface AContractThatCannotBeRead {
  readonly package: string
  /** Why the ledger could not answer, in its own words: the row it could not read back, and what was wrong with it. */
  readonly why: string
}

/** What a caller hands the gate: the contract in force, one the ledger could not answer for, or none at all. */
export type TheContractHanded = TheContractInForce | AContractThatCannotBeRead | undefined

/** Whether the ledger could not answer for this package's contract. */
export const isAContractThatCannotBeRead = (contract: TheContractInForce | AContractThatCannotBeRead): contract is AContractThatCannotBeRead =>
  'why' in contract

/** The acts this call is that the contract leaves out, in the contract's own words. */
export function theActsNotAllowed(
  call: AReadableCall,
  contract: TheContractInForce,
  ownNameOf?: TheOwnNameOf,
): readonly AContractAct[] {
  if (contract.kind === 'unbounded') return []
  return theActsOfACall(call, contract.package, ownNameOf).filter((act) => !contract.allowed.includes(act))
}

/** How a contract names what it allows, as the refusal quotes it: its acts with "only", or that it allows none at all. */
const theAllowedSaid = (contract: TheContractInForce): string =>
  contract.allowed.length === 0 ? 'no act at all' : `${contract.allowed.join(', ')} only`

/** The verbs a refusal says the call performs, one per act, so the sentence reads as English. */
const THE_VERB: Readonly<Record<AContractAct, string>> = { push: 'pushes', tag: 'tags', handoff: 'hands off', land: 'lands' }

/** The call's acts as verbs: `pushes`, or `pushes and tags` when it is both. */
const theVerbsOf = (acts: readonly AContractAct[]): string => acts.map((act) => THE_VERB[act]).join(' and ')

/** Whether the sentence takes a plural: one act is, two acts are. */
const theIsOrAre = (acts: readonly AContractAct[]): string => (acts.length === 1 ? 'is' : 'are')

/** Why a call whose acts the ledger's unreadable contract cannot be judged against does not run. */
const theUnreadableRefusal = (acts: readonly AContractAct[], contract: AContractThatCannotBeRead): string =>
  `this call ${theVerbsOf(acts)}, and package ${contract.package}'s contract could not be read (${contract.why}), so ` +
  `${acts.join(' and ')} ${theIsOrAre(acts)} refused until the ledger answers, and no other call is.`

/** Why a call whose acts the contract leaves out does not run, named with the contract, its version and its acts. */
const theLeavingOutRefusal = (acts: readonly AContractAct[], contract: TheContractInForce): string =>
  `this call ${theVerbsOf(acts)}, and package ${contract.package}'s contract (version ${String(contract.version)}) allows ` +
  `${theAllowedSaid(contract)}, so ${acts.join(' and ')} ${theIsOrAre(acts)} not in it and the call does not run. ` +
  'Do what the contract allows, or ask the owner for a new version of it.'

/**
 * Why this call does not run, or undefined when it does: the acts it is that the package's contract leaves out — or,
 * for a contract the ledger could not answer for, the acts it is at all.
 */
export function refuseACallOutsideTheContract(
  call: AReadableCall,
  contract: TheContractHanded,
  ownNameOf?: TheOwnNameOf,
): string | undefined {
  if (contract === undefined) return undefined
  const acts = theActsOfACall(call, contract.package, ownNameOf)
  if (acts.length === 0) return undefined
  if (isAContractThatCannotBeRead(contract)) return theUnreadableRefusal(acts, contract)
  if (contract.kind === 'unbounded') return undefined
  const left_out = acts.filter((act) => !contract.allowed.includes(act))
  return left_out.length === 0 ? undefined : theLeavingOutRefusal(left_out, contract)
}
