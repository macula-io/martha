// The crew's wait-for graph (martha#320): a cycle of waits, or a chain that ends at a member who cannot answer.
//
// This exists so a crew cannot deadlock quietly. The instance is the crew's own (2026-11-03): a member handed a package
// off, waited on a menu for the owner, and the Supervisor waited on a HANDOFF from that member. Every row read
// `waiting`, every one of them was right to wait, and it cleared only when someone read the pull request themselves.
//
// The edges are the waits the rows already hold: what a member said it waits on (`waits.on`, and never the words it wrote
// in `waits.for`), and a HANDOFF no answer has followed, from its sender to each reviewer. A CI run is a sink — it ends by
// itself, so a chain that ends at one is no deadlock. The owner declares no waits, so the owner's one edge is inferred: a
// wait on the owner is a wait the owner was never told about, and what the owner then waits for is the receiver's row.
//
// A deadlock is a cycle, or a chain that ends at a member who cannot answer: parked, quiet, or stalled. A parked member
// ends a chain only when it is resting; a busy one that has reported inside the crew's stall window is at work, and
// counting it would name it as the blocker while it works (#471). A member with no row at all is not an end — a reviewer
// not started yet is the receiver's to start. A receiver with no row is one: nobody else starts it.
//
// Each one is a nudge with no window: a cycle never clears by itself, so waiting longer only costs.
//
// Pure, like ../nudge_the_supervisor: no I/O, no clock of its own, so both hosts run the same rule.

import { OWNER } from '../declare_crew/declare_crew.ts'
import { BUSY, lastSaidAt, type Nudge, type NudgeInput, type ReviewWait } from '../nudge_the_supervisor/nudge_the_supervisor.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { IDLE, OFFLINE_AFTER_MS, type DashboardRow, type State } from '../show_dashboard_beat/show_dashboard_beat.ts'

/** One wait: `from` waits on `to` for `what`, since `since`. */
export interface WaitEdge {
  readonly from: string
  readonly to: string
  readonly what: string
  readonly since: number
}

/** A deadlock as the crew reads it: the waits in it, who must act and what they must do, and since when it has held. */
export interface Deadlock {
  readonly kind: 'cycle' | 'dead-end'
  readonly edges: readonly WaitEdge[]
  readonly must_act: string
  readonly act: string
  readonly since: number
  /** Whether the receiver of nudges is in it, which makes it the owner's too: it cannot be relied on to see its own. */
  readonly holds_receiver: boolean
}

/** The words a wait may name instead of a member's own name: the crew's two, and a CI run, which ends by itself. */
const CI_WORD = 'ci'

const keyOf = (name: string): string => name.trim().toLowerCase()
const named = (name: string, other: string): boolean => keyOf(name) === keyOf(other)

/** The row a name is, or undefined when the crew has no row for it. */
const rowOf = (name: string, rows: readonly DashboardRow[]): DashboardRow | undefined => rows.find((row) => named(row.member, name))

/** Whether a row has gone quiet: the reader's word for it (../see_the_crew), from the row's own beat. */
const quiet = (row: DashboardRow, now: number): boolean => now - row.at > OFFLINE_AFTER_MS

/** The row's own word for a parked member: the dashboard's state, not the place a crew keeps its markers in. Private to
 * this file, as ../nudge_the_supervisor's is to that one, so the load-bearing word is written where it is read. */
const PARKED_STATE: State = 'parked'

/** Whether a member is parked, by the row's own state or by the marker the crew keeps beside it. */
const parked = (row: DashboardRow, input: NudgeInput): boolean =>
  row.state === PARKED_STATE || input.parked.some((name) => named(name, row.member))


/** Whether a member has nothing in hand: its own row says idle, and its last report is done or there is none. */
const free = (row: DashboardRow): boolean => row.state === IDLE && row.progress.step >= row.progress.of

/** Whether a parked member is resting rather than at work: a busy row that said something inside the stall window. */
const atWork = (row: DashboardRow, input: NudgeInput): boolean =>
  (BUSY as readonly string[]).includes(row.state) && input.now - lastSaidAt(row) < input.windows.stalled_ms

/** The receiver a wait on "supervisor" names, when the crew has exactly one, so a row written in the crew's own shorthand
 * reaches the member it means. A crew with two receivers has no single "the supervisor", and the word names none. */
const theOneReceiver = (receivers: readonly string[]): string => (receivers.length === 1 ? (receivers[0] as string) : '')

/**
 * The member a wait names, as the row's own `on`: a member's name, the owner, or the crew's shorthand for its supervisor.
 * '' when the wait is on a CI run, or on a word this crew has nobody for.
 */
const partyOf = (on: string, input: NudgeInput): string => {
  if (named(on, CI_WORD)) return ''
  if (named(on, OWNER) || named(on, input.owner)) return input.owner
  if (named(on, SUPERVISOR)) return theOneReceiver(input.receivers)
  return rowOf(on, input.rows)?.member ?? ''
}

/** Whether a row's own wait is no edge at all: a CI run ends by itself, a member at work is not held up by what it named,
 * a free member waits for work rather than on a person, and a parked member waits on nobody while it rests. */
const noEdge = (row: DashboardRow, input: NudgeInput): boolean =>
  row.state === 'working' || free(row) || (parked(row, input) && !atWork(row, input))

/** A row's own declared wait, as the one edge it makes. */
function declaredEdges(row: DashboardRow, input: NudgeInput): WaitEdge[] {
  const wait = row.waits
  if (wait === null || noEdge(row, input)) return []
  const to = partyOf(wait.on, input)
  if (to === '' || named(to, row.member)) return []
  return [{ from: row.member, to, what: wait.for, since: wait.since }]
}

/** A HANDOFF no answer has followed: its sender waits on each reviewer, unless it has gone back to work. */
function reviewEdges(wait: ReviewWait, input: NudgeInput): WaitEdge[] {
  const sender = rowOf(wait.from, input.rows)
  if (sender !== undefined && sender.state === 'working') return []
  const from = sender?.member ?? wait.from
  return wait.to
    .filter((to) => !named(to, from))
    .map((to) => rowOf(to, input.rows)?.member ?? to)
    .filter((to) => to !== '')
    .map((to) => ({ from, to, what: `a verdict on ${wait.package}`, since: wait.at }))
}

/** The owner's one edge: what the owner waits for is the receiver's row naming the members who wait on it. */
function ownerEdge(edges: readonly WaitEdge[], input: NudgeInput): WaitEdge[] {
  const untold = edges.filter((edge) => named(edge.to, input.owner))
  if (untold.length === 0) return []
  const since = Math.min(...untold.map((edge) => edge.since))
  return [{ from: input.owner, to: theOneReceiver(input.receivers), what: `a to-do row for ${untold.map((edge) => edge.from).join(', ')}`, since }]
    .filter((edge) => edge.to !== '')
}

/** Every edge the rows and the review waits make. */
export function waitEdgesOf(input: NudgeInput): readonly WaitEdge[] {
  const declared = [...input.rows.flatMap((row) => declaredEdges(row, input)), ...input.waits.flatMap((wait) => reviewEdges(wait, input))]
  return [...declared, ...ownerEdge(declared, input)]
}

/** Every simple cycle once: a cycle is walked from its smallest key, through keys larger than it only. */
function cyclesOf(edges: readonly WaitEdge[]): WaitEdge[][] {
  const found: WaitEdge[][] = []
  const starts = [...new Set(edges.map((edge) => keyOf(edge.from)))].sort()
  const walk = (start: string, at: string, path: WaitEdge[]): void => {
    for (const edge of edges.filter((each) => keyOf(each.from) === at)) {
      const next = keyOf(edge.to)
      if (next === start) found.push([...path, edge])
      else if (next > start && !path.some((step) => keyOf(step.from) === next)) walk(start, next, [...path, edge])
    }
  }
  for (const start of starts) walk(start, start, [])
  return found
}

const latest = (edges: readonly WaitEdge[]): number => Math.max(...edges.map((edge) => edge.since))

const holds = (edges: readonly WaitEdge[], name: string): boolean => edges.some((edge) => named(edge.from, name) || named(edge.to, name))

/**
 * Who must act on a cycle: the one whose wait closed it last, which began waiting on someone already waiting on it. A
 * cycle through the owner or through the receiver is the receiver's whoever closed it: a member cannot deliver what the
 * receiver itself holds, and the owner's edge stands for a row the owner was never given.
 */
function cycleDeadlock(cycle: readonly WaitEdge[], input: NudgeInput): Deadlock {
  const receiver = theOneReceiver(input.receivers)
  const holds_receiver = receiver !== '' && holds(cycle, receiver)
  const acted = [receiver, input.owner].filter((name) => name !== '').find((name) => cycle.some((edge) => named(edge.from, name)))
  const closer = [...cycle].sort((one, two) => two.since - one.since)[0] as WaitEdge
  const must_act = acted ?? closer.from
  const waited = cycle.find((edge) => named(edge.to, must_act))
  const what = waited === undefined || waited.what === '' ? 'what it waits for' : waited.what
  return {
    kind: 'cycle',
    edges: cycle,
    must_act,
    act: `deliver ${what} to ${waited?.from ?? must_act}`,
    since: latest(cycle),
    holds_receiver,
  }
}

/** Why a member cannot answer a wait, or '' when it can: it is parked, its row has gone quiet, or it has stalled. */
function unableBecause(name: string, input: NudgeInput, stalled: ReadonlySet<string>): string {
  if (named(name, input.owner)) return ''
  const row = rowOf(name, input.rows)
  if (row === undefined) return input.receivers.some((receiver) => named(receiver, name)) ? 'has no row' : ''
  if (parked(row, input) && !atWork(row, input)) return 'is parked'
  if (quiet(row, input.now)) return 'is quiet'
  return stalled.has(keyOf(name)) ? 'has stalled' : ''
}

/** Every edge that leads, in any number of steps, to the member at the end. */
function chainInto(end: string, edges: readonly WaitEdge[]): WaitEdge[] {
  const reached = new Set([keyOf(end)])
  const chain: WaitEdge[] = []
  for (let grew = true; grew; ) {
    const more = edges.filter((edge) => reached.has(keyOf(edge.to)) && !chain.includes(edge))
    grew = more.length > 0
    for (const edge of more) {
      chain.push(edge)
      reached.add(keyOf(edge.from))
    }
  }
  return chain
}

/** Who must act on a chain that ends at a member who cannot answer: the member itself when it has only stalled, and
 * otherwise whoever can wake it — the receiver, or the owner when what is asleep is the receiver. */
function deadEndDeadlock(end: string, why: string, chain: readonly WaitEdge[], input: NudgeInput): Deadlock {
  const receiver = theOneReceiver(input.receivers)
  const isTheReceiver = receiver !== '' && named(end, receiver)
  const must_act = why === 'has stalled' ? end : isTheReceiver ? input.owner : (receiver || input.owner)
  const waited_on = chain.filter((edge) => named(edge.to, end)).map((edge) => edge.from).join(', ')
  const act = why === 'has stalled' ? `report progress or answer ${waited_on}` : `bring ${end} back, or move the waits on it`
  return {
    kind: 'dead-end',
    edges: chain,
    must_act,
    act: `${act} (${end} ${why})`,
    since: latest(chain),
    holds_receiver: receiver !== '' && (isTheReceiver || holds(chain, receiver)),
  }
}

/** Members that have said they are busy and have not moved for the stall window: the ends a chain must not run into. */
const stalledMembers = (input: NudgeInput): ReadonlySet<string> =>
  new Set(
    input.rows
      .filter((row) => (BUSY as readonly string[]).includes(row.state) && !quiet(row, input.now) && !parked(row, input) && input.now - lastSaidAt(row) >= input.windows.stalled_ms)
      .map((row) => keyOf(row.member)),
  )

function deadEndsOf(edges: readonly WaitEdge[], input: NudgeInput): Deadlock[] {
  const stalled = stalledMembers(input)
  return [...new Set(edges.map((edge) => edge.to))].flatMap((end) => {
    const why = unableBecause(end, input, stalled)
    return why === '' ? [] : [deadEndDeadlock(end, why, chainInto(end, edges), input)]
  })
}

const sameWait = (one: WaitEdge, other: WaitEdge): boolean => named(one.from, other.from) && named(one.to, other.to)

/** One deadlock for one situation (#492): a stalled member inside a cycle produced the cycle and a chain that ended at
 * that same member, so the pane drew the same waits twice. The cycles are read first, so the whole thing is the one kept. */
const onePerSituation = (found: readonly Deadlock[]): Deadlock[] =>
  found.filter((deadlock, at) => !found.slice(0, at).some((earlier) => earlier.edges.some((edge) => deadlock.edges.some((other) => sameWait(edge, other)))))

/** Every deadlock the crew's rows and review waits hold, cycles first. */
export function deadlocksOf(input: NudgeInput): readonly Deadlock[] {
  const edges = waitEdgesOf(input)
  return onePerSituation([...cyclesOf(edges).map((cycle) => cycleDeadlock(cycle, input)), ...deadEndsOf(edges, input)])
}

/** Each deadlock as a nudge, with no window: it names the member who must act, and no package. */
export const deadlockNudges = (input: NudgeInput): readonly Nudge[] =>
  deadlocksOf(input).map((deadlock) => ({ kind: 'deadlock' as const, member: deadlock.must_act, package: '', since: deadlock.since }))
