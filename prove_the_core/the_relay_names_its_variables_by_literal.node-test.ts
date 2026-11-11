import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'

import { RELAY_SOCKET_VARIABLE } from '../src/claude_code_relay/hooks/relay_protocol.ts'
import { environmentReadsOf } from './the_relay_names_its_variables_by_literal.ts'

const HOOKS = dirname(new URL('../src/claude_code_relay/hooks/hooks.json', import.meta.url).pathname)

/**
 * Every module of the relay this repository compiles itself: the `.ts` files of its hooks folder, whichever of them
 * the entry hands the registration to. A `.tsx` module is compiled by the host that loads it, which refuses a computed
 * variable name just the same; CI's "the relay loads in the recorded host" is what reads those. Reading the folder
 * rather than the list is what keeps a module from slipping past by being imported rather than listed.
 */
function modulesTheHostLoads(): readonly string[] {
  return readdirSync(HOOKS)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(HOOKS, name))
}

test('every module the host loads names every variable it reads by a literal, the name the protocol defines', () => {
  // Every module, not the one the rule was written for (martha#254): a second module is exactly how a call that
  // names its variable would otherwise slip past, and a refused module leaves every gate a member has off.
  for (const module of modulesTheHostLoads()) {
    const reads = environmentReadsOf(readFileSync(module, 'utf8'), module)
    for (const { line, name } of reads) {
      const got = name === null ? 'something that is not a literal name' : `the literal ${name}`
      assert.equal(name, RELAY_SOCKET_VARIABLE, `${module}:${line} reads $.env by ${got}; the host refuses the module unless it is the literal ${RELAY_SOCKET_VARIABLE}`)
    }
  }
  // Every .ts module the entry hands the registration to, register.ts among them, is read here; a new one is read by
  // the loop above without being named again.
  const register = modulesTheHostLoads().find((module) => module.endsWith('register.ts'))
  assert.ok(register !== undefined, 'the relay is among the modules')
  assert.notEqual(environmentReadsOf(readFileSync(register, 'utf8'), register).length, 0, "the relay reads the launcher's socket from its environment")
})

test('the literal-name check bites: a constant, a template with a substitution and no name are each caught', () => {
  for (const call of ['$.env.get(RELAY_SOCKET_VARIABLE)', '$.env.get(`${prefix}_SOCKET`)', '$.env.get()']) {
    assert.deepEqual(environmentReadsOf(`async ($) => ${call}`, 'probe.ts').map(({ name }) => name), [null], call)
  }
  const literal = environmentReadsOf(`async ($) => $.env.get('${RELAY_SOCKET_VARIABLE}')`, 'probe.ts')
  assert.deepEqual(literal.map(({ name }) => name), [RELAY_SOCKET_VARIABLE])
})
