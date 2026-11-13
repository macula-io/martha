// The places that must name a value by literal, with the reason (martha#289).
//
// The rule fails on a literal that restates an exported constant, and a word can
// mean something else in a file that is not about the constant: `'config'` is a
// git subcommand in a test that drives git, `'Bash'` is recorded host data. Each
// such place is declared here by its value and its file, with one line saying why
// the word there is not the constant's.
//
// This list is held to its own standards, so it cannot become a baseline:
//   - the check fails when an entry matches no literal in its file any more;
//   - the check fails when an entry has no reason, or repeats another entry;
//   - it is never generated: an entry is written by hand, for a place a reviewer
//     has read, and it is the only place a word is excused in that file.
//
// Keyed by value and file, so a file that drives git thirty times is one entry.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { RELAY_SOCKET_VARIABLE } from '../claude_code_relay/hooks/relay_protocol.ts'
import { WHOLE_FILE_CONTENT } from '../claude_code_host/claude_code_file_tools.ts'
import { CLAUDE_CODE_SHELL_TOOL } from '../claude_code_host/claude_code_host.ts'
import { ELICITATION, ELICITATION_RESULT, NOTIFICATION, PERMISSION_REQUEST, TOOL_CHECK } from '../hear_the_hosts_dialogs/hear_the_hosts_dialogs.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { THE_REFRESH_ASK, CARRY_A_MODEL, CARRY_A_TEXT, CARRY_THE_CLEAR } from '../refresh_a_member/the_refresh_flow.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { LOG_A_MILESTONE } from '../keep_the_ledger/keep_the_ledger.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { READ_THE_RECEIPTS } from '../show_what_a_message_became/show_what_a_message_became.ts'
import { PARK_A_MEMBER, REFRESH_THIS_SESSION, RETURN_TO_YOUR_OWN_MODEL, SWITCH_YOUR_MODEL, THE_MODEL_REPORT_ASK, WAKE_A_MEMBER } from '../a_crews_tools/a_crews_tools.ts'
import { WHO_IS_FREE } from '../see_who_is_free/who_is_free_tool.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { CONFIG } from '../refuse_a_member_writing_owner_memory/git_config_a_later_run_reads.ts'
import { OWNER_TODO_ADD, OWNER_TODO_DONE, THE_OWNERS_TODO_ASK } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'

/**
 * Why the relay's mod names these three by literal (martha#255): the host installs
 * the relay as a copy of its own folder, and a hooks module may import only its own
 * files, so no constant of the core is reachable from inside it.
 */
const THE_RELAY_CANNOT_IMPORT = 'the host installs the relay as a copy of its own folder, so a hooks module there imports only its own files and the name it asks is held by literal'

/** Why the five landing tools are named by literal in the hooks module (martha#256), as one wording for all five. */
const A_HOOKS_MODULE = 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal'

/**
 * Why the handover's one argument is named by literal (martha#255): it is the
 * argument the host's Write call takes, and the constant holding it sits in the
 * host glue, which a slice may not import (prove_the_core keeps that boundary).
 * The word is too common to define again: defining it would make every `content`
 * in the tree stale at once, and a member's tool call is not worth that.
 */
const THE_ARGUMENT_OF_A_WRITE = 'the host\'s own name for the argument that holds a whole file, which lives in the host glue a slice may not import'

/**
 * Why the mod writes `model` twice by literal (martha#315): it is the word an order carries a model under, which the
 * launcher holds as a constant a hooks module cannot import, and it is also the name of the host command the mod runs to
 * switch a session's model — the same spelling twice, and only the first is the launcher's word.
 */
const THE_MODEL_IN_THE_MOD = 'the word an order carries a model under, which the launcher holds as a constant a hooks module cannot import, and the name of the host command this mod runs to switch a session, which the host names'

/**
 * Why the mod writes `clear` twice by literal (martha#255 r=2): it is the word an order carries the clear under, which
 * the launcher holds as a constant a hooks module cannot import, and it is also the name of the host command the mod
 * runs to clear a session — the same spelling twice, and only the first is the launcher's word. The list is keyed by
 * value and file, so the two are one entry.
 */
const THE_CLEAR_IN_THE_MOD = 'the word an order carries the clear under, which the launcher holds as a constant a hooks module cannot import, and the name of the host command this mod runs to clear a session, which the host names'

/**
 * Why three launch and refresh tests write `clear` as a literal (martha#255 r=2):
 * it is the word the host records in a `session_started` event whose session began
 * with `/clear` — recorded data, not the order a launcher answers, and the same
 * spelling by coincidence in exactly the sense this list is for.
 */
const THE_HOSTS_WORD_FOR_A_CLEAR = 'the host\'s own word in the session_started event it records, for a session that began with /clear: recorded data, not the order a launcher answers'

/**
 * Why the relay registers the host's five hook events by literal (martha#313): the host's plugin validator reads the
 * module and refuses a relay whose `on(...)` names its event by anything but a string literal, and the relay is installed
 * as a copy of its own folder, where a hooks module imports only its own files. The adapter that reads those same
 * events holds their names, and this entry is what keeps the two spellings one name.
 */
const THE_HOST_NAMES_ITS_HOOKS = 'the host\'s plugin validator refuses an on(...) whose event is not a string literal, and a hooks module imports only its own files'

/**
 * Why `model` is written by literal in five files that are not about the order (martha#315): each names a field of
 * something else, and the order's carry word is a different word that happens to be spelled the same. The host's Agent
 * schema names its own argument; the request body the stand-in host reads carries the model under its own key.
 */
const THE_HOSTS_OWN_MODEL_FIELD = 'the host\'s own name for the argument that carries a model, in the Agent schema it declares and in the request body it sends: recorded host data, not the word an order carries a model under'

/** Why `model` is written by literal for the dashboard (martha#315): it is the row's own field, read and written by it. */
const THE_ROWS_MODEL_FIELD = 'the row\'s own field for the model a session runs on, which the dashboard reads back and writes'

/** Why `model` is written by literal for the declaration (martha#315): it is the key a member's own model is declared under. */
const THE_DECLARATIONS_MODEL_KEY = 'the key a member\'s own model is declared under, in the declaration this repository writes'

/** Why a reader of a park names its kind by literal (martha#319): a union's tag is a type, and the place is another word. */
const THE_KIND_OF_A_PARK = 'the tag of the ThePark union, which TypeScript narrows on by literal; the crew\'s park place is named the same word and is not this'
export const EXCEPTIONS: readonly Exception[] = [
  // The one rule in src/check_no_literal_restates_a_value makes an entry name its
  // value, so the value is written as the constant that holds it: a literal here
  // would be the same copy the rule exists to catch, in the very file that excuses it.
  { value: THE_REFRESH_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: WRITE_MY_HANDOVER_TOOL, file: 'claude_code_relay/hooks/crew.tsx', reason: `the name of a tool this mod answers and registers; ${THE_RELAY_CANNOT_IMPORT}` },
  // The five landing tools' hooks (martha#256): a hooks module runs with no Node and may import only its own files,
  // so the slice's own constant is not reachable there, and the host's plugin validator refuses a tool named by
  // anything but a literal. Each entry names the constant rather than another copy of its value.
  { value: VERIFY_RANGE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: LAND_BATCH, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: FAST_FORWARD_AFTER_THE_OWNERS_YES, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: WORKTREE_OPEN, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: WORKTREE_FINISH, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  // The five names the crew's own tools took (martha#343): the same reason as the landing tools above — the mod answers
  // each by a literal it cannot build, and the constant it would otherwise read lives in a slice it may not import.
  { value: LOG_A_MILESTONE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: SAY_TO_THE_CREW, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: READ_THE_RECEIPTS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: PARK_A_MEMBER, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: WAKE_A_MEMBER, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: REFRESH_THIS_SESSION, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  // The Supervisor's who-is-free tool (martha#319): the same reason, one more tool the mod answers by a literal.
  { value: WHO_IS_FREE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  // The owner's to-do list (martha#316): the mod answers its two tools by literal, as above, and asks the launcher for
  // the list under a name held by literal for the reason the refresh ask is.
  { value: OWNER_TODO_ADD, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: OWNER_TODO_DONE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: THE_OWNERS_TODO_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  // The socket the mod talks to its launcher over (martha#254): the name is read by the host from this very file, and
  // the host refuses a hooks module that gives `$.env.get` anything but a literal, an imported constant included
  // (#104) — so the copy of the name has to sit here, and this line is the one that says it is the same name.
  { value: RELAY_SOCKET_VARIABLE, file: 'claude_code_relay/hooks/crew.tsx', reason: 'the host reads this name from the hooks module and refuses anything but a literal in $.env.get, an imported constant included (#104)' },
  { value: WHOLE_FILE_CONTENT, file: 'a_crews_tools/a_crews_tools.ts', reason: `the one argument the handover tool takes; ${THE_ARGUMENT_OF_A_WRITE}` },
  { value: WHOLE_FILE_CONTENT, file: 'write_my_handover/write_my_handover.ts', reason: `the one argument this tool reads; ${THE_ARGUMENT_OF_A_WRITE}` },
  // The order's two decision words (martha#255 r=2 R1): the launcher names them as constants, so the mod's own copy of
  // each — it reads the answer and runs it, and a hooks module cannot import the constant — is held here. Reword either
  // on the launcher's side and this entry matches no literal in the mod, and the gate says so by name.
  { value: CARRY_A_TEXT, file: 'claude_code_relay/hooks/crew_answers.ts', reason: `the word an order carries a text under, read back off the wire; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: CARRY_THE_CLEAR, file: 'claude_code_relay/hooks/crew_answers.ts', reason: `the word an order carries the clear under, read back off the wire; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: CARRY_A_TEXT, file: 'claude_code_relay/hooks/crew.tsx', reason: `the word this mod submits a prompt under; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: CARRY_THE_CLEAR, file: 'claude_code_relay/hooks/crew.tsx', reason: THE_CLEAR_IN_THE_MOD },
  // The model order's word and the model switch's own tool names (martha#315): the same reason as the entries above.
  { value: CARRY_A_MODEL, file: 'claude_code_relay/hooks/crew_answers.ts', reason: `the word an order carries a model under, read back off the wire; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: CARRY_A_MODEL, file: 'claude_code_relay/hooks/crew.tsx', reason: THE_MODEL_IN_THE_MOD },
  { value: SWITCH_YOUR_MODEL, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: RETURN_TO_YOUR_OWN_MODEL, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: THE_MODEL_REPORT_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher once a model switch resolved; ${THE_RELAY_CANNOT_IMPORT}` },
  // The same spelling in recorded host data (martha#255 r=2): three tests replay what the host recorded, and its word
  // for a session that began with /clear is its own.
  { value: CARRY_THE_CLEAR, file: 'carry_taint_across_a_refresh/carry_taint_across_a_refresh.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
  { value: CARRY_THE_CLEAR, file: 'launch_a_claude_code_member/a_refresh_is_not_wiped_by_the_clear.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
  { value: CARRY_THE_CLEAR, file: 'launch_a_claude_code_member/launch_a_claude_code_member.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
  // The park test reads back the state a marker holds, and checks that the old single tool's argument is gone
  // (martha#343). Both spell the word the crew's park place is named with, and neither is that place.
  { value: PARKED_PLACE, file: 'a_crews_tools/the_park_tool_keeps_the_marker.node-test.ts', reason: 'the state a park marker reads back as, and the argument the one tool used to take; the crew\'s park place is named the same word and is not this' },
  { value: PARKED_PLACE, file: 'stop_and_restart_a_member/list_the_members.ts', reason: 'the state martha ls shows a parked member in, and the kind a park read answers with (martha#312); the crew\'s park place is named the same word and is not this' },
  { value: PARKED_PLACE, file: 'stop_and_restart_a_member/stop_and_restart_a_member.node-test.ts', reason: 'the state martha ls shows a parked member in, and the kind a park read answers with, as the test expects them (martha#312); the crew\'s park place is named the same word and is not this' },
  // Who is free reads a park by its kind (martha#319): `parked` is the tag of the ThePark union, which TypeScript
  // narrows on and which no constant can stand in for, and the crew's park place is named the same word and is not it.
  { value: PARKED_PLACE, file: 'see_who_is_free/see_who_is_free.ts', reason: THE_KIND_OF_A_PARK },
  { value: PARKED_PLACE, file: 'see_who_is_free/see_who_is_free.node-test.ts', reason: THE_KIND_OF_A_PARK },
  // A host sends the calling plugin's own name as an origin's name (martha#343), and the relay's plugin is called
  // Martha. The crew's state directory is named the same word and means nothing here: this fixture stands in for a
  // real host's event, and the test reads only the origin's kind.
  { value: STATE_ROOT_NAME, file: 'launch_a_claude_code_member/a_prompt_the_relay_takes_in_is_raised.node-test.ts', reason: 'the plugin name a host puts in an origin, not the crew state directory name: the words are the same and the meanings are not' },
  // The five events the relay hears from the host (martha#313), each spelled out because the host's validator will take
  // nothing else there.
  { value: PERMISSION_REQUEST, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: ELICITATION, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: ELICITATION_RESULT, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: NOTIFICATION, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: TOOL_CHECK, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  // A git subcommand, in a test that makes a throwaway repository (martha#315). The constant of that name is the file a
  // git directory keeps its configuration in, which this test neither reads nor writes.
  { value: CONFIG, file: 'launch_a_claude_code_member/a_switch_on_the_recorded_host.node-test.ts', reason: 'git\'s own `config` subcommand, in a test that makes a throwaway repository; the constant of that name is the file a git directory keeps its settings in' },
  // The word `model` in the model-switch work (martha#315), in five files that each mean a field of their own by it.
  { value: CLAUDE_CODE_SHELL_TOOL, file: 'run_reviews_on_the_review_model/run_reviews_on_the_review_model.node-test.ts', reason: 'a call to a tool that spawns no subagent, named as the host names its shell: what the test needs is a real tool the rule must not hold' },
  { value: CARRY_A_MODEL, file: 'a_crews_tools/the_model_tools_answer_the_crew.node-test.ts', reason: 'the arguments the switch tool takes, as its own schema declares them' },
  { value: CARRY_A_MODEL, file: 'a_crews_tools/a_crews_tools.ts', reason: 'the argument the two model tools take and read back, as their own schemas declare it; the order\'s carry word is a different word spelled the same' },
  { value: PARKED_PLACE, file: 'a_crews_tools/a_crews_tools.ts', reason: 'the word a park\'s answer says a member is now in, in the line the member is told; the constant of that name is the place a crew keeps a park marker in' },
  { value: CARRY_A_MODEL, file: 'claude_code_host/claude_code_host.node-test.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  { value: CARRY_A_MODEL, file: 'claude_code_host/claude_code_host.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  { value: CARRY_A_MODEL, file: 'declare_crew/declare_crew.ts', reason: THE_DECLARATIONS_MODEL_KEY },
  { value: CARRY_A_MODEL, file: 'launch_a_claude_code_member/drive_the_recorded_host.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  { value: CARRY_A_MODEL, file: 'run_reviews_on_the_review_model/run_reviews_on_the_review_model.node-test.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  { value: CARRY_A_MODEL, file: 'show_dashboard_beat/show_dashboard_beat.ts', reason: THE_ROWS_MODEL_FIELD },
]

