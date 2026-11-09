// Each instruction text a host can attach to a member's session is owned by
// exactly one row of INBOUND_PATHS (martha#135). A reviewer reading the table
// could be told two different things about one file — A16 claiming a checkout's
// fixed text while B4's exemption claimed the text a read attaches — so the
// owner of each text is named once, and this fails CI when the rows disagree.
//
// The table is the claim and the rows are its words: the owner's own row must
// name the file, and no other row may name it except by pointing at the owner.
// Each planted case below proves the check sees that kind of disagreement, so a
// check that stops seeing one fails by name here rather than passing quietly.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  INBOUND_PATHS,
  INSTRUCTION_FILES,
  INSTRUCTION_TEXT_OWNERS,
  INSTRUCTION_TEXT_WORDING,
  gapsInInstructionTextOwnership,
  type InboundPath,
  type InstructionText,
} from './inbound_paths.ts'

/** A row that takes text in, saying only its `what`. */
const row = (id: string, what: string): InboundPath => ({ id, what, klass: 'fetched', control: { kind: 'shell-gate' }, attestation: 'none' })

/** A row that reaches no model, which has a `why` as well as its `what`. */
const silent = (id: string, what: string, why: string): InboundPath => ({
  id,
  what,
  klass: 'delivered',
  control: { kind: 'no-text-reaches-the-model', why },
  attestation: 'none',
})

const text = (owner: string, file: string = INSTRUCTION_FILES.checkout, words: readonly string[] = []): InstructionText => ({ text: 'A_TEXT', file, owner, words })

/** The row A16's own text is, for the cases that plant a text requiring its words. */
const aCheckoutsFixedText = (why: string) => silent('A16', `a checkout's fixed text: its ${INSTRUCTION_FILES.checkout} files`, why)

test('the ownership table as shipped gives each instruction text exactly one owner, and no other row names its file (#135)', () => {
  assert.deepEqual(gapsInInstructionTextOwnership(), [])
})

test('every instruction file the constants define is owned in the table, and the table names no other file', () => {
  const covered = [...new Set(INSTRUCTION_TEXT_OWNERS.map((entry) => entry.file))].sort()
  assert.deepEqual(covered, [...new Set(Object.values(INSTRUCTION_FILES))].sort())
})

test('a row that names the file of a text it does not own makes the check fail, naming both rows', () => {
  const rows = [
    silent('A16', `a checkout's fixed text: its ${INSTRUCTION_FILES.checkout} files`, 'the host loads none of them'),
    row('B4', `files a read takes in, the ${INSTRUCTION_FILES.checkout} among them`),
  ]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16')]), [
    { text: INSTRUCTION_FILES.checkout, why: 'row B4 names it too, and A16 is its owner' },
  ])
})

test('a row that points at the owner instead of naming the file is no claim of its own', () => {
  const rows = [
    silent('A16', `a checkout's fixed text: its ${INSTRUCTION_FILES.checkout} files`, 'the host loads none of them'),
    row('B4', `files a read takes in; the fixed text a read attaches is the owner's (${INSTRUCTION_FILES.checkout}: see A16)`),
  ]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16')]), [])
})

test('a pointer at a row that does not own the file is a claim of its own, so the check fails, naming both rows', () => {
  const rows = [aCheckoutsFixedText('the host loads none of them'), row('B4', `files a read takes in (an ${INSTRUCTION_FILES.checkout} here: see C1)`)]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16')]), [
    { text: INSTRUCTION_FILES.checkout, why: 'row B4 names it too, and A16 is its owner' },
  ])
})

test("a pointer at its own row claims another row's file, so the check fails", () => {
  const rows = [aCheckoutsFixedText('the host loads none of them'), row('B4', `files a read takes in (an ${INSTRUCTION_FILES.checkout} here: see B4)`)]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16')]), [
    { text: INSTRUCTION_FILES.checkout, why: 'row B4 names it too, and A16 is its owner' },
  ])
})

test('a pointer naming two rows, only one of which owns the file, is a claim: every id in it must own', () => {
  const rows = [aCheckoutsFixedText('the host loads none of them'), row('B4', `files a read takes in (a ${INSTRUCTION_FILES.checkout}: see A16, B4)`)]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16')]), [
    { text: INSTRUCTION_FILES.checkout, why: 'row B4 names it too, and A16 is its owner' },
  ])
})

test("an owner that stops saying a file below the top loads that directory's makes the check fail, naming the phrase", () => {
  const rows = [aCheckoutsFixedText('the host loads none of them, here or below')]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16', INSTRUCTION_FILES.checkout, [INSTRUCTION_TEXT_WORDING.nested])]), [
    { text: 'A_TEXT', why: `its owner A16 does not say "${INSTRUCTION_TEXT_WORDING.nested}", which this text requires of it` },
  ])
})

test('an owner that says every phrase its text requires passes, read exactly as the phrase is written', () => {
  const said = `each of ${INSTRUCTION_TEXT_WORDING.above} is planted, and ${INSTRUCTION_TEXT_WORDING.not_observed} here`
  const words = [INSTRUCTION_TEXT_WORDING.above, INSTRUCTION_TEXT_WORDING.not_observed]
  assert.deepEqual(gapsInInstructionTextOwnership([aCheckoutsFixedText(said)], [text('A16', INSTRUCTION_FILES.checkout, words)]), [])
})

test('an owner that stops saying where a text comes from makes the check fail, naming the phrase it dropped', () => {
  const rows = [aCheckoutsFixedText('the host loads none of them, here or below')]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16', INSTRUCTION_FILES.checkout, [INSTRUCTION_TEXT_WORDING.above])]), [
    { text: 'A_TEXT', why: `its owner A16 does not say "${INSTRUCTION_TEXT_WORDING.above}", which this text requires of it` },
  ])
})

test('an owner that stops saying a text is not observed makes the check fail, naming the phrase it dropped', () => {
  const rows = [aCheckoutsFixedText('the host loads none of them')]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16', INSTRUCTION_FILES.checkout, [INSTRUCTION_TEXT_WORDING.not_observed])]), [
    { text: 'A_TEXT', why: `its owner A16 does not say "${INSTRUCTION_TEXT_WORDING.not_observed}", which this text requires of it` },
  ])
})

test('an owner that is not a row makes the check fail, naming the owner', () => {
  assert.deepEqual(gapsInInstructionTextOwnership([row('A16', 'a row that names nothing')], [text('A99')]), [
    { text: 'A_TEXT', why: 'its owner A99 is not a row in INBOUND_PATHS' },
  ])
})

test('an owner whose words do not name the file makes the check fail, naming the file', () => {
  assert.deepEqual(gapsInInstructionTextOwnership([row('A16', 'a checkout\'s fixed text')], [text('A16')]), [
    { text: 'A_TEXT', why: `its owner A16 does not name ${INSTRUCTION_FILES.checkout}` },
  ])
})

test('the same text owned twice makes the check fail, saying how many times', () => {
  const rows = [silent('A16', `a checkout's fixed text: its ${INSTRUCTION_FILES.checkout} files`, 'the host loads none of them')]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [text('A16'), text('A16')]), [
    { text: 'A_TEXT', why: 'it is owned 2 times, and a text has exactly one owner' },
    { text: 'A_TEXT', why: 'it is owned 2 times, and a text has exactly one owner' },
  ])
})

test('one file owned by two rows makes the check fail, naming both', () => {
  const rows = [
    silent('A16', `a checkout's fixed text: its ${INSTRUCTION_FILES.checkout} files`, 'the host loads none of them'),
    row('B4', `files a read takes in, the ${INSTRUCTION_FILES.checkout} among them`),
  ]
  assert.deepEqual(gapsInInstructionTextOwnership(rows, [{ ...text('A16'), text: 'ONE' }, text('B4')]), [
    { text: INSTRUCTION_FILES.checkout, why: 'it is owned by A16, B4, and a file has exactly one owning row' },
  ])
})

test('the shipped rows are read, not restated: the owner of each text is the row whose words name its file', () => {
  for (const entry of INSTRUCTION_TEXT_OWNERS) {
    const owner = INBOUND_PATHS.find((path) => path.id === entry.owner)
    assert.ok(owner !== undefined, `${entry.text} names ${entry.owner}, which is no row`)
    assert.ok(`${owner.what} ${owner.control.kind === 'no-text-reaches-the-model' ? owner.control.why : ''}`.includes(entry.file), `${entry.owner} names no ${entry.file}`)
  }
})
