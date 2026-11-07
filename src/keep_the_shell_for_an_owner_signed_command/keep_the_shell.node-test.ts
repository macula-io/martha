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
import { CLAUDE_CODE_BASH_RESULT_SHAPES, RECORDED_BASH_RESULTS } from '../claude_code_host/claude_code_bash_results.ts'

// Shapes of this repository's own, in the recorded host's two forms (a plain result, and the error form), so the
// rules below are held whatever the pinned host's answers look like: a status 0 result is an object, a status 1 one
// is the host's error string, and both carry the output where it was printed.
const [OK, FAILED] = RECORDED_STATUSES
const MARK = '\u0000run-output\u0000'
const shapeFor = (status: RecordedResultShape['status']): RecordedResultShape => ({
  status,
  output: 'some',
  mark: MARK,
  value: status === OK ? { stdout: MARK, stderr: '', interrupted: false } : { result: `Error: Exit code ${String(status)}\n${MARK}`, text: `Exit code ${String(status)}\n${MARK}`, isError: true },
})
const SHAPES = [shapeFor(OK), shapeFor(FAILED)]

const NAME = 'test'
const SIGNED = [NAME]
const OUTPUT = 'ok 1 - the suite passed\n'
const ID = 'toolu_01'

const receipt = (over: Partial<Receipt> = {}): Receipt => ({ tool_use_id: ID, name: NAME, status: OK, output: OUTPUT, output_sha256: sha256Of(OUTPUT), ...over })
const builtFor = (status: number = OK, output: string = OUTPUT): unknown => resultBuiltFrom(SHAPES, status, output)
const call = (over: Partial<AnsweredBash> = {}): AnsweredBash => ({ tool_use_id: ID, command: RUN_COMMAND_PREFIX + NAME, run_in_background: undefined, answer: builtFor(), ...over })

test('a signed run whose result is exactly the one its receipt builds keeps the shell', () => {
  assert.equal(keepsTheShell(call(), SIGNED, receipt(), SHAPES).why, undefined)
})

test('a failed signed run (status 1) keeps the shell when its result is the recorded one', () => {
  const failed = receipt({ status: FAILED })
  assert.equal(keepsTheShell(call({ answer: builtFor(FAILED, OUTPUT) }), SIGNED, failed, SHAPES).why, undefined)
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
  const built = builtFor() as Record<string, unknown>
  const variants = [
    { ...built, note: 'added' },
    { ...built, stderr: 'a stranger wrote here' },
    { ...built, stdout: `${OUTPUT}more` },
    { ...built, stdout: OUTPUT.slice(1) },
    Object.fromEntries(Object.entries(built).filter(([key]) => key !== 'stderr')),
    { ...built, exit: FAILED },
    JSON.stringify(built),
  ]
  for (const answer of variants) assert.equal(keepsTheShell(call({ answer }), SIGNED, receipt(), SHAPES).why, RESULT_DIFFERS, JSON.stringify(answer))
})

test('the order of a result\'s keys does not matter, its values do', () => {
  const built = builtFor() as Record<string, unknown>
  const reordered = Object.fromEntries(Object.entries(built).reverse())
  assert.equal(keepsTheShell(call({ answer: reordered }), SIGNED, receipt(), SHAPES).why, undefined)
})

// The recorded host answers put the output in two places: on its own, as a status 0 answer does, and after a prefix
// ("Error: Exit code 1\n" then the output), as a status 1 answer does. So the mark is replaced wherever it stands in
// the shape, at any depth, and the host's own prefix stays where it was.
test('the output replaces every mark in the shape, a prefixed one included', () => {
  const shape: RecordedResultShape = { status: FAILED, output: 'some', mark: MARK, value: { result: `Error: Exit code 1\n${MARK}`, nested: { list: [MARK] } } }
  const shown = 'ok 1 - the suite passed'
  assert.deepEqual(resultBuiltFrom([shape], FAILED, OUTPUT), { result: `Error: Exit code 1\n${shown}`, nested: { list: [shown] } })
})

// The shapes this repository ships are the host's own answers, not a guess: every case the recording holds for a
// status the exemption covers builds exactly the answer that was recorded, and a status it does not cover builds
// nothing, so a run that ended with it records A13 rather than an answer nobody saw.
test('the recorded shapes reproduce every recorded answer, and an unrecorded status builds none (#129)', () => {
  assert.ok(RECORDED_BASH_RESULTS.cases.length >= 4, 'the recording holds the answers the shapes are built from')
  for (const recorded of RECORDED_BASH_RESULTS.cases) {
    const shown = resultBuiltFrom(CLAUDE_CODE_BASH_RESULT_SHAPES, recorded.status, recorded.printed)
    const covered = (RECORDED_STATUSES as readonly number[]).includes(recorded.status)
    assert.deepEqual(shown, covered ? recorded.answer : undefined, `a run with status ${String(recorded.status)} printing ${JSON.stringify(recorded.printed)}`)
  }
  for (const status of RECORDED_STATUSES) {
    for (const output of ['some', 'none']) {
      assert.ok(CLAUDE_CODE_BASH_RESULT_SHAPES.some((shape) => shape.status === status && shape.output === output), `status ${String(status)} with ${output} output has its shape`)
    }
  }
})

test('a run is bound only to a foreground call whose command is exactly the prefix and a shape name', () => {
  assert.equal(runNameOf({ command: `${RUN_COMMAND_PREFIX}${NAME}` }), NAME)
  assert.equal(runNameOf({ command: `${RUN_COMMAND_PREFIX}${NAME}`, run_in_background: false }), NAME)
  for (const input of [{ command: `${RUN_COMMAND_PREFIX}${NAME}`, run_in_background: true }, { command: `${RUN_COMMAND_PREFIX}${NAME} ` }, { command: `${RUN_COMMAND_PREFIX}A` }, { command: `${RUN_COMMAND_PREFIX}${NAME};id` }, { command: 'npm test' }, {}]) {
    assert.equal(runNameOf(input), undefined, JSON.stringify(input))
  }
})
