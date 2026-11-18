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
 * What stands for a whole text that held the token across a line break or a terminal sequence, where the token cannot be
 * cut out in place: the text is not kept at all (martha#639, r=1 item 2).
 */
export const WITHHELD = '[withheld: the token was in this text across a line break or a terminal sequence, so none of it is kept]'

/**
 * A terminal's control sequences: CSI (`ESC [ ... final`), OSC (`ESC ] ... BEL` or `ESC ] ... ESC \`) and the
 * two-byte escapes. The member's screen is every byte its terminal drew, and the terminal wraps and moves its cursor
 * with these, so a token on the screen can be split by them.
 */
const TERMINAL_SEQUENCES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** Every line break and carriage return. */
const LINE_BREAKS = /[\r\n]/g

/** `text` as one line of what it shows: its terminal sequences and line breaks taken out. */
export const flattened = (text: string): string => text.replace(TERMINAL_SEQUENCES, '').replace(LINE_BREAKS, '')

/**
 * Whether `text` holds the token, or a fine-grained token, split: a whole one in what the text shows (its breaks and
 * sequences taken out) that the text itself does not hold whole. Cut out in place, such a token would leave a piece
 * behind: the part after a wrap that falls past the `github_pat_` prefix, say.
 */
const holdsOneSplit = (text: string, token: string): boolean => {
  const flat = flattened(text)
  const whole = [...(flat.includes(token) ? [token] : []), ...(flat.match(FINE_GRAINED_TOKEN) ?? [])]
  return whole.some((one) => flat.split(one).length > text.split(one).length)
}

/**
 * `text` with the token and every fine-grained token shape replaced by REDACTED, and whether there was any. When the
 * token is still there once line breaks and terminal sequences are taken out (a screen that wrapped it), the whole
 * text is replaced by WITHHELD, since no single piece of it is the token. An empty token is refused: it would match
 * nothing and read as a record with no token in it.
 */
export function redactTheToken(text: string, token: string): KeptText {
  if (token.trim() === '') throw new Error('the token to look for is empty, so the record cannot be held to it')
  if (holdsOneSplit(text, token)) return { text: WITHHELD, reached: true }
  const withoutTheToken = text.split(token).join(REDACTED)
  const kept = withoutTheToken.replace(FINE_GRAINED_TOKEN, REDACTED)
  return { text: kept, reached: kept !== text }
}
