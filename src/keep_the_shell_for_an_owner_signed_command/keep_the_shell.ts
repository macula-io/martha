// Whether a `Bash` result keeps the member's shell (martha#129, design step 4, with r=3): nothing is recorded only
// when the call was exactly `martha run <name>` for a shape the owner signed, a receipt the launcher kept for this
// very call matches, and the whole result equals the one built from that receipt. Every other `Bash` result
// records A13, as #127 does.
//
//   - The command is compared byte for byte with RUN_COMMAND_PREFIX + name; nothing is parsed. A call run in the
//     background is never exempt.
//   - The receipt is single use and bound to the call's tool_use_id, taken from the relay's own tool_called.
//   - The result is compared as a whole value with the one built from the receipt's output and status by the
//     shape the pinned host was recorded giving (RecordedResultShape). An extra key, a non-empty stderr, an error
//     field, a truncation or an added note is a different value: nothing is stripped or searched for.
//   - The recorded shape covers statuses 0 and 1 only. Any other status (2, 127, 137, a signal) records A13, named
//     as an unrecorded status: the host's result for it was not recorded and is not guessed.

import { createHash } from 'node:crypto'

/** What the member types to run a shape: this, then the shape's name, and nothing else. */
export const RUN_COMMAND_PREFIX = 'martha run '
/** The statuses whose host result was recorded. */
export const RECORDED_STATUSES = [0, 1] as const

/** One recorded host result: its value with the run's output replaced by `placeholder`, which occurs once. */
export interface RecordedResultShape {
  readonly status: (typeof RECORDED_STATUSES)[number]
  readonly placeholder: string
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

/** A `Bash` call as the host answered it. */
export interface AnsweredBash {
  readonly tool_use_id: string
  readonly command: unknown
  readonly run_in_background: unknown
  readonly result: unknown
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
  const shape = shapes.find((recorded) => recorded.status === receipt.status)
  if (shape === undefined) return { why: `the run ended with status ${receipt.status}, whose host result was not recorded` }
  return canonical(call.result) === canonical(resultBuiltFrom(shape, receipt.output)) ? { why: undefined } : { why: RESULT_DIFFERS }
}

/** The recorded value with the placeholder string replaced by `output`, wherever a string equals it. */
export function resultBuiltFrom(shape: RecordedResultShape, output: string): unknown {
  return replaced(shape.value, shape.placeholder, output)
}

function replaced(value: unknown, placeholder: string, output: string): unknown {
  if (typeof value === 'string') return value === placeholder ? output : value
  if (Array.isArray(value)) return value.map((item) => replaced(item, placeholder, output))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaced(item, placeholder, output)]))
}

/** JSON with every object's keys sorted: two values are equal exactly when these strings are. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'object' && item !== null && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : item,
  )
}
