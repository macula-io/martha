// One bounded recovery after an announced act fails (martha#512, slices 1 and 2).
//
// This exists so a failure costs a package one attempt at most, and only after the act's real state has been read: a
// push that may have run is never sent twice, and a failure nothing here can name stops the package and reaches the
// Supervisor instead of looping in the member's own turn.
//
// The ledger already tells the three endings apart (../log_ledger): the act was never sent, because its row was not
// kept; it was sent and failed, and its failure is the outcome that was kept; or it was sent and its outcome was not
// kept at all. `sendOutwardAct` answers each of those to its caller and, until this slice, the caller could only word
// them: ../open_and_finish_a_worktree told its member "Check what happened before sending anything again" with nothing
// that checks and nothing that counts the attempt. This is that check and that count. It names the failure, reads what
// is really there through the sender's own look, decides, and keeps the decision on the package, so a successor reads
// the attempt the package already paid for and a restart or a refresh buys no second one.
//
// The gate of 2026-11-16 put the announced outward acts first: a push, a tag, a handoff, a room message. Slice 1 recovered
// one package's act; slice 2 runs the same core over an act that lands several packages at once (a batch's push and its
// fast-forward, through ./send_an_act_on_every_package), and routes the crew's messages through it. One rule holds across
// packages: a retry needs every ledger to have kept the decision, and a pause is claimed only on the packages whose row
// was kept. A pause holds every act on its package except one: a message only to those the crew's nudges go to, so a
// paused member can still say it is paused. A tool call the host runs has no row before it runs, and giving every call
// one is martha#513.
//
// What it will not do: send an act again whose outcome is unknown, or whose send was refused. `unknown` is a class, and
// it is the one that never retries. Silence is never taken for success.

import type { ProcessOutcome } from '../host_contract/host_contract.ts'
import { LOG_A_MILESTONE, RESUME_EVENT } from '../keep_the_ledger/keep_the_ledger.ts'
import type { CiOutcome } from '../wait_for_ci/wait_for_ci.ts'
import {
  ActNotSent,
  OutcomeNotKept,
  concludeAct,
  noteRecovery,
  theAttemptsOn,
  thePauseOn,
  type LedgerHost,
  type Outcome,
  type OutwardAct,
  type RecoveryDecision,
  type RecoveryRow,
  readLedger,
} from '../log_ledger/log_ledger.ts'
import { sendOnEveryPackage, type AnActOnPackages, type AnAnnouncement } from './send_an_act_on_every_package.ts'

/**
 * The classes a failure can be given (martha#512). A class is a name the tree agrees on, in its own words, and not a
 * guess: `unknown` means the failure was read and could not be named, and it is never retried.
 *
 * The two a command gives name the command: the same exit says nothing on its own, and what ran is half of what a
 * member needs to know.
 *
 * `budget_exhausted` is one class whatever ran out — the crew's GitHub allowance, a CI wait's reads, a package's own
 * budget — and the evidence it carries names which, because the recovery a member takes depends on what has to change.
 */
export const FAILURE_CLASSES = [
  'command_timed_out',
  'command_failed',
  'check_red',
  'merge_conflict',
  'permission_refused',
  'host_died',
  'budget_exhausted',
  'unknown',
] as const
export type FailureClass = (typeof FAILURE_CLASSES)[number]

/** A failure, as the tree names it: the class, and the evidence the class was read from, in one line. */
export interface AFailure {
  readonly class: FailureClass
  readonly evidence: string
}

/** A read of the CI that says something failed, or that the read could not be made: a green, or a run still going, is
 * not a failure and cannot be classified as one. */
export type ACiFailureRead = Exclude<CiOutcome, { readonly kind: 'green' | 'still_running' }>

/** What a caller saw fail, in the terms the tree already has for it. */
export type TheFailureWitness =
  /** A read of the CI, as ../wait_for_ci answered it. */
  | { readonly kind: 'a_check_read'; readonly read: ACiFailureRead }
  /** A command that ended on its own, with an exit code. */
  | { readonly kind: 'a_command_ended'; readonly ended: ProcessOutcome }
  /** A command a deadline ended, so the act it ran may or may not have happened. */
  | { readonly kind: 'a_command_timed_out'; readonly ended: ProcessOutcome }
  /** Anything thrown: its code, its name, or its message. */
  | { readonly kind: 'an_error'; readonly error: unknown }

const isARow = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const theCodeOf = (error: unknown): unknown => (isARow(error) ? error['code'] : undefined)

const theNameOf = (error: unknown): string => (isARow(error) && typeof error['name'] === 'string' ? error['name'] : '')

const theMessageOf = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : ''
}

/** The last line a command wrote to its stderr, which is where the reason for a non-zero exit is. */
const theLastLineOf = (text: string): string => text.trim().split('\n').at(-1)?.trim() ?? ''

/** The class a code the host or Node gives stands for; undefined when this tree has no name for it. */
const theClassOf = (code: unknown): FailureClass | undefined => {
  if (code === 'ETIMEDOUT') return 'command_timed_out'
  if (code === 'EACCES' || code === 'EPERM') return 'permission_refused'
  return undefined
}

/** What a read of the CI came to, as a failure: a red, a budget that ran out naming itself, or nothing nameable. */
const theClassOfACheck = (read: ACiFailureRead): AFailure => {
  if (read.kind === 'red') return { class: 'check_red', evidence: `the CI answered red: ${read.ended.map((run) => run.name).join('; ')}` }
  if (read.kind === 'out_of_budget') return { class: 'budget_exhausted', evidence: `the GitHub budget refused the read: ${read.refusal}` }
  if (read.kind === 'over_its_reads') return { class: 'budget_exhausted', evidence: `the CI wait spent its reads: ${read.refusal}` }
  return { class: 'unknown', evidence: `the CI could not be read: ${read.refusal}` }
}

/** What a command that ended on its own came to: a non-zero exit is a failure; anything else is not one this reads. */
const theClassOfAnExit = (ended: ProcessOutcome): AFailure => {
  const last = theLastLineOf(ended.stderr)
  if (ended.exit_code === null) return { class: 'unknown', evidence: `the command ended with no exit code${last === '' ? '' : `: ${last}`}` }
  if (ended.exit_code === 0) return { class: 'unknown', evidence: `the command exited 0, so nothing there says it failed${last === '' ? '' : `: ${last}`}` }
  return { class: 'command_failed', evidence: `exit ${String(ended.exit_code)}${last === '' ? '' : `: ${last}`}` }
}

/** What a thrown failure came to: its code or name first, then a plain failure, and `unknown` when it says nothing. */
const theClassOfAnError = (error: unknown): AFailure => {
  const said = theMessageOf(error)
  const named = theClassOf(theCodeOf(error))
  if (named !== undefined) return { class: named, evidence: said === '' ? `a failure with the code ${String(theCodeOf(error))}` : said }
  if (theNameOf(error) === 'TimeoutError') return { class: 'command_timed_out', evidence: said === '' ? 'a timeout carried no message' : said }
  return said === '' ? { class: 'unknown', evidence: 'the failure carried nothing to read it by: no code, no name, no message' } : { class: 'command_failed', evidence: said }
}

/**
 * Names a failure, from what a caller saw. A witness this slice cannot read is `unknown`, never a guess.
 *
 * The class says why the act did not happen, and `TheAttempt` below says whether it may have run at all: a send the
 * ledger refused before it ran reads as a command that failed, because that is what it came to, and the attempt is
 * what stops the recovery from ever reading that as evidence about the world.
 */
export function classifyAFailure(witness: TheFailureWitness): AFailure {
  if (witness.kind === 'a_check_read') return theClassOfACheck(witness.read)
  if (witness.kind === 'a_command_ended') return theClassOfAnExit(witness.ended)
  if (witness.kind === 'a_command_timed_out') {
    return { class: 'command_timed_out', evidence: `the command did not finish in its time: ${theLastLineOf(witness.ended.stderr)}` }
  }
  return theClassOfAnError(witness.error)
}

/**
 * A failure a slice named itself, from evidence this one cannot read: a merge it found clashed, a host that reported the
 * task it was running failed. The name is checked against the list; a name this slice does not know is refused, never
 * turned into `unknown`, because a caller with a name of its own has read something this slice has not.
 */
export function aFailureNamed(failure_class: unknown, evidence: unknown): AFailure | { readonly refused: string } {
  if (typeof evidence !== 'string' || evidence.trim() === '') return { refused: 'a failure needs the evidence it was read from, in one line' }
  const named = FAILURE_CLASSES.find((candidate) => candidate === failure_class)
  if (named === undefined) {
    return { refused: `${JSON.stringify(failure_class)} is not a failure class this tree names (${FAILURE_CLASSES.join(', ')})` }
  }
  return { class: named, evidence: evidence.trim() }
}

/** What a look at an act's real state found: it happened, it did not, or nothing there could say. */
export interface AnInspection {
  readonly state: 'it_happened' | 'it_did_not_happen' | 'cannot_tell'
  /** What was read, named: a remote's refs, a room, a file. */
  readonly read: string
  /** What that reading said. */
  readonly found: string
}

/**
 * Reads the act's real state through the look the sender supplies, and never throws: a look that fails is the state
 * `cannot_tell`, with what it said, so an unreadable world pauses the package instead of being taken for an answer.
 */
export async function inspectTheActualState(look: () => Promise<AnInspection>): Promise<AnInspection> {
  try {
    return await look()
  } catch (failure) {
    const said = theMessageOf(failure)
    return { state: 'cannot_tell', read: "the act's state", found: said === '' ? 'nothing said why' : said }
  }
}

/** How the failed attempt ended, as the ledger tells it apart: never sent, sent and refused, or sent with no outcome. */
export type TheAttempt = 'never_sent' | 'sent_and_failed' | 'may_have_run'

/** How many automatic attempts one act of a package is given, over the package's whole life (martha#512's answer (b)). */
export const ATTEMPTS_A_PACKAGE_IS_GIVEN = 1

/** How a pause is lifted, in the words a refusal names it with: the milestone tool, and its event (martha#512). */
const HOW_A_PAUSE_IS_LIFTED = (): string => `${LOG_A_MILESTONE}, event ${RESUME_EVENT}`

/** The decision, and why: the words are recorded with it and told to the member. */
export interface TheDecision {
  readonly decision: RecoveryDecision
  readonly why: string
}

/** The rules a decision is made by, written once so the words a member reads and the row it keeps cannot differ. */
const WHY = {
  unknown: 'nothing here retries a failure it cannot name',
  happened: 'the act had already happened, so it was not sent again',
  cannot_tell: 'the act may have run and nothing can say what became of it, so it is not sent again',
  spent: 'this act has already spent the one attempt a package is given',
  refused: 'the act was sent and refused, so sending it again is the member\'s decision and not this rule\'s',
  again: 'the act did not happen, so it may be sent once more',
  unrecorded: 'the decision could not be kept on the package, so sending the act again would spend an attempt no successor could read',
  unconcluded: 'the attempt that was left awaiting could not be concluded, so the act is not sent again',
} as const

/** What a decision is read from: the failure, what the inspection found, how the attempt ended, and what was spent. */
export interface ADecisionAsked {
  readonly failure: AFailure
  readonly inspection: AnInspection
  readonly attempt: TheAttempt
  readonly attempts_spent: number
}

/**
 * What the package does next, in this order: a failure it cannot name pauses it; an act that had already happened is
 * recorded from what was found, never sent again; one that may have run and cannot be read pauses; an act that has
 * spent its attempt pauses; one sent and refused goes back to the member to replan; and only an act that did not
 * happen, was never sent or was sent with nothing kept, is sent once more.
 */
export function decideARecovery(asked: ADecisionAsked): TheDecision {
  if (asked.failure.class === 'unknown') return { decision: 'paused', why: WHY.unknown }
  if (asked.inspection.state === 'it_happened') return { decision: 'concluded_from_the_inspection', why: WHY.happened }
  if (asked.inspection.state === 'cannot_tell') return { decision: 'paused', why: WHY.cannot_tell }
  if (asked.attempts_spent >= ATTEMPTS_A_PACKAGE_IS_GIVEN) return { decision: 'paused', why: WHY.spent }
  if (asked.attempt === 'sent_and_failed') return { decision: 'replanned', why: WHY.refused }
  return { decision: 'retried_once', why: WHY.again }
}

/** Who is sending, and the act: the package, the member's name, and the act itself. */
export interface AnAttempt {
  readonly package: string
  readonly member: string
  readonly act: OutwardAct
}

/** How the ledger says the attempt ended: its three endings, read from the error the send threw. */
function theAttemptThatWas(failure: unknown): TheAttempt {
  if (failure instanceof ActNotSent) return failure.row_may_stand_at === undefined ? 'never_sent' : 'may_have_run'
  return failure instanceof OutcomeNotKept ? 'may_have_run' : 'sent_and_failed'
}

/** The witness a send's failure is: whatever was thrown, read by its code, its name or its message. */
const theWitnessOf = (failure: unknown): TheFailureWitness => ({ kind: 'an_error', error: failure })

/**
 * A failed act that is not sent again: the decision the package made, and the words the member is told. It carries the
 * three parts so a caller can say its own line, and `told` so it need not.
 */
export class RecoveryDecided extends Error {
  readonly decision: RecoveryDecision
  readonly failure: AFailure
  readonly inspection: AnInspection
  readonly told: string

  constructor(told: string, parts: TheParts) {
    super(told)
    this.name = 'RecoveryDecided'
    this.decision = parts.decision.decision
    this.failure = parts.failure
    this.inspection = parts.inspection
    this.told = told
  }
}

/** The parts of one decided recovery: what failed, what was read, and what was decided. The row keeps all three. */
interface TheParts {
  readonly failure: AFailure
  readonly inspection: AnInspection
  readonly decision: TheDecision
}

/** What a look at an act's real state found, in the sentence a member reads: the read, then what it said. */
const theSawOf = (inspection: AnInspection): string =>
  inspection.state === 'cannot_tell' ? `${inspection.read} could not be read: ${inspection.found}` : `${inspection.read} found ${inspection.found}`

/** What the store said when it would not keep a row: one line, and never nothing. */
const saidAtTheStore = (refusal: unknown): string => {
  const said = theMessageOf(refusal)
  return said === '' ? 'the store refused the row and said nothing why' : said
}


/**
 * A row the recovery needed, the package it was for, and whether that package holds it. A store that will not keep one
 * never hides what the inspection found: the act's real state is still told, and so is the fact that nothing was
 * recorded (martha#512 r=2).
 */
type AKeptRow = { readonly kept: true; readonly package: string } | { readonly kept: false; readonly package: string; readonly what: string; readonly said: string }

/** Keeps a row on one package, or says which one the store would not keep, instead of letting a store failure hide the state. */
async function keptOrSaid(work_package: string, writing: Promise<void>, what: string): Promise<AKeptRow> {
  try {
    await writing
    return { kept: true, package: work_package }
  } catch (refusal) {
    return { kept: false, package: work_package, what, said: saidAtTheStore(refusal) }
  }
}

/** The packages whose every row was kept: the only ones a pause recorded on them can be claimed for. */
const thePackagesThatKept = (packages: readonly string[], rows: readonly AKeptRow[]): readonly string[] =>
  packages.filter((one) => rows.every((row) => row.kept || row.package !== one))

/**
 * The line a member is told, and the row keeps: the act, the class, what was read, and what the packages do now. A row
 * the store would not keep is named after the decision, so the member knows the words describe the world and not what
 * the package holds. `held` names the packages a pause stands on: the hold and the nudge are claimed for those alone.
 */
function theWordsOf(input: AnActOnPackages, parts: TheParts, rows: readonly AKeptRow[], held: readonly string[]): string {
  const act = `the ${input.act.kind} (${input.act.what})`
  const asked = parts.decision.decision === 'paused' ? thePauseWords(input.packages, held) : ''
  const lost = rows.flatMap((row) =>
    row.kept ? [] : [` ${row.what.charAt(0).toUpperCase()}${row.what.slice(1)}${input.packages.length > 1 ? ` for ${row.package}` : ''} was not recorded (${row.said}).`],
  ).join('')
  return `${input.packages.join(', ')}: ${act} failed as ${parts.failure.class} (${parts.failure.evidence}). ${theSawOf(parts.inspection)}. ${parts.decision.why}.${lost} Nothing more is sent.${asked}`
}

/** What a pause holds, and the one message it lets through (martha#512 slice 2): said wherever the hold is told. */
const WHAT_A_PAUSE_HOLDS = (): string =>
  `no act is sent on it, except a message only to those the crew's nudges go to, until the Supervisor or the owner resumes it (${HOW_A_PAUSE_IS_LIFTED()})`

/** A package the pause could not be recorded on: nothing holds it, nobody is nudged, and the duty is the member's. */
const NOTHING_HOLDS_ONE = ' The pause could not be recorded, so nothing holds the package and the Supervisor is not nudged: do not go on with this package, and tell the Supervisor yourself.'

/**
 * What a pause does, told only as far as the ledgers hold it (martha#512 r=2, slice 2). The hold and the nudge both read
 * the `paused` row, so they are claimed for the packages in `held` and no other: a package whose row the store would not
 * keep is named, and its member told to stop and report.
 */
function thePauseWords(packages: readonly string[], held: readonly string[]): string {
  const unheld = packages.filter((one) => !held.includes(one))
  if (packages.length === 1) return unheld.length === 0 ? ` The package is paused: the Supervisor is nudged about it, and ${WHAT_A_PAUSE_HOLDS()}.` : NOTHING_HOLDS_ONE
  const paused = held.length === 0 ? '' : ` ${held.join(', ')} ${held.length === 1 ? 'is' : 'are'} paused: the Supervisor is nudged about each, and ${WHAT_A_PAUSE_HOLDS()}.`
  const not_held =
    unheld.length === 0
      ? ''
      : ` The pause could not be recorded on ${unheld.join(', ')}, so nothing holds ${unheld.length === 1 ? 'it' : 'them'} and the Supervisor is not nudged: do not go on with ${unheld.length === 1 ? 'it' : 'them'}, and tell the Supervisor yourself.`
  return `${paused}${not_held}`
}

/**
 * An act refused because its package stands paused (martha#512): nothing was announced and nothing ran. A pause holds
 * the package until whoever the crew's nudges go to resumes it, so a member that calls again straight after a pause gets
 * this, and never a fresh first send of an act that may already have run.
 */
export class PackagePaused extends Error {
  readonly told: string

  constructor(input: AnAttempt, pause: RecoveryRow) {
    const told =
      `${input.package}: the ${input.act.kind} (${input.act.what}) was not sent, because the package is paused since the ` +
      `${pause.act.kind} (${pause.act.what}) failed as ${pause.failure.class}: ${WHAT_A_PAUSE_HOLDS()}.`
    super(told)
    this.name = 'PackagePaused'
    this.told = told
  }
}

/** Whether a send may pass a pause: only a message to those the crew's nudges go to does (martha#512 slice 2, Q1). */
export interface TheHold {
  readonly passes_the_hold?: boolean
}

/**
 * Sends an announced act and recovers from its failure, once at most: the act's row is kept before it runs, the failure
 * is named and the act's real state read through `look`, one decision is kept on the package, and the act is sent again
 * only when the inspection found it did not happen and the package has not spent its attempt. An act that had already
 * happened is answered with what was found; one that is not sent again throws RecoveryDecided, carrying the words.
 *
 * A store that will not keep the recovery's own rows never turns a fact about the world into its opposite: the answer
 * still says what the inspection found, and names the row the package does not hold. A decision that cannot be kept is
 * never acted on — an attempt no successor could read is not spent — so the package stops instead of sending again.
 *
 * A package that stands paused is refused before anything is announced (PackagePaused): a pause holds the package, not
 * the one act that paused it. The one send that passes it is a message only to those the crew's nudges go to, so a
 * member on a paused package can still report; it passes the hold and nothing else, so it is recovered like any act.
 */
export async function sendAnActAndRecover(
  host: LedgerHost,
  input: AnAttempt,
  send: () => Promise<string>,
  look: () => Promise<AnInspection>,
  hold: TheHold = {},
): Promise<string> {
  return sendAnActOnEveryPackageAndRecover(host, { packages: [input.package], member: input.member, act: input.act }, send, look, hold)
}

/**
 * The same recovery for an act that lands several packages at once (martha#512 slice 2): announced in every package's
 * ledger, sent once, decided once, and the decision kept in every ledger. A package that stands paused refuses the act.
 * The attempt is spent when any package has spent it; a retry is sent only when every ledger kept the decision to send
 * it, and a pause is claimed only for the packages whose ledger kept it.
 */
export async function sendAnActOnEveryPackageAndRecover(
  host: LedgerHost,
  input: AnActOnPackages,
  send: () => Promise<string>,
  look: () => Promise<AnInspection>,
  hold: TheHold = {},
): Promise<string> {
  if (hold.passes_the_hold !== true) await refuseAPausedPackage(host, input)
  const first = await sendOnEveryPackage(host, input, send)
  if ('said' in first) return first.said
  return recoverFrom(host, input, { failure: first.failure, awaiting: first.awaiting, send, look })
}

/** Throws PackagePaused for the first package of the act that stands paused. */
async function refuseAPausedPackage(host: LedgerHost, input: AnActOnPackages): Promise<void> {
  for (const work_package of input.packages) {
    const pause = thePauseOn(await readLedger(host, work_package))
    if (pause !== undefined) throw new PackagePaused({ package: work_package, member: input.member, act: input.act }, pause)
  }
}

/** The failure of one attempt, what it left awaiting, and the two ways to go on from it: what the sender runs, and what it looks at. */
interface ASend {
  readonly failure: unknown
  readonly awaiting: readonly AnAnnouncement[]
  readonly send: () => Promise<string>
  readonly look: () => Promise<AnInspection>
}

/** A decision that stops the packages before anything else is sent, with no pause row written on any of them. */
const stoppedBecause = (parts: TheParts, why: string): TheParts => ({ failure: parts.failure, inspection: parts.inspection, decision: { decision: 'paused', why } })

/** Names the failure, reads the state, decides and keeps the decision; then does what was decided. */
async function recoverFrom(host: LedgerHost, input: AnActOnPackages, attempt: ASend): Promise<string> {
  const parts = await thePartsOf(host, input, attempt)
  const noted = await noteTheParts(host, input, parts)
  if (parts.decision.decision === 'retried_once' && noted.some((row) => !row.kept)) {
    // An attempt belongs to the package, and one a package cannot keep is one no successor would read. So a store
    // failure on any ledger stops the act instead of buying a second attempt that ledger does not know about.
    const stopped = stoppedBecause(parts, WHY.unrecorded)
    throw new RecoveryDecided(theWordsOf(input, stopped, noted, []), stopped)
  }
  if (parts.decision.decision === 'concluded_from_the_inspection') return concludedWhatWasFound(host, input, attempt, parts, noted)
  if (parts.decision.decision === 'retried_once') return theOneMoreTry(host, input, attempt, parts)
  throw new RecoveryDecided(theWordsOf(input, parts, noted, thePackagesThatKept(input.packages, noted)), parts)
}

/** Keeps what a recovery was decided on, in every package's ledger: the class and its evidence, what was read and found, and the decision. */
async function noteTheParts(host: LedgerHost, input: AnActOnPackages, parts: TheParts): Promise<readonly AKeptRow[]> {
  const rows: AKeptRow[] = []
  for (const work_package of input.packages) {
    const row = {
      package: work_package,
      member: input.member,
      act: input.act,
      failure: { class: parts.failure.class, evidence: parts.failure.evidence },
      inspection: { read: parts.inspection.read, found: parts.inspection.found },
      decision: parts.decision.decision,
    }
    rows.push(await keptOrSaid(work_package, noteRecovery(host, row), 'the decision'))
  }
  return rows
}

/** The three parts of the decision, read in the order the rule asks for them: the failure, the state, what was spent. */
async function thePartsOf(host: LedgerHost, input: AnActOnPackages, attempt: ASend): Promise<TheParts> {
  const failure = classifyAFailure(theWitnessOf(attempt.failure))
  const inspection = await inspectTheActualState(attempt.look)
  let attempts_spent = 0
  for (const work_package of input.packages) attempts_spent = Math.max(attempts_spent, theAttemptsOn(await readLedger(host, work_package), input.act))
  return { failure, inspection, decision: decideARecovery({ failure, inspection, attempt: theAttemptThatWas(attempt.failure), attempts_spent }) }
}

/** Concludes every announcement an attempt left awaiting with one outcome; answers each row and whether it was kept. */
async function concludeTheAwaiting(host: LedgerHost, member: string, awaiting: readonly AnAnnouncement[], outcome: Outcome, what: string): Promise<readonly AKeptRow[]> {
  const rows: AKeptRow[] = []
  for (const one of awaiting) rows.push(await keptOrSaid(one.package, concludeAct(host, { package: one.package, member, announced_at: one.at, outcome }), what))
  return rows
}

/**
 * The act recorded from what the inspection found. Its rows are concluded only where they were left awaiting, which is
 * the one case an inspection can settle: an act whose outcome was kept stands as it was written, and the recovery row is
 * what says the world holds more. A store that will not keep either row does not change what was found, so the answer
 * still says it, and says which row the packages do not hold.
 */
async function concludedWhatWasFound(host: LedgerHost, input: AnActOnPackages, attempt: ASend, parts: TheParts, noted: readonly AKeptRow[]): Promise<string> {
  const concluded = await concludeTheAwaiting(host, input.member, attempt.awaiting, { succeeded: true, detail: parts.inspection.found }, "the act's ending")
  const rows = [...noted, ...concluded]
  return rows.every((row) => row.kept) ? parts.inspection.found : theWordsOf(input, parts, rows, [])
}

/**
 * The first decision's one retry: the act is announced and sent once more. An act whose rows were left awaiting is
 * concluded first, as the inspection found it, so no row of a retry stands open for a successor to chase.
 *
 * The retry's own failure is decided by the same rule as the first one, with the attempt spent: what the inspection
 * found had happened is concluded from what was found and never sent a third time, and anything else pauses the
 * packages. A retry that removed the branch and then failed anyway is therefore an act that happened, not a pause.
 */
async function theOneMoreTry(host: LedgerHost, input: AnActOnPackages, attempt: ASend, first: TheParts): Promise<string> {
  const concluded = await concludeTheAwaiting(host, input.member, attempt.awaiting, { succeeded: false, detail: `${first.inspection.found}; it was sent once more` }, 'the attempt that was left awaiting')
  if (concluded.some((row) => !row.kept)) {
    const stopped = stoppedBecause(first, WHY.unconcluded)
    throw new RecoveryDecided(theWordsOf(input, stopped, concluded, []), stopped)
  }
  const again = await sendOnEveryPackage(host, input, attempt.send)
  if ('said' in again) return again.said
  const failure = classifyAFailure(theWitnessOf(again.failure))
  const inspection = await inspectTheActualState(attempt.look)
  // The one attempt has been spent on the send above, so the cap settles this: what was found, or a pause.
  const decided = decideARecovery({ failure, inspection, attempt: theAttemptThatWas(again.failure), attempts_spent: ATTEMPTS_A_PACKAGE_IS_GIVEN })
  const twice = `the attempt the package was given had already failed as ${first.failure.class}, and this one failed as ${failure.class}`
  const parts: TheParts = { failure, inspection, decision: { decision: decided.decision, why: `${twice}; ${decided.why}` } }
  const noted = await noteTheParts(host, input, parts)
  const retried: ASend = { failure: again.failure, awaiting: again.awaiting, send: attempt.send, look: attempt.look }
  if (decided.decision === 'concluded_from_the_inspection') return concludedWhatWasFound(host, input, retried, parts, noted)
  throw new RecoveryDecided(theWordsOf(input, parts, noted, thePackagesThatKept(input.packages, noted)), parts)
}

/**
 * Whether none of these packages stands paused, for an act that lands them all (martha#512 slice 2): read before
 * anything is cut, merged or announced, so a batch that would be refused writes nothing on any of its packages. A pause
 * that already stands holds the batch and pauses nothing else; only a pause decided on the batch's own push pauses
 * every package in it. A ledger that cannot be read refuses too, since it cannot say the package is not paused.
 */
export async function noneOfTheseIsPaused(host: LedgerHost, packages: readonly string[], what: string): Promise<{ readonly ok: true } | { readonly refused: string }> {
  for (const work_package of packages) {
    let pause: RecoveryRow | undefined
    try {
      pause = thePauseOn(await readLedger(host, work_package))
    } catch (error) {
      return { refused: `the ledger of ${work_package} could not be read, so nothing says it is not paused (${theMessageOf(error)}): ${what}.` }
    }
    if (pause !== undefined) {
      return { refused: `${what}: ${work_package} is paused since the ${pause.act.kind} (${pause.act.what}) failed as ${pause.failure.class}, and ${WHAT_A_PAUSE_HOLDS()}. Leave it out of the batch, or land the batch once it is resumed.` }
    }
  }
  return { ok: true }
}
