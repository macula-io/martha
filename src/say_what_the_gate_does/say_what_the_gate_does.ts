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

import { GATE_AUDIT_PLACE, theLinesIn, type AnAuditLine } from '../audit_the_gate_for_a_member/audit_the_gate_for_a_member.ts'
import { gateModeFor, type GateMode, type GateSetting } from '../read_the_gate_mode/read_the_gate_mode.ts'

/** What the owner asked to see. */
export interface GateAsked {
  /** The members the crew declares, in the declaration's order. */
  readonly members: readonly string[]
  /** The gate as the declaration asked for it. */
  readonly gate: GateSetting
  /** The crew's own place: the audit folder is inside it. */
  readonly crew: string
  /** The one member whose lines the owner asked for; absent asks for the summary. */
  readonly member?: string
}

/** What to print, or why the audit cannot be read. */
export type TheGate = { readonly shown: true; readonly lines: readonly string[] } | { readonly shown: false; readonly refusal: string }

const auditPlaceIn = (asked: GateAsked, member: string) => ({ directory: join(asked.crew, GATE_AUDIT_PLACE), member })

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
