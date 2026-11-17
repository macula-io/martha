// One outward act, announced in the ledger of every package it lands, sent once, and concluded in each (martha#512,
// slice 2).
//
// This exists so an act that lands several packages at once — a batch's push, the fast-forward the owner said yes to —
// is recovered by the same rule as one package's act. The act runs once, and every package it lands holds the
// announcement before it runs, so no package's ledger is told afterwards that something was sent. One package is the
// case of one: the endings are the ledger's own (../log_ledger's ActNotSent, the act's own error, OutcomeNotKept), so the
// recovery reads them the same way whatever the count.
//
// What a failure leaves is said with it: the packages whose row stands announced and unconcluded, which the recovery
// concludes from what it found before it does anything else, so no row of an attempt stays open for a successor.

import { OutcomeNotKept, announceAct, concludeAct, type LedgerHost, type Outcome, type OutwardAct } from '../log_ledger/log_ledger.ts'

/** The act, who sends it, and every package it lands: one package for an act that is its alone. */
export interface AnActOnPackages {
  readonly packages: readonly string[]
  readonly member: string
  readonly act: OutwardAct
}

/** A package's announcement: the package, and the row its ledger kept it at. */
export interface AnAnnouncement {
  readonly package: string
  readonly at: number
}

/**
 * How one send ended: what it said, or the failure it threw and the announcements it left standing unconcluded. The
 * failure is the ledger's own ending: ActNotSent when a row was not kept before the act ran, the act's own error when it
 * ran and failed and every package kept that, and OutcomeNotKept when it ran and some package's outcome was not kept.
 */
export type AnEnding = { readonly said: string } | { readonly failure: unknown; readonly awaiting: readonly AnAnnouncement[] }

const detailOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Concludes every announcement with one outcome; answers those whose outcome was not kept, and the first refusal. */
async function concludeEvery(
  host: LedgerHost,
  member: string,
  announced: readonly AnAnnouncement[],
  outcome: Outcome,
): Promise<{ readonly awaiting: readonly AnAnnouncement[]; readonly refusal?: unknown }> {
  const awaiting: AnAnnouncement[] = []
  let refusal: unknown
  for (const one of announced) {
    try {
      await concludeAct(host, { package: one.package, member, announced_at: one.at, outcome })
    } catch (error) {
      awaiting.push(one)
      refusal ??= error
    }
  }
  return refusal === undefined ? { awaiting } : { awaiting, refusal }
}

/**
 * Every package's ledger announces the act, or it does not run. A row one package will not keep stops it: the packages
 * already announced are concluded as not sent, and any whose conclusion was not kept are said, still awaiting.
 */
async function announceOnEvery(host: LedgerHost, input: AnActOnPackages): Promise<{ readonly ok: readonly AnAnnouncement[] } | Extract<AnEnding, { failure: unknown }>> {
  const announced: AnAnnouncement[] = []
  for (const work_package of input.packages) {
    try {
      announced.push({ package: work_package, at: await announceAct(host, { package: work_package, member: input.member, act: input.act }) })
    } catch (failure) {
      const left = await concludeEvery(host, input.member, announced, { succeeded: false, detail: `it was not sent: the row for ${work_package} was not kept` })
      return { failure, awaiting: left.awaiting }
    }
  }
  return { ok: announced }
}

/** The ending a send leaves when some package did not keep its outcome: the ledger's OutcomeNotKept, and who awaits. */
const notKept = (
  input: AnActOnPackages,
  left: { readonly awaiting: readonly AnAnnouncement[]; readonly refusal?: unknown },
  sent: OutcomeNotKept['sent'],
  send_error?: unknown,
): AnEnding => ({
  failure: new OutcomeNotKept({ act: input.act, announced_at: left.awaiting[0]?.at ?? 0, sent, send_error, keeping_error: left.refusal }),
  awaiting: left.awaiting,
})

/** Announces the act in every package's ledger, sends it once, and concludes it in each: how it ended, never thrown. */
export async function sendOnEveryPackage(host: LedgerHost, input: AnActOnPackages, send: () => Promise<string>): Promise<AnEnding> {
  const announced = await announceOnEvery(host, input)
  if (!('ok' in announced)) return announced
  let said: string
  try {
    said = await send()
  } catch (send_error) {
    const left = await concludeEvery(host, input.member, announced.ok, { succeeded: false, detail: detailOf(send_error) })
    return left.awaiting.length === 0 ? { failure: send_error, awaiting: [] } : notKept(input, left, { succeeded: false }, send_error)
  }
  const left = await concludeEvery(host, input.member, announced.ok, { succeeded: true, detail: said })
  return left.awaiting.length === 0 ? { said } : notKept(input, left, { succeeded: true, result: said })
}
