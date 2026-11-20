// The crew's owner_notices block (martha#931 C): which of the host's notifications reach the owner. It was the
// SHOWN_AS_A_DIALOG rows of WHAT_EACH_NOTIFICATION_SAYS in ../tell_the_owner_a_session_waits; the declaration's
// `owner_notices.show` now names them, and a declaration that names none reads those rows, so the owner of a file an
// earlier release wrote is told of what they were told of before. The parse lives here, beside declare_crew, which hands
// it the block's raw value and its own refusal.

import { SHOWN_AS_A_DIALOG, WHAT_EACH_NOTIFICATION_SAYS } from '../tell_the_owner_a_session_waits/tell_the_owner_a_session_waits.ts'

/** The declaration's key for the block. */
export const OWNER_NOTICES = 'owner_notices'

/** The fields the block may name; each is optional. */
export const OWNER_NOTICES_KEYS = ['show'] as const

/** The crew's owner notices. */
export interface CrewOwnerNotices {
  /** The host's own names of the notifications the owner is told of; a name not here is shown to nobody. */
  readonly show: readonly string[]
}

/** Every notification name the host sends, as Martha's table knows them: the only names `show` may hold. */
const THE_HOSTS_NOTICES: readonly string[] = Object.keys(WHAT_EACH_NOTIFICATION_SAYS)

/** What the crew reads when the declaration names no block: the notifications the table shows as a dialog. */
export const OWNER_NOTICES_WHEN_UNNAMED: CrewOwnerNotices = Object.freeze({
  show: Object.freeze(THE_HOSTS_NOTICES.filter((name) => WHAT_EACH_NOTIFICATION_SAYS[name] === SHOWN_AS_A_DIALOG)),
})

/** How a field of the block is refused: the field, dotted under the block, and why. */
export type RefuseAnOwnerNoticesField = (field: string, why: string) => never

/**
 * The block as the declaration names it, over OWNER_NOTICES_WHEN_UNNAMED. Each name must be one the host sends: a name
 * the table does not know is refused by its place in the list, since a misspelt name would hide a notice silently. An
 * empty list is a list an owner may mean (told of nothing); a name the table marks not for the owner may be listed, and
 * the owner is then told of it, though it repeats another event.
 */
export function ownerNoticesOf(value: unknown, refuse: RefuseAnOwnerNoticesField): CrewOwnerNotices {
  if (value === undefined) return OWNER_NOTICES_WHEN_UNNAMED
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return refuse(OWNER_NOTICES, `is not an object of ${OWNER_NOTICES_KEYS.join(', ')}`)
  const block = value as Readonly<Record<string, unknown>>
  const unknown = Object.keys(block).find((key) => !(OWNER_NOTICES_KEYS as readonly string[]).includes(key))
  if (unknown !== undefined) return refuse(`${OWNER_NOTICES}.${unknown}`, `is not a field here (they are ${OWNER_NOTICES_KEYS.join(', ')})`)
  return Object.freeze({ show: theNamesOf(block['show'], refuse) })
}

/** The list as named, or the default's when it names none. */
function theNamesOf(show: unknown, refuse: RefuseAnOwnerNoticesField): readonly string[] {
  if (show === undefined) return OWNER_NOTICES_WHEN_UNNAMED.show
  if (!Array.isArray(show)) return refuse(`${OWNER_NOTICES}.show`, 'is not a list of the host\'s notification names')
  show.forEach((name: unknown, at) => {
    if (typeof name !== 'string' || !THE_HOSTS_NOTICES.includes(name)) refuse(`${OWNER_NOTICES}.show[${String(at)}]`, `is not a notification the host sends (they are ${THE_HOSTS_NOTICES.join(', ')})`)
  })
  return Object.freeze([...new Set(show as readonly string[])])
}
