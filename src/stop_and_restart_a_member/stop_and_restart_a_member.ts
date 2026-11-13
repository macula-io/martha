// Stopping a running member, asked of the launcher that holds it (martha#312).
//
// This exists so the owner can stop a member from any terminal, and the member's session ends the way a member's
// session always ends: through the launcher holding the owner's terminal, which alone may start it again (martha#98).
// So a stop is a REQUEST to that launcher, never a kill from outside: one file per member in the crew's own store,
// written whole, that the launcher reads on its own tick, acts on once by its id, and answers under the same id.
//
// A request names the launch it is for — the member's pid and the identity the kernel gave that process — so a request
// left over from an earlier launch never ends a later one, and a launcher acts only on a request for its own member.
//
// When no launcher answers by the deadline, the member outlived its launcher (leftover_relay_directories admits that
// can happen), and the owner's verb ends the recorded group itself: asked to end, a grace, then made to. Each signal
// goes through `processes.signalGroup`, which refuses once the pid names another process: crew-code's reused-pid rule,
// with the check and the signal in one call.
//
// Whoever ends the member keeps the ledger's row: `member_stopped`, with who asked and why, in the crew's lifecycle
// stream. The core reads no disk: the crew place, the launches, the rows and the processes are the host's.

import type { CrewPlace, Processes, Refused, RowStore } from '../host_contract/host_contract.ts'
import type { MemberLaunch } from '../attribute_a_cross_session_sender/attribute_a_cross_session_sender.ts'

/** Where a crew keeps its members' lifecycle requests, under the one crew store. */
export const LIFECYCLE_PLACE = 'lifecycle'

/** One request file per member, so two requests never disagree about whose they are. */
export const theRequestFile = (member: string): string => `${member}.json`

/** The crew's stream of members stopped and restarted, apart from any package's ledger: a stop is no package's act. */
export const LIFECYCLE_STREAM = 'member_lifecycle'

/** The ledger's word for a member whose session was ended. */
export const MEMBER_STOPPED = 'member_stopped'

/** The ledger's word for a member whose session was ended and started again (../restart_a_member). */
export const MEMBER_RESTARTED = 'member_restarted'

/** What a member is asked to do: end, or end and start again on its own terminal (martha#312). */
export const STOP = 'stop'
export const RESTART = 'restart'
export type LifecycleAct = typeof STOP | typeof RESTART
const LIFECYCLE_ACTS: readonly LifecycleAct[] = [STOP, RESTART]

/** How long a member's group has, once asked to end, before it is made to: crew-code's grace. */
export const STOP_GRACE_MS = 10_000

/** How long the owner's verb waits for the launcher's answer: the launcher's own grace, and as long again for its tick and its cleanup. */
export const ANSWER_DEADLINE_MS = 2 * STOP_GRACE_MS

/**
 * How long a restart's asker waits for the launcher's answer: crew-code's `crew_restart` deadline. A restart is answered
 * only once the member is started again, so it waits for the end and for a whole launch, and a launch prepares a tree.
 */
export const RESTART_ANSWER_DEADLINE_MS = 120_000

/** How long a request of each act waits for its launcher before the asker stops waiting. */
export const ANSWER_DEADLINE_OF: Readonly<Record<LifecycleAct, number>> = { [STOP]: ANSWER_DEADLINE_MS, [RESTART]: RESTART_ANSWER_DEADLINE_MS }

/** How often the owner's verb looks for an answer, and for a group to be gone. */
export const ANSWER_POLL_MS = 250

/**
 * How long a launcher has, once its member's process is gone, to write its answer: its own cleanup. Past it, the verb
 * stops waiting and records the end itself (r=1 R1), rather than waiting out the whole deadline for a member that ended.
 */
export const ANSWER_AFTER_EXIT_MS = 2_000

/** Which launch a request is for: the member's process, and the identity the kernel gave it. */
export interface TheLaunch {
  readonly pid: number
  readonly process_started_at: string
}

/** A request to a member's launcher. */
export interface LifecycleRequest {
  readonly id: string
  readonly act: LifecycleAct
  /** A restart that starts the member with no handover; always false for a stop. */
  readonly fresh: boolean
  readonly by: string
  readonly reason: string
  /** When it was asked, as an ISO time. */
  readonly at: string
  readonly launch: TheLaunch
}

/**
 * Who ended the member: its launcher, the owner's verb because no launcher answered, or the member itself, gone before
 * either acted (r=1 R1: a member that exits inside the launcher's tick is stopped, not a refusal).
 */
export type EndedBy = 'launcher' | 'owner_verb' | 'itself'
const ENDED_BY: readonly EndedBy[] = ['launcher', 'owner_verb', 'itself']

/** What became of a request. */
export interface LifecycleOutcome {
  readonly id: string
  readonly ended_by: EndedBy
  readonly at: string
  /** A restart's start: whether the member is running again, or why it is not. A stop carries none. */
  readonly restarted?: { readonly started: true } | { readonly started: false; readonly refusal: string }
  /** A restart that ended a member whose row read working: its turn is lost, so the asker knows to send it again. */
  readonly mid_turn?: boolean
}

/** A member's request as the store holds it: none, waiting for its launcher, answered, or a file nobody can read. */
export type TheRequest =
  | { readonly kind: 'none' }
  | { readonly kind: 'pending'; readonly request: LifecycleRequest }
  | { readonly kind: 'answered'; readonly request: LifecycleRequest; readonly outcome: LifecycleOutcome }
  | { readonly kind: 'unreadable'; readonly refusal: string }

/** The crew's lifecycle place, made when missing; or why it may not be used. */
export type LifecycleStores = { readonly lifecycle: CrewPlace | Refused }

/** A member's request: read whole, or `unreadable`, because a guess at a request decides whether a member is ended. */
export function theRequestOf(place: CrewPlace, member: string): TheRequest {
  const read = place.read(theRequestFile(member))
  if (read === undefined) return { kind: 'none' }
  if ('refusal' in read) return { kind: 'unreadable', refusal: read.refusal }
  const held = heldIn(read.text)
  if (held === undefined) return { kind: 'unreadable', refusal: `${place.path}/${theRequestFile(member)} holds no lifecycle request, so Martha cannot say what was asked of ${member}.` }
  return held.outcome === null ? { kind: 'pending', request: held.request } : { kind: 'answered', request: held.request, outcome: held.outcome }
}

function heldIn(text: string): { readonly request: LifecycleRequest; readonly outcome: LifecycleOutcome | null } | undefined {
  let held: unknown
  try {
    held = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isObject(held) || !isRequest(held['request'])) return undefined
  const outcome = held['outcome']
  if (outcome === null) return { request: held['request'], outcome: null }
  return isOutcome(outcome) ? { request: held['request'], outcome } : undefined
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function isRequest(value: unknown): value is LifecycleRequest {
  if (!isObject(value) || !isObject(value['launch'])) return false
  const { id, act, by, reason, at } = value
  const { pid, process_started_at } = value['launch']
  const strings = [id, by, reason, at, process_started_at].every((field) => typeof field === 'string')
  return strings && LIFECYCLE_ACTS.includes(act as LifecycleAct) && typeof value['fresh'] === 'boolean' && typeof pid === 'number'
}

function isOutcome(value: unknown): value is LifecycleOutcome {
  if (!isObject(value)) return false
  const { id, ended_by, at, restarted, mid_turn } = value
  const kept = typeof id === 'string' && typeof at === 'string' && ENDED_BY.includes(ended_by as EndedBy)
  return kept && (restarted === undefined || isRestarted(restarted)) && (mid_turn === undefined || typeof mid_turn === 'boolean')
}

function isRestarted(value: unknown): boolean {
  if (!isObject(value)) return false
  return value['started'] === true || (value['started'] === false && typeof value['refusal'] === 'string')
}

/**
 * Answers `request` once: when the file already holds an answer to this id, that answer stands and nothing is written,
 * so a launcher and a verb that both reach the end of one stop keep one outcome and one ledger row between them (r=1
 * observation). Resolves to the answer that stands, and whether it was this caller's.
 */
export function answerOnce(place: CrewPlace, member: string, request: LifecycleRequest, outcome: LifecycleOutcome): { readonly outcome: LifecycleOutcome; readonly ours: boolean } | Refused {
  const read = theRequestOf(place, member)
  if (read.kind === 'answered' && read.outcome.id === request.id) return { outcome: read.outcome, ours: false }
  if (read.kind !== 'pending' || read.request.id !== request.id) return { outcome, ours: false }
  const kept = keepTheRequest(place, member, request, outcome)
  return kept ?? { outcome, ours: true }
}

/** Keeps a member's request, answered or not, whole. */
export function keepTheRequest(place: CrewPlace, member: string, request: LifecycleRequest, outcome: LifecycleOutcome | null): Refused | undefined {
  return place.keep(theRequestFile(member), `${JSON.stringify({ request, outcome })}\n`)
}

/**
 * The launch of `member` that is running now: its record, while the kernel still names the same process at its pid.
 * The records come read by the binder's own reader (`launchesIn`), so a store that cannot vouch for them is no launch.
 */
export function theRunningLaunchOf(launches: readonly MemberLaunch[], processes: Pick<Processes, 'identityOf'>, member: string): MemberLaunch | undefined {
  const launch = launches.find((one) => one.member_name === member)
  return launch !== undefined && processes.identityOf(launch.pid) === launch.process_started_at ? launch : undefined
}

export const sameLaunch = (one: TheLaunch, other: TheLaunch): boolean => one.pid === other.pid && one.process_started_at === other.process_started_at

/** A request no launcher answered by its act's deadline: its launcher is gone, or is not reading. */
export const isUnanswered = (request: LifecycleRequest, now: number): boolean => now - Date.parse(request.at) > ANSWER_DEADLINE_OF[request.act]

/** The ledger's row for a member that was ended. */
export async function keepTheStop(rows: RowStore, member: string, request: LifecycleRequest, outcome: LifecycleOutcome): Promise<void> {
  await rows.append(LIFECYCLE_STREAM, { event: MEMBER_STOPPED, member, by: request.by, reason: request.reason, id: request.id, ended_by: outcome.ended_by, at: outcome.at })
}

// --- the owner's verb ---------------------------------------------------------------------------------------------

/** What the owner's verb needs of a host. */
export interface StoppingHost {
  readonly stores: LifecycleStores & { readonly rows: RowStore }
  /** The launcher's records as `launchesIn` reads them, read afresh on every call. */
  launches(): readonly MemberLaunch[]
  readonly processes: Pick<Processes, 'identityOf' | 'signalGroup'>
  readonly clock: { now(): number }
  wait(ms: number): Promise<void>
}

/** A stop someone asked for. */
export interface AskingToStop {
  readonly member: string
  readonly by: string
  readonly reason: string
  readonly id: string
}

/** What came of the owner's stop: each told in the words the owner reads. */
export type Stopped =
  | { readonly kind: 'stopped'; readonly ended_by: EndedBy; readonly told: string }
  | { readonly kind: 'not_running'; readonly told: string }
  | { readonly kind: 'in_flight'; readonly told: string }
  | { readonly kind: 'refused'; readonly told: string }

/**
 * Stops `member`: the request kept for its launcher, its answer waited for, and, when no launcher answers by the
 * deadline, the recorded group ended here while it is still the recorded process. A member that is not running is
 * said to be so, and nothing is asked.
 */
export async function stopAMember(host: StoppingHost, asking: AskingToStop): Promise<Stopped> {
  const { member } = asking
  if ('refusal' in host.stores.lifecycle) return { kind: 'refused', told: host.stores.lifecycle.refusal }
  const place = host.stores.lifecycle
  const launch = theRunningLaunchOf(host.launches(), host.processes, member)
  if (launch === undefined) return { kind: 'not_running', told: `${member} is not running, so nothing was stopped.` }
  const held = whatHoldsTheStop(place, member, launch, host.clock.now())
  if (held !== undefined) return held
  const request: LifecycleRequest = {
    id: asking.id,
    act: STOP,
    fresh: false,
    by: asking.by,
    reason: asking.reason,
    at: new Date(host.clock.now()).toISOString(),
    launch: { pid: launch.pid, process_started_at: launch.process_started_at },
  }
  const kept = keepTheRequest(place, member, request, null)
  if (kept !== undefined) return { kind: 'refused', told: kept.refusal }
  const heard = await theLaunchersAnswer(host, place, member, request)
  if ('outcome' in heard) return { kind: 'stopped', ended_by: heard.outcome.ended_by, told: `${member} is stopped.` }
  if (heard.gone) return theEndKeptHere(host, place, member, request, 'itself')
  return endTheGroupHere(host, place, member, request)
}

/** Why a new stop may not be asked: a request nobody can read, or one for this launch still waiting for its launcher. */
export function whatHoldsTheStop(place: CrewPlace, member: string, launch: TheLaunch, now: number): Extract<Stopped, { readonly kind: 'in_flight' | 'refused' }> | undefined {
  const current = theRequestOf(place, member)
  if (current.kind === 'unreadable') return { kind: 'refused', told: current.refusal }
  if (current.kind !== 'pending' || !sameLaunch(current.request.launch, launch) || isUnanswered(current.request, now)) return undefined
  return { kind: 'in_flight', told: `a ${current.request.act} of ${member} asked by ${current.request.by} at ${current.request.at} is in flight.` }
}

const isStillTheRecorded = (host: Pick<StoppingHost, 'processes'>, launch: TheLaunch): boolean => host.processes.identityOf(launch.pid) === launch.process_started_at

/**
 * The launcher's answer to `request`, waited for until the deadline. A member whose process is gone is waited on only for
 * ANSWER_AFTER_EXIT_MS more, its launcher's cleanup, and then reported `gone` (r=1 R1); silence past the deadline with the
 * process still there is `silent`.
 */
async function theLaunchersAnswer(host: StoppingHost, place: CrewPlace, member: string, request: LifecycleRequest): Promise<{ readonly outcome: LifecycleOutcome } | { readonly gone: boolean }> {
  const until = Date.parse(request.at) + ANSWER_DEADLINE_MS
  let goneSince: number | undefined
  while (host.clock.now() <= until) {
    const read = theRequestOf(place, member)
    if (read.kind === 'answered' && read.outcome.id === request.id) return { outcome: read.outcome }
    if (!isStillTheRecorded(host, request.launch)) goneSince ??= host.clock.now()
    if (goneSince !== undefined && host.clock.now() - goneSince >= ANSWER_AFTER_EXIT_MS) return { gone: true }
    await host.wait(ANSWER_POLL_MS)
  }
  return { gone: false }
}

/** The recorded group ended here, since no launcher answered: asked to end, a grace, then made to. A group already gone is a member that ended. */
async function endTheGroupHere(host: StoppingHost, place: CrewPlace, member: string, request: LifecycleRequest): Promise<Stopped> {
  const { pid, process_started_at } = request.launch
  const asked = host.processes.signalGroup(pid, process_started_at, 'SIGTERM')
  if (!asked.signalled) {
    return isStillTheRecorded(host, request.launch) ? { kind: 'refused', told: `no launcher answered for ${member}, and ${asked.refusal}` } : theEndKeptHere(host, place, member, request, 'itself')
  }
  const until = host.clock.now() + STOP_GRACE_MS
  while (host.clock.now() < until && isStillTheRecorded(host, request.launch)) await host.wait(ANSWER_POLL_MS)
  if (isStillTheRecorded(host, request.launch)) {
    const made = host.processes.signalGroup(pid, process_started_at, 'SIGKILL')
    if (!made.signalled && isStillTheRecorded(host, request.launch)) return { kind: 'refused', told: `no launcher answered for ${member}; it was asked to end, and ${made.refusal}` }
  }
  return theEndKeptHere(host, place, member, request, 'owner_verb')
}

/** What the verb tells the owner, by who ended the member. */
const TOLD_WHEN_KEPT_HERE: Readonly<Record<Exclude<EndedBy, 'launcher'>, (member: string) => string>> = {
  owner_verb: (member) => `${member} is stopped; no launcher answered, so Martha ended its process group itself.`,
  itself: (member) => `${member} is stopped; it had ended before its launcher answered, so Martha recorded the stop itself.`,
}

/** The end recorded by the verb, once: the outcome under the request's id, and its ledger row unless a launcher kept it first. */
async function theEndKeptHere(host: StoppingHost, place: CrewPlace, member: string, request: LifecycleRequest, ended_by: Exclude<EndedBy, 'launcher'>): Promise<Stopped> {
  const answered = answerOnce(place, member, request, { id: request.id, ended_by, at: new Date(host.clock.now()).toISOString() })
  if ('refusal' in answered) return { kind: 'refused', told: `${member} was ended, and ${answered.refusal}` }
  if (answered.ours) await keepTheStop(host.stores.rows, member, request, answered.outcome)
  return { kind: 'stopped', ended_by: answered.outcome.ended_by, told: answered.ours ? TOLD_WHEN_KEPT_HERE[ended_by](member) : `${member} is stopped.` }
}

// --- the launcher's watch -----------------------------------------------------------------------------------------

/** What the launcher's watch needs of a host. */
export interface WatchingHost {
  readonly stores: LifecycleStores & { readonly rows: RowStore }
  readonly processes: Pick<Processes, 'signalGroup'>
  readonly clock: { now(): number }
}

/** The member a launcher holds: its launch, how to make it end, and when it has. */
export interface TheHeldMember {
  readonly member: string
  readonly launch: TheLaunch
  /** Ends the member's group now, saying why; the launcher's own stop. */
  stop(why: string): void
  /** Settles once the member has ended and the launch is gone. */
  readonly stopped: Promise<unknown>
  tellOwner(line: string): void
}

/** The request waiting for this launch, if one is: never one left from an earlier launch of the same member. */
function requestForThisLaunch(place: CrewPlace, held: Pick<TheHeldMember, 'member' | 'launch'>): LifecycleRequest | undefined {
  const read = theRequestOf(place, held.member)
  return read.kind === 'pending' && sameLaunch(read.request.launch, held.launch) ? read.request : undefined
}

/** What the owner's terminal is told a member is being, by the act asked of it. */
const BEING: Readonly<Record<LifecycleAct, string>> = { [STOP]: 'stopped', [RESTART]: 'restarted' }

/**
 * Watches `held`'s request every `tick_ms` for as long as it runs, and acts on a stop or a restart for this launch once:
 * the group asked to end, made to after the grace, and, for a stop, the answer and the ledger's row kept once it has
 * ended. A restart's answer waits for the start that follows. Returns what ends
 * the watch; the member ending ends it too.
 */
export function watchForAStop(host: WatchingHost, held: TheHeldMember, tick_ms: number): () => void {
  let acting: LifecycleRequest | undefined
  let grace: NodeJS.Timeout | undefined
  const tick = setInterval(() => {
    if (acting !== undefined || 'refusal' in host.stores.lifecycle) return
    const asked = requestForThisLaunch(host.stores.lifecycle, held)
    if (asked === undefined) return
    acting = asked
    held.tellOwner(`${held.member} is being ${BEING[asked.act]}, asked by ${asked.by}: ${asked.reason}`)
    host.processes.signalGroup(held.launch.pid, held.launch.process_started_at, 'SIGTERM')
    grace = setTimeout(() => held.stop(`asked by ${asked.by}: ${asked.reason}`), STOP_GRACE_MS)
  }, tick_ms)
  const unwatch = (): void => {
    clearInterval(tick)
    clearTimeout(grace)
  }
  void held.stopped.then(async () => {
    unwatch()
    if ('refusal' in host.stores.lifecycle) return
    // A request for this launch that the tick had not yet read when the member ended is answered too (r=1 R1): the
    // member is stopped, by itself, and the verb waiting on it is told so rather than left to its deadline.
    const asked = acting ?? requestForThisLaunch(host.stores.lifecycle, held)
    // A restart is answered by whoever starts the member again (../restart_a_member's holdTheMember), once it has.
    if (asked === undefined || asked.act === RESTART) return
    const outcome: LifecycleOutcome = { id: asked.id, ended_by: acting === undefined ? 'itself' : 'launcher', at: new Date(host.clock.now()).toISOString() }
    const answered = answerOnce(host.stores.lifecycle, held.member, asked, outcome)
    if ('refusal' in answered) return held.tellOwner(`${held.member} was stopped, and ${answered.refusal}`)
    if (!answered.ours) return
    await keepTheStop(host.stores.rows, held.member, asked, outcome).catch((error: unknown) =>
      held.tellOwner(`${held.member} was stopped, and the ledger did not keep it: ${error instanceof Error ? error.message : String(error)}`),
    )
  })
  return unwatch
}
