// The coincidences of know_the_goose_engines_facts: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289, #437). Read by the restated-values check as a syntax tree,
// never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'
import { SKILLS_KIND } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { THE_EXTENSION_A_MEMBER_KEEPS } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import { THE_FINISH_OF_A_TOOL_TURN } from '../stand_in_for_an_openai_model/the_openai_stand_in.ts'

export const COINCIDENCES: readonly Exception[] = [
  // ENGINE_PLACES names files in the Goose engine's source tree as that tree spells them: `crates/goose/src/config/` is
  // the engine's own config module. The constant is git's config file, which no part of reading the engine touches.
  { value: CONFIG, file: 'know_the_goose_engines_facts/the_engines_facts_in_its_source.ts', reason: 'the config folder in ENGINE_PLACES is the Goose engine\'s own config module, named as its source tree names it; the constant holds git\'s config file (martha#541)' },
  // `crates/goose/src/skills/` is the engine's own skills module, where it reads its built-in skills switch. The
  // constant is the folder Claude Code loads an owner's skills from, which no part of reading the engine touches.
  { value: SKILLS_KIND, file: 'know_the_goose_engines_facts/the_engines_facts_in_its_source.ts', reason: 'the skills folder in ENGINE_PLACES is the Goose engine\'s own skills module, named as its source tree names it; the constant holds the folder Claude Code loads skills from (martha#839)' },
  // `crates/goose/src/acp/server/tool_calls/` is the engine's own module that turns a tool request into an ACP tool
  // call, where it writes the called tool's name into `_meta`. The constant is the finish reason an OpenAI model gives a
  // turn that ends in tool calls, which no part of reading the engine's source touches.
  { value: THE_FINISH_OF_A_TOOL_TURN, file: 'know_the_goose_engines_facts/the_engines_facts_in_its_source.ts', reason: 'the tool_calls folder in ENGINE_PLACES is the Goose engine\'s own ACP tool-call module, named as its source tree names it; the constant holds the finish reason an OpenAI model gives a tool turn (martha#541)' },
  // `crates/goose/src/agents/platform_extensions/developer/` is the engine's own module for the Developer extension,
  // where it lists and runs its shell tool. The constant is the extension key a launch keeps switched on, Martha's own
  // choice; that folder is named by the engine's tree and moves only with it, so the path is not derived from the key.
  { value: THE_EXTENSION_A_MEMBER_KEEPS, file: 'know_the_goose_engines_facts/the_engines_facts_in_its_source.ts', reason: 'the developer folder in ENGINE_PLACES is the Goose engine\'s own Developer extension module, named as its source tree names it; the constant holds the extension key a launch keeps on (martha#541)' },
]
