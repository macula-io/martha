// The audit of the gate for one member (martha#321).
//
// This exists so an owner can watch the gate on one member at a time before trusting it everywhere: a member named in
// `gate_audits` (or every member under `gate_enforces: nobody`) has its calls run, and each refusal the gate WOULD have
// given is written down for the owner, one JSON line per arrival.
//
// WHY IT REFUSES WHEN ITS OWN LINE CANNOT BE WRITTEN. An audit that can lose its evidence is worse than no audit: the
// owner would read a short file as a quiet member. So the line is written BEFORE the call runs, and a call whose line
// cannot be kept is refused — and that refusal is the only one an audited member can meet for a reason the owner
// never named, which is why auditing is asked for by name and never the default (../read_the_gate_mode).
//
// WHAT ONE LINE HOLDS, and never holds: the path id the text arrived on, the sender the record holds (a node id, or
// none, with the path's own reason when the recorder knew it), the tool class the call is, the refusal's exact words,
// and the moment. It holds no arrival's text: the record is what must not be readable to a model, and a file is just
// as readable as a record.
//
// READ BY THE PERSON ONLY. `martha gate --member <name>` prints these lines; no crew tool reads the folder, so an
// audited member's text cannot come back to a model through the record of it (../say_what_the_gate_does).

import { join } from 'node:path'

import type { Refused } from '../host_contract/host_contract.ts'
import { appendStateLine, readStateFile } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import type { Ingestion } from '../refuse_execution_after_ungated_text/refuse_execution_after_ungated_text.ts'

/** The folder inside the crew's own state directory that holds one file per audited member. */
export const GATE_AUDIT_PLACE = 'gate_would_refuse'

/** One member's audit lines, and the folder they live in. */
export interface GateAuditPlace {
  /** `<crew>/gate_would_refuse`, made 0700 with the crew's place. */
  readonly directory: string
  /** The member whose calls are audited. */
  readonly member: string
}

/** A refusal the gate would have given this call, before it was allowed to run. */
export interface AWouldRefusal {
  /** The tool class the call is, named as the caller named it. */
  readonly tool: string
  /** The arrival the gate refused on: its path, its sender, and why the recorder could not attribute one. */
  readonly arrival: Ingestion
  /** The refusal the gate gave, in its own exact words. */
  readonly refusal: string
}

/** The file one member's would-be refusals are kept in. */
export const auditFileIn = (place: GateAuditPlace): string => join(place.directory, `${place.member}.jsonl`)

/**
 * One line, as the owner reads it: the path, the sender and the reason there is none, the tool, the refusal's words,
 * and the moment. The line never carries the text that arrived.
 */
export function lineOfAWouldRefusal(refusal: AWouldRefusal, at: number): string {
  return JSON.stringify({
    at: new Date(at).toISOString(),
    path: refusal.arrival.path,
    sender: refusal.arrival.from_node_id,
    ...(refusal.arrival.why === undefined ? {} : { why: refusal.arrival.why }),
    tool: refusal.tool,
    refusal: refusal.refusal,
  })
}

/** Keeps one line for a refusal the gate would have given; or why it could not be kept. */
export function keepAWouldRefusal(place: GateAuditPlace, refusal: AWouldRefusal, at: number = Date.now()): Refused | undefined {
  return appendStateLine(auditFileIn(place), lineOfAWouldRefusal(refusal, at), 'would-be refusal')
}

/** One line an audited member's call left, read back for the owner. */
export type AnAuditLine = Readonly<Record<string, unknown>>

/** One line of the file as a would-be refusal, or undefined when it is not one. */
function anAuditLineOr(row: string): AnAuditLine | undefined {
  try {
    const parsed: unknown = JSON.parse(row)
    const isOne = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    return isOne ? (parsed as AnAuditLine) : undefined
  } catch {
    return undefined
  }
}

/** Every line this member's audit holds, oldest first; or why the file cannot be read as lines. */
export function theLinesIn(place: GateAuditPlace): readonly AnAuditLine[] | Refused {
  const read = readStateFile(auditFileIn(place))
  if ('refusal' in read) return read
  const written = read.text.split('\n').filter((line) => line !== '')
  const lines = written.map(anAuditLineOr)
  if (lines.includes(undefined)) return { refusal: `${auditFileIn(place)} holds a line that is not a would-be refusal.` }
  return lines.filter((line) => line !== undefined)
}
