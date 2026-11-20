// The throwaway token's expiry, read each live run (martha#639).
//
// A lost token reaches only the bot, and a token with an expiry only until then. GitHub
// says when a token expires in the `github-authentication-token-expiration` header of any call it answers, and says
// nothing for a token made with no expiry. So the run reads that header every live run, before it makes anything, and:
//
// - an expired token, or a date it cannot read, refuses the live run by name;
// - no date at all is a note, said once per live run, not an alarm: the owner DECIDED on 2026-11-18 ("Keep it, no expiry")
//   to keep the bot's token without one, so the bound left is the bot's isolation (it owns nothing but throwaway
//   repositories);
// - a date within NEAR_DAYS is a warning by name, so the owner renews it before a live run fails on it.

/** The header GitHub answers a token's expiry in. */
export const EXPIRY_HEADER = 'github-authentication-token-expiration'

/** How many days before its expiry a token is warned about. */
export const NEAR_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

/** What the live run does about the token's expiry, and the words it says. */
export interface Expiry {
  readonly refuses: boolean
  /** Information, said once per live run. */
  readonly note?: string
  readonly warning?: string
  readonly why?: string
}

/** What a live run says of a token with no expiry: the owner's choice, as information. */
export const NO_EXPIRY_NOTE = "the token has no expiry (owner's choice, 2026-11-18)"

/** GitHub's expiry, written `2026-12-18 03:00:00 UTC`, as milliseconds; undefined when it is not that. */
const expiryOf = (value: string): number | undefined => {
  const at = Date.parse(value.trim().replace(' UTC', 'Z').replace(' ', 'T'))
  return Number.isNaN(at) ? undefined : at
}

/** What the header's value, empty when GitHub sent none, says of the token at `now`. */
export function theTokensExpiry(value: string, now: Date): Expiry {
  if (value.trim() === '') return { refuses: false, note: NO_EXPIRY_NOTE }
  const at = expiryOf(value)
  if (at === undefined) return { refuses: true, why: `the token's expiry '${value.trim()}' could not be read` }
  const left = at - now.getTime()
  if (left <= 0) return { refuses: true, why: `the token expired at ${value.trim()}: renew it with the setup script` }
  const days = Math.floor(left / DAY_MS)
  if (days < NEAR_DAYS) return { refuses: false, warning: `the token expires in ${days} day(s), at ${value.trim()}: renew it with the setup script` }
  return { refuses: false }
}
