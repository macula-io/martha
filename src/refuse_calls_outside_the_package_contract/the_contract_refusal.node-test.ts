// What a call is, and what a package's contract refuses of it (martha#513 slice 2).
//
// The two claims this file pins are the slice's: a call's act is read from what the call itself says (the command's own
// words, the line as read) and never from a name someone gave it, and a contract refuses exactly the acts it leaves out
// — nothing for a call that is no act, nothing without a contract, and nothing for a package the owner marked unbounded.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CLAUDE_CODE_SHELL_TOOL, ownNameOfCalledTool } from '../claude_code_host/claude_code_host.ts'
import { CONTRACT_ACTIONS } from '../keep_the_package_contract/the_contract_in_a_brief.ts'
import { LAND, LAND_BATCH, FAST_FORWARD_AFTER_THE_OWNERS_YES } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { PARK_A_MEMBER } from '../park_and_wake_a_member/the_park_tools.ts'
import { KEEP_THE_CONTRACT_TOOL } from '../keep_the_package_contract/the_contract_tools.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
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
const aShellCall = (command: string, tool: string = CLAUDE_CODE_SHELL_TOOL) => ({ tool, input: { command } })

// --- the words a command is made of -------------------------------------------------

test('a command is read as its own words, a quoted run being one word', () => {
  assert.deepEqual(theWordsOfACommand('git push origin main'), ['git', 'push', 'origin', 'main'])
  assert.deepEqual(theWordsOfACommand('echo "git push"'), ['echo', 'git push'])
  assert.deepEqual(theWordsOfACommand("cd /tmp && git push"), ['cd', '/tmp', '&&', 'git', 'push'])
})

test("a script's last line that pushes is a push, wherever in the command it sits", () => {
  // The commonest push there is: a script whose last line pushes. A reader that only looked at a command's first word,
  // or that dropped the line break, saw `git` as the argument of the line above it and let the push through.
  assert.deepEqual(theActsOfACall(aShellCall('npm test\ngit push origin main'), PACKAGE), ['push'])
  assert.deepEqual(theActsOfACall(aShellCall('npm test\n\ncd out\ngit tag v1'), PACKAGE), ['tag'])
  // Inside a quote a break is part of the word, so a commit message that mentions a push is not one.
  assert.deepEqual(theActsOfACall(aShellCall('git commit -m "fix one\ngit push is broken"'), PACKAGE), [])
})

// --- the shapes a member writes a push in, one test each (martha#513 slice 2, round 2) --

test('a push run through git -C is a push', () => {
  assert.deepEqual(theActsOfACall(aShellCall('git -C /work/repo push origin main'), PACKAGE), ['push'])
})

test("a push run through git's -c is a push", () => {
  assert.deepEqual(theActsOfACall(aShellCall('git -c core.pager=cat push'), PACKAGE), ['push'])
})

test('a push behind an assignment is a push', () => {
  assert.deepEqual(theActsOfACall(aShellCall('GIT_SSH_COMMAND=ssh git push'), PACKAGE), ['push'])
})

test('a push that ends its command with a ; is a push', () => {
  assert.deepEqual(theActsOfACall(aShellCall('git push;'), PACKAGE), ['push'])
})

test('a push with nothing spacing it from && is a push', () => {
  assert.deepEqual(theActsOfACall(aShellCall('cd x&&git push'), PACKAGE), ['push'])
})

test('a push after an & is a push, whatever leads up to it', () => {
  assert.deepEqual(theActsOfACall(aShellCall('a & b, then git push'), PACKAGE), ['push'])
})

test('a push inside parentheses is a push', () => {
  assert.deepEqual(theActsOfACall(aShellCall('(git push)'), PACKAGE), ['push'])
})

test("a push behind git's own --git-dir is a push", () => {
  assert.deepEqual(theActsOfACall(aShellCall('git --git-dir /r push'), PACKAGE), ['push'])
})

test("a push behind git's own --work-tree is a push", () => {
  assert.deepEqual(theActsOfACall(aShellCall('git --work-tree /r push'), PACKAGE), ['push'])
})

test("a push behind git's own --namespace is a push", () => {
  assert.deepEqual(theActsOfACall(aShellCall('git --namespace n push'), PACKAGE), ['push'])
})

test("a push behind git's own --config-env is a push", () => {
  assert.deepEqual(theActsOfACall(aShellCall('git --config-env k=v push'), PACKAGE), ['push'])
})

test('a push run through a path to git is a push', () => {
  assert.deepEqual(theActsOfACall(aShellCall('/usr/bin/git push'), PACKAGE), ['push'])
  assert.deepEqual(theActsOfACall(aShellCall('./git push'), PACKAGE), ['push'])
})

test('words that only talk about a push are no act, quoted, and sh -c stays out of scope', () => {
  assert.deepEqual(theActsOfACall(aShellCall('echo "git push"'), PACKAGE), [])
  assert.deepEqual(theActsOfACall(aShellCall('sh -c "git push"'), PACKAGE), [])
})

test("a land arrives under the host's own name for the tool, and is still a land", () => {
  const called = `mcp__martha__${LAND_BATCH}`
  assert.deepEqual(theActsOfACall({ tool: called, input: {} }, PACKAGE), [])
  assert.deepEqual(theActsOfACall({ tool: called, input: {} }, PACKAGE, ownNameOfCalledTool), [LAND])
  assert.deepEqual(theActsOfACall({ tool: `mcp__martha__${FAST_FORWARD_AFTER_THE_OWNERS_YES}`, input: {} }, PACKAGE, ownNameOfCalledTool), [LAND])
})

// --- what act a call is -------------------------------------------------------------

test('the acts a call is, in the contract\'s own words: the four, and none for anything else', () => {
  assert.deepEqual(theActsOfACall(aShellCall('git push origin main'), PACKAGE), ['push'])
  assert.deepEqual(theActsOfACall(aShellCall('cd /tmp && git push'), PACKAGE), ['push'])
  assert.deepEqual(theActsOfACall(aShellCall('git tag v1.2.3'), PACKAGE), ['tag'])
  assert.deepEqual(theActsOfACall(aShellCall('git push --tags'), PACKAGE), ['push', 'tag'])
  assert.deepEqual(theActsOfACall({ tool: LAND_BATCH, input: {} }, PACKAGE), [LAND])
  assert.deepEqual(theActsOfACall({ tool: FAST_FORWARD_AFTER_THE_OWNERS_YES, input: {} }, PACKAGE), [LAND])
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
  assert.deepEqual(theActsOfACall({ tool: SAY_TO_THE_CREW, input: { to: [SUPERVISOR], text: line } }, PACKAGE), ['handoff'])
  // The same line naming another package is that package's act, not this one's.
  assert.deepEqual(theActsOfACall({ tool: SAY_TO_THE_CREW, input: { text: `HANDOFF synthetic-owner/other#9 ${BASE}..${TIP} r=1 ci=4` } }, PACKAGE), [])
  // A message with no line is just a message.
  assert.deepEqual(theActsOfACall({ tool: SAY_TO_THE_CREW, input: { text: 'a remark about the weather' } }, PACKAGE), [])
  // A VERDICT line is not a handoff: the ledger keeps them apart, so the contract does.
  assert.deepEqual(theActsOfACall({ tool: SAY_TO_THE_CREW, input: { text: `VERDICT ${PACKAGE} PASS ${BASE}..${TIP} r=1 ci=4` } }, PACKAGE), [])
})

test('writing a handover is never an act, even when the handover itself holds a handoff line', () => {
  const text = `HANDOFF ${PACKAGE} ${BASE}..${TIP} r=1 ci=4\n\nmy handover`
  assert.deepEqual(theActsOfACall({ tool: WRITE_MY_HANDOVER_TOOL, input: { content: text } }, PACKAGE), [])
  const refused = refuseACallOutsideTheContract({ tool: WRITE_MY_HANDOVER_TOOL, input: { content: text } }, aContract([LAND]))
  assert.equal(refused, undefined)
})

// --- what the contract refuses ------------------------------------------------------

test('the acts a call is that the contract leaves out are the ones refused, and nothing else is', () => {
  assert.deepEqual(theActsNotAllowed(aShellCall('git push'), aContract(['push', LAND])), [])
  assert.deepEqual(theActsNotAllowed(aShellCall('git push'), aContract([LAND])), ['push'])
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
  const refused = refuseACallOutsideTheContract(aShellCall('git push origin main'), aContract(['handoff', LAND], 3))
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

test('a call handed no contract at all, and a package the owner called unbounded, refuse nothing at all', () => {
  assert.equal(refuseACallOutsideTheContract(aShellCall('git push'), undefined), undefined)
  const unbounded: TheContractInForce = { package: PACKAGE, version: 1, kind: 'unbounded', allowed: [] }
  assert.equal(refuseACallOutsideTheContract(aShellCall('git push --tags'), unbounded), undefined)
  assert.equal(refuseACallOutsideTheContract({ tool: LAND_BATCH, input: {} }, unbounded), undefined)
})

test('a package with no contract recorded refuses every call but the ones that end it and the tool that keeps one (martha#597)', () => {
  const none_recorded = { package: PACKAGE }
  // An act and a call that is no act are refused alike: this gate does not stand only on the act table.
  for (const call of [aShellCall('git push origin main'), aShellCall('npm test'), { tool: 'Read', input: { file_path: 'a-file' } }]) {
    const refused = refuseACallOutsideTheContract(call, none_recorded, ownNameOfCalledTool)
    assert.ok(refused !== undefined, call.tool)
    assert.match(refused, new RegExp(`${PACKAGE} has no contract recorded, so none of its work runs until one is kept`))
    assert.match(refused, new RegExp(`keeps it with ${KEEP_THE_CONTRACT_TOOL.name}`))
  }
  // The four that end a package still run, by the host's own name for each, and so does the tool that keeps a contract.
  for (const own_name of [WRITE_MY_HANDOVER_TOOL, SAY_TO_THE_CREW, REPORT_WHERE_THE_WORK_STANDS, PARK_A_MEMBER, KEEP_THE_CONTRACT_TOOL.name]) {
    assert.equal(refuseACallOutsideTheContract({ tool: `mcp__martha__${own_name}`, input: {} }, none_recorded, ownNameOfCalledTool), undefined, own_name)
  }
  // A look-alike is another call, refused like any other.
  assert.ok(refuseACallOutsideTheContract({ tool: 'mcp__martha__not_write_my_handover', input: {} }, none_recorded, ownNameOfCalledTool) !== undefined)
})

test('a contract the ledger cannot read back refuses that act alone, and the words say why', () => {
  const unreadable = { package: PACKAGE, why: 'row 3 is not a contract block' }
  const refused = refuseACallOutsideTheContract(aShellCall('git push origin main'), unreadable)
  assert.ok(refused !== undefined)
  assert.match(
    refused,
    /this call pushes, and package synthetic-owner\/repo#7's contract could not be read \(row 3 is not a contract block\), so push is refused until the ledger answers/,
  )
  // A call that is no act runs whatever the ledger could not answer: the unreadable contract refuses that act alone.
  assert.equal(refuseACallOutsideTheContract(aShellCall('npm test'), unreadable), undefined)
  assert.equal(refuseACallOutsideTheContract({ tool: 'some_read', input: {} }, unreadable), undefined)
})

test('the gate\'s words are the contract\'s words: the two vocabularies are the same four acts', () => {
  assert.deepEqual([...CONTRACT_ACTS], [...CONTRACT_ACTIONS])
})
