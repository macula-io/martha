// The coincidences of claude_code_relay: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/no_literal_restates_a_value.ts'
import { PARK_A_MEMBER, REFRESH_THIS_SESSION, RESTART_A_MEMBER, RETURN_TO_YOUR_OWN_MODEL, SWITCH_YOUR_MODEL, THE_CHANNEL_READ_ASK, THE_MODEL_REPORT_ASK, THE_TOOLS_ASK, WAKE_A_MEMBER } from '../a_crews_tools/a_crews_tools.ts'
import { VERIFY_RANGE } from '../check_a_range_before_the_owner_says_yes/check_a_range_before_the_owner_says_yes.ts'
import { CARRY_THE_END } from '../end_a_running_turn/end_the_running_turn.ts'
import { THE_NEXT_MESSAGE_ASK } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { ELICITATION, ELICITATION_RESULT, NOTIFICATION, PERMISSION_REQUEST, TOOL_CHECK } from '../hear_the_hosts_dialogs/hear_the_hosts_dialogs.ts'
import { LOG_A_MILESTONE } from '../keep_the_ledger/keep_the_ledger.ts'
import { OWNER_TODO_ADD, OWNER_TODO_DONE, THE_OWNERS_TODO_ASK } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { STANDING, STANDING_ADD, STANDING_CLOSE } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { LIST_ASKS, QUEUE_ASK, SETTLE_ASKS, TAKE_ASKS } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { CARRY_A_MODEL, CARRY_A_TEXT, CARRY_THE_CLEAR, THE_REFRESH_ASK } from '../refresh_a_member/the_refresh_flow.ts'
import { WHO_IS_FREE } from '../see_who_is_free/who_is_free_tool.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { READ_THE_RECEIPTS } from '../show_what_a_message_became/show_what_a_message_became.ts'
import { WAIT_FOR_CI } from '../wait_for_ci/wait_for_ci.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { RELAY_SOCKET_VARIABLE } from './hooks/relay_protocol.ts'

/** Why the five landing tools are named by literal in the hooks module (martha#256), as one wording for all five. */
const A_HOOKS_MODULE = 'a hooks module imports only its own files, and the host refuses a tool named by anything but a literal'

/**
 * Why the mod writes `clear` twice by literal (martha#255 r=2): it is the word an order carries the clear under, which
 * the launcher holds as a constant a hooks module cannot import, and it is also the name of the host command the mod
 * runs to clear a session — the same spelling twice, and only the first is the launcher's word. The list is keyed by
 * value and file, so the two are one entry.
 */
const THE_CLEAR_IN_THE_MOD = 'the word an order carries the clear under, which the launcher holds as a constant a hooks module cannot import, and the name of the host command this mod runs to clear a session, which the host names'

/**
 * Why the relay registers the host's five hook events by literal (martha#313): the host's plugin validator reads the
 * module and refuses a relay whose `on(...)` names its event by anything but a string literal, and the relay is installed
 * as a copy of its own folder, where a hooks module imports only its own files. The adapter that reads those same
 * events holds their names, and this entry is what keeps the two spellings one name.
 */
const THE_HOST_NAMES_ITS_HOOKS = 'the host\'s plugin validator refuses an on(...) whose event is not a string literal, and a hooks module imports only its own files'

/** Why the relay socket's name is written by literal in register.ts (#289 part b, as for crew.tsx in martha#254). */
const THE_HOST_READS_THE_SOCKET_BY_LITERAL = 'the host reads this name from the hooks module and refuses anything but a literal in $.env.get, an imported constant included (#104)'

/**
 * Why the mod writes `model` twice by literal (martha#315): it is the word an order carries a model under, which the
 * launcher holds as a constant a hooks module cannot import, and it is also the name of the host command the mod runs to
 * switch a session's model — the same spelling twice, and only the first is the launcher's word.
 */
const THE_MODEL_IN_THE_MOD = 'the word an order carries a model under, which the launcher holds as a constant a hooks module cannot import, and the name of the host command this mod runs to switch a session, which the host names'

/**
 * Why the relay's mod names these three by literal (martha#255): the host installs
 * the relay as a copy of its own folder, and a hooks module may import only its own
 * files, so no constant of the core is reachable from inside it.
 */
const THE_RELAY_CANNOT_IMPORT = 'the host installs the relay as a copy of its own folder, so a hooks module there imports only its own files and the name it asks is held by literal'

export const COINCIDENCES: readonly Exception[] = [
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
  { value: WAIT_FOR_CI, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: RESTART_A_MEMBER, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: REFRESH_THIS_SESSION, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  // The Supervisor's who-is-free tool (martha#319): the same reason, one more tool the mod answers by a literal.
  { value: WHO_IS_FREE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  // The owner's to-do list (martha#316): the mod answers its two tools by literal, as above, and asks the launcher for
  // the list under a name held by literal for the reason the refresh ask is.
  { value: OWNER_TODO_ADD, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: OWNER_TODO_DONE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  // The owner's ask queue (martha#313): the mod answers its four tools by literal, for the same reason.
  { value: QUEUE_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: LIST_ASKS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: TAKE_ASKS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: SETTLE_ASKS, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: THE_OWNERS_TODO_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  // The Supervisor's standing items (martha#317): three more tools the mod answers by a literal, for the same reason.
  { value: STANDING_ADD, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: STANDING_CLOSE, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  { value: STANDING, file: 'claude_code_relay/hooks/crew.tsx', reason: A_HOOKS_MODULE },
  // The socket the mod talks to its launcher over (martha#254): the name is read by the host from this very file, and
  // the host refuses a hooks module that gives `$.env.get` anything but a literal, an imported constant included
  // (#104) — so the copy of the name has to sit here, and this line is the one that says it is the same name.
  { value: RELAY_SOCKET_VARIABLE, file: 'claude_code_relay/hooks/crew.tsx', reason: 'the host reads this name from the hooks module and refuses anything but a literal in $.env.get, an imported constant included (#104)' },
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
  // The end order's word (martha#311), which the mod reads off the wire and carries out: the same reason as the entries above.
  { value: CARRY_THE_END, file: 'claude_code_relay/hooks/crew_answers.ts', reason: `the word an order carries the end of a running turn under, read back off the wire; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: CARRY_THE_END, file: 'claude_code_relay/hooks/crew.tsx', reason: `the word this mod ends the running turn under; ${THE_RELAY_CANNOT_IMPORT}` },
  // The five events the relay hears from the host (martha#313), each spelled out because the host's validator will take
  // nothing else there.
  { value: PERMISSION_REQUEST, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: ELICITATION, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: ELICITATION_RESULT, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: NOTIFICATION, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: TOOL_CHECK, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: RELAY_SOCKET_VARIABLE, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_READS_THE_SOCKET_BY_LITERAL },
  { value: THE_CHANNEL_READ_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: THE_NEXT_MESSAGE_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: THE_TOOLS_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
]
