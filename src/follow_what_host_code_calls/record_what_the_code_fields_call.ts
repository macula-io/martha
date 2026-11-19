// The callees of each recorded code field, cut from the host's bundle beside the field (martha#811, R6).
//
// Each code field's texts are found where the bundle holds them, and what they call is followed to the depth the
// field's entry in CODE_FIELDS names; the result is recorded as `<field>_callees`. A text the bundle holds other than
// exactly once cannot be placed, unless its field is found from another (CODE_FIELDS' `foundFrom`): then it is found
// by the function name it declares, from that field's place.

import { CODE_FIELDS, calleesFieldOf, textsOf } from '../compare_two_host_recordings/compare_two_recordings.ts'
import { Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'
import { bundleOf, calleesOf, placeOf } from './follow_the_free_callees.ts'
import type { GuardCalls } from '../compare_two_host_recordings/what_a_recorded_text_calls.ts'

/** The name a recorded function text declares. */
const DECLARED = /^(?:async )?function\*? ?([\w$]+)\(/

/** Where the bundle holds a recorded text verbatim, when it holds it exactly once. */
function verbatimPlaceOf(host: string, text: string): { readonly at: number; readonly length: number } | undefined {
  const at = host.indexOf(text)
  return at < 0 || host.indexOf(text, at + 1) >= 0 ? undefined : { at, length: text.length }
}

/** Where the bundle holds one code field's texts. */
function placesOf(host: string, field: string, derived: Readonly<Record<string, unknown>>): Array<{ readonly at: number; readonly length: number }> {
  const { foundFrom } = CODE_FIELDS[field] ?? {}
  const anchors = foundFrom === undefined ? [] : textsOf(derived[foundFrom]).map((text) => verbatimPlaceOf(host, text)?.at)
  const places: Array<{ readonly at: number; readonly length: number }> = []
  for (const text of textsOf(derived[field])) {
    const verbatim = verbatimPlaceOf(host, text)
    const name = DECLARED.exec(text)?.[1]
    if (verbatim !== undefined) places.push(verbatim)
    else if (foundFrom !== undefined && name !== undefined && anchors.every((anchor) => anchor !== undefined)) {
      places.push(placeOf(bundleOf(host), [...(anchors as number[]), ...places.map(({ at }) => at)], name))
    } else throw new Unreadable(`a text of ${field} is not held exactly once by the host`)
  }
  return places
}

/** The name a code field's callees are reported under when they cannot be cut. */
export const calleesPartOf = (field: string): string => `what ${field} calls`

/** Each code field's callees, by its callee field; and the parts that could not be cut, each by its name. */
export function calleesOfTheCodeFields(host: string, derived: Readonly<Record<string, unknown>>): { readonly callees: Record<string, GuardCalls>; readonly unreadable: readonly string[] } {
  const callees: Record<string, GuardCalls> = {}
  const unreadable: string[] = []
  for (const [field, { depth }] of Object.entries(CODE_FIELDS)) {
    const cut = cutOrUnreadable(() => calleesOf(bundleOf(host), placesOf(host, field, derived), depth))
    if (cut instanceof Unreadable) {
      unreadable.push(calleesPartOf(field))
      process.stderr.write(`${calleesPartOf(field)}: ${cut.message}\n`)
    } else callees[calleesFieldOf(field)] = cut
  }
  return { callees, unreadable }
}

/** The callees `cut` reads, or the error when they are unreadable; any other error is thrown on. */
function cutOrUnreadable(cut: () => GuardCalls): GuardCalls | Unreadable {
  try {
    return cut()
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error
    return error
  }
}
