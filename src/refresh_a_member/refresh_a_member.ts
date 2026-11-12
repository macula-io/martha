// The refresh flow: a member hands over, is cleared, and resumes on the same package (martha#255).
//
// This exists so a member that has filled its context — or that a crew wants off a large context — does not take the
// crew down with it: it writes its handover, the launcher clears the session and the successor comes back on the work,
// with no hand work by the owner.
//
// One owner of the flow, and it is here, in the core: the mod that runs in the member's session reports what only that
// session knows (its context, the turn's own last answer) and runs `/clear` when this says so, and decides nothing.
// The four phases and their ends are the gated design's: due, handing over, clearing, and — as ends — declined and
// abandoned. A flow is kept in the crew's own store, one file per member, because it must outlive the session it is
// about: a clear replaces the session, and a flow remembered only in one would be forgotten exactly when it matters.
//
// Every threshold is measured from where THIS session began, never from zero (martha#255 design, martha#470): a session
// resumes at the share its predecessor reached, so a threshold measured from zero asks again on the first free report,
// clears, and resumes into the same size — the loop that started dozens of sessions in minutes with no work done.

import type { CrewPlace, CrewStore, HandoverStamp, Refused } from '../host_contract/host_contract.ts'
import { CREW_HANDOVER_WRITTEN, CREW_REFRESH_DECLINED, WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'

/** Where a crew keeps its flows, under the one crew store. */
export const REFRESHES_PLACE = 'refresh'

/** The percent of its limit past which a member hands over, whatever any switch says. */
export const HANDOVER_LIMIT_PERCENT = 70

/**
 * The margin above the share a session began at, and above the share a decline was taken at: a member is not asked
 * again until it has grown this far past either. One number for both, so #470's rule is one comparison wherever it is
 * applied.
 */
export const REFRESH_MARGIN_PERCENT = 10

/** Two refreshes of one member inside this window are a storm, and a storm is parked, not refused. */
export const STORM_WINDOW_MS = 30 * 60_000

/** How many refreshes inside the window are a storm. */
export const STORM_THRESHOLD = 2

/** How long a flow may sit in one phase before it is abandoned, once, with the reason on the row. */
export const FLOW_WINDOW_MS = 30 * 60_000

/** What started a flow: the limit always, a finished task when the crew switched it on, or someone asking. */
export type RefreshTrigger = 'at_the_limit' | 'after_a_task' | 'asked'

/** Where a flow is. `declined` and `abandoned` are its ends; `clearing` is the clear that was told to the mod. */
export type RefreshPhase = 'handing_over' | 'declined' | 'clearing' | 'abandoned'

/** The phases a flow is still running in: the two that hold every later ask back. */
export const LIVE_PHASES: readonly RefreshPhase[] = ['handing_over', 'clearing']

/** Whether a flow is still running: `handing_over` or `clearing`, never one of the ends. */
export function aFlowIsLive(flow: ARefresh | undefined): flow is ARefresh {
  return flow !== undefined && LIVE_PHASES.includes(flow.phase)
}

/**
 * One member's flow, as the crew's store keeps it. Everything the next turn needs to carry on is here, so a launcher
 * that restarted reads the flow rather than a memory of one.
 */
export interface ARefresh {
  readonly phase: RefreshPhase
  readonly trigger: RefreshTrigger
  /** Why, in one line: the owner reads it on the row. Never the member's own words about itself. */
  readonly reason: string
  /** When this phase began, in milliseconds. */
  readonly at: number
  /** When the handover was asked for: a stamp older than this is a handover from an earlier flow. */
  readonly asked_at: number
  /** The report this ask followed, so one finished task is asked once. */
  readonly asked_on: string
  /** How many times the handover was sent back, and what was missing. */
  readonly sent_back: number
  readonly missing: readonly string[]
  /** The share this session began at, and the share the ask (or the decline) was taken at. */
  readonly started_at_percent: number
  readonly percent: number
  /** The session the clear was run in: the predecessor a successor inherits. Empty until the clear is told. */
  readonly clear_from: string
  /** When this member was last refreshed, oldest first: what the storm is counted over. */
  readonly refreshed_at: readonly number[]
  /**
   * Whether the Supervisor has been told about this flow already: one line per flow, and a new flow carries it from a
   * decline, so a member that keeps declining at the limit is not a line per ask (design r=2's "told once").
   */
  readonly told: boolean
}

/** The file one member's flow is kept in: one per member, so two flows never disagree. */
export const theRefreshFile = (member: string): string => `${member}.refresh.json`

/** Where one crew's flows live, `<crew>/refresh`: made when missing, refused when it is not a place to write. */
export function refreshesPlace(host: { readonly stores: { readonly crew: CrewStore } }): CrewPlace | Refused {
  return host.stores.crew.place(REFRESHES_PLACE)
}

/** The member's flow, or undefined when it has none. A file that is not one is a refusal, never read as no flow. */
export function theFlowOf(place: CrewPlace, member: string): ARefresh | undefined | Refused {
  const read = place.read(theRefreshFile(member))
  if (read === undefined) return undefined
  if ('refusal' in read) return read
  try {
    const held: unknown = JSON.parse(read.text)
    return isARefresh(held) ? held : unreadableFlow(member)
  } catch {
    return unreadableFlow(member)
  }
}

/** Keeps the member's flow whole, or says why it could not. */
export function keepTheFlow(place: CrewPlace, member: string, flow: ARefresh): Refused | undefined {
  return place.keep(theRefreshFile(member), `${JSON.stringify(flow)}\n`)
}

const unreadableFlow = (member: string): Refused => ({ refusal: `${theRefreshFile(member)} is not a flow this launcher reads` })

/** Every field a flow is read by, each checked on its own: a file missing one of them is not a flow. */
const FLOW_FIELDS: readonly ((flow: Record<string, unknown>) => boolean)[] = [
  (flow) => typeof flow['phase'] === 'string',
  (flow) => typeof flow['trigger'] === 'string',
  (flow) => typeof flow['reason'] === 'string',
  (flow) => typeof flow['at'] === 'number',
  (flow) => typeof flow['asked_at'] === 'number',
  (flow) => typeof flow['asked_on'] === 'string',
  (flow) => typeof flow['sent_back'] === 'number',
  (flow) => Array.isArray(flow['missing']),
  (flow) => typeof flow['started_at_percent'] === 'number',
  (flow) => typeof flow['percent'] === 'number',
  (flow) => typeof flow['clear_from'] === 'string',
  (flow) => Array.isArray(flow['refreshed_at']),
  (flow) => typeof flow['told'] === 'boolean',
]

/** True when `value` is a flow this launcher wrote, every field of it. */
function isARefresh(value: unknown): value is ARefresh {
  if (typeof value !== 'object' || value === null) return false
  const flow = value as Record<string, unknown>
  return FLOW_FIELDS.every((holds) => holds(flow))
}

/** A flow beginning: the trigger, the share this session began at, and the share it was taken at. */
export function aFlowStarting(starting: {
  readonly trigger: RefreshTrigger
  readonly reason: string
  readonly at: number
  readonly started_at_percent: number
  readonly percent: number
  readonly asked_on: string
  readonly refreshed_at: readonly number[]
  /** Whether the Supervisor was already told, which a flow begun after a decline carries (see `told`). */
  readonly told?: boolean
}): ARefresh {
  return {
    phase: 'handing_over',
    trigger: starting.trigger,
    reason: starting.reason,
    at: starting.at,
    asked_at: starting.at,
    asked_on: starting.asked_on,
    sent_back: 0,
    missing: [],
    started_at_percent: starting.started_at_percent,
    percent: starting.percent,
    clear_from: '',
    refreshed_at: starting.refreshed_at,
    told: starting.told === true,
  }
}

/** What the session says about itself at a turn's end, and what the launcher already knows about it. */
export interface TheSessionsReading {
  /** The member's context as a share of its limit, as the host reports it. */
  readonly percent: number
  /** The share this session began at: the reference every threshold here is measured from. */
  readonly started_at_percent: number
  /** The report this turn finished, named as the row names it: '' when it finished none. */
  readonly finished_report: string
  /** Whether the declaration switched the after-a-task trigger on. */
  readonly refresh_between_tasks: boolean
  /** Whether the member is parked: a parked member is not refreshed between tasks. */
  readonly parked: boolean
  /** Whether someone asked for this refresh: the owner's or the Supervisor's word, which is never declined. */
  readonly asked: boolean
  /** The flow as it stands, undefined when none has run. */
  readonly flow: ARefresh | undefined
}

/** Whether a refresh is due, and what started it — or why none is. */
export type Due = { readonly due: true; readonly trigger: RefreshTrigger } | { readonly due: false; readonly why: string }

/**
 * Whether this session should hand over now, in the order the design checks: a flow still running holds every other
 * ask back; then the limit, because it is not a setting; then someone's word, which a parked member still answers;
 * then a finished task, when the crew switched that on; and a decline holds the after-a-task ask back until the member
 * has finished another task and grown past the share it declined at.
 */
export function aRefreshIsDue(reading: TheSessionsReading): Due {
  const running = heldByARunningFlow(reading.flow)
  if (running !== undefined) return running
  if (reading.asked) return { due: true, trigger: 'asked' }
  return heldByItsLastAsk(reading) ?? heldByWhereItBegan(reading) ?? atTheLimitOrAfterATask(reading)
}

/** A flow still running holds every later ask back, whatever else would have asked. */
function heldByARunningFlow(flow: ARefresh | undefined): Due | undefined {
  if (!aFlowIsLive(flow)) return undefined
  return { due: false, why: `its flow is ${flow.phase}` }
}

/**
 * The member's last flow, whatever its end, holds two asks back: one finished task is asked once, and a decline is
 * measured exactly as an ask is.
 *
 * - The finished report the flow asked on is the row's own finished report, and the flow file outlives the clear, so a
 *   successor is not asked to hand over again on the work its predecessor was already asked about (#470's loop, caught
 *   at the ask rather than at the clear). The report is named by its task, which no row write changes and only another
 *   report can replace; a second report on the same task is the task it was already asked about (design test 12).
 * - A decline is held until another task finishes past the share it was taken at, plus the same margin every other
 *   threshold uses. Past the limit the limit answers (design §4: "past it, the limit trigger hands over whatever else
 *   says"), and a decline at the limit is asked again once per finished task, which the hold above already gives.
 * - The limit answers over this hold too, because it is not a setting: a session taken past the limit hands over even
 *   on the finished report its flow already asked about. A successor inherits the flow file and the row still names
 *   its predecessor's finished task, so a hold that outlasted the limit would grow a member to 90% and never ask it.
 *   The one flow the limit does not answer over is a decline taken at the limit: that hold is the at-limit rule's one
 *   ask per finished turn, and a decline is measured exactly as an ask is.
 */
function heldByItsLastAsk(reading: TheSessionsReading): Due | undefined {
  const flow = reading.flow
  if (flow === undefined) return undefined
  const belowTheLimitOrADeclineAtIt = reading.percent < HANDOVER_LIMIT_PERCENT || aDeclineTakenAtTheLimit(flow)
  if (reading.finished_report !== '' && flow.asked_on === reading.finished_report && belowTheLimitOrADeclineAtIt) {
    return { due: false, why: flow.phase === 'declined' ? 'it declined on this task' : 'this task was already asked about' }
  }
  const measuredFromItsDecline = flow.phase === 'declined' && flow.trigger === 'after_a_task'
  if (measuredFromItsDecline && reading.percent < HANDOVER_LIMIT_PERCENT && reading.percent < flow.percent + REFRESH_MARGIN_PERCENT) {
    return { due: false, why: 'it has not grown past the share it declined at' }
  }
  return undefined
}

/** Whether the flow was declined at a share at or past the limit: the one hold the limit does not answer over. */
function aDeclineTakenAtTheLimit(flow: ARefresh): boolean {
  return flow.phase === 'declined' && flow.percent >= HANDOVER_LIMIT_PERCENT
}

/** The one comparison both thresholds are measured by: a session that began at 75% is not refreshed into the same 75%. */
function heldByWhereItBegan(reading: TheSessionsReading): Due | undefined {
  if (reading.percent < reading.started_at_percent + REFRESH_MARGIN_PERCENT) {
    return { due: false, why: 'it has not grown past the share this session began at' }
  }
  return undefined
}

/** The limit first, because it is not a setting; then a finished task, when the crew switched that trigger on. */
function atTheLimitOrAfterATask(reading: TheSessionsReading): Due {
  if (reading.percent >= HANDOVER_LIMIT_PERCENT) return { due: true, trigger: 'at_the_limit' }
  if (reading.parked) return { due: false, why: 'it is parked' }
  if (!reading.refresh_between_tasks) return { due: false, why: 'the crew did not switch the after-a-task trigger on' }
  if (reading.finished_report === '') return { due: false, why: 'it finished no task' }
  return { due: true, trigger: 'after_a_task' }
}

/** Whether a trigger may be declined: the two automatic ones may, and a refresh someone asked for never may. */
export function aDeclineIsAllowed(trigger: RefreshTrigger): boolean {
  return trigger === 'at_the_limit' || trigger === 'after_a_task'
}

/** The grounds a member may give, in the practice's own words, so the line it writes is the line the design names. */
export const DECLINE_GROUNDS = [
  'an approved range it has not pushed yet, or a push or tag ask it is still waiting on',
  'a change in hand',
  'a reply it must act on',
] as const

/** The ground an at-limit decline may give: the only one the design allows there. */
export const THE_LIMIT_GROUND = 'it cannot reach a safe point at all'

/**
 * The prompt a member is asked to hand over with. The file is the host's and the member is told no path: the tool
 * writes it where the launcher decided, and a path in a prompt would be a second place a handover could come from.
 */
export function theHandoverPrompt(asking: { readonly at_limit: boolean; readonly percent: number }): string {
  const first = asking.at_limit
    ? [
        `Your context is at ${asking.percent}%, past the ${HANDOVER_LIMIT_PERCENT}% handover limit, so this session hands over to a fresh one.`,
        'First reach a safe point: finish the edit you are in, then commit or stash the work so the working tree is clean.',
        'If an approved push has not been made yet, make it first: the yes is for that exact sha.',
      ]
    : [
        'Your task is done and your context is large, so this session will be cleared and restarted from a handover.',
        'First decide whether that is safe.',
      ]
  const grounds = asking.at_limit ? `Only if ${THE_LIMIT_GROUND},` : `If ${DECLINE_GROUNDS.join('; ')},`
  return [
    ...first,
    `${grounds} answer exactly ${CREW_REFRESH_DECLINED} and one line saying which ground it is.`,
    `Otherwise write your handover with the ${WRITE_MY_HANDOVER_TOOL} tool, in the shape the practice gives: first rules;`,
    'what runs; open items in order; pending decisions; gotchas; and one line for each package your row says you hold,',
    `carrying its branch and tip sha or "nothing committed". Then answer exactly ${CREW_HANDOVER_WRITTEN}.`,
  ].join(' ')
}

/** The note a handover that missed something is sent back with: what was missing, and the word to answer with. */
export function theSendBackNote(missing: readonly string[]): string {
  return (
    `Your handover is not accepted yet: ${missing.join('; ')}. Write it again with the ${WRITE_MY_HANDOVER_TOOL} tool, ` +
    `then answer exactly ${CREW_HANDOVER_WRITTEN}.`
  )
}

/**
 * What became of the handover a member says it wrote: accepted, sent back once with what was missing, or — at the
 * limit, and on a second miss — cleared anyway, because a clear that never happens is worse than an imperfect
 * handover. The stamp is the host's, so a file written before this flow asked is never taken for this flow's work.
 */
export type HandoverVerdict =
  | { readonly kind: 'accepted'; readonly missing: readonly string[] }
  | { readonly kind: 'not_written'; readonly why: string }
  | { readonly kind: 'sent_back'; readonly missing: readonly string[] }
  | { readonly kind: 'cleared_anyway'; readonly missing: readonly string[] }

/** What a handover is judged on: the host's stamp for the file, the file's text, and what the member's row holds. */
export interface TheHandoverRead {
  readonly stamp: HandoverStamp | Refused | undefined
  readonly text: string
  readonly asked_at: number
  /** The packages the member's row says it holds. */
  readonly holds: readonly string[]
  /** How many times this flow has already sent one back. */
  readonly sent_back: number
  readonly at_limit: boolean
}

/** Every package line a handover is missing, in the order the row names the packages. */
export function packagesMissingFrom(text: string, holds: readonly string[]): readonly string[] {
  return holds.filter((held) => !text.includes(held)).map((held) => `no line naming ${held}`)
}

/** Whether the handover was written after this flow asked for it, by the host's stamp. */
function writtenAfterAsking(stamp: HandoverStamp | Refused | undefined, asked_at: number): stamp is HandoverStamp {
  if (stamp === undefined || 'refusal' in stamp) return false
  const written = Date.parse(stamp.written_at)
  return Number.isFinite(written) && written >= asked_at
}

/** What the answer to a handover ask means for the flow. */
export function whatBecameOfTheHandover(reading: TheHandoverRead): HandoverVerdict {
  if (reading.stamp === undefined) return { kind: 'not_written', why: 'this session has written no handover' }
  if ('refusal' in reading.stamp) return { kind: 'not_written', why: reading.stamp.refusal }
  if (!writtenAfterAsking(reading.stamp, reading.asked_at)) {
    return { kind: 'not_written', why: 'the handover was written before this session was asked for one' }
  }
  const missing = packagesMissingFrom(reading.text, reading.holds)
  if (missing.length === 0) return { kind: 'accepted', missing }
  // At the limit a clear cannot wait, and a second miss clears anyway: the row says what was missing either way.
  if (reading.at_limit || reading.sent_back >= 1) return { kind: 'cleared_anyway', missing }
  return { kind: 'sent_back', missing }
}

/**
 * The prompt the successor resumes on: its handover's file, and the acts of its package that were sent and never
 * concluded — so it checks them instead of sending them twice (martha#254's read). The file is named, never quoted.
 */
export function theResumePrompt(resuming: { readonly member: string; readonly file: string; readonly acts: readonly string[] }): string {
  const acts =
    resuming.acts.length === 0
      ? ''
      : ` Before you send anything again, check what became of these acts of your package, which were sent and never concluded: ${resuming.acts.join('; ')}.`
  return (
    `You are ${resuming.member}. Martha just refreshed this session. Read your handover at ${resuming.file}: it is what ` +
    `your predecessor left you, and it is the only place your work stands. Then carry on with the packages it names.${acts}`
  )
}

/** Whether a flow has sat in its phase past the window: a prompt that never ran, or a member that never answered. */
export function aFlowStalled(flow: ARefresh, now: number): boolean {
  return now - flow.at >= FLOW_WINDOW_MS
}

/** Whether this refresh is one too many inside the window: a storm, parked rather than refused. */
export function isAStorm(refreshed_at: readonly number[], now: number): boolean {
  const inside = refreshed_at.filter((at) => now - at < STORM_WINDOW_MS)
  return inside.length + 1 >= STORM_THRESHOLD
}

/** The line a storm sends the Supervisor, once: which member, at which contexts, from which handover. */
export function theStormLine(storm: { readonly member: string; readonly percents: readonly number[]; readonly file: string }): string {
  const minutes = Math.round(STORM_WINDOW_MS / 60_000)
  return (
    `${storm.member} was parked after ${storm.percents.length} refreshes inside ${minutes} minutes ` +
    `(at ${storm.percents.join('%, ')}%), the last from ${storm.file}. It stays parked until the owner or the Supervisor wakes it.`
  )
}

/**
 * The line a decline at the limit sends the Supervisor, once: the member is past the limit, has not handed over, and
 * says why it cannot. Sent as the storm's is, so the Supervisor hears it without watching the dashboard.
 */
export function theLimitLine(refusal: { readonly member: string; readonly percent: number; readonly said: string }): string {
  return (
    `${refusal.member} is at ${refusal.percent}% of its context, past the ${HANDOVER_LIMIT_PERCENT}% handover limit, and has not handed over: ` +
    `it declined at the limit, saying ${refusal.said}. It is asked again when it finishes a task.`
  )
}

/** The line a refresh someone asked for that ends abandoned sends the Supervisor, once. */
export function theAskedLine(refusal: { readonly member: string; readonly why: string }): string {
  return (
    `${refusal.member} was asked to refresh and could not hand over: ${refusal.why}. ` +
    'The flow is abandoned with that reason on its row, and that instruction asks nothing more of it.'
  )
}

/** The flow as the phase its send-back leaves it in: asked again, with what was missing kept for the row. */
export function theFlowSentBack(flow: ARefresh, missing: readonly string[], at: number): ARefresh {
  return { ...flow, phase: 'handing_over', at, asked_at: at, sent_back: flow.sent_back + 1, missing }
}

/** The flow a decline ends, with the member's own ground as its reason. */
export function theFlowDeclined(flow: ARefresh, ground: string, at: number): ARefresh {
  return { ...flow, phase: 'declined', at, reason: ground }
}

/** The flow once the clear has been told to the mod: the session it was told in is the predecessor to inherit. */
export function theFlowClearing(flow: ARefresh, clear_from: string, missing: readonly string[], at: number): ARefresh {
  return { ...flow, phase: 'clearing', at, clear_from, missing }
}

/** The flow an unanswered ask ends: abandoned once, with the reason the owner reads. */
export function theFlowAbandoned(flow: ARefresh, why: string, at: number): ARefresh {
  return { ...flow, phase: 'abandoned', at, reason: why }
}
