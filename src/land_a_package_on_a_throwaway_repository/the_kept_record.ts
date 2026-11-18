// The nightly live run's kept record holds no token (martha#639, R4).
//
// Members hold Bash and, in the landing phase, the throwaway token, so a member's transcript can carry it: `gh auth
// token`, `gh auth status -t`, gh's hosts file read whole, a remote URL with credentials in it. The run keeps
// transcripts and screens in its log when a step fails, and the night's findings are posted from that log. So every
// text bound for the log goes through here first: the token's exact value, and anything in the shape of a fine-grained
// token, is replaced, and the run fails the night by name when anything was. The private scan before a post stays as a
// second line, not the first.

/** What a fine-grained personal access token looks like, so one the run was not given is caught too. */
export const FINE_GRAINED_TOKEN = /github_pat_[A-Za-z0-9_]+/g

/** What stands where a token was. */
export const REDACTED = '[the token, redacted]'

/** The night's failure when a token reached the kept record, in the words the run prints. */
export const THE_TOKEN_REACHED_THE_RECORD = 'the token reached the kept record'

/** A text made fit for the kept record, and whether a token had reached it. */
export interface KeptText {
  readonly text: string
  readonly reached: boolean
}

/**
 * `text` with the token and every fine-grained token shape replaced by REDACTED, and whether there was any. An empty
 * token is refused: it would match nothing and read as a record with no token in it.
 */
export function redactTheToken(text: string, token: string): KeptText {
  if (token.trim() === '') throw new Error('the token to look for is empty, so the record cannot be held to it')
  const withoutTheToken = text.split(token).join(REDACTED)
  const kept = withoutTheToken.replace(FINE_GRAINED_TOKEN, REDACTED)
  return { text: kept, reached: kept !== text }
}
