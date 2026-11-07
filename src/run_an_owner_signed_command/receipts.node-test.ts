import assert from 'node:assert/strict'
import { test } from 'node:test'

import { sha256Of } from '../keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'
import { receiptsInMemory, TWO_PENDING } from './receipts.ts'

const ENDED = { output: Buffer.from('ok\n'), status: 0 }

test('a run binds to the one pending call of its name, and its receipt is taken once', () => {
  const receipts = receiptsInMemory()
  receipts.callPending('toolu_01', 'test')
  assert.deepEqual(receipts.claim('test'), { tool_use_id: 'toolu_01' })
  receipts.keep('toolu_01', 'test', ENDED)
  assert.deepEqual(receipts.take('toolu_01'), { tool_use_id: 'toolu_01', name: 'test', status: 0, output: 'ok\n', output_sha256: sha256Of('ok\n') })
  assert.equal(receipts.take('toolu_01'), undefined)
})

test('a run with no pending call, or for another name, binds to nothing', () => {
  const receipts = receiptsInMemory()
  assert.match(String(receipts.claim('test')), /no martha run test call is pending/)
  receipts.callPending('toolu_01', 'lint')
  assert.match(String(receipts.claim('test')), /no martha run test call is pending/)
})

test('two pending calls refuse the run, so neither can take the other one\'s receipt', () => {
  const receipts = receiptsInMemory()
  receipts.callPending('toolu_01', 'test')
  receipts.callPending('toolu_02', 'test')
  assert.equal(receipts.claim('test'), TWO_PENDING)
})

test('a pending call is claimed once: a second run for it binds to nothing', () => {
  const receipts = receiptsInMemory()
  receipts.callPending('toolu_01', 'test')
  receipts.claim('test')
  assert.match(String(receipts.claim('test')), /no martha run test call is pending/)
})

test('a result kept for a call that was never claimed is not kept', () => {
  const receipts = receiptsInMemory()
  receipts.callPending('toolu_01', 'test')
  receipts.keep('toolu_01', 'test', ENDED)
  assert.equal(receipts.take('toolu_01'), undefined)
})

test('a call answered without a run leaves nothing pending', () => {
  const receipts = receiptsInMemory()
  receipts.callPending('toolu_01', 'test')
  assert.equal(receipts.take('toolu_01'), undefined)
  receipts.callPending('toolu_02', 'test')
  assert.deepEqual(receipts.claim('test'), { tool_use_id: 'toolu_02' })
})
