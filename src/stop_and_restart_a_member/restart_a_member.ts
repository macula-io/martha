// Restarting a member: its session ended and started again in the same terminal, under the same launcher (martha#312).
//
// This exists so the owner and the Supervisor can bring a stalled member back with one act, and the member comes back
// knowing where it was: it starts on the same prompt `martha wake` uses, naming its newest handover, or on none when
// the restart is fresh.
//
// A restart is a request to the member's own launcher, as a stop is (./stop_and_restart_a_member): only the launcher
// holding the owner's terminal may start a member (martha#98). The launcher's watch ends the member exactly as it ends
// one for a stop; what follows is `holdTheMember`, which the launcher runs for as long as it holds the terminal. When
// the member it held ended for a restart asked of that launch, it starts the member again through the same start the
// owner's verb used, so the approval gate runs again and a tree changed since the owner's yes is refused there, on the
// terminal and in the request's answer. The restart is answered once, after that start, and the ledger keeps
// `member_restarted`.
//
// Who may ask: the owner, at a terminal, always. A member, through the tool, only when its role is granted
// `restart_member` in the declaration's table, never for itself, and not twice for one member inside the refresh
// storm window, so two members cannot keep restarting a third.
//
// The core reads no disk: the crew place, the launches, the rows, the dashboard and the start are the host's.

import { OWNER, RESTART_MEMBER } from '../declare_crew/declare_crew.ts'
import type { HandoverStampStore, Processes, Refused, RowStore, TheCrewFilesStores } from '../host_contract/host_contract.ts'
import { theNewestHandover, type TheDeclaration } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { STORM_WINDOW_MS } from '../refresh_a_member/refresh_a_member.ts'
import { STATE_OF_PHASE } from '../report_progress/report_progress.ts'
import { theResumePrompt } from '../wake_a_member/wake_a_member.ts'
import { HANDOVERS_PLACE } from '../write_my_handover/write_my_handover.ts'
import {
  answerOnce,
  keepTheRequest,
  LIFECYCLE_STREAM,
  MEMBER_RESTARTED,
  RESTART,
  RESTART_ANSWER_DEADLINE_MS,
  ANSWER_POLL_MS,
  sameLaunch,
  theRequestOf,
  theRunningLaunchOf,
  whatHoldsTheStop,
  type AskingToStop,
  type LifecycleOutcome,
  type LifecycleRequest,
  type LifecycleStores,
  type StoppingHost,
  type TheLaunch,
} from './stop_and_restart_a_member.ts'

/** A restart someone asked for: a stop's asking, and whether the member starts with no handover. */
export interface AskingToRestart extends AskingToStop {
  readonly fresh: boolean
}

/** What came of a restart: each told in the words the asker reads. */
export type Restarted =
  | { readonly kind: 'restarted'; readonly told: string }
  | { readonly kind: 'not_running'; readonly told: string }
  | { readonly kind: 'in_flight'; readonly told: string }
  | { readonly kind: 'refused'; readonly told: string }

/** What a restart refused at the start says, and what a member that is not running is told to use instead. */
export const notRunningToRestart = (member: string): string =>
  `${member} is not running, so nothing was restarted. martha wake ${member} starts it from its newest handover.`

/** The words for a restart that started the member again. */
function toldRestarted(member: string, request: LifecycleRequest, outcome: LifecycleOutcome): string {
  const on = request.fresh ? 'fresh, with no handover' : 'from its newest handover'
  const lost = outcome.mid_turn === true ? '; it ended mid-turn, so send again what it was working on' : ''
  return `${member} is restarted ${on}${lost}.`
}

/**
 * Restarts `member`: the request kept for its launcher, and its answer waited for until the restart deadline. A launcher
 * that does not answer leaves the member as it is: only that launcher may start it again, so nothing here ends it.
 */
export async function restartAMember(host: StoppingHost, asking: AskingToRestart): Promise<Restarted> {
  const { member } = asking
  if ('refusal' in host.stores.lifecycle) return { kind: 'refused', told: host.stores.lifecycle.refusal }
  const place = host.stores.lifecycle
  const launch = theRunningLaunchOf(host.launches(), host.processes, member)
  if (launch === undefined) return { kind: 'not_running', told: notRunningToRestart(member) }
  const held = whatHoldsTheStop(place, member, launch, host.clock.now())
  if (held !== undefined) return held
  const request: LifecycleRequest = {
    id: asking.id,
    act: RESTART,
    fresh: asking.fresh,
    by: asking.by,
    reason: asking.reason,
    at: new Date(host.clock.now()).toISOString(),
    launch: { pid: launch.pid, process_started_at: launch.process_started_at },
  }
  const kept = keepTheRequest(place, member, request, null)
  if (kept !== undefined) return { kind: 'refused', told: kept.refusal }
  const until = Date.parse(request.at) + RESTART_ANSWER_DEADLINE_MS
  while (host.clock.now() <= until) {
    const read = theRequestOf(place, member)
    if (read.kind === 'answered' && read.outcome.id === request.id) return theRestartAnswered(member, request, read.outcome)
    await host.wait(ANSWER_POLL_MS)
  }
  const seconds = Math.round(RESTART_ANSWER_DEADLINE_MS / 1_000)
  return {
    kind: 'refused',
    told: `no launcher answered the restart of ${member} within ${seconds} s, so it was not restarted from here: only the launcher holding its terminal may start it again. martha stop ${member} ends it, and martha wake ${member} starts it from its newest handover.`,
  }
}

function theRestartAnswered(member: string, request: LifecycleRequest, outcome: LifecycleOutcome): Restarted {
  const started = outcome.restarted
  if (started === undefined || started.started) return { kind: 'restarted', told: toldRestarted(member, request, outcome) }
  return { kind: 'refused', told: `${member} was ended and not started again: ${started.refusal}` }
}

// --- the tool's asker ---------------------------------------------------------------------------------------------

/**
 * Whether `actor`, a member, may restart another through the tool: its role must be granted `restart_member` in the
 * declaration's table. The owner's own verb is the owner's act at their terminal, and never asks this.
 */
export function mayRestartAnother(declaration: TheDeclaration, actor: string): boolean {
  const granted = declaration.mode.may[RESTART_MEMBER] ?? []
  const role = declaration.members.find((one) => one.name === actor)?.role
  return role !== undefined && granted.includes(role)
}

/**
 * The tool restart of `member` the ledger holds inside the storm window, if one is: the refusal that names it. The
 * owner's own restarts are not counted, since the owner's verb is not limited.
 */
export async function aRestartTooSoon(rows: RowStore, member: string, now: number): Promise<string | undefined> {
  let kept: Awaited<ReturnType<RowStore['read']>>
  try {
    kept = await rows.read(LIFECYCLE_STREAM)
  } catch (error) {
    // A ledger that cannot be read cannot say there was no restart inside the window, so none is asked.
    return `the ledger could not be read, so Martha cannot tell whether ${member} was restarted inside the window: ${error instanceof Error ? error.message : String(error)}`
  }
  const restarts = kept
    .map((kept) => kept.row as Record<string, unknown>)
    .filter((row) => row['event'] === MEMBER_RESTARTED && row['member'] === member && row['by'] !== OWNER && typeof row['asked_at'] === 'string')
  const last = restarts.at(-1)
  if (last === undefined) return undefined
  const asked_at = Date.parse(last['asked_at'] as string)
  if (now - asked_at >= STORM_WINDOW_MS) return undefined
  const minutes = Math.round(STORM_WINDOW_MS / 60_000)
  return `${member} was restarted by ${String(last['by'])} at ${String(last['asked_at'])}, inside the last ${minutes} minutes, so it is not restarted again by a tool. The owner's martha restart ${member} is not limited.`
}

/** A member's ask through the tool: who calls, and the declaration that says what that caller's role may do. */
export interface AToolRestart extends AskingToRestart {
  readonly declaration: TheDeclaration
}

/**
 * Restarts `member` as a member asked through the tool: refused, before anything is written, to a caller whose role the
 * table does not grant `restart_member`, to a member restarting itself, to a name the crew does not have, and inside the
 * storm window; otherwise asked as the owner's verb asks it.
 */
export async function restartByTool(host: StoppingHost, asking: AToolRestart): Promise<Restarted> {
  const names = asking.declaration.members.map((one) => one.name)
  if (!mayRestartAnother(asking.declaration, asking.by)) {
    return { kind: 'refused', told: `${asking.by} may not restart a member: the declaration grants ${RESTART_MEMBER} to nobody of its role.` }
  }
  if (asking.member === asking.by) return { kind: 'refused', told: `${asking.by} may not restart itself: refresh_this_session starts it afresh from its handover.` }
  if (!names.includes(asking.member)) return { kind: 'refused', told: `${asking.member} is not on this crew (its members are ${names.join(', ')}), so there is nobody to restart.` }
  const tooSoon = await aRestartTooSoon(host.stores.rows, asking.member, host.clock.now())
  if (tooSoon !== undefined) return { kind: 'refused', told: tooSoon }
  return restartAMember(host, asking)
}

// --- the launcher's hold ------------------------------------------------------------------------------------------

/** A member the launcher started: its pid, and what settles when it has ended. */
export interface StartedMember<Ended> {
  readonly started: true
  readonly pid: number
  readonly stopped: Promise<Ended>
}

/** A start: the member running, or why it is not. The launcher tells the owner its own refusal. */
export type AStart<Ended> = StartedMember<Ended> | { readonly started: false; readonly refusal: string }

/** What the launcher's hold needs of a host. */
export interface HoldingHost<Ended> {
  readonly stores: LifecycleStores & { readonly rows: RowStore } & TheCrewFilesStores
  readonly stamps: HandoverStampStore
  readonly processes: Pick<Processes, 'identityOf'>
  readonly clock: { now(): number }
  /** The state the member's dashboard row last read, or null when it has none. */
  rowStateOf(member: string): string | null
  /** Starts the member again on this prompt, or on none, through the owner's own start. */
  start(prompt: string | undefined): Promise<AStart<Ended>>
  tellOwner(line: string): void
}

/** How a hold ended: the member's last end, or a restart that could not start it again. */
export type HeldEnd<Ended> = { readonly kind: 'ended'; readonly ended: Ended } | { readonly kind: 'not_restarted'; readonly refusal: string }

/**
 * Holds `member` from its first start for as long as it runs: each time the member ends for a restart asked of that
 * launch, it is started again through `host.start`, and the restart is answered and kept in the ledger. Resolves when
 * the member ended for any other reason, or when a restart could not start it again.
 */
export async function holdTheMember<Ended>(host: HoldingHost<Ended>, member: string, first: StartedMember<Ended>): Promise<HeldEnd<Ended>> {
  let running = first
  for (;;) {
    const launch = { pid: running.pid, process_started_at: host.processes.identityOf(running.pid) }
    const ended = await running.stopped
    const asked = launch.process_started_at === null ? undefined : theRestartAskedOf(host, member, { pid: launch.pid, process_started_at: launch.process_started_at })
    if (asked === undefined) return { kind: 'ended', ended }
    const again = await startAgain(host, member, asked)
    if (!again.started) return { kind: 'not_restarted', refusal: again.refusal }
    running = again
  }
}

/** A restart asked of this launch and not yet answered, if one is. */
function theRestartAskedOf<Ended>(host: HoldingHost<Ended>, member: string, launch: TheLaunch): LifecycleRequest | undefined {
  if ('refusal' in host.stores.lifecycle) return undefined
  const read = theRequestOf(host.stores.lifecycle, member)
  return read.kind === 'pending' && read.request.act === RESTART && sameLaunch(read.request.launch, launch) ? read.request : undefined
}

/** The prompt a restarted member starts on: none when fresh or when it never handed over, else the wake's own. */
function thePromptToRestartOn<Ended>(host: HoldingHost<Ended>, member: string, fresh: boolean): { readonly prompt: string | undefined } | Refused {
  if (fresh) return { prompt: undefined }
  const place = host.stores.crew.place(HANDOVERS_PLACE)
  if ('refusal' in place) return place
  const newest = theNewestHandover(place, host.stamps, member)
  if (newest.kind === 'unreadable') return { refusal: newest.refusal }
  if (newest.kind === 'no_handover') {
    host.tellOwner(`${member} has handed nothing over, so it is restarted with no handover.`)
    return { prompt: undefined }
  }
  return { prompt: theResumePrompt(newest.handover, member) }
}

/** The member started again for `asked`, and the restart answered once, with its ledger row, whether it started or not. */
async function startAgain<Ended>(host: HoldingHost<Ended>, member: string, asked: LifecycleRequest): Promise<AStart<Ended>> {
  const mid_turn = host.rowStateOf(member) === STATE_OF_PHASE.working
  const prompt = thePromptToRestartOn(host, member, asked.fresh)
  const started: AStart<Ended> = 'refusal' in prompt ? { started: false, refusal: prompt.refusal } : await host.start(prompt.prompt)
  if ('refusal' in prompt) host.tellOwner(`${member} was not restarted: ${prompt.refusal}`)
  const restarted = started.started ? ({ started: true } as const) : ({ started: false, refusal: started.refusal } as const)
  const outcome: LifecycleOutcome = { id: asked.id, ended_by: 'launcher', at: new Date(host.clock.now()).toISOString(), restarted, mid_turn }
  await keepTheRestart(host, member, asked, outcome)
  return started
}

/** The answer under the request's id and the ledger's row, once; a store that refuses is told to the owner. */
async function keepTheRestart<Ended>(host: HoldingHost<Ended>, member: string, asked: LifecycleRequest, outcome: LifecycleOutcome): Promise<void> {
  if ('refusal' in host.stores.lifecycle) return
  const answered = answerOnce(host.stores.lifecycle, member, asked, outcome)
  if ('refusal' in answered) return host.tellOwner(`${member}'s restart was not answered: ${answered.refusal}`)
  if (!answered.ours) return
  const { started } = outcome.restarted ?? { started: true }
  const refusal = outcome.restarted !== undefined && !outcome.restarted.started ? { refusal: outcome.restarted.refusal } : {}
  const row = { event: MEMBER_RESTARTED, member, by: asked.by, reason: asked.reason, id: asked.id, fresh: asked.fresh, asked_at: asked.at, started, mid_turn: outcome.mid_turn ?? false, ...refusal, at: outcome.at }
  await host.stores.rows.append(LIFECYCLE_STREAM, row).catch((error: unknown) =>
    host.tellOwner(`${member} was restarted, and the ledger did not keep it: ${error instanceof Error ? error.message : String(error)}`),
  )
}
