import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { RELAY_SOCKET_VARIABLE } from '../src/claude_code_relay/hooks/relay_protocol.ts'
import { environmentReadsOf } from './the_relay_names_its_variables_by_literal.ts'

const REGISTER = new URL('../src/claude_code_relay/hooks/register.ts', import.meta.url)

test('the relay names every variable it reads by a literal, the name the protocol defines, as the host demands', () => {
  const reads = environmentReadsOf(readFileSync(REGISTER, 'utf8'), REGISTER.pathname)
  assert.notEqual(reads.length, 0, "the relay reads the launcher's socket from its environment")
  for (const { line, name } of reads) {
    const got = name === null ? 'something that is not a literal name' : `the literal ${name}`
    assert.equal(name, RELAY_SOCKET_VARIABLE, `hooks/register.ts:${line} reads $.env by ${got}; the host refuses the module unless it is the literal ${RELAY_SOCKET_VARIABLE}`)
  }
})

test('the literal-name check bites: a constant, a template with a substitution and no name are each caught', () => {
  for (const call of ['$.env.get(RELAY_SOCKET_VARIABLE)', '$.env.get(`${prefix}_SOCKET`)', '$.env.get()']) {
    assert.deepEqual(environmentReadsOf(`async ($) => ${call}`, 'probe.ts').map(({ name }) => name), [null], call)
  }
  const literal = environmentReadsOf(`async ($) => $.env.get('${RELAY_SOCKET_VARIABLE}')`, 'probe.ts')
  assert.deepEqual(literal.map(({ name }) => name), [RELAY_SOCKET_VARIABLE])
})
