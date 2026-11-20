// The variables that move the host onto a cloud provider are cut from its one provider choice, in its order, and only
// when there is exactly one (the_cloud_providers.ts, martha#916 r=4). The text is the recorded host's own shape,
// written out with the recording's names.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import { cloudProviderVariablesIn } from './the_cloud_providers.ts'

/** The provider choice as 2.1.329 spells it, testing `variables` on the environment `env`, each named after its variable. */
const providerChoice = (variables: readonly string[], env = 's'): string =>
  `function ve(){if(Po()||v7e()||Sre())return"gateway";return ${variables.map((name) => `${env}.${name}?"${name.toLowerCase()}":`).join('')}"firstParty"}`

const RECORDED = RECORDED_HOST.cloud_provider_variables

test('martha#916 r=4: the variables the provider choice tests are cut, in its order, and they are the recording\'s', () => {
  assert.ok(RECORDED.length > 1, 'the recording names more than one provider, so the order is pinned')
  assert.deepEqual(cloudProviderVariablesIn(`var a=1;${providerChoice(RECORDED)};var b=2`), { cloud_provider_variables: RECORDED })
  const added = [...RECORDED, 'A_PROVIDER_THIS_TEST_MADE_UP']
  assert.deepEqual(cloudProviderVariablesIn(providerChoice(added)), { cloud_provider_variables: added })
})

test('martha#916 r=4: a host with no provider choice, or two that name different variables, is refused', () => {
  assert.throws(() => cloudProviderVariablesIn('function ve(){return"firstParty"}'), /0 provider choices/)
  assert.throws(() => cloudProviderVariablesIn(`${providerChoice(RECORDED)};${providerChoice(RECORDED.slice(1))}`), /2 provider choices/)
  // The same choice twice in a bundle is one choice.
  assert.deepEqual(cloudProviderVariablesIn(`${providerChoice(RECORDED)};${providerChoice(RECORDED)}`), { cloud_provider_variables: RECORDED })
})

test('martha#916 r=4: a choice whose tests read two environments is refused', () => {
  const mixed = providerChoice(RECORDED).replace(`s.${RECORDED[0] ?? ''}?`, `t.${RECORDED[0] ?? ''}?`)
  assert.throws(() => cloudProviderVariablesIn(mixed), /reads 2 environments/)
})
