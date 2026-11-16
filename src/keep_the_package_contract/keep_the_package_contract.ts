// A package's contract, kept as a version of it in the package's ledger (martha#513, slice 1).
//
// This exists so the contract a Supervisor writes with a brief is a fact about the package and not about the session
// that wrote it. It is kept as a row of the package's own append-only stream: the first contract is version 1, and any
// later one is the next version, never an edit of the one before it — the store appends and cannot rewrite, so "a change
// is a new version" is its rule rather than a writer's care.
//
// What a member is handed at a start and after a refresh is read from that row, never from the brief: a brief edited
// after its version was kept reaches the member when the Supervisor keeps the change, and not before. That is the same
// rule a handover is written under, and the reason the two are handed together.
//
// The row keeps the contract's own lines, so a later session reads it by the same rule the brief was read by
// (../the_contract_in_a_brief's theContractOfABlock). A row this slice cannot read back is refused by name rather than
// rendered half read.

import { isContractKeptRow, readLedger, noteTheContract, WORK_PACKAGE, type LedgerHost } from '../log_ledger/log_ledger.ts'
import { theAsksTheOwnerSaidYesTo } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import {
  theContractIn,
  theContractOfABlock,
  type APackageContract,
  type ACriterion,
  type BudgetUnit,
} from './the_contract_in_a_brief.ts'

/** The name the crew's tool is registered under: the Supervisor keeps a package's contract with it (martha#513). */
export const KEEP_THE_PACKAGE_CONTRACT = 'keep_the_package_contract'

/** One version of a package's contract, as the package's ledger holds it. */
export interface AContractVersion {
  readonly version: number
  readonly digest: string
  readonly contract: APackageContract
  /** The member that kept it: the Supervisor, since only a role the table lets assign work may. */
  readonly member: string
  readonly at: number
}

/** Every version of a package's contract, oldest first, each read back from the block the ledger holds. */
export async function theContractVersionsOf(host: LedgerHost, package_name: string): Promise<readonly AContractVersion[]> {
  const kept = (await readLedger(host, package_name)).filter(isContractKeptRow)
  return kept.map((row) => {
    const read = theContractOfABlock(row.block)
    if ('refused' in read) {
      throw new Error(`the contract kept as version ${String(row.version)} of ${package_name} cannot be read back: ${read.refused}`)
    }
    return { version: row.version, digest: row.digest, contract: read.ok.contract, member: row.member, at: row.at }
  })
}

/** The version a package is held to: its newest, or undefined when it has never had one. */
export async function theNewestContractOf(host: LedgerHost, package_name: string): Promise<AContractVersion | undefined> {
  return (await theContractVersionsOf(host, package_name)).at(-1)
}

/** What a keeper is handed: the package, the brief the contract is in, and the member keeping it. */
export interface TheKeeping {
  readonly package: string
  readonly member: string
  readonly brief: string
}

/** What keeping a contract answers: what was kept or that nothing changed, or why nothing could be kept. */
export type TheContractKept = { readonly answer: string } | { readonly refused: string }

/** Whether this version is the one the package already holds, so a re-read of the same brief keeps no second row. */
const alreadyHeld = (newest: AContractVersion | undefined, digest: string): boolean => newest?.digest === digest

/** Why an unbounded contract may not be kept, or undefined when the owner's yes is there: only the owner says it. */
async function whyNotUnbounded(host: LedgerHost, contract: APackageContract): Promise<string | undefined> {
  if (contract.kind !== 'unbounded') return undefined
  const yes = await theAsksTheOwnerSaidYesTo(host)
  return yes.includes(contract.owner_yes)
    ? undefined
    : `the owner has not said yes to ask ${String(contract.owner_yes)}, and only the owner may mark a package unbounded (martha#513).`
}

/**
 * Keeps the contract the brief carries as the package's next version — or says why not: a package name that is not one,
 * a brief whose block this slice cannot read, an unbounded contract whose ask the owner never answered yes to, or the
 * version the package already holds, which keeps nothing.
 */
export async function keepThePackageContract(host: LedgerHost, keeping: TheKeeping): Promise<TheContractKept> {
  if (!WORK_PACKAGE.test(keeping.package)) {
    return { refused: `${JSON.stringify(keeping.package)} is not a work package, so there is no ledger to keep a contract in (owner/repo#n).` }
  }
  const read = theContractIn(keeping.brief)
  if ('refused' in read) return read
  const why_not = await whyNotUnbounded(host, read.ok.contract)
  if (why_not !== undefined) return { refused: why_not }
  const newest = await theNewestContractOf(host, keeping.package)
  if (alreadyHeld(newest, read.ok.digest)) {
    return { answer: `${keeping.package} already holds this contract as version ${String(newest?.version ?? 0)}; nothing was kept.` }
  }
  const version = (newest?.version ?? 0) + 1
  await noteTheContract(host, { package: keeping.package, member: keeping.member, version, digest: read.ok.digest, block: read.ok.block })
  return {
    answer:
      `Kept: ${keeping.package} now holds contract version ${String(version)}, and every session of its member is handed it ` +
      'at its start and after a refresh. A changed contract is the next version, never an edit.',
  }
}

/** How a criterion's evidence is found, in the words its check uses at verification. */
const theEvidenceSaid = (evidence: ACriterion['evidence']): string => {
  if (evidence.kind === 'test') return `the test file ${evidence.of} at the tip`
  if (evidence.kind === 'document') return `the document ${evidence.of} at the tip`
  if (evidence.kind === 'ci') return `the CI job ${JSON.stringify(evidence.of)} green on the tip`
  return `the owner's yes to ask ${evidence.of}`
}

/** A budget as the member reads it: each unit with its count, in the contract's own order. */
const theBudgetSaid = (budget: Readonly<Partial<Record<BudgetUnit, number>>>): string => {
  const units = Object.entries(budget).map(([unit, count]) => `${String(count)} ${unit}`)
  return units.length === 0 ? 'no unit named' : units.join(', ')
}

/** What the member is handed of a contract: its goal, each criterion with its evidence, what it may do, spend and end on. */
function theBoundContractSaid(version: AContractVersion): string {
  const contract = version.contract
  if (contract.kind !== 'bounded') return ''
  const criteria = contract.acceptance.map((one, at) => `  ${String(at + 1)}. ${one.criterion} — evidenced by ${theEvidenceSaid(one.evidence)}`)
  return [
    `The package contract, version ${String(version.version)}, kept by ${version.member}:`,
    `  goal: ${contract.goal}`,
    '  acceptance:',
    ...criteria,
    `  allowed: ${contract.allowed.join(', ')}`,
    `  budget: ${theBudgetSaid(contract.budget)}`,
    `  done: ${contract.done}`,
  ].join('\n')
}

/**
 * The part of a session's first line that carries the package's contract, or says the package has none: a package may
 * not be worked without one, and a contract the owner called unbounded says so with the reason they gave.
 */
export function theContractPart(package_name: string, version: AContractVersion | undefined): string {
  if (version === undefined) {
    return (
      `${package_name} has no package contract recorded, so its work is not yet bounded by one. Its Supervisor keeps it with ` +
      `the ${KEEP_THE_PACKAGE_CONTRACT} tool, and a package the owner says needs none is kept as unbounded with their reason.`
    )
  }
  if (version.contract.kind === 'unbounded') {
    return (
      `${package_name}'s package contract, version ${String(version.version)}, is unbounded by the owner's word: ` +
      `${version.contract.reason} (ask ${String(version.contract.owner_yes)}).`
    )
  }
  return theBoundContractSaid(version)
}

/**
 * The contract part of a member's start or resume, read from the package's ledger: undefined when the member holds no
 * package, and the part itself when it does — the version a package holds is handed every time a session starts.
 */
export async function theContractPartOf(host: LedgerHost, package_name: string): Promise<string | undefined> {
  if (package_name === '') return undefined
  return theContractPart(package_name, await theNewestContractOf(host, package_name))
}
