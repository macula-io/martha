// What a package's acceptance criteria have at one revision (martha#513, slice 1).
//
// This exists so the owner's yes is said to a range whose work is measured against what the package said it would do,
// and not only against a green run: every criterion the brief names is looked for at the exact revision the range would
// land, and one whose evidence is not there is named on the menu line with why. Evidence of another revision is no
// evidence for this one, which is the same rule the CI runs on the tip are read under (../check_a_range_before_the_owner_says_yes).
//
// What it does not do: judge whether the evidence is good. A test file at the tip and a green job on it are what the
// contract named; whether the test tests the right thing is the reviewer's, as it always was. What this closes is the
// gap between "the criteria" and "the range": a package whose criteria nobody can point at is a package nobody can say
// is done.
//
// A package with no contract is said so, never passed: this slice arrived after packages were already landing, and the
// line says which packages of a batch are held by a contract and which are not rather than refusing the batch.

import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { OWNER_YES } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { SHORT_SHA } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import type { ACriterion, APackageContract } from './the_contract_in_a_brief.ts'
import { theNewestContractOf } from './keep_the_package_contract.ts'

/** Where this slice looks for a criterion's evidence, at the one revision a range would land. */
export interface TheEvidenceAt {
  /** The revision the criteria are checked at: the tip the owner is asked to say yes to. */
  readonly revision: string
  /** Whether a job of this name, or a run of this name whose every job succeeded, was green on that revision. */
  readonly ciSucceeded: (what: string) => boolean
  /** Whether `path` is in the tree at that revision. */
  readonly fileIsThere: (path: string) => Promise<boolean>
  /** Whether the owner answered yes to that ask. */
  readonly ownerSaidYes: (ask: number) => Promise<boolean>
}

/** One criterion and what it has here: met, or why not. */
export type ACriterionChecked = { readonly criterion: string; readonly evidence: ACriterion['evidence'] } & (
  | { readonly met: true }
  | { readonly met: false; readonly why: string }
)

/** Whether a criterion was met, so the ones that were not can be named without a cast. */
const isMet = (checked: ACriterionChecked): checked is ACriterionChecked & { readonly met: true } => checked.met

/** What one criterion has at the revision: whether it is met, and why not when it is not. */
async function theCriterionAt(criterion: ACriterion, at: TheEvidenceAt): Promise<ACriterionChecked> {
  const { kind, of } = criterion.evidence
  if (kind === 'ci') {
    return at.ciSucceeded(of)
      ? { criterion: criterion.criterion, evidence: criterion.evidence, met: true }
      : { criterion: criterion.criterion, evidence: criterion.evidence, met: false, why: `no CI job or run named ${JSON.stringify(of)} was green on ${at.revision}` }
  }
  const there = kind === OWNER_YES ? await at.ownerSaidYes(Number(of)) : await at.fileIsThere(of)
  if (there) return { criterion: criterion.criterion, evidence: criterion.evidence, met: true }
  return {
    criterion: criterion.criterion,
    evidence: criterion.evidence,
    met: false,
    why: kind === OWNER_YES ? `the owner has not said yes to ask ${of}` : `${of} is not at ${at.revision}`,
  }
}

/** Every criterion a contract names, checked at the revision: an unbounded contract names none. */
export async function theCriteriaChecked(contract: APackageContract, at: TheEvidenceAt): Promise<readonly ACriterionChecked[]> {
  if (contract.kind === 'unbounded') return []
  const checked: ACriterionChecked[] = []
  for (const criterion of contract.acceptance) checked.push(await theCriterionAt(criterion, at))
  return checked
}

/** The first characters of a revision, as the menu line shows it. */
const short = (sha: string): string => sha.slice(0, SHORT_SHA)

/** Whether a criterion was not met, so the ones that were not can be named without a cast. */
const isNotMet = (checked: ACriterionChecked): checked is ACriterionChecked & { readonly met: false; readonly why: string } => !checked.met

/** What a criterion that is not met is called on the line: its own words, and why it is not met. */
const theUnmetSaid = (unmet: readonly (ACriterionChecked & { readonly why: string })[]): string =>
  `; not met: ${unmet.map((one) => `${JSON.stringify(one.criterion)} (${one.why})`).join(', ')}`

/**
 * What one package's contract says about the revision, in the words the menu line carries: every criterion met, each
 * one that is not met with why, the owner's word that the package is unbounded, or that no contract is recorded at all.
 */
export async function theAcceptanceOf(host: LedgerHost, package_name: string, at: TheEvidenceAt): Promise<string> {
  const version = await theNewestContractOf(host, package_name)
  if (version === undefined) return `acceptance of ${package_name}: no package contract recorded`
  if (version.contract.kind === 'unbounded') {
    return `acceptance of ${package_name}: unbounded by the owner's word (ask ${String(version.contract.owner_yes)})`
  }
  const checked = await theCriteriaChecked(version.contract, at)
  const met = checked.filter(isMet).length
  const unmet = checked.filter(isNotMet)
  const counted = `${String(met)} of ${String(checked.length)} criteria met at ${short(at.revision)}`
  return unmet.length === 0 ? `acceptance of ${package_name}: ${counted}` : `acceptance of ${package_name}: ${counted}${theUnmetSaid(unmet)}`
}
