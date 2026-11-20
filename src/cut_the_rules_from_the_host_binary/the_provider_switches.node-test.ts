// The variables that switch the host off its own API are cut from the gateway's gate and the host's one provider
// choice, the gateway's first and the chain's in its order, and only when there is exactly one of each
// (the_provider_switches.ts, martha#916 r=4). The texts are the recorded host's own shapes, written out with the
// recording's names.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { providerSwitchVariablesIn } from './the_provider_switches.ts'

/** The gateway's gate as 2.1.329 spells it, on the environment `env`. */
const gatewayGate = (variable: string, env = 's'): string =>
  `function Iws(){{if(!${env}.${variable})return!1;let e=${env}.ANTHROPIC_BASE_URL,n=${env}.ANTHROPIC_AUTH_TOKEN||JWt();if(!e||!n)return!1}}`

/** The provider choice as 2.1.329 spells it, testing `variables` on the environment `env`, each named after its variable. */
const providerChoice = (variables: readonly string[], env = 's'): string =>
  `function ve(){if(Po()||v7e()||Sre())return"gateway";return ${variables.map((name) => `${env}.${name}?"${name.toLowerCase()}":`).join('')}"firstParty"}`

const [GATEWAY = '', ...CHAIN] = RECORDED_HOST.provider_switch_variables

test('martha#916 r=4: the gateway\'s switch and the variables the provider choice tests are cut, in order, and they are the recording\'s', () => {
  assert.ok(CHAIN.length > 1, 'the recording names more than one cloud provider, so the order is pinned')
  assert.deepEqual(providerSwitchVariablesIn(`var a=1;${providerChoice(CHAIN)};${gatewayGate(GATEWAY)};var b=2`), { provider_switch_variables: RECORDED_HOST.provider_switch_variables })
  const added = [...CHAIN, 'A_PROVIDER_THIS_TEST_MADE_UP']
  assert.deepEqual(providerSwitchVariablesIn(`${gatewayGate('A_GATEWAY_THIS_TEST_MADE_UP')};${providerChoice(added)}`), { provider_switch_variables: ['A_GATEWAY_THIS_TEST_MADE_UP', ...added] })
})

test('martha#916 r=4: a host with no provider choice or no gateway gate, or two of either that differ, is refused', () => {
  assert.throws(() => providerSwitchVariablesIn(`${gatewayGate(GATEWAY)};function ve(){return"firstParty"}`), /0 provider choices/)
  assert.throws(() => providerSwitchVariablesIn(providerChoice(CHAIN)), /0 gateway switches/)
  assert.throws(() => providerSwitchVariablesIn(`${gatewayGate(GATEWAY)};${providerChoice(CHAIN)};${providerChoice(CHAIN.slice(1))}`), /2 provider choices/)
  assert.throws(() => providerSwitchVariablesIn(`${gatewayGate(GATEWAY)};${gatewayGate('ANOTHER_GATEWAY')};${providerChoice(CHAIN)}`), /2 gateway switches/)
  // The same choice and the same gate twice in a bundle are one of each.
  const twice = `${gatewayGate(GATEWAY)};${providerChoice(CHAIN)};${gatewayGate(GATEWAY)};${providerChoice(CHAIN)}`
  assert.deepEqual(providerSwitchVariablesIn(twice), { provider_switch_variables: RECORDED_HOST.provider_switch_variables })
})

test('martha#916 r=4: a choice whose tests read two environments is refused, and a gate whose reads do not share its environment is not a gate', () => {
  const mixed = providerChoice(CHAIN).replace(`s.${CHAIN[0] ?? ''}?`, `t.${CHAIN[0] ?? ''}?`)
  assert.throws(() => providerSwitchVariablesIn(`${gatewayGate(GATEWAY)};${mixed}`), /reads 2 environments/)
  const split = gatewayGate(GATEWAY).replace('e=s.ANTHROPIC_BASE_URL', 'e=t.ANTHROPIC_BASE_URL')
  assert.throws(() => providerSwitchVariablesIn(`${split};${providerChoice(CHAIN)}`), /0 gateway switches/)
})
