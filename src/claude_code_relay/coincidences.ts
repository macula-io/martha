// The coincidences of claude_code_relay: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { REFRESH_THIS_SESSION, THE_MODEL_REPORT_ASK, THE_TOOLS_ASK } from '../a_crews_tools/a_crews_tools.ts'
import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { CARRY_THE_END } from '../end_a_running_turn/end_the_running_turn.ts'
import { THE_NEXT_MESSAGE_ASK, THE_TURN_STARTED_ASK } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { ELICITATION, ELICITATION_RESULT, NOTIFICATION, PERMISSION_REQUEST, TOOL_CHECK } from '../hear_the_hosts_dialogs/hear_the_hosts_dialogs.ts'
import { THE_CHANNEL_READ_ASK } from '../keep_the_crew_channel/the_channel_read.ts'
import { LOG_A_MILESTONE } from '../keep_the_ledger/keep_the_ledger.ts'
import { KEEP_THE_PACKAGE_CONTRACT } from '../keep_the_package_contract/keep_the_package_contract.ts'
import { OWNER_TODO_ADD, OWNER_TODO_DONE, THE_OWNERS_TODO_ASK } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { STANDING, STANDING_ADD, STANDING_CLOSE } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { PROC_ROOT } from '../linux_process_identity/process_identity_from_proc.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { PARK_A_MEMBER, WAKE_A_MEMBER } from '../park_and_wake_a_member/the_park_tools.ts'
import { LIST_ASKS, QUEUE_ASK, SETTLE_ASKS, TAKE_ASKS } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { REPORT_WHERE_THE_WORK_STANDS } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { CARRY_A_MODEL, CARRY_A_TEXT, CARRY_THE_CLEAR, THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { THE_BUDGET_ASK } from '../keep_what_a_session_spent/the_crews_budget.ts'
import { WHO_IS_FREE } from '../see_who_is_free/who_is_free_tool.ts'
import { UNHELD_WORK } from '../find_the_unheld_work/unheld_work_tool.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { THE_WHOLE_CREW } from '../keep_the_crew_channel/crew_channel.ts'
import { READ_THE_RECEIPTS } from '../show_what_a_message_became/show_what_a_message_became.ts'
import { RESTART_A_MEMBER } from '../stop_and_restart_a_member/the_restart_tool.ts'
import { RETURN_TO_YOUR_OWN_MODEL, SWITCH_YOUR_MODEL } from '../switch_a_members_model/the_switch_tools.ts'
import { WAIT_FOR_CI } from '../wait_for_ci/wait_for_ci.ts'
import { FILE_A_FRICTION_NOTE } from '../file_a_friction_note/the_friction_tool.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { THE_RELEASE_ACT } from '../tell_a_member_what_its_relaunch_killed/tell_a_member_what_its_relaunch_killed.ts'
import { REFRESH_BEAT_MS } from './hooks/crew_turn_beat.ts'
import { PANE, RELAY_DEADLINE_MS, RELAY_SOCKET_VARIABLE } from './hooks/relay_protocol.ts'

/**
 * Why the relay holds by literal what it cannot import, as one wording for every entry below: the host installs the
 * relay as a copy of its own folder, so a hooks module imports only its own files; and where the host reads such a name
 * itself — a tool's name (martha#256, martha#343), the event an `on(...)` names (martha#313), what `$.env.get` returns
 * (#104) — it refuses anything but a string literal, an imported constant included. Each entry keeps its own part of it
 * as its phrase or as the comment above it.
 */
const A_HOOKS_MODULE_CANNOT_IMPORT = 'the host installs the relay as a copy of its own folder, so a hooks module imports only its own files and holds by literal what it cannot import; and where the host reads such a name itself, a tool\'s name, the event an on(...) names, or what $.env.get returns, it refuses anything but a string literal, an imported constant included (#104)'

export const COINCIDENCES: readonly Exception[] = [
  // The one rule in src/check_no_literal_restates_a_value makes an entry name its
  // value, so the value is written as the constant that holds it: a literal here
  // would be the same copy the rule exists to catch, in the very file that excuses it.
  { value: THE_REFRESH_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: THE_BUDGET_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher when the owner types /crew-budget (martha#990); ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: WRITE_MY_HANDOVER_TOOL, file: 'claude_code_relay/hooks/crew.tsx', reason: `the name of a tool this mod answers and registers; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  // The five landing tools' hooks (martha#256): a hooks module runs with no Node and may import only its own files,
  // so the slice's own constant is not reachable there, and the host's plugin validator refuses a tool named by
  // anything but a literal. Each entry names the constant rather than another copy of its value.
  { value: VERIFY_RANGE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: LAND_BATCH, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: FAST_FORWARD_AFTER_THE_OWNERS_YES, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: WORKTREE_OPEN, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: WORKTREE_FINISH, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The five names the crew's own tools took (martha#343): the same reason as the landing tools above — the mod answers
  // each by a literal it cannot build, and the constant it would otherwise read lives in a slice it may not import.
  { value: LOG_A_MILESTONE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The package contract's tool (martha#513): the Supervisor keeps a package's contract with it, and the mod answers it
  // by a literal for the same reason as the entries above.
  { value: KEEP_THE_PACKAGE_CONTRACT, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: SAY_TO_THE_CREW, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The owner's `/crew` (martha#927) asks the launcher under the tool's own name, as the model's call of it does.
  { value: SAY_TO_THE_CREW, file: 'claude_code_relay/hooks/crew_command.ts', reason: `the tool /crew sends through; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  // The command's name is the crew's own word, which the channel also uses for "every member": the same spelling, and
  // not the same thing. A send from /crew names one member, never the whole crew.
  { value: THE_WHOLE_CREW, file: 'claude_code_relay/hooks/crew_command.ts', reason: 'the /crew command the owner types (martha#927), not the channel\'s word for every member' },
  { value: THE_WHOLE_CREW, file: 'claude_code_relay/hooks/crew.tsx', reason: 'the name of the /crew command the owner types (martha#927), not the channel\'s word for every member' },
  // The release act (#693 r=2): the refusal names it and the mod answers it, each by a literal.
  { value: THE_RELEASE_ACT, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: READ_THE_RECEIPTS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The park, wake and restart tools took their names in slices of their own (#443 part 5), so each is read here from
  // the slice that declares it; the mod still answers each by a literal, for the reason above.
  { value: PARK_A_MEMBER, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: WAKE_A_MEMBER, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: WAIT_FOR_CI, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The friction note's tool (martha#318): the same reason, one more tool the mod answers by a literal.
  { value: FILE_A_FRICTION_NOTE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: RESTART_A_MEMBER, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: REFRESH_THIS_SESSION, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The Supervisor's who-is-free tool (martha#319): the same reason, one more tool the mod answers by a literal.
  { value: WHO_IS_FREE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The Supervisor's unheld-work tool (martha#319 package B): one more tool the mod answers by a literal.
  { value: UNHELD_WORK, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The progress tool, under Martha's own name since #468: the mod answers it by a literal, for the same reason.
  { value: REPORT_WHERE_THE_WORK_STANDS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The owner's to-do list (martha#316): the mod answers its two tools by literal, as above, and asks the launcher for
  // the list under a name held by literal for the reason the refresh ask is.
  { value: OWNER_TODO_ADD, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: OWNER_TODO_DONE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The owner's ask queue (martha#313): the mod answers its four tools by literal, for the same reason.
  { value: QUEUE_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: LIST_ASKS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: TAKE_ASKS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: SETTLE_ASKS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: THE_OWNERS_TODO_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  // The Supervisor's standing items (martha#317): three more tools the mod answers by a literal, for the same reason.
  { value: STANDING_ADD, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: STANDING_CLOSE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: STANDING, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The socket the mod talks to its launcher over (martha#254): the name is read by the host from this very file, and
  // the host refuses a hooks module that gives `$.env.get` anything but a literal, an imported constant included
  // (#104) — so the copy of the name has to sit here, and this line is the one that says it is the same name.
  { value: RELAY_SOCKET_VARIABLE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  // The order's two decision words (martha#255 r=2 R1): the launcher names them as constants, so the mod's own copy of
  // each — it reads the answer and runs it, and a hooks module cannot import the constant — is held here. Reword either
  // on the launcher's side and this entry matches no literal in the mod, and the gate says so by name.
  { value: CARRY_A_TEXT, file: 'claude_code_relay/hooks/crew_answers.ts', reason: `the word an order carries a text under, read back off the wire; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: CARRY_THE_CLEAR, file: 'claude_code_relay/hooks/crew_answers.ts', reason: `the word an order carries the clear under, read back off the wire; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: CARRY_A_TEXT, file: 'claude_code_relay/hooks/crew.tsx', reason: `the word this mod submits a prompt under; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  // The clear: the word an order carries the clear under (martha#255 r=2), which is also the name of the host command
  // this mod runs to clear a session — the same spelling twice, and only the first is the launcher's word. The list is
  // keyed by value and file, so a word that is both is one entry.
  { value: CARRY_THE_CLEAR, file: 'claude_code_relay/hooks/crew.tsx', reason: `the word an order carries the clear under, which is also the name of the host command this mod runs; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  // The model order's word and the model switch's own tool names (martha#315): the same reason as the entries above;
  // the two tool names are read from the slice that declares them since #443 part 5.
  { value: CARRY_A_MODEL, file: 'claude_code_relay/hooks/crew_answers.ts', reason: `the word an order carries a model under, read back off the wire; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  // The model: the word an order carries a model under (martha#315), which is also the name of the host command this
  // mod runs to switch a session's model — the same spelling twice, as for the clear above.
  { value: CARRY_A_MODEL, file: 'claude_code_relay/hooks/crew.tsx', reason: `the word an order carries a model under, which is also the name of the host command this mod runs; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: SWITCH_YOUR_MODEL, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: RETURN_TO_YOUR_OWN_MODEL, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: THE_MODEL_REPORT_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher once a model switch resolved; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  // The end order's word (martha#311), which the mod reads off the wire and carries out: the same reason as the entries above.
  { value: CARRY_THE_END, file: 'claude_code_relay/hooks/crew_answers.ts', reason: `the word an order carries the end of a running turn under, read back off the wire; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: CARRY_THE_END, file: 'claude_code_relay/hooks/crew.tsx', reason: `the word this mod ends the running turn under; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  // The five events the relay hears from the host (martha#313), each spelled out because the host's validator will take
  // nothing else there.
  { value: PERMISSION_REQUEST, file: 'claude_code_relay/hooks/register.ts', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: ELICITATION, file: 'claude_code_relay/hooks/register.ts', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: ELICITATION_RESULT, file: 'claude_code_relay/hooks/register.ts', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: NOTIFICATION, file: 'claude_code_relay/hooks/register.ts', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: TOOL_CHECK, file: 'claude_code_relay/hooks/register.ts', reason: A_HOOKS_MODULE_CANNOT_IMPORT },
  { value: RELAY_SOCKET_VARIABLE, file: 'claude_code_relay/hooks/register.ts', reason: 'the variable the relay reads with $.env.get, which the host takes there only as a string literal (#104)' },
  { value: THE_CHANNEL_READ_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: THE_NEXT_MESSAGE_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: THE_TURN_STARTED_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the turn start this mod reports to the launcher; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: THE_TOOLS_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${A_HOOKS_MODULE_CANNOT_IMPORT}` },
  { value: PANE, file: 'claude_code_relay/hooks/relay_protocol.ts', reason: 'the pane\'s id and the command that opens it are the program\'s own name; the same word names the folder Martha keeps her state under' },
  // The relay's beat, which is a minute too (martha#441): a hooks module imports only its own files, so the relay cannot
  // import the core's MINUTE_MS, and its beat is the same duration under its own name.
  { value: REFRESH_BEAT_MS, file: 'claude_code_relay/hooks/crew_turn_beat.ts', reason: 'a hooks module imports only its own files, so the relay cannot import the core MINUTE_MS; its beat is the same minute under its own name' },
  // Where the relay reads this host's own state line (martha#437): the same root as the core's PROC_ROOT, held by literal
  // for the reason the beat above is, and the same one word the core's readers take. The relay's own tests read the core's
  // constant, so a copy that drifts from it is caught twice: here by name, and there by a read nothing answers.
  { value: PROC_ROOT, file: 'claude_code_relay/hooks/register.ts', reason: 'a hooks module imports only its own files, so the relay cannot import the core PROC_ROOT; its own copy is the same root, its only reader takes it from there, and the relay\'s tests read the core\'s constant' },
  // The relay's own half-minute wait (martha#441): this file is the protocol both sides of a launch read, so it imports
  // nothing, and its wait for the launcher to check a checkout's tree is the same half minute as the launcher's wait
  // for a host answer and not the same deadline.
  { value: RELAY_DEADLINE_MS, file: 'claude_code_relay/hooks/relay_protocol.ts', reason: 'the relay\'s wait for the launcher to check a checkout\'s tree; the launcher\'s wait for a host answer is the same half minute and not the same deadline, and a hooks module imports only its own files' },
]
