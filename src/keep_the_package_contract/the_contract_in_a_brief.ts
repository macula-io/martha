// The package contract a brief carries (martha#513, slice 1): what the package is for, how each acceptance criterion is
// evidenced, what it may do, what it may spend, and what done means.
//
// This exists so a package is not only a name a Supervisor hands a member: the work it may do and the evidence that
// ends it are written down once, before the work starts, in the brief the Supervisor already writes. The block is typed
// rather than read as prose, so three things can follow it: a version kept in the package's ledger, a member handed the
// same contract every session, and a verification that says which criteria have their evidence at the exact revision.
//
// What a contract is not, here: a rule this slice enforces. Allowed actions narrow what a package may do when the
// tool-call gate reads them (slice 2), and the budget is counted when the package's spend is counted (slice 3). This
// slice reads the block, refuses one it cannot read whole, and keeps what it says.
//
// The block is one fenced block in the brief, and nothing outside it is a contract:
//
//   ```package-contract
//   goal: what the package is for, in one line
//   acceptance: a criterion a reviewer can see | test: src/some_slice/some_slice.node-test.ts
//   acceptance: another criterion | ci: CI
//   allowed: push, tag
//   budget: 120 minutes, 200 tool calls
//   done: what ends the package
//   ```
//
// A `ci` criterion names the CI job or the whole workflow run whose green is its evidence, so `ci: CI` (the workflow this
// repository's runs are named) and `ci: structural floor` (one of its jobs) are both read, and a criterion is met when
// that job, or every job of that run, succeeded at the tip.
//
// An unbounded contract is the owner's answer instead, and carries nothing else: `unbounded: the reason` and
// `owner_yes: <the ask the owner answered yes to>`.
//
// Nothing here is defaulted: a block that leaves out a part is refused naming every part it left out, and a word this
// file does not know is refused rather than dropped, because a contract a careful reader would not recognise is worse
// than no contract at all.

import { createHash } from 'node:crypto'

import { OWNER_YES } from '../queue_the_owners_asks/queue_the_owners_asks.ts'

/** The write fence that opens the block, and the one that closes it. */
export const CONTRACT_BLOCK = 'package-contract'
const A_FENCE = '```'

/**
 * The actions a contract may allow: Martha's own verbs, so a contract works on every host (gate:design 2026-11-16,
 * answer (b)). A verb outside this list is refused by name, so a contract cannot promise an action nothing here knows.
 */
export const CONTRACT_ACTIONS = ['push', 'tag', 'handoff', 'land'] as const
export type ContractAction = (typeof CONTRACT_ACTIONS)[number]

/**
 * How a criterion's evidence is named: the file at the tip that proves it, the job green on the tip's CI, or the ask the
 * owner answered yes to. Each is read at the revision the package's work would land on, so evidence of another revision
 * is no evidence for this one.
 */
export const EVIDENCE_KINDS = ['test', 'document', 'ci', OWNER_YES] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/**
 * What a budget may be counted in: minutes and tool calls on every host, and tokens where a host reports them (answer
 * (c)). A contract that names none of them is refused; one that names a unit this list does not is refused by name.
 */
export const BUDGET_UNITS = ['minutes', 'tool calls', 'tokens'] as const
export type BudgetUnit = (typeof BUDGET_UNITS)[number]

/** One acceptance criterion, and where its evidence is found. */
export interface ACriterion {
  readonly criterion: string
  readonly evidence: { readonly kind: EvidenceKind; readonly of: string }
}

/** What a package may spend, in the units a host can count. A unit it does not name is not a unit it may spend. */
export type ABudget = Readonly<Partial<Record<BudgetUnit, number>>>

/** A contract with work in it: the parts a member reads and a reviewer checks. */
export interface ABoundedContract {
  readonly kind: 'bounded'
  readonly goal: string
  readonly acceptance: readonly ACriterion[]
  readonly allowed: readonly ContractAction[]
  readonly budget: ABudget
  readonly done: string
}

/**
 * The owner's word that a package needs no contract: the reason they gave, and the ask they gave it in. Only the owner
 * may say it (answer (d)), so the reason travels with the yes it was said in rather than standing on its own.
 */
export interface AnUnboundedContract {
  readonly kind: 'unbounded'
  readonly reason: string
  readonly owner_yes: number
}

export type APackageContract = ABoundedContract | AnUnboundedContract

/** A contract as a brief carries it: the contract, a digest of the block it was read from, and that block's own lines,
 * which is what the ledger keeps so a later session reads the contract itself rather than a copy of it. */
export interface AContractRead {
  readonly contract: APackageContract
  readonly digest: string
  readonly block: readonly string[]
}

/** What reading a brief came to: the contract it carries, or why it carries none this slice can read. */
export type TheContractIn = { readonly ok: AContractRead } | { readonly refused: string }

/** What one step of the read came to. */
type Step<T> = { readonly ok: T } | { readonly refused: string }
const no = (refused: string): Step<never> => ({ refused })

/**
 * A digest of the block: its lines with the space around them taken off, joined as one text. A block whose words changed
 * has another digest, and so is another version; a block whose indentation or trailing space changed has the same one,
 * because that is not a change a member could read. Both ends are trimmed: a brief indents its block to sit under a list
 * item as readily as it leaves it flush, and the same contract is the same version either way.
 */
export const theDigestOf = (block: readonly string[]): string =>
  createHash('sha256')
    .update(block.map((line) => line.trim()).join('\n'), 'utf8')
    .digest('hex')

/** The block a brief carries, or why it carries none: its lines, the fences not among them. */
function theBlockIn(brief: string): Step<readonly string[]> {
  const lines = brief.split('\n')
  const opened = lines.findIndex((line) => line.trim() === `${A_FENCE}${CONTRACT_BLOCK}`)
  if (opened < 0) {
    return no(`the brief carries no package contract: it holds no ${A_FENCE}${CONTRACT_BLOCK} block (martha#513).`)
  }
  const closed = lines.findIndex((line, at) => at > opened && line.trim() === A_FENCE)
  if (closed < 0) {
    return no(`the ${CONTRACT_BLOCK} block of the brief is never closed: a contract is fenced, and its last line is ${A_FENCE}.`)
  }
  return { ok: lines.slice(opened + 1, closed) }
}

/** A block's line as the key and the value it gives, or why the line is not one: a key, a colon, and something after. */
function thePairIn(line: string): Step<{ readonly key: string; readonly value: string }> {
  const at = line.indexOf(':')
  if (at < 1) return no(`${JSON.stringify(line.trim())} is not a line of a package contract: a contract's line is "key: value".`)
  return { ok: { key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() } }
}

/** What a contract's block has to say, as the lines gave it, before it is judged whole. */
interface AContractDraft {
  goal?: string
  acceptance: ACriterion[]
  allowed?: readonly ContractAction[]
  budget?: ABudget
  done?: string
  unbounded?: string
  owner_yes?: number
}

const THE_PARTS = ['goal', 'acceptance', 'allowed', 'budget', 'done', 'unbounded', OWNER_YES] as const
const ACCEPTANCE = 'acceptance'

/** The criterion and the evidence an `a criterion | kind: what` line gives, or why the line is not one. */
function theCriterionIn(value: string): Step<ACriterion> {
  const parts = value.split(' | ')
  const [criterion, said] = parts
  if (parts.length !== 2 || criterion === undefined || said === undefined || criterion.trim() === '') {
    return no(`${JSON.stringify(value)} is not an acceptance line: it reads "criterion | kind: what evidences it".`)
  }
  const evidence = theEvidenceIn(said, criterion.trim())
  return 'refused' in evidence ? evidence : { ok: { criterion: criterion.trim(), evidence: evidence.ok } }
}

/** The evidence a criterion's own half names, or why it names none this tree reads. */
function theEvidenceIn(said: string, criterion: string): Step<ACriterion['evidence']> {
  const at = said.indexOf(':')
  const kind = at < 0 ? '' : said.slice(0, at).trim()
  const of = at < 0 ? '' : said.slice(at + 1).trim()
  if (!(EVIDENCE_KINDS as readonly string[]).includes(kind)) {
    return no(`${JSON.stringify(kind)} is not evidence this tree reads (${EVIDENCE_KINDS.join(', ')}): ${JSON.stringify(criterion)}.`)
  }
  if (of === '') return no(`the criterion ${JSON.stringify(criterion)} names no ${kind} to evidence it.`)
  if (kind === OWNER_YES && !isAnAsk(of)) return no(`the criterion ${JSON.stringify(criterion)} is evidenced by an ask, and ${JSON.stringify(of)} is not one.`)
  return { ok: { kind: kind as EvidenceKind, of } }
}

/** Whether `text` is an ask's id, as the queue writes one: a whole number. */
const isAnAsk = (text: string): boolean => /^[0-9]+$/.test(text)

/** The actions an `allowed` line gives: every one of them a verb Martha knows, and at least one. */
function theActionsIn(value: string): Step<readonly ContractAction[]> {
  const words = value.split(',').map((word) => word.trim()).filter((word) => word !== '')
  const unknown = words.find((word) => !(CONTRACT_ACTIONS as readonly string[]).includes(word))
  if (unknown !== undefined) return no(`${JSON.stringify(unknown)} is not an action this tree has (${CONTRACT_ACTIONS.join(', ')}).`)
  if (words.length === 0) return no('the allowed line names no action, so the package could do nothing at all.')
  return { ok: words as ContractAction[] }
}

/** One `120 minutes` of a budget line, as the unit and its count, or why it is not one. */
function theUnitIn(said: string): Step<{ readonly unit: BudgetUnit; readonly count: number }> {
  const told = /^([0-9]+) (.+)$/.exec(said.trim())
  if (told === null) return no(`${JSON.stringify(said.trim())} is not what a package may spend: a budget is "120 minutes", a count and its unit.`)
  const count = Number(told[1])
  const unit = told[2] ?? ''
  if (!(BUDGET_UNITS as readonly string[]).includes(unit)) {
    return no(`${JSON.stringify(unit)} is not a unit this tree counts (${BUDGET_UNITS.join(', ')}).`)
  }
  if (count < 1) return no(`a budget of ${String(count)} ${unit} spends nothing, which is no budget at all.`)
  return { ok: { unit: unit as BudgetUnit, count } }
}

/** What a `budget` line gives: each unit with its count, and at least one. */
function theBudgetIn(value: string): Step<ABudget> {
  const said = value.split(',').map((part) => part.trim()).filter((part) => part !== '')
  if (said.length === 0) return no('the budget line names nothing, so the package may spend nothing at all.')
  const budget: Record<string, number> = {}
  for (const part of said) {
    const read = theUnitIn(part)
    if ('refused' in read) return read
    if (budget[read.ok.unit] !== undefined) return no(`${read.ok.unit} is given twice in one budget.`)
    budget[read.ok.unit] = read.ok.count
  }
  return { ok: budget as ABudget }
}

/** The readers a contract's lines go through, one per part; a line whose key is not here is refused by name. */
const THE_READERS: Readonly<Record<string, (draft: AContractDraft, value: string) => Step<true>>> = {
  goal: (draft, value) => {
    draft.goal = value
    return { ok: true }
  },
  acceptance: (draft, value) => {
    const read = theCriterionIn(value)
    if ('refused' in read) return read
    draft.acceptance.push(read.ok)
    return { ok: true }
  },
  allowed: (draft, value) => {
    const read = theActionsIn(value)
    if ('refused' in read) return read
    draft.allowed = read.ok
    return { ok: true }
  },
  budget: (draft, value) => {
    const read = theBudgetIn(value)
    if ('refused' in read) return read
    draft.budget = read.ok
    return { ok: true }
  },
  done: (draft, value) => {
    draft.done = value
    return { ok: true }
  },
  unbounded: (draft, value) => {
    draft.unbounded = value
    return { ok: true }
  },
  owner_yes: (draft, value) => {
    if (!isAnAsk(value)) return no(`the owner_yes line names the ask the owner answered yes to, and ${JSON.stringify(value)} is not one.`)
    draft.owner_yes = Number(value)
    return { ok: true }
  },
}

/** One line into the draft, or why it may not go there: a key this tree does not know, given twice, or with no value. */
function intoTheDraft(draft: AContractDraft, seen: Set<string>, pair: { readonly key: string; readonly value: string }): string | undefined {
  const reader = THE_READERS[pair.key]
  if (reader === undefined) {
    return `${JSON.stringify(pair.key)} is not a line of a package contract (its parts are ${THE_PARTS.join(', ')}).`
  }
  if (pair.key !== ACCEPTANCE && seen.has(pair.key)) return `${pair.key} is given twice; a contract has one ${pair.key}.`
  if (pair.value === '') return `${pair.key} is given with nothing after it.`
  seen.add(pair.key)
  const read = reader(draft, pair.value)
  return 'refused' in read ? read.refused : undefined
}

/** Everything a block's lines say, or the first line that cannot be read. */
function theDraftIn(lines: readonly string[]): Step<AContractDraft> {
  const draft: AContractDraft = { acceptance: [] }
  const seen = new Set<string>()
  for (const line of lines) {
    if (line.trim() === '') continue
    const pair = thePairIn(line)
    if ('refused' in pair) return pair
    const refused = intoTheDraft(draft, seen, pair.ok)
    if (refused !== undefined) return no(refused)
  }
  return { ok: draft }
}

/** The parts a bounded contract names, in the contract's own order: the ones this draft gave a value to. */
const thePartsNamed = (draft: AContractDraft): readonly string[] =>
  [
    draft.goal === undefined ? '' : 'goal',
    draft.acceptance.length === 0 ? '' : 'acceptance',
    draft.allowed === undefined ? '' : 'allowed',
    draft.budget === undefined ? '' : 'budget',
    draft.done === undefined ? '' : 'done',
  ].filter((part) => part !== '')

/** The parts a bounded contract has to name, and which this one left out; empty when it left out none. */
const thePartsLeftOut = (draft: AContractDraft): readonly string[] =>
  ['goal', ACCEPTANCE, 'allowed', 'budget', 'done'].filter((part) => !thePartsNamed(draft).includes(part))

/** Why a draft is no contract at all: the parts a bounded one left out, or an unbounded one that is neither. */
function theRefusalOf(draft: AContractDraft): string | undefined {
  if (draft.unbounded === undefined) {
    if (draft.owner_yes !== undefined) return 'an owner_yes line belongs to an unbounded contract, and this one is bounded.'
    const left_out = thePartsLeftOut(draft)
    return left_out.length === 0 ? undefined : `a package contract names every part, and this one leaves out ${left_out.join(', ')}.`
  }
  const named = thePartsNamed(draft)
  if (named.length > 0) return `a package contract is bounded or unbounded, never both: this one is unbounded and also names ${named.join(', ')}.`
  if (draft.owner_yes === undefined) return 'an unbounded contract is the owner\'s word, so it names the ask they said yes to as owner_yes.'
  return undefined
}

/** The contract a draft is, once it is one. */
function theContractOf(draft: AContractDraft): APackageContract {
  if (draft.unbounded !== undefined) return { kind: 'unbounded', reason: draft.unbounded, owner_yes: draft.owner_yes ?? 0 }
  return {
    kind: 'bounded',
    goal: draft.goal ?? '',
    acceptance: draft.acceptance,
    allowed: draft.allowed ?? [],
    budget: draft.budget ?? {},
    done: draft.done ?? '',
  }
}

/**
 * The contract a brief carries, and a digest of the block it was read from — or why this slice reads none: no block, a
 * block never closed, a line it cannot read, or a contract missing a part.
 */
export function theContractIn(brief: string): TheContractIn {
  const block = theBlockIn(brief)
  if ('refused' in block) return block
  return theContractOfABlock(block.ok)
}

/**
 * The contract a block's own lines are, read again: the ledger keeps the block a contract came from, so a later session
 * reads the contract by the same rule this one was read by rather than trusting a copy of it.
 */
export function theContractOfABlock(block: readonly string[]): TheContractIn {
  const draft = theDraftIn(block)
  if ('refused' in draft) return draft
  const refusal = theRefusalOf(draft.ok)
  if (refusal !== undefined) return { refused: refusal }
  return { ok: { contract: theContractOf(draft.ok), digest: theDigestOf(block), block } }
}
