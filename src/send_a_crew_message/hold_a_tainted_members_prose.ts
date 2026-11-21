// A tainted member's message, split into the crew lines that go out and the prose that is held (martha#987 slice 4,
// gap 15 of #957; crew-code's pass_crew_lines_hold_prose).
//
// DECIDED 2026-11-06 "Crew lines pass, prose taints" (the owner, recorded in crew-code's tracker): an exact crew line from a
// tainted member passes; its free-text prose never reaches another member as crew text.
//
// So the send splits the message, not the member:
//   - a crew line is one line that reads whole as a HANDOFF or a VERDICT through ../read_a_crew_line, the one
//     definition the cards teach, with no `| prose` tail (T9);
//   - every other non-blank line is the sender's prose. A line the sender wrote that opens with the held word is prose
//     too: the held line is written only here (T10);
//   - the prose is kept in a file in the crew's own store, under Martha's state root and outside the checkout, where a
//     member's file tools may not write (martha#619). A member may read it, and that read takes the text in: a file
//     tool's read outside the start tree records B4, and any shell output records A13 (T11). Nothing new reads it.
//
// The residual, as crew-code states it (T13): a crew line's key values (a URL, a `doc=`) are shape-checked by
// ../read_a_crew_line, and a value is the one channel such a line still carries.

import { readACrewLine } from '../read_a_crew_line/read_a_crew_line.ts'

/** The crew store's place that holds tainted members' prose. */
export const HELD_PLACE = 'held-prose'

/** A held file's name: the sender, the clock at the send and a counter, so two sends in one millisecond keep both. */
export const heldFileNameOf = (sender: string, at: number, seq: number): string => `${sender}-${at}-${seq}.txt`

/** The word the held line opens with. A sender's own line that opens with it is prose. */
export const HELD_WORD = 'HELD'

/** The line that stands in for prose that was held, after the crew lines that went out. */
export const heldLineOf = (sender: string, path: string): string =>
  `${HELD_WORD} ${path} | ${sender}'s message had more than crew lines, and ${sender}'s session holds text the crew ` +
  `cannot vouch for, so the rest is held there as ${sender}'s untrusted text: the crew line above still decides (a held ` +
  `VERDICT body is not an empty one), and reading the file takes that text in.`

/** The line a message with no crew line in it goes out as: the receiver is told a message was held, not left with nothing. */
export const heldOnlyLineOf = (sender: string, path: string): string =>
  `${HELD_WORD} ${path} | ${sender}'s whole message is held there as ${sender}'s untrusted text: it carries no crew ` +
  `line, so none of it went out. Reading the file takes that text in.`

/** True for a line a tainted sender may still send: one line that reads whole as a crew line, with no prose tail. */
export function isExactCrewLine(line: string): boolean {
  if (line.includes('\n') || line.includes('|')) return false
  return readACrewLine(line).line !== null
}

/** A tainted member's message, split: its crew lines in order, and every other non-blank line as one text. */
export function splitForSend(text: string): { readonly crew_lines: readonly string[]; readonly prose: string } {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  return { crew_lines: lines.filter(isExactCrewLine), prose: lines.filter((line) => !isExactCrewLine(line)).join('\n') }
}

/** The message a tainted member sends: its crew lines, then the held line when prose was held. */
export function sentFromTainted(crew_lines: readonly string[], sender: string, held_path: string): string {
  if (held_path === '') return crew_lines.join('\n')
  return crew_lines.length === 0 ? heldOnlyLineOf(sender, held_path) : [...crew_lines, heldLineOf(sender, held_path)].join('\n')
}
