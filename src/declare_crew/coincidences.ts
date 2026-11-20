// The coincidences of declare_crew: words its own files spell like a constant held elsewhere, meaning something
// else by them, each with its reason (martha#289). Read by the restated-values check as a syntax tree, never run.

import type { Exception } from '../../prove_the_core/a_value_is_said_once/no_literal_restates_a_value.ts'
import { HOST_ANSWER_TIMEOUT_MS } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { THE_CHANNEL_READ_ASK } from '../keep_the_crew_channel/the_channel_read.ts'
import { CARRY_A_MODEL } from '../refresh_a_member/the_refresh_flow.ts'
import { SUPERVISOR } from '../report_where_the_work_stands/report_where_the_work_stands.ts'
import { HOST, OWNER, ROLE_TEXTS_DIRECTORY } from './declare_crew.ts'
import { THE_MODELS_SWITCH } from '../pass_only_switches_that_load_no_config/pass_only_switches_that_load_no_config.ts'
import { PARKED_PLACE } from '../park_and_wake_a_member/park_and_wake_a_member.ts'
import { CONFIG } from '../find_what_a_later_git_run_reads/git_config_a_later_run_reads.ts'
import { TRANSCRIPTS_PLACE } from '../keep_martha_state_outside_the_checkout/keep_martha_state_outside_the_checkout.ts'
import { KITTY } from '../open_the_crew_in_kitty/the_session_kitty_reads.ts'

/** Why `'owner'` is written by literal in the declaration (#289 part b). */
const A_FIELD_OF_THE_DECLARATION = 'a field of the crew declaration, as its schema names it and as a refusal names the field'

/** Why a role name is written by literal in a test crew (#289 part b). */
export const A_ROLE_A_TEST_CREW_DECLARES = 'the role a test crew declares; a role is the declaration\'s own word, and the constant of that word is the role report_where_the_work_stands reads'

/** Why `model` is written by literal for the declaration (martha#315): it is the key a member's own model is declared under. */
const THE_DECLARATIONS_MODEL_KEY = 'the key a member\'s own model is declared under, in the declaration this repository writes'

export const COINCIDENCES: readonly Exception[] = [
  // The offline time before martha#931, pinned as written so the default is checked against the old value rather than
  // read back from the code that defines it; the host's answer timeout is the same number for another reason.
  { value: HOST_ANSWER_TIMEOUT_MS, file: 'declare_crew/the_crews_thresholds.node-test.ts', reason: 'the offline time the code held before martha#931, pinned in milliseconds as written' },
  // A coincidence of names (martha#312): the declaration's own field, as v0.1.0's file lacks it, is not the launcher's ask.
  { value: THE_CHANNEL_READ_ASK, file: 'declare_crew/declare_crew.node-test.ts', reason: 'the declaration field a crew file names, which the launcher\'s ask happens to share' },
  // The declaration's mode holds a `roles` field, the list of the crew's role names; `roles/` is the directory each
  // role's text sits in (martha#306). One English word names the field and the folder, and the field reader is not a
  // path: it is excused here, and a copy of the word anywhere else still fails.
  { value: ROLE_TEXTS_DIRECTORY, file: 'declare_crew/declare_crew.ts', reason: 'the declaration\'s mode.roles field, a list of role names, and not the roles/ directory a role\'s text sits in' },
  { value: CARRY_A_MODEL, file: 'declare_crew/declare_crew.ts', reason: THE_DECLARATIONS_MODEL_KEY },
  { value: THE_CHANNEL_READ_ASK, file: 'declare_crew/declare_crew.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: OWNER, file: 'declare_crew/declare_crew.node-test.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: OWNER, file: 'declare_crew/declare_crew.ts', reason: A_FIELD_OF_THE_DECLARATION },
  { value: SUPERVISOR, file: 'declare_crew/declare_crew.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
  { value: SUPERVISOR, file: 'declare_crew/the_drafts_declaration.node-test.ts', reason: A_ROLE_A_TEST_CREW_DECLARES },
  // PR 939 ruling: Martha's team table names its supervisor role; report_where_the_work_stands imports this slice, so its constant cannot be imported back.
  { value: SUPERVISOR, file: 'declare_crew/declare_crew.ts', reason: 'the supervisor role Martha\'s team table names; the slice that holds SUPERVISOR imports this one, so it is not imported back' },
  // martha#931: a harness's `config` is the folder that harness keeps its own settings in, not git's config file.
  { value: CONFIG, file: 'declare_crew/the_crews_profiles.ts', reason: 'a harness\'s config field in the declaration, the folder it keeps its settings in, not git\'s config file' },
  // martha#931: `transcripts` is the declaration's block of how much of a launch's transcript is kept, not the state folder they are kept in.
  { value: TRANSCRIPTS_PLACE, file: 'declare_crew/the_crews_workspace.ts', reason: 'the declaration\'s transcripts block, not the state folder transcripts are kept in' },
  { value: TRANSCRIPTS_PLACE, file: 'declare_crew/the_drafts_declaration.node-test.ts', reason: 'the declaration\'s transcripts block, not the state folder transcripts are kept in' },
  // martha#931: the declaration names its terminal as the owner types it; the kitty opener's own constant sits in an adapter, which a slice may not import.
  { value: KITTY, file: 'declare_crew/the_drafts_declaration.node-test.ts', reason: 'the terminal a declaration names, as the owner types it, and the one a declaration naming none opens in (martha#932); the opener\'s program is another value' },
  { value: KITTY, file: 'declare_crew/the_crews_workspace.ts', reason: 'the terminal a declaration names, as the owner types it; the opener\'s constant is in an adapter a slice may not import' },
  // martha#307: the switch the owner gives martha crew add for a member's model, which a host's own switch happens to share.
  // martha#541 package A: engine_endpoint's `host` is the server an engine member's model is reached on (the provider's
  // own OPENAI_HOST word), not the host a member runs on that HOST names.
  { value: HOST, file: 'declare_crew/the_engines_endpoint.ts', reason: 'engine_endpoint.host, the server an engine member\'s model is reached on, not the host a member runs on' },
  // martha#511: a member's `parked`, the field of Raf's draft on #931 that keeps a declared member down at `martha up`.
  { value: PARKED_PLACE, file: 'declare_crew/declare_crew.ts', reason: 'a member\'s field in the declaration that keeps it down at martha up; the crew\'s park place is named the same word and is not this' },
  { value: THE_MODELS_SWITCH, file: 'declare_crew/change_a_member.ts', reason: 'the switch martha crew add takes for a member\'s model, not the switch a host is started with' },
]
