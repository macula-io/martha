// `report_progress`: what a member says about its own work, and what of it is recorded (martha#254).
//
// This exists so a member moves its own row on the owner's dashboard, and so the row says only what the member can
// honestly say about itself. A report is a member's own word: it is never refused for naming a stranger (a misspelt
// name is a typo to see, not a lie to hide), and it never stops the member's turn. What it can be told is that a
// part of it was not recorded and why, and the part it dropped stays as it was.
//
// Two rules are the row's honesty, not a guard:
//
//   - A WAIT ON A PERSON SAYS WHAT IT WAITS FOR. The owner's dashboard is read to see who holds whom up; a row that
//     says "waiting on Supervisor" and nothing else tells the owner to go and ask. So a wait on a person with no
//     `waiting_for` is not recorded, and the row keeps the wait it had (the crew's rule for a wait on a person).
//   - A NAME THE CREW DOES NOT HAVE IS RECORDED, WITH A WARNING. The row is the member's own word about itself; a
//     name nobody has is a typo to see in the warning, not something to paper over by dropping the wait.
//
// The task's own limit is defined once, here, and read by the tool's description, by the cut, and by the test: the
// number the model is told is exactly the number its words are cut at (martha#254 r=1 R2).

import { STATES, type Progress, type State, type Waits } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** The longest a task is kept: the number the tool's own description quotes, and the number its words are cut at. */
export const TASK_CHARACTERS = 80

/** The phases a member can report, and the state each is shown as while the report holds. */
export const PHASES = ['working', 'reviewing'] as const
export type Phase = (typeof PHASES)[number]

/** The phases as the row's state. */
export const STATE_OF_PHASE: Readonly<Record<Phase, State>> = { working: 'working', reviewing: 'reviewing' }

/** The owner, as a wait names them. */
export const OWNER = 'owner'

/** The Supervisor, as a wait names them. */
export const SUPERVISOR = 'supervisor'

/** What a package is: owner/repo#n, as GitHub names an issue, which is what the ledger keys a stream by. */
const WORK_PACKAGE = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.+#)[A-Za-z0-9._-]+#[1-9][0-9]*$/

/** The crew a member reports to: the owner, and every member's name. */
export interface TheCrew {
  readonly owner: string
  readonly members: readonly string[]
}

/** What the member asked for, as the tool's own arguments. */
export interface ProgressAsked {
  readonly task?: unknown
  readonly step?: unknown
  readonly of?: unknown
  readonly phase?: unknown
  readonly waiting_on?: unknown
  readonly waiting_for?: unknown
  readonly package?: unknown
}

/** What the row said before this report: the wait it keeps when a report does not land one, and the package it holds. */
export interface ProgressBefore {
  readonly waits: Waits | null
  readonly holds: string
}

/** What this report records, field by field. */
export interface ProgressTaken {
  readonly state: State
  readonly task: string
  readonly progress: Progress
  readonly waits: Waits | null
  readonly holds: string
  /** What the member should see, and why: never a refusal of its work. */
  readonly warnings: readonly string[]
}

const isText = (value: unknown): value is string => typeof value === 'string'

/** Cuts `task` to TASK_CHARACTERS: at the last word that fits, so a word is not cut in half when one does. */
export function cutTask(task: string): string {
  const trimmed = task.trim()
  if (trimmed.length <= TASK_CHARACTERS) return trimmed
  const head = trimmed.slice(0, TASK_CHARACTERS + 1)
  const space = head.lastIndexOf(' ')
  return space > 0 ? head.slice(0, space).trimEnd() : trimmed.slice(0, TASK_CHARACTERS)
}

/** Whether `name` is somebody the crew has, compared as the declaration compares names: ignoring case. */
export function theCrewHas(crew: TheCrew, name: string): boolean {
  const folded = name.trim().toLowerCase()
  if (folded === OWNER || folded === SUPERVISOR) return true
  return crew.members.some((member) => member.toLowerCase() === folded)
}

/** Takes one report: what it records, and what the member is told. */
export function takeProgress(
  asked: ProgressAsked,
  crew: TheCrew,
  before: ProgressBefore,
  now: number,
): { readonly taken: ProgressTaken; readonly told: string } {
  const warnings: string[] = []
  const task = isText(asked.task) ? cutTask(asked.task) : ''
  if (isText(asked.task) && task.length < asked.task.trim().length) warnings.push(`the task was cut to ${TASK_CHARACTERS} characters`)

  const of = Math.max(1, asInteger(asked.of) ?? 1)
  const askedStep = asInteger(asked.step) ?? 0
  const step = Math.min(Math.max(0, askedStep), of)
  if (step !== askedStep) warnings.push(`step was kept between 0 and ${of}`)

  const phase: Phase = isPhase(asked.phase) ? asked.phase : 'working'
  const wait = takesAWait(asked, crew, before, now, warnings)
  const holds = packageOf(asked.package, before.holds, warnings)

  const taken: ProgressTaken = {
    state: wait.waits !== null ? 'waiting' : STATE_OF_PHASE[phase],
    task,
    // `at` is when the member moved itself, not when the launcher last beat (martha#320): the heartbeat rewrites the row
    // every few seconds, so a rule that looks for a member that has stopped would never see one.
    progress: { step, of, at: now },
    waits: wait.waits,
    holds,
    warnings,
  }
  return { taken, told: toldOf(taken, wait.not_recorded) }
}

/** A whole number an argument names, or undefined when it names none. */
function asInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && /^-?[0-9]+$/.test(value.trim())) return Number(value.trim())
  return undefined
}

const isPhase = (value: unknown): value is Phase => (PHASES as readonly unknown[]).includes(value)

/** What the row's wait becomes, and what of the report was not recorded. */
function takesAWait(
  asked: ProgressAsked,
  crew: TheCrew,
  before: ProgressBefore,
  now: number,
  warnings: string[],
): { readonly waits: Waits | null; readonly not_recorded?: string } {
  if (!isText(asked.waiting_on) || asked.waiting_on.trim() === '') return { waits: null }
  const on = asked.waiting_on.trim()
  const from = isText(asked.waiting_for) ? asked.waiting_for.trim() : ''
  if (!theCrewHas(crew, on)) warnings.push(`nobody on this crew is named ${JSON.stringify(on)}: the wait is recorded as you gave it`)
  const whether = waitWithoutWhatFor(crew, on, from)
  if (whether !== undefined) return { waits: before.waits, not_recorded: whether }
  return { waits: { on, for: from, since: sinceOf(before, on, from, now) } }
}

/** Why a wait is not recorded at all: it names a person and does not say what it waits for. */
function waitWithoutWhatFor(crew: TheCrew, on: string, from: string): string | undefined {
  if (from !== '' || !isAPerson(crew, on)) return undefined
  return `a wait on ${on} says what it waits for (a HANDOFF, a verdict, a menu, a yes), so nothing was recorded and the row keeps the wait it had`
}

/** When the wait began: the moment it began if it is the wait the row already had, and now otherwise. */
function sinceOf(before: ProgressBefore, on: string, from: string, now: number): number {
  const same = before.waits !== null && before.waits.on === on && before.waits.for === from
  return same ? before.waits!.since : now
}

/** Whether a wait names a person: the owner, the Supervisor, or a member of this crew. */
function isAPerson(crew: TheCrew, name: string): boolean {
  const folded = name.trim().toLowerCase()
  return folded === OWNER || folded === SUPERVISOR || crew.members.some((member) => member.toLowerCase() === folded)
}

/** The package the row holds: the one this report names, or the one it already held when the name it gives is no package. */
function packageOf(named: unknown, held: string, warnings: string[]): string {
  if (!isText(named) || named.trim() === '') return held
  const package_name = named.trim()
  if (WORK_PACKAGE.test(package_name)) return package_name
  warnings.push(`${JSON.stringify(package_name)} is not a package: name it as owner/repo#n, the way an issue is named`)
  return held
}

/** What the member is told: what landed, and what did not and why. */
function toldOf(taken: ProgressTaken, notRecorded: string | undefined): string {
  if (notRecorded !== undefined && taken.warnings.length === 0) return `Not recorded: ${notRecorded}.`
  const parts = [`Progress noted: ${taken.progress.step}/${taken.progress.of}, ${taken.state}.`]
  if (notRecorded !== undefined) parts.push(`Not recorded: ${notRecorded}.`)
  return [...parts, ...taken.warnings.map((warning) => `Note: ${warning}.`)].join(' ')
}

/** The tool's own description, which quotes the limit its words are cut at (martha#254 r=1 R2, test 14). */
export const REPORT_PROGRESS_DESCRIPTION =
  `Report progress on your current assigned task to the crew dashboard the owner watches. ` +
  `Call it when you start a task (step 0), after each meaningful step, and once when done (step equal to of). ` +
  `The task is kept to ${TASK_CHARACTERS} characters and a longer one is cut there. ` +
  `A wait on a person says what it waits for; a wait without it is not recorded and the row keeps the wait it had.`

/** The states a report can leave the row in, so a reader of this slice knows what it writes. */
export const STATES_A_REPORT_WRITES: readonly State[] = STATES.filter((state) => state === 'working' || state === 'reviewing' || state === 'waiting')
