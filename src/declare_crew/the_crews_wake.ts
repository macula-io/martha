// The house rule that wakes a member which is idle with work nobody holds (martha#959): the switch, the two windows it
// names, and their reading, beside declare_crew, which hands it the declaration and its own refusal, as the thresholds
// are read (./the_crews_thresholds.ts).
//
// The rule is off unless the declaration names it, and it names two windows with it — the first wait, and the cap the
// doubling stops at — so no member is woken on a window the code made up. `wake_after_minutes: 0` is a crew that keeps
// the rule and turns it off. It takes no host and reads no file.

/** The house rule that wakes a member which is idle with work nobody holds (martha#959). */
export const WAKE = 'wake'
export const WAKE_AFTER_MINUTES = 'wake_after_minutes'
export const WAKE_CAP_MINUTES = 'wake_cap_minutes'
export const WAKE_MINUTES = [WAKE_AFTER_MINUTES, WAKE_CAP_MINUTES] as const

/** How a window of this rule is refused: the field, dotted under `house_rules`, and why. */
export type RefuseAWakeField = (field: string, why: string) => never

/**
 * The two windows a crew that wakes an idle member names (martha#959): all of them, when the rule is on, so a member is
 * never woken on a window the code made up. A crew that turns the rule off names none of them and is not asked.
 */
export function refuseTheWakeWindows(refuse: RefuseAWakeField, value: Readonly<Record<string, unknown>>): void {
  if (value[WAKE] !== true) return
  const missing = WAKE_MINUTES.find((minutes) => value[minutes] === undefined)
  if (missing !== undefined) {
    refuse(`house_rules.${missing}`, `is missing, and house_rules.${WAKE} is on in this declaration`)
  }
}
