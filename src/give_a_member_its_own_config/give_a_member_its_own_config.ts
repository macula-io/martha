// A config folder of the member's own (martha#602, step 5 of martha#601).
//
// This exists so the owner runs `martha start` from their own home, beside whatever their own Claude Code sessions
// load there. A member's host reads its user settings, its global config and its user scope from the folder
// CLAUDE_CONFIG_DIR names. Left to the owner's, an owner who runs another crew tool has hooks and plugins there, whose
// output would reach the member with nothing recorded (martha#121), and the launch is refused. With a folder of its
// own the member loads none of them, and the gate reads the settings Martha wrote instead.
//
// The folder is made new for each launch, 0700, inside the launch's own snapshot directory, and goes with it: the
// host refuses --resume (check_every_path_is_gated), so nothing in it needs to outlive the launch, and nothing one
// launch plants reaches the next. Before the member starts it holds two files, both the owner's choice (martha#602,
// decided 2026-11-18):
//   - settings.json: claude.ai connectors off and account skills not synced, so nothing the owner's account carries
//     reaches a member through its sign-in;
//   - .claude.json: the approved checkout, and only that folder, marked trusted, so the host does not ask again at
//     every start; and the host's first run marked done, so a fresh folder shows no first-run screens (the theme
//     picker, the security notice) before the session starts, and the theme is the host's own default. These are
//     first-run answers Martha gives for the owner. It answers an API key yes only for a member billed by that key
//     (below).
//
// It also holds the skills of the approved checkout (martha#747), copied under skills/ from the bytes the launch gate
// carried and hashed as approved: the host reads that folder as user-scope skills while project settings stay off, so
// the checkout's own .claude/skills is never read. They are copies, never links (the host drops a second file of the
// same identity, and a link would leave the live checkout's bytes in place), at file mode 0600 in 0700 folders: the
// executable bit is not carried, because the approval hashes content, not mode.
//
// Sign-in is pointed at, never copied: the recorded host's sign-in store variable, set and empty, names the owner's own
// default store (../cut_the_rules_from_the_host_binary/the_sign_in_store.ts). Both variables go on the member's
// environment over anything inherited, so neither the owner's shell nor a settings file the gate passes points the
// member back at the owner's folder.
//
// A member is billed through one credential, never both (martha#916). With a key and the sign-in both, the host bills
// the key: a G1 probe showed a member on "API Usage Billing" whose key had no credit, while the owner's own record had
// rejected that key (DECIDED 2026-11-20 "a", which supersedes the 2026-11-18 "answer yes for the owner"). The crew's
// `billing` setting picks it (DECIDED 2026-11-20 "Crew setting (Recommended)"):
//   - "subscription": the sign-in store variable as above, the launcher's key taken out of the member's environment,
//     and no key answered in its host record;
//   - "api_key": the launcher's key kept, the sign-in store variable taken out, so the host's store follows
//     CLAUDE_CONFIG_DIR into the member's own folder, which holds no sign-in, and that key answered yes in its host
//     record, so the host does not stop the member to ask.
// With no setting, a signed-in owner's member is billed by the subscription; one whose owner is not signed in by the
// key, when the launcher carries one; and otherwise by the subscription, whose sign-in the host then asks for. A
// sign-in that cannot be told is not read as "not signed in": the member is billed by the subscription, so an unknown
// answer never moves a member onto the key.

import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { API_KEY_VARIABLE, apiKeyAnsweredYes, AUTH_TOKEN_VARIABLE, FIRST_RUN_DONE_KEY, HOST_TRUST_RECORD_FILE, API_KEY_ANSWERS_KEY, TRUST_ACCEPTED_KEY, type TheSignIn } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { BILLED_BY_API_KEY, BILLED_BY_SUBSCRIPTION, type Billing } from '../declare_crew/declare_crew.ts'
import { CLAUDE_CODE_SIGN_IN_STORE_VARIABLE } from '../claude_code_host/recorded_claude_code_host.ts'
import { CONFIG_DIR_VARIABLE, SKILLS_KIND, SYNC_OFF_SETTING } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { USER_SETTINGS_FILE } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'

/** The setting that keeps the owner's claude.ai connectors out of a session. */
export const CONNECTORS_OFF_SETTING = 'disableClaudeAiConnectors'

/** The member's config folder, under the launch's snapshot directory. */
export const MEMBER_CONFIG_FOLDER = 'the-members-own-config'

/** Only the launcher's user reads or writes the folder and its files. */
export const MEMBER_CONFIG_MODE = 0o700
/** The mode of every file the folder holds: only the launcher's user reads it. */
export const FILE_MODE = 0o600

/** The member's user settings: the owner's account connectors off, its skills not synced (martha#602). */
export const MEMBERS_OWN_SETTINGS: Readonly<Record<string, boolean>> = { [CONNECTORS_OFF_SETTING]: true, [SYNC_OFF_SETTING]: false }

/**
 * The host's record for the member: its first run done, the key it is billed by (if any) answered yes, and the
 * approved checkout trusted, by its path and its real path, and nothing else. Without the first two, a fresh folder
 * shows the host's screens before any session starts, and the launcher, holding a member in a trusted folder to the
 * short deadline, stops it (seen live and in the recorded host, martha#602).
 */
export function theMembersHostRecord(checkout: string, billedKey: string | undefined): Readonly<Record<string, unknown>> {
  const trusted = { [TRUST_ACCEPTED_KEY]: true }
  const answered = billedKey === undefined || billedKey === '' ? {} : { [API_KEY_ANSWERS_KEY]: apiKeyAnsweredYes(billedKey) }
  return { [FIRST_RUN_DONE_KEY]: true, ...answered, projects: Object.fromEntries([...new Set([checkout, realpathSync(checkout)])].map((path) => [path, trusted])) }
}

/**
 * The credentials each billing hands a member: the variables that carry them to the host (martha#916). A bearer token
 * bills the API as a key does, and the host takes it over the owner's sign-in unasked (seen live on 2.1.329, r=3).
 */
const THE_CREDENTIALS_OF: Readonly<Record<Billing, readonly string[]>> = {
  [BILLED_BY_SUBSCRIPTION]: [CLAUDE_CODE_SIGN_IN_STORE_VARIABLE],
  [BILLED_BY_API_KEY]: [API_KEY_VARIABLE, AUTH_TOKEN_VARIABLE],
}

/** The variables a member billed by `billing` is never given, whatever it inherits: the other billing's credentials. */
export function notGivenUnder(billing: Billing): readonly string[] {
  return Object.entries(THE_CREDENTIALS_OF).flatMap(([other, variables]) => (other === billing ? [] : variables))
}

/**
 * The member's environment over everything inherited: its own config folder, and, for a member billed by the
 * subscription, the owner's default sign-in store.
 */
export function theMembersConfigEnvironment(folder: string, billing: Billing): Readonly<Record<string, string>> {
  return billing === BILLED_BY_SUBSCRIPTION ? { [CONFIG_DIR_VARIABLE]: folder, [CLAUDE_CODE_SIGN_IN_STORE_VARIABLE]: '' } : { [CONFIG_DIR_VARIABLE]: folder }
}

/**
 * The billing a member gets (martha#916): the crew's own when it declares one; else the subscription when the host
 * says the owner is signed in, the key when it says not and the launcher carries one, and the subscription otherwise,
 * an untold sign-in included.
 */
export function theBillingAMemberGets(declared: Billing | null, signIn: TheSignIn, carriesAKey: boolean): Billing {
  if (declared !== null) return declared
  return 'signed_in' in signIn && !signIn.signed_in && carriesAKey ? BILLED_BY_API_KEY : BILLED_BY_SUBSCRIPTION
}

/**
 * Makes the member's config folder at `folder` for a member of `checkout` billed by `billedKey`, or by none, holding
 * `skills`, keyed by their path below the skills folder; or why it could not be made.
 */
export function makeTheMembersConfig(
  folder: string,
  checkout: string,
  billedKey: string | undefined,
  skills: Readonly<Record<string, Uint8Array>>,
): { readonly made: true } | { readonly made: false; readonly refusal: string } {
  try {
    lstatSync(folder)
    return { made: false, refusal: `${folder} already exists, and a member's config folder is only ever made new` }
  } catch {
    // Not there: the only case in which it is made.
  }
  try {
    mkdirSync(folder, { mode: MEMBER_CONFIG_MODE })
    writeFileSync(join(folder, USER_SETTINGS_FILE), `${JSON.stringify(MEMBERS_OWN_SETTINGS)}\n`, { mode: FILE_MODE, flag: 'wx' })
    writeFileSync(join(folder, HOST_TRUST_RECORD_FILE), `${JSON.stringify(theMembersHostRecord(checkout, billedKey))}\n`, { mode: FILE_MODE, flag: 'wx' })
    for (const [path, bytes] of Object.entries(skills)) {
      const at = join(folder, SKILLS_KIND, path)
      mkdirSync(dirname(at), { recursive: true, mode: MEMBER_CONFIG_MODE })
      writeFileSync(at, bytes, { mode: FILE_MODE, flag: 'wx' })
    }
    return { made: true }
  } catch (error) {
    return { made: false, refusal: `the member's config folder ${folder} could not be made: ${error instanceof Error ? error.message : String(error)}` }
  }
}
