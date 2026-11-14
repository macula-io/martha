import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  GATE_AUDITS,
  GATE_ENFORCES,
  gateModeFor,
  gateSettingOf,
  type GateRefused,
  type GateSetting,
} from './read_the_gate_mode.ts'

// The crew these readings are about: two enforced, one audited, one in neither.
const members = ['Mars', 'Ceres', 'Juno']

const setting = (houseRules: Record<string, unknown> | undefined, crew = members): GateSetting => {
  const read = gateSettingOf(houseRules, crew)
  assert.ok(!('refused' in read) || read.refused !== true, `refused: ${JSON.stringify(read)}`)
  return read as GateSetting
}

const refused = (houseRules: Record<string, unknown>, crew = members): GateRefused => {
  const read = gateSettingOf(houseRules, crew)
  assert.ok('refused' in read && read.refused === true, `not refused: ${JSON.stringify(read)}`)
  return read
}

test('#321: an absent gate_enforces and an absent strict_gate are off — no call is refused and no audit line is written', () => {
  for (const houseRules of [undefined, {}, { dashboard: true, owner_bell: true }]) {
    const read = setting(houseRules)
    assert.equal(read.kind, 'off')
    for (const member of members) assert.equal(gateModeFor(read, member), 'off', `${member} under ${JSON.stringify(houseRules)}`)
  }
})

test('#321: a declaration naming strict_gate true reads as enforced every member, and one naming it false reads as off', () => {
  const on = setting({ strict_gate: true })
  assert.equal(on.kind, 'every-member')
  for (const member of members) assert.equal(gateModeFor(on, member), 'enforced')

  const off = setting({ strict_gate: false })
  assert.equal(off.kind, 'off')
  for (const member of members) assert.equal(gateModeFor(off, member), 'off')
})

test('#321: gate_enforces nobody audits every member, all enforces every member', () => {
  const audited = setting({ [GATE_ENFORCES]: 'nobody' })
  const enforced = setting({ [GATE_ENFORCES]: 'all' })
  for (const member of members) {
    assert.equal(gateModeFor(audited, member), 'audited')
    assert.equal(gateModeFor(enforced, member), 'enforced')
  }
})

test('#321: gate_enforces names the members it enforces for, and every member it does not name is off', () => {
  const read = setting({ [GATE_ENFORCES]: ['Mars', 'Ceres'] })
  assert.equal(gateModeFor(read, 'Mars'), 'enforced')
  assert.equal(gateModeFor(read, 'ceres'), 'enforced', 'names are compared ignoring case')
  assert.equal(gateModeFor(read, 'Juno'), 'off', 'a member in neither list is off, never audited')
})

test('#321: gate_audits names a member to audit while another stays off', () => {
  const read = setting({ [GATE_AUDITS]: ['Juno'] })
  assert.equal(gateModeFor(read, 'Juno'), 'audited')
  assert.equal(gateModeFor(read, 'Mars'), 'off')
})

test('#321: the two lists together hold one member each, and a member in both is refused naming both', () => {
  const both = setting({ [GATE_ENFORCES]: ['Mars'], [GATE_AUDITS]: ['Juno'] })
  assert.equal(gateModeFor(both, 'Mars'), 'enforced')
  assert.equal(gateModeFor(both, 'Juno'), 'audited')
  assert.equal(gateModeFor(both, 'Ceres'), 'off')

  const clash = refused({ [GATE_ENFORCES]: ['Mars'], [GATE_AUDITS]: ['Mars'] })
  assert.equal(clash.field, GATE_AUDITS)
  assert.match(clash.why, /Mars/)
})

test('#321: a name the declaration does not know is refused by name', () => {
  const read = refused({ [GATE_ENFORCES]: ['NobodyOnThisCrew'] })
  assert.equal(read.field, `${GATE_ENFORCES}[0]`)
  assert.match(read.why, /NobodyOnThisCrew/)
})

test('#321: all or nobody beside the audit list is refused, never resolved silently in a security switch', () => {
  assert.equal(refused({ [GATE_ENFORCES]: 'all', [GATE_AUDITS]: ['Juno'] }).field, GATE_AUDITS)
  assert.equal(refused({ [GATE_ENFORCES]: 'nobody', [GATE_AUDITS]: ['Juno'] }).field, GATE_AUDITS)
})

test('#321: a field that names nobody is refused, so an empty list cannot read as off by accident', () => {
  assert.equal(refused({ [GATE_ENFORCES]: [] }).field, GATE_ENFORCES)
  assert.equal(refused({ [GATE_AUDITS]: [] }).field, GATE_AUDITS)
})

test('#321: gate_enforces that is neither a word nor a list is refused', () => {
  assert.equal(refused({ [GATE_ENFORCES]: 3 }).field, GATE_ENFORCES)
  assert.equal(refused({ [GATE_ENFORCES]: true }).field, GATE_ENFORCES)
})
