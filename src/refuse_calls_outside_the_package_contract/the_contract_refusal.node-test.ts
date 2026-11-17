// What a call is, and what a package's contract refuses of it (martha#513 slice 2).
//
// The two claims this file pins are the slice's: a call's act is read from what the call itself says (the command's own
// words, the line as read) and never from a name someone gave it, and a contract refuses exactly the acts it leaves out
// — nothing for a call that is no act, nothing without a contract, and nothing for a package the owner marked unbounded.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CONTRACT_ACTIONS } from '../keep_the_package_contract/the_contract_in_a_brief.ts'
import { LAND_BATCH, FAST_FORWARD_AFTER_THE_OWNERS_YES } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { CONTRACT_ACTS, theActsOfACall, theWordsOfACommand } from './the_acts_of_a_call.ts'
import { refuseACallOutsideTheContract, theActsNotAllowed, type TheContractInForce } from './refuse_a_call_outside_the_contract.ts'

const PACKAGE = 'synthetic-owner/repo#7'
/** A range as the crew's own line writes it: two forty-hex shas, since a shorter pair is refused when it is read. */
const BASE = 'a'.repeat(40)
const TIP = 'b'.repeat(40)

/** A bounded contract on this package, allowing the acts it names. */
const aContract = (allowed: readonly (typeof CONTRACT_ACTS)[number][], version = 2): TheContractInForce => ({
  package: PACKAGE,
  version,
  kind: 'bounded',
  allowed,
})

/** The words of a shell call as the host hands it over. */
const aShellCall = (command: string, tool = 'Bash') => ({ tool, input: { command } })

// --- the words a command is made of -------------------------------------------------

test('a command is read as its own words, a quoted run being one word', () => {
  assert.deepEqual(theWordsOfACommand('git push origin main'), ['git', 'push', 'origin', 'main'])
  assert.deepEqual(theWordsOfACommand('echo "git push"'), ['echo', 'git push'])
  assert.deepEqual(theWordsOfACommand("cd /tmp && git push"), ['cd', '/tmp', '&&', 'git', 'push'])
})

// --- what act a call is -------------------------------------------------------------

test('the acts a call is, in the contract\'s own words: the four, and none for anything else', () => {
  assert.deepEqual(theActsOfACall(aShellCall('git push origin main'), PACKAGE), ['push'])
  assert.deepEqual(theActsOfACall(aShellCall('cd /tmp && git push'), PACKAGE), ['push'])
  assert.deepEqual(theActsOfACall(aShellCall('git tag v1.2.3'), PACKAGE), ['tag'])
  assert.deepEqual(theActsOfACall(aShellCall('git push --tags'), PACKAGE), ['push', 'tag'])
  assert.deepEqual(theActsOfACall({ tool: LAND_BATCH, input: {} }, PACKAGE), ['land'])
  assert.deepEqual(theActsOfACall({ tool: FAST_FORWARD_AFTER_THE_OWNERS_YES, input: {} }, PACKAGE), ['land'])
  // A quoted run is one word, so nothing that merely talks about a push is one.
  assert.deepEqual(theActsOfACall(aShellCall('echo "git push"'), PACKAGE), [])
  assert.deepEqual(theActsOfACall(aShellCall('npm test'), PACKAGE), [])
  // A command is read only where the shell is: a read tool carrying a command field runs no git.
  assert.deepEqual(theActsOfACall(aShellCall('git push', 'Read'), PACKAGE), [])
  // A command is read wherever a tool can execute: the shell list is of the tools that only read, so a tool nobody
  // has seen before is a shell as far as this table is concerned.
  assert.deepEqual(theActsOfACall({ tool: 'some_tool', input: { command: 'git push' } }, PACKAGE), ['push'])
  // A call that carries neither a command nor a line is no act, whatever its name.
  assert.deepEqual(theActsOfACall({ tool: 'some_tool', input: {} }, PACKAGE), [])
})

test('a handoff is the review line, read as the crew reads it, and only for the package this member holds', () => {
  const line = `HANDOFF ${PACKAGE} ${BASE}..${TIP} r=1 ci=4`
  assert.deepEqual(theActsOfACall({ tool: 'say_to_the_crew', input: { to: ['supervisor'], text: line } }, PACKAGE), ['handoff'])
  // The same line naming another package is that package's act, not this one's.
  assert.deepEqual(theActsOfACall({ tool: 'say_to_the_crew', input: { text: `HANDOFF synthetic-owner/other#9 ${BASE}..${TIP} r=1 ci=4` } }, PACKAGE), [])
  // A message with no line is just a message.
  assert.deepEqual(theActsOfACall({ tool: 'say_to_the_crew', input: { text: 'a remark about the weather' } }, PACKAGE), [])
  // A VERDICT line is not a handoff: the ledger keeps them apart, so the contract does.
  assert.deepEqual(theActsOfACall({ tool: 'say_to_the_crew', input: { text: `VERDICT ${PACKAGE} PASS ${BASE}..${TIP} r=1 ci=4` } }, PACKAGE), [])
})

test('writing a handover is never an act, even when the handover itself holds a handoff line', () => {
  const text = `HANDOFF ${PACKAGE} ${BASE}..${TIP} r=1 ci=4\n\nmy handover`
  assert.deepEqual(theActsOfACall({ tool: 'write_my_handover', input: { content: text } }, PACKAGE), [])
  const refused = refuseACallOutsideTheContract({ tool: 'write_my_handover', input: { content: text } }, aContract(['land']))
  assert.equal(refused, undefined)
})

// --- what the contract refuses ------------------------------------------------------

test('the acts a call is that the contract leaves out are the ones refused, and nothing else is', () => {
  assert.deepEqual(theActsNotAllowed(aShellCall('git push'), aContract(['push', 'land'])), [])
  assert.deepEqual(theActsNotAllowed(aShellCall('git push'), aContract(['land'])), ['push'])
  // `git push --tags` is both acts, so a contract holding one of them still refuses it.
  assert.deepEqual(theActsNotAllowed(aShellCall('git push --tags'), aContract(['push'])), ['tag'])
  assert.deepEqual(theActsNotAllowed(aShellCall('git push --tags'), aContract(['tag'])), ['push'])
  assert.deepEqual(theActsNotAllowed(aShellCall('git push --tags'), aContract(['push', 'tag'])), [])
})

test('a call the contract allows runs, and the answer is nothing at all', () => {
  assert.equal(refuseACallOutsideTheContract(aShellCall('git tag v1'), aContract(['tag', 'push'])), undefined)
  assert.equal(refuseACallOutsideTheContract(aShellCall('npm test'), aContract([])), undefined)
})

test('a refused call is told which act it is, the contract\'s version, and what the contract does allow', () => {
  const refused = refuseACallOutsideTheContract(aShellCall('git push origin main'), aContract(['handoff', 'land'], 3))
  assert.ok(refused !== undefined)
  assert.match(refused, /this call pushes, and package synthetic-owner\/repo#7's contract \(version 3\) allows handoff, land only, so push is not in it and the call does not run/)
  // Both acts named when the command is both, and each of them missing is named.
  const both = refuseACallOutsideTheContract(aShellCall('git push --tags'), aContract(['handoff']))
  assert.ok(both !== undefined)
  assert.match(both, /this call pushes and tags, and package .* allows handoff only, so push and tag are not in it/)
  // A contract that allows nothing at all says so rather than printing an empty list.
  const none = refuseACallOutsideTheContract({ tool: LAND_BATCH, input: {} }, aContract([]))
  assert.ok(none !== undefined)
  assert.match(none, /this call lands, and package .* allows no act at all, so land is not in it/)
})

test('a package with no contract, and a package the owner called unbounded, refuse nothing at all', () => {
  assert.equal(refuseACallOutsideTheContract(aShellCall('git push'), undefined), undefined)
  const unbounded: TheContractInForce = { package: PACKAGE, version: 1, kind: 'unbounded', allowed: [] }
  assert.equal(refuseACallOutsideTheContract(aShellCall('git push --tags'), unbounded), undefined)
  assert.equal(refuseACallOutsideTheContract({ tool: LAND_BATCH, input: {} }, unbounded), undefined)
})

test('the gate\'s words are the contract\'s words: the two vocabularies are the same four acts', () => {
  assert.deepEqual([...CONTRACT_ACTS], [...CONTRACT_ACTIONS])
})
