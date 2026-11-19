// The text Martha shows the owner, shown safely (a pure move out of the command adapter, which is at its ceiling):
// a terminal would act on some of what a path, a member's name or a kept approval may hold rather than show it.

/** The lines an owner is shown, and nothing else: what this slice needs of the terminal, so it asks no adapter for it. */
export interface LinesShownToTheOwner {
  out(line: string): void
  err(line: string): void
}

/**
 * What a terminal would act on rather than show: C0 and C1 controls, DEL, the bidirectional marks (left-to-right,
 * right-to-left, the Arabic letter mark), overrides and isolates, and the line and paragraph separators.
 */
export const TERMINAL_CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu

/** `line` with every terminal control written out as an escape, so nothing Martha shows can move, erase or reorder what the owner reads. */
export function shownSafely(line: string): string {
  return line.replace(TERMINAL_CONTROL, (control) => {
    const code = control.codePointAt(0)!
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`
  })
}

/** The io with every line it shows escaped: a path, a member's name or a kept approval may hold anything. */
export const showingSafely = <Shown extends LinesShownToTheOwner>(io: Shown): Shown => ({
  ...io,
  out: (line: string) => io.out(shownSafely(line)),
  err: (line: string) => io.err(shownSafely(line)),
})

/** The command ended as asked. */
export const EXIT_DONE = 0
/** The command refused, and said why. */
export const EXIT_REFUSED = 1
/** The command was not used in a way it knows. */
export const EXIT_USAGE = 2

/** What starts every line Martha shows the owner on stderr. */
export const SAID_BY = 'martha:'

/** How a line of Martha's own is told on the owner's stderr. */
export const tellOwnerOn = (io: LinesShownToTheOwner) => (line: string): void => io.err(`${SAID_BY} ${line}`)

/** The refusal, its words told on stderr, and the status a command that refused ends with. */
export function refused(io: LinesShownToTheOwner, why: string): number {
  tellOwnerOn(io)(why)
  return EXIT_REFUSED
}

/** What moves the cursor home and clears the terminal, so each frame of a strip is drawn in place of the last. */
export const CLEAR_THE_TERMINAL = '\u001b[H\u001b[2J'

/** How a frame is drawn where the one before it was: the terminal cleared, then the frame's own lines. */
export const drawingInPlace = <Shown extends LinesShownToTheOwner & { outBytes(bytes: Buffer): void }>(
  io: Shown,
) => (frame: readonly string[]): void => {
  io.outBytes(Buffer.from(CLEAR_THE_TERMINAL))
  for (const line of frame) io.out(line)
}
