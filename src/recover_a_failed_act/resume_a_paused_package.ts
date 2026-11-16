// A paused package, told to the Supervisor and resumed by them (martha#512).
//
// This exists so a pause stops a package and reaches someone who can decide, instead of resting on the member that
// paused it to say so. A recovery that cannot name a failure, cannot read what became of the act, or has spent the one
// attempt a package is given keeps a `paused` row (./recover_a_failed_act); that row holds every later act sent through
// the recovery until it is resumed. Here are the two ends of that hold: the nudge the crew's receivers read while it
// stands, and the resume that lifts it.
//
// A resume is `log_a_milestone`'s `resume` event (../keep_the_ledger), so no tool is added to the host's mod. Who may
// resume is who the nudge goes to (../nudge_the_supervisor's theNudgesGoTo): the members the mode's table grants
// `assign_work`, and the owner when it grants it to them. A member cannot lift its own package's pause, and the resume
// is written as this launch's member, never as a name the call carries.
//
// A resume does not give the package its attempt back (the gate's answer (b)): the attempt is the package's, so the same
// act failing again after a resume pauses it again rather than sending it a third time.

import type { LedgerHost } from '../log_ledger/log_ledger.ts'
import { PACKAGE_RESUMED, WORK_PACKAGE, noteMilestone, readLedger, thePauseOn } from '../log_ledger/log_ledger.ts'
import type { Nudge } from '../nudge_the_supervisor/nudge_the_supervisor.ts'

/** A resume, as it is asked for: the package, the member asking, its note, and who the crew's nudges go to. */
export interface AResumeAsked {
  readonly package: string
  readonly member: string
  readonly note: string
  /** Who may resume: who the crew's nudges go to. Empty when the declaration could not be read, so nobody may. */
  readonly may: readonly string[]
}

/** Lifts a package's pause, for whoever the crew's nudges go to and for nobody else; resolves to what the member is told. */
export async function resumeAPausedPackage(host: LedgerHost, asked: AResumeAsked): Promise<{ readonly told: string }> {
  if (!asked.may.some((name) => name.toLowerCase() === asked.member.toLowerCase())) {
    return { told: `Not recorded: ${asked.member} may not resume a paused package; only ${asked.may.join(', ') || 'nobody'}, who the crew's nudges go to, may.` }
  }
  const pause = thePauseOn(await readLedger(host, asked.package))
  if (pause === undefined) return { told: `Not recorded: ${asked.package} is not paused.` }
  await noteMilestone(host, { package: asked.package, member: asked.member, milestone: PACKAGE_RESUMED, note: asked.note })
  return { told: `Kept: ${asked.package} is resumed. The ${pause.act.kind} (${pause.act.what}) that paused it is behind it, and its acts may be sent again.` }
}

/**
 * The nudges for the packages that stand paused, one each, about the member whose recovery paused it and since then.
 * Only the packages handed in are read: the ones the crew's rows hold and its lines name, which is where a paused package
 * is. A ledger row that cannot be read is refused, as every reader of the ledger refuses it (../log_ledger).
 */
export async function thePausedNudges(ledger: LedgerHost, packages: readonly string[]): Promise<readonly Nudge[]> {
  const nudges: Nudge[] = []
  for (const package_name of new Set(packages.filter((one) => WORK_PACKAGE.test(one)))) {
    const pause = thePauseOn(await readLedger(ledger, package_name))
    if (pause !== undefined) nudges.push({ kind: 'paused', member: pause.member, package: package_name, since: pause.at })
  }
  return nudges
}
