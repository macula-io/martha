// Where the crew keeps everything, one `KEY=path` a line (martha#985, gap 20 of #957): `martha where`.
//
// This exists so a tool outside the launcher — a script, an editor, the owner — acts on this crew instead of assuming
// a layout. Every value is read from the slice that already knows it: the declaration's own file name, the state
// directory the launcher opened, the crew's own directory under the state root, the handovers place inside it, the
// two places the declaration's house rules name for clones and worktrees, the roster the crew writes, and the mode the
// crew declared.
//
// A place a crew does not have prints an empty value and not a missing line, as crew-code prints `MESH` empty for an
// adopted crew: a script reads the line it asked for and finds nothing there, rather than a line it did not expect.
// The lines are in this order always, so two crews' answers can be compared line by line.

/** The roster's own file name, under the crew's directory: the file `martha where` names when the crew has one, and
 * the one the crew's roster verb will write (gap 22 of #957, where a member's mesh key place is decided). */
export const ROSTER_FILE = 'roster.json'

/** Each key a line carries, in the order the lines are printed. Exported, so a reader or a test names a key once. */
export const WHERE_KEYS = {
  declaration: 'DECLARATION',
  state: 'STATE',
  crew: 'CREW',
  handovers: 'HANDOVERS',
  clones: 'CLONES',
  worktrees: 'WORKTREES',
  roster: 'ROSTER',
  mode: 'MODE',
} as const

/** Every place the crew keeps something, each as the slice that knows it answered it; null where the crew has none. */
export interface ThePlacesShown {
  readonly declaration: string
  readonly state: string
  readonly crew: string
  readonly handovers: string
  readonly clones: string | null
  readonly worktrees: string | null
  /** The roster file, when the crew has one; null when it has none yet, as crew-code prints a place a crew lacks. */
  readonly roster: string | null
  readonly mode: string
}

/** The lines `martha where` prints: one per key, in WHERE_KEYS' order, an empty value for a place the crew has none of. */
export function whereLinesOf(shown: ThePlacesShown): readonly string[] {
  const each = [shown.declaration, shown.state, shown.crew, shown.handovers, shown.clones, shown.worktrees, shown.roster, shown.mode]
  return (Object.values(WHERE_KEYS) as readonly string[]).map((key, at) => `${key}=${each[at] ?? ''}`)
}
