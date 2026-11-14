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
import { FAST_FORWARD_AFTER_THE_OWNERS_YES, LAND, LAND_BATCH } from '../land_passed_work_as_one_batch/land_passed_work_as_one_batch.ts'
import { WORKTREE_FINISH, WORKTREE_OPEN } from '../open_and_finish_a_worktree/open_and_finish_a_worktree.ts'
import { THE_REFRESH_ASK, CARRY_A_MODEL, CARRY_A_TEXT, CARRY_THE_CLEAR } from '../refresh_a_member/the_refresh_flow.ts'
import { WRITE_MY_HANDOVER_TOOL } from '../write_my_handover/write_my_handover.ts'
import { LOG_A_MILESTONE } from '../keep_the_ledger/keep_the_ledger.ts'
import { SAY_TO_THE_CREW } from '../send_a_crew_message/send_a_crew_message.ts'
import { READ_THE_RECEIPTS } from '../show_what_a_message_became/show_what_a_message_became.ts'
import { PARK_A_MEMBER, REFRESH_THIS_SESSION, RESTART_A_MEMBER, RETURN_TO_YOUR_OWN_MODEL, SWITCH_YOUR_MODEL, THE_CHANNEL_READ_ASK, THE_MODEL_REPORT_ASK, THE_TOOLS_ASK, WAKE_A_MEMBER } from '../a_crews_tools/a_crews_tools.ts'
import { WHO_IS_FREE } from '../see_who_is_free/who_is_free_tool.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { CREW_ROWS_PLACE, OWN_WRITES_SUFFIX, STATE_ROOT_NAME } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { OWNER, ROLE_TEXTS_DIRECTORY, WORKTREES } from '../declare_crew/declare_crew.ts'
import { CONFIG } from '../refuse_a_member_writing_owner_memory/git_config_a_later_run_reads.ts'
import { OWNER_TODO_ADD, OWNER_TODO_DONE, THE_OWNERS_TODO_ASK } from '../keep_the_owners_todo_list/keep_the_owners_todo_list.ts'
import { THE_MODEL_KEY } from '../put_the_owners_model_back/the_owners_settings_file.ts'
import { LIST_ASKS, QUEUE_ASK, SETTLE_ASKS, TAKE_ASKS } from '../queue_the_owners_asks/queue_the_owners_asks.ts'
import { STANDING, STANDING_ADD, STANDING_CLOSE } from '../keep_the_supervisors_standing_items/keep_the_supervisors_standing_items.ts'
import { WAIT_FOR_CI } from '../wait_for_ci/wait_for_ci.ts'
import { EMPTY_DIRECTORY_NAME } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'
import { RELAY_JOURNAL_SUFFIX } from '../launch_a_claude_code_member/keep_the_relays_journal.ts'
import { REFRESHES_PLACE } from '../refresh_a_member/refresh_a_member.ts'
import { REFRESH_FIELD } from '../show_dashboard_beat/show_dashboard_beat.ts'
import { RUN_IN_BACKGROUND } from '../keep_the_shell_for_an_owner_signed_command/keep_the_shell.ts'
import { SK_ED25519 } from '../trust_only_signed_lists/ssh_signature.ts'
import { STAGING_PREFIX } from '../crew_files_directory/crew_files_directory.ts'
import { SUPERVISOR } from '../report_progress/report_progress.ts'
import { THE_NEXT_MESSAGE_ASK } from '../hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts'
import { TREE_HASH } from '../prove_the_mesh_server_bytes/prove_the_mesh_server_bytes.ts'
import { TREE_PARAMETER } from '../install_the_recorded_mesh_server/confine_to_the_recorded_tree.ts'

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


/** Why `model` is written by literal for the declaration (martha#315): it is the key a member's own model is declared under. */
const THE_DECLARATIONS_MODEL_KEY = 'the key a member\'s own model is declared under, in the declaration this repository writes'

/** Why a reader of a park names its kind by literal (martha#319): a union's tag is a type, and the place is another word. */
const THE_KIND_OF_A_PARK = 'the tag of the ThePark union, which TypeScript narrows on by literal; the crew\'s park place is named the same word and is not this'
/**
 * Why a test names git's `config` subcommand by literal (martha#315, martha#359): it makes a throwaway repository and
 * sets its identity, and the constant of that name is the file a git directory keeps its settings in, which the test
 * neither reads nor writes.
 */
const A_TOOLS_OWN_SUBCOMMAND = 'a tool\'s own `config` subcommand (git\'s, npm\'s, opencode\'s), in a test or a probe that drives it; the constant of that name is the file a git directory keeps its settings in'

/**
 * Why `model` is written by literal beside the settings key of the same spelling (martha#359): the key a restore may
 * touch in the owner's settings file is one word, and these files mean other fields by it — the word an order carries
 * a model under, and the name of the place a crew keeps its model records in. Reword the settings key and each of these
 * matches nothing, and the gate says so by name.
 */
const THE_OWNERS_FILES_MODEL_KEY_IS_NOT_THESE = 'a word of its own that the settings key of the owner\'s file is spelled the same as'

// The coincidences of #289 part (b), as Uranus ruled them on the whole-tree report: a
// word that something else owns, kept, with the family it belongs to. A word that
// could be any other word was renamed instead, never excused.

/** The value of OPEN_THE_PANE, which lives in a hooks module (.tsx) that nothing outside the relay can import, so this list holds it once, here. */
const THE_WHOLE_CREW = 'crew'
/** Why this list spells the whole-crew word itself (#289 part b). */
const THE_PANES_CONSTANT_CANNOT_BE_IMPORTED = 'the whole-crew word, held once for the entries below: the constant of that value is the pane command in a .tsx hooks module, which nothing outside the relay can import'
/** Why `'crew'` is written by literal where a message is addressed (#289 part b). */
const THE_WHOLE_CREW_ADDRESSEE = 'the addressee that means every member, a member of the Addressee union compared at run time; the constant of that word is the command that opens the pane'
/** Why a store's name is written by literal in a test of the host contract (#289 part b). */
const A_STORE_THE_CONTRACT_NAMES = 'the name of a store the host contract declares, listed as the host holds them; the constant of that word is a folder of the crew\'s state'
/** Why `'crew'` is written by literal in a signed list (#289 part b). */
const A_FIELD_OF_A_SIGNED_LIST = 'a field a signed list document carries, named as its signature covers it'
/** Why `'tree'` is written by literal where a launcher reads a checkout (#289 part b). */
const THE_TAG_OF_A_READ_TREE = 'the tag of the union a checkout read returns, which TypeScript narrows on by literal; the constant of that word is a recorder\'s parameter'
/** Why `'tree'` is written by literal in an approval record (#289 part b). */
const A_FIELD_OF_AN_APPROVAL = 'a field of an approval record, as the record is written and read back'
/** Why `'nothing'` is written by literal where an approval is told (#289 part b). */
const THE_TAG_OF_NOTHING_TO_APPROVE = 'the tag of an approval outcome with nothing to approve, a union member TypeScript narrows on; the constant of that word is the name of an empty folder'
/** Why `'parked'` is written by literal among a row's states (#289 part b). */
const A_STATE_OF_A_ROW = 'a state a dashboard row can be in, listed in STATES; the crew\'s park place is named the same word and is not this'
/** Why `'owner'` is written by literal in the declaration (#289 part b). */
const A_FIELD_OF_THE_DECLARATION = 'a field of the crew declaration, as its schema names it and as a refusal names the field'
/** Why `'owner'` is written by literal as a turn's origin (#289 part b). */
const THE_OWNER_AS_A_TURNS_ORIGIN = 'a member of the TurnOrigin union, compared at run time; the constant of that word is the role of the crew\'s owner'
/** Why the relay socket's name is written by literal in register.ts (#289 part b, as for crew.tsx in martha#254). */
const THE_HOST_READS_THE_SOCKET_BY_LITERAL = 'the host reads this name from the hooks module and refuses anything but a literal in $.env.get, an imported constant included (#104)'
/** Why `'martha'` is written by literal for the repository, the command or the plugin (#289 part b). */
const THE_REPOSITORYS_OWN_NAME = 'the repository\'s, its command\'s or its plugin\'s own name; the constant of that word is the folder Martha keeps its state under'
/** Why a role name is written by literal in a test crew (#289 part b). */
const A_ROLE_A_TEST_CREW_DECLARES = 'the role a test crew declares; a role is the declaration\'s own word, and the constant of that word is the role report_progress reads'
/** Why each store's glue holds its own staging prefix (#289 part b). */
const MACHINE_GLUE_HOLDS_ITS_OWN = 'machine glue imports only the host contract and its own files, so each store\'s glue holds its own staging prefix'
/** Why `'sha512'` is written by literal for an ssh signature (#289 part b). */
const SSHS_OWN_HASH_NAME = 'ssh\'s own name for the hash a signature uses; the constant of that word names the hash of a recorded tree'
/** Why an ssh key type is written by literal among the public addresses (#289 part b). */
const A_KEY_TYPE_IS_A_PUBLIC_ADDRESS = 'a key type listed as a public address that posted text may carry; the constant of that word is the type the signature reader accepts'
/** Why `'.jsonl'` is written by literal where a probe reads the host (#289 part b). */
const THE_HOSTS_TRANSCRIPT_SUFFIX = 'Claude Code\'s own suffix for a session transcript, which a probe reads; the constant of that word is the suffix of the launcher\'s own-writes records'
/** Why `'.json'` is written by literal in a filter (#289 part b). */
const ANY_JSON_FILE = 'a filter on any JSON file; the constant of that word is the suffix of the relay\'s journal'
/** Why a test's title equals a constant (#289 part b). */
const A_TEST_TITLED_WITH_ITS_RULE = 'a test\'s title, which states in words the rule the constant names'
/** Why `'worktrees'` is written by literal inside a git directory (#289 part b). */
const GITS_OWN_WORKTREES_FOLDER = 'git\'s own folder for linked worktrees inside a git directory; the constant of that word is the crew\'s house rule for where worktrees go'
/** Why the two `'refresh'` constants stay apart (#289 part b). */
const TWO_REFRESH_WORDS = 'a row\'s refresh field and the folder of refresh records are two meanings spelled alike, each defined once in its own slice'

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
  { value: WHOLE_FILE_CONTENT, file: 'a_crews_tools/a_crews_tools.ts', reason: `the one argument the handover tool takes; ${THE_ARGUMENT_OF_A_WRITE}` },
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
  // A coincidence of names (martha#312): the declaration's own field, as v0.1.0's file lacks it, is not the launcher's ask.
  { value: THE_CHANNEL_READ_ASK, file: 'declare_crew/declare_crew.node-test.ts', reason: 'the declaration field a crew file names, which the launcher\'s ask happens to share' },
  // The same spelling in recorded host data (martha#255 r=2): three tests replay what the host recorded, and its word
  // for a session that began with /clear is its own.
  { value: CARRY_THE_CLEAR, file: 'carry_taint_across_a_refresh/carry_taint_across_a_refresh.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
  { value: CARRY_THE_CLEAR, file: 'launch_a_claude_code_member/a_refresh_is_not_wiped_by_the_clear.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
  { value: CARRY_THE_CLEAR, file: 'launch_a_claude_code_member/launch_a_claude_code_member.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
  // The same word again (martha#306 r=2): this test posts the start the host posts after a /clear, so the source is the
  // host's own vocabulary and not the word an order carries a clear under.
  { value: CARRY_THE_CLEAR, file: 'start_a_member/start_a_member.node-test.ts', reason: THE_HOSTS_WORD_FOR_A_CLEAR },
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
  // The dashboard's own word for a parked member (martha#320). It is the row's state, and shares its spelling with
  // PARKED_PLACE, the name of the place a crew keeps its park markers in: the two are different names for different
  // things, and a park is read by both — the marker and the row the member itself wrote.
  { value: PARKED_PLACE, file: 'nudge_the_supervisor/nudge_the_supervisor.ts', reason: 'the dashboard row\'s state, not the place a crew keeps its park markers in' },
  { value: PARKED_PLACE, file: 'nudge_the_supervisor/nudge_the_supervisor.node-test.ts', reason: 'the dashboard row\'s state, not the place a crew keeps its park markers in' },
  { value: PARKED_PLACE, file: 'watch_waits/watch_waits.ts', reason: 'the dashboard row\'s state, read where a chain ends; not the place a crew keeps its park markers in' },
  { value: PARKED_PLACE, file: 'watch_waits/watch_waits.node-test.ts', reason: 'the dashboard row\'s state, not the place a crew keeps its park markers in' },
  // A member trying to log the landing (martha#320). The test asks the ledger to refuse three spellings of it, and the
  // third is also the name of the branch prefix a landing pushes from: the same word, and neither is the other.
  { value: LAND, file: 'keep_the_ledger/keep_the_ledger.node-test.ts', reason: 'a milestone spelling the ledger must refuse, not the branch prefix a landing pushes from' },
  // The declaration's mode holds a `roles` field, the list of the crew's role names; `roles/` is the directory each
  // role's text sits in (martha#306). One English word names the field and the folder, and the field reader is not a
  // path: it is excused here, and a copy of the word anywhere else still fails.
  { value: ROLE_TEXTS_DIRECTORY, file: 'declare_crew/declare_crew.ts', reason: 'the declaration\'s mode.roles field, a list of role names, and not the roles/ directory a role\'s text sits in' },
  // The five events the relay hears from the host (martha#313), each spelled out because the host's validator will take
  // nothing else there.
  { value: PERMISSION_REQUEST, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: ELICITATION, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: ELICITATION_RESULT, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: NOTIFICATION, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  { value: TOOL_CHECK, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_NAMES_ITS_HOOKS },
  // A git subcommand, in a test that makes a throwaway repository (martha#315). The constant of that name is the file a
  // git directory keeps its configuration in, which this test neither reads nor writes.
  { value: CONFIG, file: 'launch_a_claude_code_member/a_switch_on_the_recorded_host.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'launch_a_claude_code_member/a_switch_does_not_move_the_owners_default.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  // The same git subcommand, in the permission-prompt run's throwaway repository (martha#363).
  { value: CONFIG, file: 'launch_a_claude_code_member/a_permission_prompt_on_the_recorded_host.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  // The word `model` in the model-switch work (martha#315), in five files that each mean a field of their own by it.
  { value: CLAUDE_CODE_SHELL_TOOL, file: 'run_reviews_on_the_review_model/run_reviews_on_the_review_model.node-test.ts', reason: 'a call to a tool that spawns no subagent, named as the host names its shell: what the test needs is a real tool the rule must not hold' },
  { value: CARRY_A_MODEL, file: 'a_crews_tools/the_model_tools_answer_the_crew.node-test.ts', reason: 'the arguments the switch tool takes, as its own schema declares them' },
  { value: CARRY_A_MODEL, file: 'a_crews_tools/a_crews_tools.ts', reason: 'the argument the two model tools take and read back, as their own schemas declare it; the order\'s carry word is a different word spelled the same' },
  { value: PARKED_PLACE, file: 'a_crews_tools/a_crews_tools.ts', reason: 'the word a park\'s answer says a member is now in, in the line the member is told; the constant of that name is the place a crew keeps a park marker in' },
  { value: CARRY_A_MODEL, file: 'claude_code_host/claude_code_host.node-test.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  { value: CARRY_A_MODEL, file: 'claude_code_host/claude_code_host.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  { value: CARRY_A_MODEL, file: 'declare_crew/declare_crew.ts', reason: THE_DECLARATIONS_MODEL_KEY },
  { value: CARRY_A_MODEL, file: 'run_reviews_on_the_review_model/run_reviews_on_the_review_model.node-test.ts', reason: THE_HOSTS_OWN_MODEL_FIELD },
  // The same spelling for the key a restore may touch in the owner's settings file (martha#359), in two files that mean
  // something else by it.
  { value: THE_MODEL_KEY, file: 'refresh_a_member/the_refresh_flow.ts', reason: `the word an order carries a model under, which this file holds as CARRY_A_MODEL; ${THE_OWNERS_FILES_MODEL_KEY_IS_NOT_THESE}` },
  { value: THE_MODEL_KEY, file: 'switch_a_members_model/switch_a_members_model.ts', reason: `the name of the place a crew keeps its model records in, which this file holds as MODEL_PLACE; ${THE_OWNERS_FILES_MODEL_KEY_IS_NOT_THESE}` },
  // #289 part (b), by Uranus's ruling: one entry per file and word.
  { value: RELAY_JOURNAL_SUFFIX, file: 'claude_code_host/settings_that_turn_hooks_off.ts', reason: ANY_JSON_FILE },
  { value: RELAY_JOURNAL_SUFFIX, file: 'show_dashboard_beat/show_dashboard_beat.ts', reason: ANY_JSON_FILE },
  { value: OWN_WRITES_SUFFIX, file: 'probe_launch_hosts/probe_hosts.ts', reason: THE_HOSTS_TRANSCRIPT_SUFFIX },
  { value: STAGING_PREFIX, file: 'crew_files_directory/crew_files_directory.ts', reason: MACHINE_GLUE_HOLDS_ITS_OWN },
  { value: STAGING_PREFIX, file: 'linux_process_identity/launch_records_directory.ts', reason: MACHINE_GLUE_HOLDS_ITS_OWN },
  { value: STAGING_PREFIX, file: 'row_streams_directory/row_streams_directory.ts', reason: MACHINE_GLUE_HOLDS_ITS_OWN },
  { value: RELAY_SOCKET_VARIABLE, file: 'claude_code_relay/hooks/register.ts', reason: THE_HOST_READS_THE_SOCKET_BY_LITERAL },
  { value: RUN_IN_BACKGROUND, file: 'keep_the_shell_for_an_owner_signed_command/keep_the_shell.node-test.ts', reason: A_TEST_TITLED_WITH_ITS_RULE },
  { value: THE_CHANNEL_READ_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: THE_CHANNEL_READ_ASK, file: 'declare_crew/declare_crew.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: CONFIG, file: 'check_no_test_the_base_passed_goes_missing/check_no_test_the_base_passed_goes_missing.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'keep_martha_state_outside_the_checkout/crew_state_directory.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'land_passed_work_as_one_batch/land_passed_work_as_one_batch.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'launch_a_claude_code_member/own_writes_on_the_recorded_host.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'launch_a_claude_code_member/run_nothing_a_checkout_planted.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'probe_launch_hosts/probe_hosts.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'refuse_code_a_checkout_runs_itself/refuse_code_a_checkout_runs_itself.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'refuse_launch_of_unapproved_config/the_launcher_judges_the_tree.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'run_an_owner_signed_command/run_a_signed_shape.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'run_an_owner_signed_command/signed_base.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'run_the_martha_command/run_the_martha_command.node-test.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: CONFIG, file: 'run_the_martha_command/run_the_martha_command.ts', reason: A_TOOLS_OWN_SUBCOMMAND },
  { value: THE_WHOLE_CREW, file: 'a_crews_tools/a_crews_tools.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'claude_code_host/claude_code_host.node-test.ts', reason: A_STORE_THE_CONTRACT_NAMES },
  { value: THE_WHOLE_CREW, file: 'hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.node-test.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'hand_a_crew_message_to_its_member/hand_a_crew_message_to_its_member.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'host_contract/host_contract.node-test.ts', reason: A_STORE_THE_CONTRACT_NAMES },
  { value: THE_WHOLE_CREW, file: 'keep_the_crew_channel/crew_channel.node-test.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'keep_the_crew_channel/crew_channel.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'send_a_crew_message/send_a_crew_message.node-test.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'send_a_crew_message/send_a_crew_message.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'show_what_a_message_became/show_what_a_message_became.node-test.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'show_what_a_message_became/show_what_a_message_became.ts', reason: THE_WHOLE_CREW_ADDRESSEE },
  { value: THE_WHOLE_CREW, file: 'trust_only_signed_lists/trust_only_signed_lists.ts', reason: A_FIELD_OF_A_SIGNED_LIST },
  { value: STATE_ROOT_NAME, file: 'check_nothing_private_gets_in/check_nothing_private_gets_in.node-test.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: STATE_ROOT_NAME, file: 'check_nothing_private_gets_in/declared.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: STATE_ROOT_NAME, file: 'check_posted_text_carries_nothing_private/check_posted_text_carries_nothing_private.node-test.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: STATE_ROOT_NAME, file: 'claude_code_host/claude_code_host.node-test.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: STATE_ROOT_NAME, file: 'launch_a_claude_code_member/drive_the_recorded_host.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: STATE_ROOT_NAME, file: 'run_the_martha_command/run_the_martha_command.node-test.ts', reason: THE_REPOSITORYS_OWN_NAME },
  { value: CARRY_A_MODEL, file: 'put_the_owners_model_back/the_owners_settings_file.ts', reason: THE_OWNERS_FILES_MODEL_KEY_IS_NOT_THESE },
  { value: EMPTY_DIRECTORY_NAME, file: 'approve_a_checkouts_config/approve_a_checkouts_config.node-test.ts', reason: THE_TAG_OF_NOTHING_TO_APPROVE },
  { value: EMPTY_DIRECTORY_NAME, file: 'approve_a_checkouts_config/approve_a_checkouts_config.ts', reason: THE_TAG_OF_NOTHING_TO_APPROVE },
  { value: EMPTY_DIRECTORY_NAME, file: 'run_the_martha_command/run_the_martha_command.ts', reason: THE_TAG_OF_NOTHING_TO_APPROVE },
  { value: OWNER, file: 'attribute_a_cross_session_sender/attribute_a_cross_session_sender.node-test.ts', reason: THE_OWNER_AS_A_TURNS_ORIGIN },
  { value: OWNER, file: 'declare_crew/declare_crew.node-test.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: OWNER, file: 'declare_crew/declare_crew.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: OWNER, file: 'take_in_a_turn/take_in_a_turn.node-test.ts', reason: THE_OWNER_AS_A_TURNS_ORIGIN },
  { value: OWNER, file: 'trust_only_framed_envelopes/trust_only_framed_envelopes.node-test.ts', reason: THE_OWNER_AS_A_TURNS_ORIGIN },
  { value: OWNER, file: 'trust_only_framed_envelopes/trust_only_framed_envelopes.ts', reason: THE_OWNER_AS_A_TURNS_ORIGIN },
  { value: PARKED_PLACE, file: 'park_and_wake_a_member/park_and_wake_a_member.node-test.ts', reason: THE_KIND_OF_A_PARK },
  { value: PARKED_PLACE, file: 'park_and_wake_a_member/park_and_wake_a_member.ts', reason: THE_KIND_OF_A_PARK },
  { value: PARKED_PLACE, file: 'show_dashboard_beat/show_dashboard_beat.ts', reason: A_STATE_OF_A_ROW },
  { value: PARKED_PLACE, file: 'wake_a_member/wake_a_member.node-test.ts', reason: THE_KIND_OF_A_PARK },
  { value: PARKED_PLACE, file: 'wake_a_member/wake_a_member.ts', reason: THE_KIND_OF_A_PARK },
  { value: REFRESHES_PLACE, file: 'show_dashboard_beat/show_dashboard_beat.ts', reason: TWO_REFRESH_WORDS },
  { value: REFRESH_FIELD, file: 'refresh_a_member/refresh_a_member.ts', reason: TWO_REFRESH_WORDS },
  { value: CREW_ROWS_PLACE, file: 'claude_code_host/claude_code_host.node-test.ts', reason: A_STORE_THE_CONTRACT_NAMES },
  { value: CREW_ROWS_PLACE, file: 'host_contract/host_contract.node-test.ts', reason: A_STORE_THE_CONTRACT_NAMES },
  { value: TREE_HASH, file: 'trust_only_signed_lists/sign_like_a_hardware_key.ts', reason: SSHS_OWN_HASH_NAME },
  { value: TREE_HASH, file: 'trust_only_signed_lists/ssh_signature.ts', reason: SSHS_OWN_HASH_NAME },
  { value: SK_ED25519, file: 'check_nothing_private_gets_in/declared.ts', reason: A_KEY_TYPE_IS_A_PUBLIC_ADDRESS },
  { value: SUPERVISOR, file: 'declare_crew/declare_crew.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
  { value: SUPERVISOR, file: 'park_and_wake_a_member/park_and_wake_a_member.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
  { value: SUPERVISOR, file: 'wake_a_member/wake_a_member.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
  { value: THE_NEXT_MESSAGE_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: THE_TOOLS_ASK, file: 'claude_code_relay/hooks/crew.tsx', reason: `the ask this mod puts to the launcher; ${THE_RELAY_CANNOT_IMPORT}` },
  { value: TREE_PARAMETER, file: 'keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts', reason: A_FIELD_OF_AN_APPROVAL },
  { value: TREE_PARAMETER, file: 'refuse_launch_of_unapproved_config/checkout_tree.ts', reason: THE_TAG_OF_A_READ_TREE },
  { value: TREE_PARAMETER, file: 'refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.node-test.ts', reason: THE_TAG_OF_A_READ_TREE },
  { value: TREE_PARAMETER, file: 'refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts', reason: THE_TAG_OF_A_READ_TREE },
  { value: TREE_PARAMETER, file: 'refuse_launch_of_unapproved_config/the_launcher_judges_the_tree.node-test.ts', reason: THE_TAG_OF_A_READ_TREE },
  { value: TREE_PARAMETER, file: 'refuse_launch_of_unapproved_config/the_launcher_judges_the_tree.ts', reason: `${THE_TAG_OF_A_READ_TREE}, and git's own object type in hash-object -t` },
  { value: TREE_PARAMETER, file: 'take_in_a_tool_result/take_in_a_tool_result.node-test.ts', reason: THE_TAG_OF_A_READ_TREE },
  { value: TREE_PARAMETER, file: 'take_in_a_tool_result/take_in_a_tool_result.ts', reason: THE_TAG_OF_A_READ_TREE },
  { value: WORKTREES, file: 'refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.node-test.ts', reason: GITS_OWN_WORKTREES_FOLDER },
  { value: THE_WHOLE_CREW, file: 'check_no_literal_restates_a_value/exceptions.ts', reason: THE_PANES_CONSTANT_CANNOT_BE_IMPORTED },
]
