import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ToolResultRows } from '../take_in_a_tool_result/take_in_a_tool_result.ts'
import { BUILTIN_SKILLS_OFF, CHECKOUT_SKILLS_ON, refuseSkillsWithoutTheirRow, theSkillsResultRow } from './the_skills_a_launch_offers.ts'

/** A skills tool spelled unlike the engine's, so a row keyed by a typed name instead of the fact goes red. */
const FACTS = { skills_tool: { name: 'skills_tool_of_this_test' } } as const
const TOOL = FACTS.skills_tool.name

/** Rows another part of the launch hands in, so the skills row is checked among them, not alone. */
const OTHER_ROWS: ToolResultRows = { another_tool: { reads: 'a_file', source: 'checkout_file', field: 'path' } }

test("with the checkout's skills on, the skills tool's result is placed as a file of the checkout, keyed by the recorded name (martha#614 slice 3, mutants: the row dropped, another reading, another source)", () => {
  assert.deepEqual(theSkillsResultRow(FACTS), { [TOOL]: { reads: 'a_source', source: 'checkout_file' } })
  assert.doesNotThrow(() => refuseSkillsWithoutTheirRow(FACTS, { ...OTHER_ROWS, ...theSkillsResultRow(FACTS) }, CHECKOUT_SKILLS_ON))
})

test("the checkout's skills on with no row for the skills tool is refused by the tool's name (martha#614 slice 3, Mars's condition (1), mutant: the guard removed)", () => {
  assert.throws(() => refuseSkillsWithoutTheirRow(FACTS, OTHER_ROWS, CHECKOUT_SKILLS_ON), new RegExp(`have no row for ${TOOL}:`))
})

test("the checkout's skills on with any other row for the skills tool is refused by the tool's name (martha#614 slice 3, mutants: the reading or the source unchecked, an extra field let through)", () => {
  const others: ReadonlyArray<ToolResultRows[string]> = [
    { reads: 'a_file', source: 'checkout_file', field: 'name' },
    { reads: 'a_search', source: 'checkout_file', field: 'name' },
    { reads: 'a_source', source: 'web' },
    { reads: 'an_agents_answer', source: 'subagent' },
    { reads: 'a_source', source: 'checkout_file', field: 'name' } as unknown as ToolResultRows[string],
    // The source and the count of fields right, the reading wrong: only the reading's own check refuses it.
    { reads: 'an_agents_answer', source: 'checkout_file' } as unknown as ToolResultRows[string],
  ]
  for (const row of others) {
    assert.throws(() => refuseSkillsWithoutTheirRow(FACTS, { ...OTHER_ROWS, [TOOL]: row }, CHECKOUT_SKILLS_ON), new RegExp(`the result row for ${TOOL} is `), JSON.stringify(row))
  }
})

test("with the checkout's skills off nothing is asked of the rows (martha#614 slice 3)", () => {
  assert.doesNotThrow(() => refuseSkillsWithoutTheirRow(FACTS, {}, !CHECKOUT_SKILLS_ON))
})

test('the switches are what the engine reads as the checkout skills on and the built-ins off (martha#614 slice 3, DECIDED 2026-11-18 "Approved skills on", "Switch built-ins off")', () => {
  assert.equal(CHECKOUT_SKILLS_ON, true, "the switch offers the checkout's skills when true")
  assert.equal(BUILTIN_SKILLS_OFF, false, 'the switch offers the built-ins when true, so off is false')
})
