// The reader of the slices' coincidence files reads what it can see and refuses the rest by name (martha#289 r=3).
//
// Every case plants its sources in memory, so nothing here depends on the tree.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  A_SPREAD,
  COINCIDENCE_FILE,
  coincidencesIn,
  COMPUTED,
  lineOfAnUnreadableCoincidence,
  NO_ARRAY,
  NOT_A_DECLARATION,
  NOT_AN_ENTRY,
  UNRESOLVED,
} from './the_coincidences_a_slice_declares.ts'

const source = (path: string, ...lines: string[]) => ({ path, text: lines.join('\n') + '\n' })
const TOOL = source('a_tool/a_tool.ts', "export const TOOL = 'the-tool'")
const IN_A_SLICE = `a_slice/${COINCIDENCE_FILE}`
const OWNER_OF_A_REASON = source(`a_owner/${COINCIDENCE_FILE}`, "export const SHARED = 'a fact the owner states'", 'export const COINCIDENCES = []')

const refusals = (...sources: { path: string; text: string }[]) => coincidencesIn(sources).unreadable.map(lineOfAnUnreadableCoincidence)

test('an entry is read through an import, a renamed import, a constant of the file, and a reason another slice owns', () => {
  const declared = source(
    IN_A_SLICE,
    "import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'",
    "import { TOOL, TOOL as RENAMED } from '../a_tool/a_tool.ts'",
    "import { SHARED } from '../a_owner/coincidences.ts'",
    "const MINE = 'the-own-word'",
    "const WHY = 'a word of its own here'",
    'export const COINCIDENCES = [',
    "  { value: TOOL, file: 'a_slice/a.node-test.ts', reason: WHY },",
    "  { value: RENAMED, file: 'a_slice/b.ts', reason: `${SHARED}, in b` },",
    "  { value: MINE, file: 'a_slice/c.ts', reason: 'said here' },",
    '] as const satisfies readonly Exception[]',
  )

  const read = coincidencesIn([TOOL, OWNER_OF_A_REASON, declared])

  assert.deepEqual(read.unreadable, [])
  assert.deepEqual(read.entries, [
    { value: 'the-tool', file: 'a_slice/a.node-test.ts', reason: 'a word of its own here', declared_in: IN_A_SLICE, line: 7 },
    { value: 'the-tool', file: 'a_slice/b.ts', reason: 'a fact the owner states, in b', declared_in: IN_A_SLICE, line: 8 },
    { value: 'the-own-word', file: 'a_slice/c.ts', reason: 'said here', declared_in: IN_A_SLICE, line: 9 },
  ])
})

test('the four refusals: a spread, a call, a computed value and a name nothing resolves, each named, never skipped', () => {
  const declared = source(
    IN_A_SLICE,
    "import { TOOL } from '../a_tool/a_tool.ts'",
    'export const COINCIDENCES = [',
    '  ...MORE,',
    "  { value: pick(), file: 'a_slice/a.ts', reason: 'r' },",
    "  { value: TOOLS.Edit, file: 'a_slice/a.ts', reason: 'r' },",
    "  { value: NOWHERE, file: 'a_slice/a.ts', reason: 'r' },",
    "  { ...TOOL_ENTRY, reason: 'r' },",
    "  { value: TOOL, file: 'a_slice/a.ts', reason: `${pick()}` },",
    "  { value: TOOL, file: 'a_slice/a.ts' },",
    '  ENTRY,',
    "  { value: TOOL, file: 'a_slice/a.ts', reason: 'kept' },",
    ']',
  )

  const read = coincidencesIn([TOOL, declared])

  assert.deepEqual(read.unreadable.map(lineOfAnUnreadableCoincidence), [
    `${IN_A_SLICE}:3: ${A_SPREAD}`,
    `${IN_A_SLICE}:4: ${COMPUTED}`,
    `${IN_A_SLICE}:5: ${COMPUTED}`,
    `${IN_A_SLICE}:6: ${UNRESOLVED}`,
    `${IN_A_SLICE}:7: ${A_SPREAD}`,
    `${IN_A_SLICE}:8: ${COMPUTED}`,
    `${IN_A_SLICE}:9: ${NOT_AN_ENTRY}`,
    `${IN_A_SLICE}:10: ${UNRESOLVED}`,
  ])
  assert.deepEqual(read.entries.map((entry) => entry.line), [11], 'the one readable entry is still read')
})

test('a file of the right name with no COINCIDENCES array the check can read is named, never skipped', () => {
  assert.deepEqual(refusals(source(IN_A_SLICE, "export const OTHER = 'x'")), [`${IN_A_SLICE}:1: ${NO_ARRAY}`])
  assert.deepEqual(refusals(source(IN_A_SLICE, 'const COINCIDENCES = []')), [`${IN_A_SLICE}:1: ${NO_ARRAY}`], 'not exported')
  assert.deepEqual(refusals(source(IN_A_SLICE, 'export const COINCIDENCES = make()')), [`${IN_A_SLICE}:1: ${NOT_A_DECLARATION}`], 'a list made by code is code')
})

test('the file holds nothing but its imports, string constants and the list: every other statement is named (condition 1 of ruling P)', () => {
  const declared = source(
    IN_A_SLICE,
    "import './runs-on-import.ts'",
    "import everything from '../a_tool/a_tool.ts'",
    "import * as all from '../a_tool/a_tool.ts'",
    "import { TOOL } from 'a-package'",
    "export { TOOL } from '../a_tool/a_tool.ts'",
    'function run() {}',
    'class Run {}',
    'run()',
    "let changing = 'x'",
    'const NUMBER = 1',
    "const JOINED = 'a' + 'b'",
    'export const COINCIDENCES = []',
  )

  assert.deepEqual(refusals(declared), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((line) => `${IN_A_SLICE}:${line}: ${NOT_A_DECLARATION}`))
  assert.deepEqual(coincidencesIn([source(IN_A_SLICE, 'function run() {}', "export const COINCIDENCES = [{ value: X, file: 'a_slice/a.ts', reason: 'r' }]")]).entries, [], 'a file of the wrong shape applies none of its entries')
})

test('only a file named exactly coincidences.ts is read: a misspelled one declares nothing', () => {
  const misspelled = source('a_slice/coincidence.ts', "import { TOOL } from '../a_tool/a_tool.ts'", "export const COINCIDENCES = [{ value: TOOL, file: 'a_slice/a.ts', reason: 'r' }]")

  assert.deepEqual(coincidencesIn([TOOL, misspelled]), { entries: [], unreadable: [] })
})
