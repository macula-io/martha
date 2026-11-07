// Whether a `Bash` result keeps the member's shell (martha#129, design step 4, with r=3): nothing is recorded only
// when the call was exactly `martha run <name>` for a shape the owner signed, a receipt the launcher kept for this
// very call matches, and the host's whole answer equals the one built from that receipt. Every other `Bash` result
// records A13, as #127 does.
//
//   - The command is compared byte for byte with RUN_COMMAND_PREFIX + name; nothing is parsed. A call run in the
//     background is never exempt.
//   - The receipt is single use and bound to the call's tool_use_id, taken from the relay's own tool_called.
//   - The answer is compared as a whole value with the one built from the receipt's output and status by the
//     answers the pinned host was recorded giving (RecordedResultShape, ../claude_code_host). An extra key, a
//     non-empty stderr, an error field, a truncation, a reminder another hook added (`context`) or an added note is
//     a different value. One key is left out of both sides: `ref`, the host's count of the messages it produced for
//     the call, which is a number and carries no text the model reads.
//   - The recorded answers cover statuses 0 and 1 only. Any other status (2, 127, 137, a signal) records A13, named
//     as an unrecorded status: the host's answer for it was not recorded and is not guessed.

import { createHash } from 'node:crypto'

import { SHAPE_NAME } from './command_shapes.ts'

/** What the member types to run a shape: this, then the shape's name, and nothing else. */
export const RUN_COMMAND_PREFIX = 'martha run '
/** The statuses whose host result was recorded. */
export const RECORDED_STATUSES = [0, 1] as const

/** Whether a run printed anything the host shows: the recorded answers differ between the two. */
export type RecordedOutput = 'some' | 'none'

/**
 * One answer the pinned host was recorded giving to `martha run <name>`: for a status, with output or without,
 * its value with the printed output written as `mark` wherever the host put it.
 */
export interface RecordedResultShape {
  readonly status: (typeof RECORDED_STATUSES)[number]
  readonly output: RecordedOutput
  readonly mark: string
  readonly value: unknown
}

/** What the launcher kept when it ran a shape for one call. */
export interface Receipt {
  readonly tool_use_id: string
  readonly name: string
  readonly status: number
  readonly output_sha256: string
  /** The output itself, to build the result the host should show; kept only until the call is answered. */
  readonly output: string
}

/** A `Bash` call as the host answered it: `answer` is what the host's tool.call resolved to, as the relay sent it. */
export interface AnsweredBash {
  readonly tool_use_id: string
  readonly command: unknown
  readonly run_in_background: unknown
  readonly answer: unknown
}

export interface ShellDecision {
  /** undefined keeps the shell; a reason records A13. */
  readonly why: string | undefined
}

/** The sha256, in hex, of a run's output. */
export const sha256Of = (output: Buffer | string): string => createHash('sha256').update(output).digest('hex')

/** Why a command is not a run of a signed shape. */
export const NOT_A_SIGNED_RUN = `the command is not ${RUN_COMMAND_PREFIX}<a shape the owner signed>`
/** Why a call run in the background keeps nothing. */
export const RUN_IN_BACKGROUND = 'a call run in the background never keeps the shell'
/** Why a receipt whose output does not hash to what it names keeps nothing. */
export const RECEIPT_TAMPERED = 'the receipt does not hold the output it hashed'
/** Why a result other than the one the run gave keeps nothing. */
export const RESULT_DIFFERS = 'the result is not the one the run gave'

/** Whether this `Bash` result keeps the shell, given the shapes the owner signed and the receipt kept for the call. */
export function keepsTheShell(call: AnsweredBash, signed_names: readonly string[], receipt: Receipt | undefined, shapes: readonly RecordedResultShape[]): ShellDecision {
  const named = shapeNameOf(call, signed_names)
  return 'why' in named ? named : receiptDecision(call, named.name, receipt, shapes)
}

function shapeNameOf(call: AnsweredBash, signed_names: readonly string[]): { readonly name: string } | ShellDecision {
  if (call.run_in_background !== undefined && call.run_in_background !== false) return { why: RUN_IN_BACKGROUND }
  if (typeof call.command !== 'string' || !call.command.startsWith(RUN_COMMAND_PREFIX)) return { why: NOT_A_SIGNED_RUN }
  const name = call.command.slice(RUN_COMMAND_PREFIX.length)
  return signed_names.includes(name) ? { name } : { why: NOT_A_SIGNED_RUN }
}

function receiptDecision(call: AnsweredBash, name: string, receipt: Receipt | undefined, shapes: readonly RecordedResultShape[]): ShellDecision {
  if (receipt === undefined || receipt.tool_use_id !== call.tool_use_id || receipt.name !== name) return { why: `no receipt was kept for this ${RUN_COMMAND_PREFIX}${name}` }
  if (sha256Of(receipt.output) !== receipt.output_sha256) return { why: RECEIPT_TAMPERED }
  const built = resultBuiltFrom(shapes, receipt.status, receipt.output)
  if (built === undefined) return { why: `the run ended with status ${receipt.status}, whose host result was not recorded` }
  return canonical(withoutRef(call.answer)) === canonical(built) ? { why: undefined } : { why: RESULT_DIFFERS }
}

/** The host's count of the messages it produced for the call: a number, never text the model reads. */
export const HOST_MESSAGE_COUNT = 'ref'

/** The answer with HOST_MESSAGE_COUNT left out, when it is a number; every other key stays. */
function withoutRef(answer: unknown): unknown {
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) return answer
  const { [HOST_MESSAGE_COUNT]: count, ...rest } = answer as Readonly<Record<string, unknown>>
  return typeof count === 'number' ? rest : answer
}

/**
 * The shape a `Bash` call asks to run: its name when the command is exactly RUN_COMMAND_PREFIX and a name a list
 * may hold, in the foreground; undefined for every other call. The launcher binds a run only to such a call.
 */
export function runNameOf(input: { readonly command?: unknown; readonly run_in_background?: unknown }): string | undefined {
  if (input.run_in_background !== undefined && input.run_in_background !== false) return undefined
  if (typeof input.command !== 'string' || !input.command.startsWith(RUN_COMMAND_PREFIX)) return undefined
  const name = input.command.slice(RUN_COMMAND_PREFIX.length)
  return SHAPE_NAME.test(name) ? name : undefined
}

/**
 * The output as the recorded host shows it: leading empty lines and trailing white space left out. A host that
 * shows it otherwise gives an answer that differs from the one built here, which records A13: a wrong rule can
 * only take the exemption away, never give it.
 */
export function hostShown(output: string): string {
  return output.replace(/^\n+/, '').trimEnd()
}

/** The answer the recorded host gives for a run that ended with `status` and printed `output`; undefined when none was recorded. */
export function resultBuiltFrom(shapes: readonly RecordedResultShape[], status: number, output: string): unknown {
  const shown = hostShown(output)
  const shape = shapes.find((recorded) => recorded.status === status && recorded.output === (shown === '' ? 'none' : 'some'))
  return shape === undefined ? undefined : replaced(shape.value, shape.mark, shown)
}

function replaced(value: unknown, mark: string, shown: string): unknown {
  if (typeof value === 'string') return value.split(mark).join(shown)
  if (Array.isArray(value)) return value.map((item) => replaced(item, mark, shown))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaced(item, mark, shown)]))
}

/** JSON with every object's keys sorted: two values are equal exactly when these strings are. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item,
  )
}
