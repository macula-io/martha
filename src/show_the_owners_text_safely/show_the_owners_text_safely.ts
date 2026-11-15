// The text Martha shows the owner, shown safely (a pure move out of the command adapter, which is at its ceiling):
// a terminal would act on some of what a path, a member's name or a kept approval may hold rather than show it.

import type { CommandIo } from '../run_the_martha_command/run_the_martha_command.ts'

/**
 * What a terminal would act on rather than show: C0 and C1 controls, DEL, the bidirectional marks (left-to-right,
 * right-to-left, the Arabic letter mark), overrides and isolates, and the line and paragraph separators.
 */
const TERMINAL_CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu

/** `line` with every terminal control written out as an escape, so nothing Martha shows can move, erase or reorder what the owner reads. */
export function shownSafely(line: string): string {
  return line.replace(TERMINAL_CONTROL, (control) => {
    const code = control.codePointAt(0)!
    return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`
  })
}

/** The io with every line it shows escaped: a path, a member's name or a kept approval may hold anything. */
export const showingSafely = (io: CommandIo): CommandIo => ({
  ...io,
  out: (line) => io.out(shownSafely(line)),
  err: (line) => io.err(shownSafely(line)),
})

