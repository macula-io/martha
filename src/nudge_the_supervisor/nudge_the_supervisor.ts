// The crew's stalls, told to whoever routes its work (martha#320).
//
// This exists so a member that has stopped, a HANDOFF nobody answered, a member held up by a person for too long, and a
// cycle of waits reach the Supervisor without anyone watching for them. The instances are the crew's own: a member read
// `waiting`, 0 of 6, for ten hours and nothing said so; three hand-offs sat unanswered until someone asked; a copy of a
// HANDOFF addressed to the Supervisor kept a review wait alive after its package had landed.
//
// A nudge says what it sees and acts on nothing. Nothing here wakes, restarts or pushes anyone: whoever reads it decides.
//
// Two rules shape the text, and both come from what a nudge is:
//
//   - A NUDGE'S LINE CARRIES ONLY CHECKED FIELDS. It lands in a Supervisor's prompt, and the words on a member's row
//     (`task`, and what it says it waits for) are words a member wrote, possibly after taking in a stranger's text. So a
//     nudge line names the kind, the member, the package and the time, each printed only when it is one the declaration
//     knows or a shape this slice checks; the member's own words stay in the owner's pane and never enter a prompt.
//   - A WAIT ENDS ON A FACT, NEVER ON A CLOCK. A HANDOFF's wait ends when a VERDICT, a landing or a newer HANDOFF for
//     that package is read; a wait on a person ends when the member reports without it. Expiring a wait on a timer would
//     hide exactly the hand-off nobody answered, which is the thing this exists to surface.
//
// Pure: no I/O and no clock of its own. The rows, the messages, the parks and the time are handed in, so both hosts run
// the same rule and the tests hold it.

import { MEMBER_NAME, MINUTE_MS, OWNER } from '../declare_crew/declare_crew.ts'
import type { Addressee } from '../keep_the_crew_channel/crew_channel.ts'
import { readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { WORK_PACKAGE } from '../log_ledger/log_ledger.ts'
import { OFFLINE_AFTER_MS, type DashboardRow, type State } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The kinds of stall a nudge names, as the Supervisor reads them. A wait on the owner is that person's nudge. */
export const NUDGE_KINDS = ['stalled', 'review', 'person', OWNER, 'deadlock'] as const
export type NudgeKind = (typeof NUDGE_KINDS)[number]

/**
 * One stall, in the few things a prompt may carry: what kind of stall it is, the member it is about, the package it is
 * about ('' when it names none), and since when. `said` is what the member itself wrote into its row — kept for the
 * owner's pane, and never printed by anything that composes a prompt (../theNudgesPart).
 */
export interface Nudge {
  readonly kind: NudgeKind
  readonly member: string
  readonly package: string
  /** Milliseconds since the epoch, when the stall began. */
  readonly since: number
  /** The member's own words about what holds it up, for a pane only. Never a nudge line. */
  readonly said?: string
}

/** The windows a crew declared, in milliseconds. Zero turns that kind of nudge off. */
export interface NudgeWindows {
  readonly stalled_ms: number
  readonly review_ms: number
  readonly person_ms: number
}

/** A HANDOFF that no answer has followed: the package, who sent it, who it reached, and when. */
export interface ReviewWait {
  readonly package: string
  readonly from: string
  readonly to: readonly string[]
  readonly at: number
}

/** A message of the crew's channel, as this rule reads it: who sent it, who it is for, what it said, and when. */
export interface SentMessage {
  readonly from: string
  readonly to: Addressee
  readonly text: string
  readonly sent_at: number
}

/** Whether a message went to the whole crew. The channel names that addressee by a word rather than a list, so its own
 * type is what this asks: a string is the whole crew, and a list is the members it names. */
const toTheWholeCrew = (to: Addressee): to is Extract<Addressee, string> => typeof to === 'string'

/** Whether `name` and `other` are the same name, compared as the declaration compares member names. */
const same = (name: string, other: string): boolean => name.trim().toLowerCase() === other.trim().toLowerCase()

/** Whether a row is one of the members a nudge is delivered to, who are never a subject of one. */
const isAReceiver = (member: string, receivers: readonly string[]): boolean => receivers.some((receiver) => same(member, receiver))

/** The verbs that answer a HANDOFF: a verdict closes the round, and a landing carries the package past review. */
export const ANSWERING_VERBS = ['VERDICT', 'LAND'] as const

/**
 * Whether a HANDOFF reached someone whose verdict it waits for: the Supervisor reviews no package,
 * so a line addressed only to the receivers of nudges is a copy of a hand-off that went to a reviewer elsewhere, and a
 * copy outlives the verdict it copied. A send naming anyone else starts the wait, whatever it was also copied to; a send
 * naming nobody starts none, since no verdict was ever going to come back.
 */
const reachesAReviewer = (to: Addressee, receivers: readonly string[]): boolean => {
  if (toTheWholeCrew(to)) return true
  return to.some((name) => !isAReceiver(name, receivers))
}

/** A package a landing answered, as the ledger read it: the wait on it ends. */
export type LandedPackages = ReadonlySet<string>

/** The crew-line verbs a message starts with, as `readACrewLine` names them. */
const verbOf = (text: string): { verb: string; package: string } | null => {
  const read = readACrewLine(text)
  if (!('line' in read) || read.line === null) return null
  return { verb: read.line.verb, package: read.line.package }
}

/**
 * The review waits the channel's messages leave (martha#320), oldest first and one per package: a HANDOFF that reached a
 * reviewer starts one, and a VERDICT, a landing, or a newer HANDOFF for that package ends it. The messages are read in
 * the order the crew wrote them, so a verdict that arrived before a hand-off cannot answer it.
 */
export function reviewWaitsIn(messages: readonly SentMessage[], landed: LandedPackages, receivers: readonly string[]): readonly ReviewWait[] {
  const waits = new Map<string, ReviewWait>()
  for (const message of messages) {
    const line = verbOf(message.text)
    if (line === null) continue
    // A copy starts no wait and ends none; a landing or a verdict is what a wait ends on.
    const startsAWait = line.verb === 'HANDOFF' && !landed.has(line.package) && reachesAReviewer(message.to, receivers)
    if (startsAWait) {
      waits.set(line.package, { package: line.package, from: message.from, to: toTheWholeCrew(message.to) ? [] : message.to, at: message.sent_at })
      continue
    }
    if ((ANSWERING_VERBS as readonly string[]).includes(line.verb)) waits.delete(line.package)
  }
  return [...waits.values()]
}

/** Whether a row is fresh enough to be read at all: a quiet row is `offline`, and no member is nudged for one. */
const quiet = (row: DashboardRow, now: number): boolean => now - row.at > OFFLINE_AFTER_MS

/** A member at work, as the owner's pane counts it: the two states that are expected to move on their own. */
export const BUSY = ['working', 'waiting'] as const

/** The row's own word for a member its crew has parked. It is the dashboard's state (../show_dashboard_beat's states),
 * and not the name of the place a crew keeps its park markers in, though the two are spelled the same. It stays private
 * to this file: exporting it would judge every literal spelling the word elsewhere in the tree (the check says so). */
const PARKED_STATE: State = 'parked'

/** The word a member's row names a CI run with, a run ending by itself and so holding up nobody for long. */
const CI = 'ci'

/** When the member last said anything about its progress: its own report, never the heartbeat that keeps the row fresh.
 * A row written before a report carried that moment has none, and the row's own beat is the last thing it says. */
export const lastSaidAt = (row: DashboardRow): number => row.progress.at ?? row.at

/** Whether the row's own progress can age into a stall: a task still in hand can, and a finished one only while the row
 * still says working — a member that carries on without reporting has said nothing since that last step. */
const canStall = (row: DashboardRow): boolean => row.progress.step < row.progress.of || row.state === 'working'

/** Whether a member is one a nudge is never made about: a receiver, a parked member, or one whose row has gone quiet. */
const outOfScope = (row: DashboardRow, input: NudgeInput): boolean =>
  isAReceiver(row.member, input.receivers) || row.state === PARKED_STATE || quiet(row, input.now) || input.parked.some((name) => same(name, row.member))

/** Members that say they are busy and have not reported progress for the window. */
function stalledNudges(input: NudgeInput): Nudge[] {
  if (input.windows.stalled_ms <= 0) return []
  return input.rows
    .filter((row) => (BUSY as readonly string[]).includes(row.state) && !outOfScope(row, input) && canStall(row))
    .filter((row) => input.now - lastSaidAt(row) >= input.windows.stalled_ms)
    .map((row) => ({ kind: 'stalled' as const, member: row.member, package: '', since: lastSaidAt(row) }))
}

/** Hand-offs that no verdict, landing or newer hand-off has answered for the window. */
function reviewNudges(input: NudgeInput): Nudge[] {
  if (input.windows.review_ms <= 0) return []
  return input.waits
    .filter((wait) => input.now - wait.at >= input.windows.review_ms)
    .map((wait) => ({ kind: 'review' as const, member: wait.from, package: wait.package, since: wait.at }))
}

/** The waits on a person that have lasted the window: a member back at work is no longer held up, and CI is no person. */
function heldWaits(input: NudgeInput): readonly { readonly row: DashboardRow; readonly wait: NonNullable<DashboardRow['waits']> }[] {
  if (input.windows.person_ms <= 0) return []
  return input.rows.flatMap((row) => {
    const wait = row.waits
    if (wait === null || row.state === 'working' || outOfScope(row, input)) return []
    if (same(wait.on, CI) || input.now - wait.since < input.windows.person_ms) return []
    return [{ row, wait }]
  })
}

/** Members that wait on a person past the window: a CI run is not a person, and a wait on the owner is the owner's. */
function personNudges(input: NudgeInput): Nudge[] {
  return heldWaits(input)
    .filter(({ wait }) => !isTheOwner(wait.on, input))
    .map(({ row, wait }) => ({ kind: 'person' as const, member: row.member, package: '', since: wait.since, said: wait.for }))
}

/** Members that wait on the owner past the window: the owner reads the pane, not the members' rows. */
function ownerNudges(input: NudgeInput): Nudge[] {
  return heldWaits(input)
    .filter(({ wait }) => isTheOwner(wait.on, input))
    .map(({ row, wait }) => ({ kind: OWNER, member: row.member, package: '', since: wait.since, said: wait.for }))
}

/** Whether a wait names the owner rather than a member of the crew: a row names the owner by the crew's own word, and a
 * row that spells the owner's name means the same person. */
const isTheOwner = (name: string, input: NudgeInput): boolean => same(name, OWNER) || same(name, input.owner)

/**
 * One member, one line: a member that waits on a person past the window has usually stopped
 * reporting too, so the same wait was drawn twice — "last progress 8/9" beside "waits on Supervisor". The line that
 * names the wait is the one kept; a stalled line only says the row has not moved.
 */
const oneWaitPerMember = (nudges: readonly Nudge[]): Nudge[] => {
  const named = new Set(nudges.filter((nudge) => nudge.kind !== 'stalled').map((nudge) => nudge.member.toLowerCase()))
  return nudges.filter((nudge) => nudge.kind !== 'stalled' || !named.has(nudge.member.toLowerCase()))
}

/** What a nudge is made from: the rows, the waits, the parks, the windows, the receivers, and the time. */
export interface NudgeInput {
  readonly rows: readonly DashboardRow[]
  readonly waits: readonly ReviewWait[]
  /** The members whose park marker says they are parked: they are not expected to move. */
  readonly parked: readonly string[]
  readonly windows: NudgeWindows
  readonly now: number
  readonly owner: string
  /** Who reads nudges: a receiver is never the subject of one. */
  readonly receivers: readonly string[]
}

/**
 * Every nudge, oldest first: the one that has waited longest is read first, and two that began together are read in the
 * alphabet's order so the text does not depend on the order the rows arrived in. `more` carries nudges another rule made
 * (../watch_waits), so a cycle sorts and shows with these.
 */
export function nudgesOf(input: NudgeInput, more: readonly Nudge[] = []): readonly Nudge[] {
  return oneWaitPerMember([
    ...stalledNudges(input),
    ...reviewNudges(input),
    ...personNudges(input),
    ...ownerNudges(input),
    ...more,
  ]).sort((one, two) => one.since - two.since || `${one.kind} ${one.member} ${one.package}`.localeCompare(`${two.kind} ${two.member} ${two.package}`))
}

/** The clock time a nudge began, in UTC to the minute: a line names when, never an age, so its text changes when a nudge
 * comes or goes rather than every minute a reader looks. */
export const clockOf = (at: number): string => `${new Date(at).toISOString().slice(11, 16)} UTC`

/** The members and the owner a nudge line may name: what the declaration holds, and nothing else. */
export interface TheDeclaredNames {
  readonly owner: string
  readonly members: readonly { readonly name: string }[]
}

/**
 * The name a line may print, or '' when it is not one the declaration knows. A row's `member` and a message's `from` are
 * text a store holds; a prompt prints only a name the crew declared, so nothing a stranger wrote reaches it (test 7).
 */
export function aDeclaredName(name: string, crew: TheDeclaredNames): string {
  const declared = [crew.owner, ...crew.members.map((member) => member.name)]
  return declared.find((one) => same(one, name)) ?? ''
}

/** One nudge as a prompt line, or null when it names nothing a line may carry. */
export function theNudgeLine(nudge: Nudge, crew: TheDeclaredNames): string | null {
  const member = aDeclaredName(nudge.member, crew)
  if (member === '' || !MEMBER_NAME.test(member)) return null
  const package_name = WORK_PACKAGE.test(nudge.package) ? nudge.package : ''
  if (nudge.package !== '' && package_name === '') return null
  const on = package_name === '' ? '' : ` on ${package_name}`
  return `- ${nudge.kind}: ${member}${on}, since ${clockOf(nudge.since)}`
}

/**
 * The part a Supervisor's prompt carries, or null when there is nothing to say. Only `theNudgeLine`'s fields are printed:
 * what a member wrote about itself (`said`) is never read here, so a member cannot put words into another member's prompt.
 */
export function theNudgesPart(nudges: readonly Nudge[], crew: TheDeclaredNames): string | null {
  const lines = nudges.map((nudge) => theNudgeLine(nudge, crew)).filter((line): line is string => line !== null)
  if (lines.length === 0) return null
  return [
    'Crew nudges: the crew sees these and acts on none of them. Check each one, then act or leave it:',
    ...lines,
  ].join('\n')
}

/** The part as the lines a pane draws, in the order it wrote them: none for a crew at work. */
export function theNudgesPartLines(nudges: readonly Nudge[], crew: TheDeclaredNames): readonly string[] {
  const part = theNudgesPart(nudges, crew)
  return part === null ? [] : part.split('\n')
}

/** The windows a declaration gave, in milliseconds, with 0 for a kind the crew turned off. */
export function windowsOf(house_rules: { readonly stalled_minutes: number | null; readonly review_minutes: number | null; readonly person_minutes: number | null }): NudgeWindows {
  return {
    stalled_ms: (house_rules.stalled_minutes ?? 0) * MINUTE_MS,
    review_ms: (house_rules.review_minutes ?? 0) * MINUTE_MS,
    person_ms: (house_rules.person_minutes ?? 0) * MINUTE_MS,
  }
}

/** The act a mode's table grants whoever routes the crew's work: one of the acts ../declare_crew names. */
const ASSIGN_WORK = 'assign_work'

/** What this rule needs of a declaration to know who reads a nudge: the owner, the members, and the mode's table. */
export interface WhoRoutes {
  readonly owner: string
  readonly members: readonly { readonly name: string; readonly role: string }[]
  readonly mode: { readonly may: Readonly<Record<string, readonly string[]>> }
}

/**
 * Who reads nudges: the members whose role the mode's table grants `assign_work`, and the owner when the table grants it
 * to them (martha#320). In a solo crew the table grants it to the owner and the list is the owner alone, which is where a
 * solo crew's pane reads them. A crew that grants it to nobody reads none, and the declaration refuses that.
 */
export function theNudgesGoTo(declaration: WhoRoutes): readonly string[] {
  const granted = declaration.mode.may[ASSIGN_WORK] ?? []
  const receivers = declaration.members.filter((member) => granted.includes(member.role)).map((member) => member.name)
  return granted.includes(OWNER) ? [declaration.owner, ...receivers] : receivers
}
