// Why a call is refused by the package contract it runs under (martha#513 slice 2, martha#597).
//
// This exists so a member's contract narrows what it may do, and never widens it: the check is one more refusal at the
// end of the gate's own list, so a call refused for other reasons keeps saying the more serious one, and a contract can
// only turn a yes into a no. It refuses nothing for an unbounded one, which is the owner's word that this package needs
// no contract at all.
//
// A package with no contract at all is the opposite case (martha#597): none of its work runs until one is kept, because
// a package that runs without a contract has no acceptance criteria and no budget, which is the gap #513 box 1 named.
// What still runs is the five calls that let a member save its context and let a Supervisor fix the package: the four
// that end a package, and the tool that records a contract.
//
// A contract the ledger cannot read back is the third case: the acts of that call are refused and nothing else is, with
// the reason said out loud. The alternative — answering no contract, or letting the read's failure out — either lets an
// act through on a contract nobody read, or denies every call the member makes, writing its handover included
// (martha#513 slice 2, round 2).
//
// The refusal names the act, the contract's version and the acts it does allow, because the model that read the call is
// the one that has to stop, and "not allowed" without the list only invites a second guess.

import { isACallThatEndsThePackage, WHAT_A_SPENT_PACKAGE_MAY_STILL_DO } from '../hold_a_package_to_its_budget/refuse_a_call_past_the_budget.ts'
import { KEEP_THE_CONTRACT_TOOL } from '../keep_the_package_contract/the_contract_tools.ts'
import { theActsOfACall, type AContractAct, type AReadableCall, type TheOwnNameOf } from './the_acts_of_a_call.ts'

/** A package's contract as its calls are held to it: the package, the version, its kind, and the acts it allows. */
export interface TheContractInForce {
  readonly package: string
  readonly version: number
  readonly kind: 'bounded' | 'unbounded'
  /** The acts a bounded contract allows. An unbounded contract allows every act, and this is not read. */
  readonly allowed: readonly AContractAct[]
}

/** A package whose ledger could not answer for: its acts are refused, and no other call is touched. */
export interface AContractThatCannotBeRead {
  readonly package: string
  /** Why the ledger could not answer, in its own words: the row it could not read back, and what was wrong with it. */
  readonly why: string
}

/** A package whose ledger holds no contract version at all: none of its work runs until one is kept (martha#597). */
export interface AContractNotRecorded {
  readonly package: string
}

/** What a caller hands the gate: the contract in force, one the ledger could not answer for, none recorded, or none. */
export type TheContractHanded = TheContractInForce | AContractThatCannotBeRead | AContractNotRecorded | undefined

/** Whether the ledger could not answer for this package's contract. */
export const isAContractThatCannotBeRead = (contract: TheContractHanded): contract is AContractThatCannotBeRead =>
  contract !== undefined && 'why' in contract

/** Whether the package has no contract at all, so none of its work may run. */
export const isAContractNotRecorded = (contract: TheContractHanded): contract is AContractNotRecorded =>
  contract !== undefined && !('kind' in contract) && !('why' in contract)

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

/** Whether this call is one a package with no contract still makes: the four that end it, and the tool that records one. */
const stillRunsWithNoContract = (own_name: string): boolean =>
  isACallThatEndsThePackage(own_name) || own_name === KEEP_THE_CONTRACT_TOOL.name

/**
 * Why a call does not run because the package has no contract at all (martha#597), naming the tool that records one and
 * the calls that still run: the four that end the package, and the tool itself for the member that may keep a contract.
 */
const theNotRecordedRefusal = (contract: AContractNotRecorded): string =>
  `this call does not run: package ${contract.package} has no contract recorded, so none of its work runs until one is kept. ` +
  `Its Supervisor keeps it with ${KEEP_THE_CONTRACT_TOOL.name}, from the package-contract block in the brief; a package ` +
  `the owner says needs none is kept as unbounded, with the reason they gave. ${WHAT_A_SPENT_PACKAGE_MAY_STILL_DO} ` +
  `${KEEP_THE_CONTRACT_TOOL.name} runs too, for the member the table lets keep one.`

/**
 * Why this call does not run, or undefined when it does: the acts it is that the package's contract leaves out — or,
 * for a contract the ledger could not answer for, the acts it is at all — or, for a package with no contract, every
 * call but the ones that let a member save its context and let a Supervisor record one (martha#597).
 */
export function refuseACallOutsideTheContract(
  call: AReadableCall,
  contract: TheContractHanded,
  ownNameOf?: TheOwnNameOf,
): string | undefined {
  return contract === undefined ? undefined : theRefusalFor(call, contract, ownNameOf)
}

/** The refusal one state of a contract gives this call, or undefined when it gives none. */
function theRefusalFor(
  call: AReadableCall,
  contract: Exclude<TheContractHanded, undefined>,
  ownNameOf?: TheOwnNameOf,
): string | undefined {
  // A contract the ledger could not answer for is read before anything else: it refuses only the acts it cannot judge.
  if ('why' in contract) {
    const acts = theActsOfACall(call, contract.package, ownNameOf)
    return acts.length === 0 ? undefined : theUnreadableRefusal(acts, contract)
  }
  // No version at all: every call is refused but the ones that let a member save its context (martha#597).
  if (!('kind' in contract)) {
    const own_name = ownNameOf === undefined ? call.tool : ownNameOf(call.tool)
    return stillRunsWithNoContract(own_name) ? undefined : theNotRecordedRefusal(contract)
  }
  return theActsRefusal(call, contract, ownNameOf)
}

/** The refusal a version in force gives an act it does not allow: none for an unbounded one, and none for a non-act. */
function theActsRefusal(call: AReadableCall, contract: TheContractInForce, ownNameOf?: TheOwnNameOf): string | undefined {
  const acts = theActsOfACall(call, contract.package, ownNameOf)
  if (acts.length === 0 || contract.kind === 'unbounded') return undefined
  const left_out = acts.filter((act) => !contract.allowed.includes(act))
  return left_out.length === 0 ? undefined : theLeavingOutRefusal(left_out, contract)
}
