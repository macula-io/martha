// The skills a Goose launch offers its member's model (martha#614 slice 3): the checkout's skills on, the engine's
// compiled-in ones off, and never the first without the row that places what `load_skill` returns.
//
// DECIDED 2026-11-18 "Approved skills on (Recommended)" and "Switch built-ins off (Recommended)". The checkout's skills
// are the owner's approved ones: the launch gate refuses a checkout whose skill roots the owner has not approved
// (Done-when 3), and the skill roots reader sees every root the engine builds (Done-when 6).
//
// Mars's condition (1): `load_skill` is never offered without its result row. The tool takes a skill's NAME (or a
// skill's supporting file by `<skill>/<file>`), never a path, so there is no argument to resolve: with the built-ins off
// and the launch's home sealed, every root a skill can come from is the checkout's, and the row is that one source,
// always taken in and never exempt as a read of the approved start tree would be. A launch that would offer the
// checkout's skills with no such row, or with any other row for the tool, is refused by the tool's name.
//
// The row never exempts a call from being asked: the engine asks the client before every advertised call in the mode
// a launch pins (#541 package A's rule (a) stops a member at a result no request came before).

import type { ToolResultReading, ToolResultRows } from '../take_in_a_tool_result/take_in_a_tool_result.ts'

/** What the checkout skills switch is set to: it offers the checkout's skills when true (martha#614 slice 3). */
export const CHECKOUT_SKILLS_ON = true

/** What the built-in skills switch is set to: it offers the compiled-in skills when true, so off is false. */
export const BUILTIN_SKILLS_OFF = false

/** Where what `load_skill` returns came from: a file of the checkout, whatever the call asked. */
export const WHAT_A_LOADED_SKILL_IS: ToolResultReading = Object.freeze({ reads: 'a_source', source: 'checkout_file' })

/** The engine's skills tool by the name a call carries (read from the engine's source into the recording). */
export interface TheSkillsTool {
  readonly skills_tool: { readonly name: string }
}

/** The one result row the checkout's skills need: `load_skill` placed as a file of the checkout. */
export function theSkillsResultRow(facts: TheSkillsTool): ToolResultRows {
  return Object.freeze({ [facts.skills_tool.name]: WHAT_A_LOADED_SKILL_IS })
}

/**
 * Throws, naming the tool, when the checkout's skills would be offered and `rows` has no row for `load_skill`, or a
 * row other than WHAT_A_LOADED_SKILL_IS (Mars's condition (1)). With the checkout's skills off it asks nothing.
 */
export function refuseSkillsWithoutTheirRow(facts: TheSkillsTool, rows: ToolResultRows, checkoutSkills: boolean): void {
  if (!checkoutSkills) return
  const tool = facts.skills_tool.name
  const row = rows[tool]
  if (row === undefined) {
    throw new Error(`the launch offers the checkout's skills, and the result rows have no row for ${tool}: what it returns would be taken in unplaced, so no member starts (martha#614 slice 3)`)
  }
  if (row.reads !== WHAT_A_LOADED_SKILL_IS.reads || row.source !== WHAT_A_LOADED_SKILL_IS.source || Object.keys(row).length !== Object.keys(WHAT_A_LOADED_SKILL_IS).length) {
    throw new Error(`the launch offers the checkout's skills, and the result row for ${tool} is ${JSON.stringify(row)}, not ${JSON.stringify(WHAT_A_LOADED_SKILL_IS)}: a loaded skill is a file of the checkout, so no member starts (martha#614 slice 3)`)
  }
}
