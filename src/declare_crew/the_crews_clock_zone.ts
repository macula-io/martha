// The crew's clock_zone (martha#931 C): the time zone every clock time Martha prints for the crew is read in. Before
// #931 there were two spellings of one clock, both UTC: `HH:MM UTC` (../nudge_the_supervisor's clockOf) and `HH:MMZ`
// (../see_the_crew's crew-tools flag). The declaration's `clock_zone` now names the zone and theClockOf is the one
// spelling; a declaration that names none reads UTC, as both did. The parse lives here, beside declare_crew, which hands
// it the raw value and its own refusal.

/** The declaration's key for the field. */
export const CLOCK_ZONE = 'clock_zone'

/** What the crew reads when the declaration names no zone: the zone both spellings printed before #931. */
export const CLOCK_ZONE_WHEN_UNNAMED = 'UTC'

/** How the field is refused: the field and why. */
export type RefuseTheClockZone = (field: string, why: string) => never

/** The formatter of one zone's clock time, to the minute, on a 24-hour clock; throws a RangeError for an unknown zone. */
const theFormatOf = (zone: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/**
 * The zone as the declaration names it, or CLOCK_ZONE_WHEN_UNNAMED. A name is a zone when the runtime's own time zone
 * data can format a clock in it; any other is refused by name, never read as UTC.
 */
export function clockZoneOf(value: unknown, refuse: RefuseTheClockZone): string {
  if (value === undefined) return CLOCK_ZONE_WHEN_UNNAMED
  if (typeof value !== 'string' || value === '') return refuse(CLOCK_ZONE, 'is not a time zone\'s name')
  try {
    theFormatOf(value)
  } catch {
    return refuse(CLOCK_ZONE, 'is not a time zone\'s name this machine knows')
  }
  return value
}

/** The clock time `at` reads in `zone`, to the minute, with the zone named: `14:05 UTC`, `15:05 Europe/Brussels`. */
export const theClockOf = (at: number, zone: string): string => `${theFormatOf(zone).format(new Date(at))} ${zone}`
