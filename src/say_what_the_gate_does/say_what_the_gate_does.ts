// What the gate does to each member, and what an audited member's calls left behind (martha#321).
//
// This exists so the owner can see the gate member by member without a model in the middle: `martha gate` prints one
// line per declared member — enforced, audited with how many would-be refusals it holds, or off — and
// `martha gate --member <name>` prints that member's lines, each the refusal the gate would have given.
//
// WHY THE PERSON ONLY. These lines carry what the gate refused and who sent it. A crew tool that read them would put
// the same text back into a model's turn that the gate exists to keep out of one, so there is no tool for it and
// ../audit_the_gate_for_a_member's folder is read here and nowhere a session can reach.

import { join } from 'node:path'

import { GATE_AUDIT_PLACE, theLinesIn, type AnAuditLine, type StateLines } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import { gateModeFor, type GateMode, type GateSetting } from '../read_the_gate_mode/read_the_gate_mode.ts'

/** The crew's own place, and how the host keeps and reads a file in it: the audit's folder is inside it. */
export interface TheCrewsOwnPlace {
  /** `<state root>/<the crew's key>`, the directory every member of the crew reads. */
  readonly directory: string
  /** How the host keeps and reads a file in it: a slice names a file, never a path on the machine. */
  readonly lines: StateLines
}

/** What the owner asked to see. */
export interface GateAsked {
  /** The members the crew declares, in the declaration's order. */
  readonly members: readonly string[]
  /** The gate as the declaration asked for it. */
  readonly gate: GateSetting
  /** The crew's own place: the audit folder is inside it. */
  readonly crew: TheCrewsOwnPlace
  /** The one member whose lines the owner asked for; absent asks for the summary. */
  readonly member?: string
}

/** What to print, or why the audit cannot be read. */
export type TheGate = { readonly shown: true; readonly lines: readonly string[] } | { readonly shown: false; readonly refusal: string }

const auditPlaceIn = (asked: GateAsked, member: string) => ({ directory: join(asked.crew.directory, GATE_AUDIT_PLACE), member, lines: asked.crew.lines })

/** A line to print, or why the audit could not be read. */
type AShownLine = { readonly line: string } | { readonly refusal: string }

/** The mode as the owner reads it, with the count an audited member's calls left. */
function summaryLine(asked: GateAsked, member: string, mode: GateMode): AShownLine {
  if (mode !== 'audited') return { line: `${member}: ${mode}` }
  const lines = theLinesIn(auditPlaceIn(asked, member))
  if ('refusal' in lines) return { refusal: lines.refusal }
  const count = lines.length === 1 ? '1 would-be refusal' : `${lines.length} would-be refusals`
  return { line: `${member}: audited, ${count}` }
}

/** One audit line as the owner reads it: when, what arrived and from whom, the tool, and the refusal's own words. */
export function oneLineShown(line: AnAuditLine): string {
  const told = (key: string): string => (typeof line[key] === 'string' ? (line[key] as string) : '')
  const sender = line['sender'] === null || line['sender'] === undefined ? 'no sender Martha could attribute' : told('sender')
  const why = told('why') === '' ? '' : ` (${told('why')})`
  return `${told('at')}  ${told('path')}  ${sender}${why}  ${told('tool')}: ${told('refusal')}`
}

/**
 * The lines `martha gate` prints for what the owner asked: every declared member's mode with an audited member's
 * count, or one member's lines oldest first.
 */
export function sayWhatTheGateDoes(asked: GateAsked): TheGate {
  if (asked.member !== undefined) return theLinesOfOneMember(asked, asked.member)
  const lines: string[] = []
  for (const member of asked.members) {
    const shown = summaryLine(asked, member, gateModeFor(asked.gate, member))
    if ('refusal' in shown) return { shown: false, refusal: shown.refusal }
    lines.push(shown.line)
  }
  return { shown: true, lines }
}

function theLinesOfOneMember(asked: GateAsked, asked_for: string): TheGate {
  const member = asked.members.find((name) => name.toLowerCase() === asked_for.toLowerCase())
  if (member === undefined) {
    return { shown: false, refusal: `the declaration does not know ${asked_for} (its members are ${asked.members.join(', ')}).` }
  }
  const lines = theLinesIn(auditPlaceIn(asked, member))
  if ('refusal' in lines) return { shown: false, refusal: lines.refusal }
  return { shown: true, lines: lines.map(oneLineShown) }
}

/** The switch that names one member's lines for `martha gate`. */
export const MEMBER_SWITCH = '--member'

/** `martha gate` as its words read: the act, and the one member whose lines were asked for, if any. */
export interface TheAskOfTheGate {
  readonly act: string
  readonly member?: string
  readonly args: readonly string[]
}

/**
 * `gate [--member <name>]`: the act, and the member whose lines were asked for; undefined when the words are no way
 * the command is used. The switch is this report's own vocabulary, so it is read here beside the report rather than
 * in ../run_the_martha_command, an adapter that composes slices and has a ceiling.
 */
export function gateOf(act: string, argv: readonly string[]): TheAskOfTheGate | undefined {
  const [, switchWord, member] = argv
  if (switchWord === undefined) return { act, args: [] }
  return switchWord === MEMBER_SWITCH && member !== undefined && member !== '' ? { act, member, args: [] } : undefined
}
