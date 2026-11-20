// A crew line goes through say_to_the_crew and no other path (martha#980 package 2, the turn-back).
//
// This exists so a hand-off is not lost on a path no one judges: say_to_the_crew reads every crew line, keeps its row in
// the package's ledger and its receipt, and the host's own messaging does none of that. So a call of the host's
// SendMessage, a mesh say or a mesh ring whose text carries a crew line is refused, naming say_to_the_crew and the line.
// A line that counts as a crew line and does not read is refused too, with what did not read: a malformed HANDOFF must
// not slip through as prose here while the same line on say_to_the_crew is read. Prose passes.
//
// It is a port of crew-code's rule that a crew line sent to a room is refused (hooks/register.tsx meshSay and meshRing),
// applied to every path that is not the crew's own. A crew line is what crew-code's messageVerbOf counts, on any line of
// the message (../read_a_crew_line). The tools are told apart by their own name, which only the host takes out of the
// name it calls (`ToolNames.ownNameOf`). The Supervisor ruled the turn-back a refusal (martha#980, 2026-11-20).

import { CLAUDE_CODE_SEND_MESSAGE_TOOL } from '../claude_code_host/claude_code_messaging_tool.ts'
import type { ToolNames } from '../host_contract/host_contract.ts'
import { readEveryCrewLine } from '../read_a_crew_line/read_a_crew_line.ts'
import { crewVerbOf } from '../read_a_crew_line/the_other_crew_verbs.ts'
import { RINGS_AND_RETURNS_THE_ANSWER, SENDS_AND_MAY_WAIT } from '../read_a_room_through_its_gate/read_a_room_through_its_gate.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'

/**
 * Each tool that hands text to another session by a path not the crew's own, by its own name, and the argument of its
 * call that holds the text: SendMessage's message, a say's text, and a ring's purpose, which is the text its callee
 * reads. The argument names are the tools' own and are read only here, as ../read_a_room_through_its_gate keeps the
 * say's wait argument.
 */
const THE_TEXT_OF_A_MESSAGING_TOOL: Readonly<Record<string, string>> = {
  [CLAUDE_CODE_SEND_MESSAGE_TOOL]: 'message',
  [SENDS_AND_MAY_WAIT]: 'text',
  [RINGS_AND_RETURNS_THE_ANSWER]: 'purpose',
}

/** The refusal of a call that sends a crew line by a path not the crew's own, or undefined for any other call. */
export function theCrewLineTurnedBack(tool: string, input: Readonly<Record<string, unknown>> | undefined, names: ToolNames): string | undefined {
  const argument = THE_TEXT_OF_A_MESSAGING_TOOL[names.ownNameOf(tool)]
  if (argument === undefined) return undefined
  const text = input?.[argument]
  if (typeof text !== 'string') return undefined
  const lines = text.split('\n')
  const named = lines.flatMap((line, index) => (crewVerbOf(line) === undefined ? [] : [theLineNamed(line, lines.length > 1 ? index + 1 : undefined)]))
  if (named.length === 0) return undefined
  return (
    `${tool} carries a crew line, and a crew line goes only through ${SAY_TO_THE_CREW}, which reads it and keeps it in the ` +
    `package's ledger. Send the crew line with ${SAY_TO_THE_CREW}; prose may still go by ${tool}. ${named.join(' ')}`
  )
}

/** The line as it was written, its number in a message of more than one, and what did not read when it does not. */
function theLineNamed(line: string, number: number | undefined): string {
  const where = number === undefined ? 'The line' : `Line ${String(number)}`
  const problem = readEveryCrewLine(line).notices[0]
  const written = `${where}: ${JSON.stringify(line.trim())}`
  return problem === undefined ? `${written}.` : `${written} does not read either, and ${SAY_TO_THE_CREW} would say so: ${problem}`
}
