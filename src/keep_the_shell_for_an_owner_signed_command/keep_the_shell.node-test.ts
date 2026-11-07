import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  keepsTheShell,
  NOT_A_SIGNED_RUN,
  RECEIPT_TAMPERED,
  RECORDED_STATUSES,
  RESULT_DIFFERS,
  resultBuiltFrom,
  RUN_COMMAND_PREFIX,
  RUN_IN_BACKGROUND,
  runNameOf,
  sha256Of,
  type AnsweredBash,
  type Receipt,
  type RecordedResultShape,
} from './keep_the_shell.ts'

// A stand-in for the recorded host shapes, until the host's own are recorded: the shape's keys are not what
// these tests are about, only that the result must equal the value built from the receipt, whole.
const [OK, FAILED] = RECORDED_STATUSES
const PLACEHOLDER = '\u0000run-output\u0000'
const shapeFor = (status: RecordedResultShape['status']): RecordedResultShape => ({ status, placeholder: PLACEHOLDER, value: { stdout: PLACEHOLDER, stderr: '', interrupted: false, exit: status } })
const SHAPES = [shapeFor(OK), shapeFor(FAILED)]

const NAME = 'test'
const SIGNED = [NAME]
const OUTPUT = 'ok 1 - the suite passed\n'
const ID = 'toolu_01'

const receipt = (over: Partial<Receipt> = {}): Receipt => ({ tool_use_id: ID, name: NAME, status: OK, output: OUTPUT, output_sha256: sha256Of(OUTPUT), ...over })
const call = (over: Partial<AnsweredBash> = {}): AnsweredBash => ({ tool_use_id: ID, command: RUN_COMMAND_PREFIX + NAME, run_in_background: undefined, result: resultBuiltFrom(shapeFor(OK), OUTPUT), ...over })

test('a signed run whose result is exactly the one its receipt builds keeps the shell', () => {
  assert.equal(keepsTheShell(call(), SIGNED, receipt(), SHAPES).why, undefined)
})

test('a failed signed run (status 1) keeps the shell when its result is the recorded one', () => {
  const failed = receipt({ status: FAILED })
  assert.equal(keepsTheShell(call({ result: resultBuiltFrom(shapeFor(FAILED), OUTPUT) }), SIGNED, failed, SHAPES).why, undefined)
})

test('any other command, or a name the owner did not sign, is not a signed run', () => {
  for (const command of ['npm test', `${RUN_COMMAND_PREFIX}other`, `${RUN_COMMAND_PREFIX}${NAME} `, ` ${RUN_COMMAND_PREFIX}${NAME}`, `${RUN_COMMAND_PREFIX}${NAME}; cat secrets`, `${RUN_COMMAND_PREFIX}${NAME}\nid`, 42]) {
    assert.equal(keepsTheShell(call({ command }), SIGNED, receipt(), SHAPES).why, NOT_A_SIGNED_RUN, String(command))
  }
})

test('a call run in the background never keeps the shell', () => {
  for (const run_in_background of [true, 'true', 1]) {
    assert.equal(keepsTheShell(call({ run_in_background }), SIGNED, receipt(), SHAPES).why, RUN_IN_BACKGROUND)
  }
  assert.equal(keepsTheShell(call({ run_in_background: false }), SIGNED, receipt(), SHAPES).why, undefined)
})

test('no receipt, or a receipt for another call or another shape, keeps nothing', () => {
  for (const kept of [undefined, receipt({ tool_use_id: 'toolu_02' }), receipt({ name: 'other' })]) {
    assert.match(keepsTheShell(call(), SIGNED, kept, SHAPES).why ?? '', /no receipt was kept/)
  }
})

test('a receipt whose output does not hash to what it names keeps nothing', () => {
  assert.equal(keepsTheShell(call(), SIGNED, receipt({ output_sha256: sha256Of('other') }), SHAPES).why, RECEIPT_TAMPERED)
})

test('a status whose host result was not recorded is named, never guessed', () => {
  for (const status of [2, 127, 137]) {
    assert.match(keepsTheShell(call(), SIGNED, receipt({ status }), SHAPES).why ?? '', new RegExp(`status ${status}, whose host result was not recorded`))
  }
})

test('a result with anything added, removed or changed is not the one the run gave', () => {
  const built = resultBuiltFrom(shapeFor(OK), OUTPUT) as Record<string, unknown>
  const variants = [
    { ...built, note: 'added' },
    { ...built, stderr: 'a stranger wrote here' },
    { ...built, stdout: `${OUTPUT}more` },
    { ...built, stdout: OUTPUT.slice(1) },
    Object.fromEntries(Object.entries(built).filter(([key]) => key !== 'stderr')),
    { ...built, exit: FAILED },
    JSON.stringify(built),
  ]
  for (const result of variants) assert.equal(keepsTheShell(call({ result }), SIGNED, receipt(), SHAPES).why, RESULT_DIFFERS, JSON.stringify(result))
})

test('the order of a result\'s keys does not matter, its values do', () => {
  const built = resultBuiltFrom(shapeFor(OK), OUTPUT) as Record<string, unknown>
  const reordered = Object.fromEntries(Object.entries(built).reverse())
  assert.equal(keepsTheShell(call({ result: reordered }), SIGNED, receipt(), SHAPES).why, undefined)
})

test('the output replaces only a string equal to the placeholder, not one that contains it', () => {
  const shape: RecordedResultShape = { status: OK, placeholder: PLACEHOLDER, value: { stdout: PLACEHOLDER, note: `x${PLACEHOLDER}`, list: [PLACEHOLDER, 1] } }
  assert.deepEqual(resultBuiltFrom(shape, OUTPUT), { stdout: OUTPUT, note: `x${PLACEHOLDER}`, list: [OUTPUT, 1] })
})

test('a run is bound only to a foreground call whose command is exactly the prefix and a shape name', () => {
  assert.equal(runNameOf({ command: `${RUN_COMMAND_PREFIX}${NAME}` }), NAME)
  assert.equal(runNameOf({ command: `${RUN_COMMAND_PREFIX}${NAME}`, run_in_background: false }), NAME)
  for (const input of [{ command: `${RUN_COMMAND_PREFIX}${NAME}`, run_in_background: true }, { command: `${RUN_COMMAND_PREFIX}${NAME} ` }, { command: `${RUN_COMMAND_PREFIX}A` }, { command: `${RUN_COMMAND_PREFIX}${NAME};id` }, { command: 'npm test' }, {}]) {
    assert.equal(runNameOf(input), undefined, JSON.stringify(input))
  }
})
