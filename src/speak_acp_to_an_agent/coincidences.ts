// The coincidences of speak_acp_to_an_agent: words its own files spell like a constant held elsewhere, meaning
// something else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never
// run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { WHOLE_FILE_CONTENT } from '../claude_code_host/claude_code_file_tools.ts'
import { THE_FAILED_TASK_STATUS } from '../read_what_claude_code_says_of_an_agent/read_a_failed_agents_report.ts'

/** Why `failed` here is not Claude Code's status of a failed agent task: it is ACP's status of a tool call that did not run. */
const ACPS_TOOL_CALL_STATUS = "ACP's own status of a tool call that did not run, as an agent reports it in a tool_call_update; Claude Code's word is its status of a failed agent task"
/** Why `content` here is not Claude Code's file-write field: it is the field of an ACP tool-call update. */
const ACPS_TOOL_CALL_FIELD = "the field of an ACP tool-call update that carries what the call produced; Claude Code's word is the field its file-write tool takes the whole file in"

export const COINCIDENCES: readonly Exception[] = [
  { value: THE_FAILED_TASK_STATUS, file: 'speak_acp_to_an_agent/the_acp_client.node-test.ts', reason: ACPS_TOOL_CALL_STATUS },
  { value: WHOLE_FILE_CONTENT, file: 'speak_acp_to_an_agent/the_acp_client.ts', reason: ACPS_TOOL_CALL_FIELD },
]
