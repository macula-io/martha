// A held package stops a batch (martha#364).
//
// This exists so an owner who holds a package back knows for certain it will not land in a batch, while a package with
// no hold lands with no extra step.
//
// A hold is one of the Supervisor's standing items (../keep_the_supervisors_standing_items) that names the package it
// holds. The landing (../land_passed_work_as_one_batch) asks this slice before it runs anything, and the fast-forward
// asks again before its push, so a hold recorded after the batch branch was cut still stops the default branch from
// moving. What stands is read through the standing items' own fold, so a close, a replaced hold and the order are the
// ones the listing draws. A hold whose day has come still holds: its DUE mark asks for its condition to be checked,
// and only a close with its evidence ends it. A stream that cannot be read stops the batch too, because a batch that
// cannot see the holds cannot promise the owner that none stands.

import type { RowStore } from '../host_contract/host_contract.ts'
import {
  STANDING,
  STANDING_CLOSE,
  STANDING_STREAM,
  theHeldPackageOf,
  theSamePackage,
  theStandingItems,
  type StandingItem,
} from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'

/** A hold a batch meets: the hold, and the package of the batch it holds, as the batch names it. */
export interface AHeldPackage {
  readonly hold: StandingItem
  readonly package: string
}

/** What this needs of a host: the crew's row streams, where the standing items live. */
export interface HoldsHost {
  readonly stores: { readonly rows: RowStore }
}

/** What a landing tool says of a hold, in its description: the model reads it before it calls. */
export const A_HOLD_REFUSES = `An open hold (${STANDING}) on one of its packages refuses the call before anything runs.`

/** Every open hold that names a package of `packages`, each with the package as the batch names it. */
export function theHoldsOnTheseRows(items: readonly StandingItem[], packages: readonly string[]): readonly AHeldPackage[] {
  return items.flatMap((hold) => {
    const held = theHeldPackageOf(hold)
    const named = held === undefined ? undefined : packages.find((one) => theSamePackage(one, held))
    return named === undefined ? [] : [{ hold, package: named }]
  })
}

/** One hold, as the refusal names it: the package, the hold's id, and what it says. */
const aHoldNamed = ({ hold, package: held }: AHeldPackage): string =>
  `${held} is held as ${hold.id} (${hold.fields['item']}; why: ${hold.fields['reason']}; until: ${hold.fields['until']}; recorded by ${hold.recorded_by})`

/** The refusal of a batch these holds stop: `what` says what was not done, then every hold, then how to go on. */
export function whyTheHoldsRefuse(holds: readonly AHeldPackage[], what: string): string {
  return `${what}: ${holds.map(aHoldNamed).join('; ')}. Close the hold with its evidence (${STANDING_CLOSE}), or take the package out of the batch, then try again.`
}

/** The batch may go on when no open hold names one of its packages; otherwise the refusal, saying `what` was not done. */
export async function noneOfTheseIsHeld(host: HoldsHost, packages: readonly string[], what: string): Promise<{ readonly ok: true } | { readonly refused: string }> {
  let items: readonly StandingItem[]
  try {
    items = theStandingItems(await host.stores.rows.read(STANDING_STREAM))
  } catch (error) {
    return { refused: `the holds could not be read (${error instanceof Error ? error.message : String(error)}): ${what}.` }
  }
  const held = theHoldsOnTheseRows(items, packages)
  return held.length === 0 ? { ok: true } : { refused: whyTheHoldsRefuse(held, what) }
}
