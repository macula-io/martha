// The token one launch's relay answers to (martha#541, packages 7-8 part C, C1).
//
// This exists so a relay that is handed a token answers only a request carrying it: the crew's tool server of a Goose
// launch carries it, and a process that is not that launch's server cannot answer for the member with a token it does
// not have. The relay owns the door, so the token's header, how a token is minted and how one is compared live here,
// beside the socket they guard; the tool server reads them from here.
//
// Said plainly, as relay_directory.ts says it of the relay as a whole: the token is a speed bump, not a boundary. It is
// written into the config root the launch writes for its engine (0600, in a root only the owner may enter), so a
// process of the same OS user can read it there. The signed roster closes that residual (martha#24); until then this
// keeps every other process on the machine, and a stale server of an earlier launch, from speaking for the member.
// The token is never written to a dashboard row, a log line or the journal: it lives in the launcher's memory and in
// that one config file, and nowhere else.

import { randomBytes, timingSafeEqual } from 'node:crypto'

/** The header a caller carries the token in, on every request it posts to the relay. */
export const THE_TOKEN_HEADER = 'x-martha-launch-token'

/** How many random bytes one launch's token holds. */
export const A_TOKENS_BYTES = 32

const HEX = 'hex'

/** A token for one launch: fresh random bytes, as hex, minted once per launch and never reused. */
export function mintALaunchToken(): string {
  return randomBytes(A_TOKENS_BYTES).toString(HEX)
}

/**
 * Whether `given` is `token`, compared in constant time over the two values' bytes. A value of another length is not
 * the token, and is told so without comparing any byte of it, so the time a refusal takes says nothing of the token's
 * bytes; that it says the length is no secret, since every token has the same one.
 */
export function isThisLaunchsToken(given: string | undefined, token: string): boolean {
  if (given === undefined) return false
  const offered = Buffer.from(given)
  const held = Buffer.from(token)
  return offered.length === held.length && timingSafeEqual(offered, held)
}
