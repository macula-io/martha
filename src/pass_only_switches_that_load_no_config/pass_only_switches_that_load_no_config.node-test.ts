// The owner's words for the host after `martha start <member> --`: only switches that load no config pass (martha#2 row A15).

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { passesOnlySwitchesThatLoadNoConfig, SWITCHES_THAT_LOAD_NO_CONFIG, unpassedOwnerArgument } from './pass_only_switches_that_load_no_config.ts'

test('every switch on the list passes, each with a value when it takes one', () => {
  const args = Object.entries(SWITCHES_THAT_LOAD_NO_CONFIG).flatMap(([name, takes]) => (takes === 'value' ? [name, 'a-value'] : [name]))
  assert.equal(unpassedOwnerArgument(args), undefined)
  assert.equal(passesOnlySwitchesThatLoadNoConfig(args), true)
})

test('the first word that may not pass is named, and so is every switch that does', () => {
  const why = unpassedOwnerArgument(['--verbose', '--settings', '{}', 'a prompt']) ?? ''
  assert.ok(why.startsWith('--settings '), why)
  for (const name of Object.keys(SWITCHES_THAT_LOAD_NO_CONFIG)) assert.ok(why.includes(name), why)
})

test('a value switch with no value, or with a switch for its value, does not pass', () => {
  const [value_switch] = Object.entries(SWITCHES_THAT_LOAD_NO_CONFIG).find(([, takes]) => takes === 'value')!
  assert.equal(passesOnlySwitchesThatLoadNoConfig([value_switch]), false)
  assert.equal(passesOnlySwitchesThatLoadNoConfig([value_switch, '--plugin-dir', 'x']), false)
})

test('a switch spelled with its value after = is not the switch, and does not pass', () => {
  const [value_switch] = Object.entries(SWITCHES_THAT_LOAD_NO_CONFIG).find(([, takes]) => takes === 'value')!
  assert.equal(passesOnlySwitchesThatLoadNoConfig([`${value_switch}=a-value`]), false)
})
