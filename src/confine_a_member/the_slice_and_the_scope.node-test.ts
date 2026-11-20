// The slice unit and the scope wrap (martha#989, C1, C2, C7, C8): the unit carries the declaration's two values and no
// number of its own, and the wrap places the member's own command last, unchanged, in a scope named for the member.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONFINEMENT_THAT_INIT_WRITES, type AConfinement } from '../declare_crew/the_crews_confinement.ts'
import { CLAUDE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { THE_RESUME_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { SYSTEMD_RUN, theScopeUnitOf, theScopeWrapped, theSliceUnitOf } from './the_slice_and_the_scope.ts'

/** A confinement none of whose values is the one `martha init` writes, so a default read would show. */
const DECLARED: AConfinement = {
  slice: 'tests.slice',
  slice_cpu_quota: '1234%',
  slice_cpu_weight: 21,
  member_cpu_quota: '321%',
  member_cpu_weight: 77,
  systemd_only_bus: { unit: 'tests-bus', socket: 'tests-bus-socket' },
}

test('#989 C7: the slice unit holds the declaration\'s two values, and no value of Martha\'s own', () => {
  assert.equal(
    theSliceUnitOf(DECLARED),
    ['[Unit]', 'Description=Crew members and everything they start (Martha\'s own CPU ceiling)', '', '[Slice]', 'CPUQuota=1234%', 'CPUWeight=21', ''].join('\n'),
  )
  assert.doesNotMatch(theSliceUnitOf(DECLARED), new RegExp(CONFINEMENT_THAT_INIT_WRITES.slice_cpu_quota), 'the unit carries the value init writes instead of the one declared')
})

test('#989 C1, C2, C8: a member starts in a scope of its own, in the declared slice, with the declared values, and its command last', () => {
  const wrapped = theScopeWrapped(DECLARED, 'Vesta', 4321, `/usr/bin/${CLAUDE}`, [THE_RESUME_SWITCH, '$NOT_EXPANDED'])
  assert.equal(wrapped.command, SYSTEMD_RUN)
  assert.equal(wrapped.unit, theScopeUnitOf('Vesta', 4321))
  assert.deepEqual(wrapped.args, [
    '--user',
    '--scope',
    '--quiet',
    '--collect',
    '--expand-environment=no',
    '--slice=tests.slice',
    '--unit=martha-Vesta-4321',
    '-p',
    'CPUQuota=321%',
    '-p',
    'CPUWeight=77',
    `/usr/bin/${CLAUDE}`,
    THE_RESUME_SWITCH,
    '$NOT_EXPANDED',
  ])
})

test('#989 C8: two launches of one member never share a scope name, since the launcher\'s pid is in it', () => {
  assert.notEqual(theScopeUnitOf('Vesta', 1), theScopeUnitOf('Vesta', 2))
  assert.match(theScopeUnitOf('Vesta', 1), /^martha-Vesta-1$/)
})
