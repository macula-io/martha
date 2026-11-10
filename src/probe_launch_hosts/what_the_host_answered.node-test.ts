// Two facts a memory row must not confuse (martha#223): an answer that did not name the
// codeword, and a run that gave no answer at all. The first is what the off switch is supposed
// to produce; the second is a row that proves nothing and used to read the same. These tests
// hold the reading of the host's own answer to telling them apart, and hold every way of
// saying nothing to failing the row rather than satisfying it.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { answerIn } from './what_the_host_answered.ts'
import { codewordVerdict } from './probe_hosts.ts'

const CODEWORD = 'ZEBRA0123abcd'
const asResult = (fields: Readonly<Record<string, unknown>>) => JSON.stringify({ type: 'result', ...fields })
const AN_ERROR = asResult({ subtype: 'error_max_turns', is_error: true, result: 'Error: Reached max turns (4)' })
const anAnswer = (text: string) => asResult({ subtype: 'success', is_error: false, result: text })

test('a run that stopped on its turn budget did not answer, and names why it stopped (martha#223)', () => {
  const answer = answerIn(AN_ERROR)
  assert.equal(answer.answered, false)
  assert.match(answer.why, /Reached max turns \(4\)/)
})

test('the codeword row reads "not said" only from an answer that was given (martha#223)', () => {
  assert.equal(codewordVerdict(anAnswer(`The codeword is ${CODEWORD}.`), CODEWORD), true)
  assert.equal(codewordVerdict(anAnswer('NONE'), CODEWORD), false)
})

test('no way of saying nothing is read as the codeword not being said (martha#223)', () => {
  const waysNothingWasSaid: readonly string[] = [AN_ERROR, anAnswer('   '), asResult({ subtype: 'success', is_error: false }), 'Error: Reached max turns (1)\n', '']
  for (const nothingSaid of waysNothingWasSaid) {
    const verdict = codewordVerdict(nothingSaid, CODEWORD)
    assert.notEqual(verdict, false, `silence was read as "the codeword was not said": ${nothingSaid}`)
    assert.match(String(verdict), /^no answer to judge: /, `the row did not say it had nothing to judge: ${nothingSaid}`)
  }
})

test('a run that printed no json is answered with why, not with a guess (martha#223)', () => {
  assert.equal(answerIn('Error: Reached max turns (1)\n').why, 'the host printed no answer of its own')
})
