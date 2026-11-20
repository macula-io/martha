// Re-records what the Claude Code host says about itself, from its binary, or
// checks that the committed recording is still what that binary says.
//
//   npm run record:claude-code-host -- <claude binary> <version>
//   npm run record:claude-code-host -- --check <claude binary> <version> <its sdk-tools.d.ts> <npm's answer>
//
// Run the first when the host is upgraded; the coverage check then names any
// session start source and any prompt origin kind the new host sends that its
// declaration does not cover, and a test names any change to the settings keys
// that turn Martha's relay off (martha#122).
//
// The second writes nothing (martha#139). It derives a recording from the binary
// in memory and compares it with the committed one, field by field, once the
// minifier's names are taken out of each code field (compare_two_recordings.ts,
// martha#811). It exits 1 when the binary cannot be read or any fact differs,
// naming the field and where it first differs; the models the release's
// sdk-tools.d.ts accepts are one of those facts. A release whose facts are all the
// recorded ones passes on its version alone with a notice that a routine
// re-record is due, until the notice ages (how_long_a_notice_lasts.ts, read from
// npm's answer for the package's `time` and `versions`). memory_off, which is
// restated by hand, differs when a text it quotes is no longer in the host's code
// (martha#412), and a change inside a function its file-mode guard calls
// differs by file_mode_guard_calls (martha#438). Its standard output
// carries only versions and the names of fields and parts, which is what the
// drift job's public log shows as the reason a run is red; a reader's own
// error, which can quote the host's code, goes to standard error.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { argv, exit, stderr, stdout } from 'node:process'

import { promptOriginsIn } from '../claude_code_host/claude_code_prompt_origins.ts'
import { sessionStartSchemaIn } from '../claude_code_host/claude_code_session_events.ts'
import { classicHookEventsIn, notificationTypesIn } from '../claude_code_host/owner_dialogs_the_host_raises.ts'
import { filePermissionRulesIn } from '../claude_code_host/file_permission_rules.ts'
import { markdownTheHostLoadsIn, type MarkdownTheHostLoads } from '../load_the_hosts_markdown/markdown_the_host_loads.ts'
import { theSkillsLoaderIn } from '../load_the_hosts_markdown/the_skills_loader.ts'
import { protectedConfigPlacesIn } from '../cut_the_rules_from_the_host_binary/protected_config_places.ts'
import { signInStoreVariableIn } from '../cut_the_rules_from_the_host_binary/the_sign_in_store.ts'
import { providerSwitchVariablesIn } from '../cut_the_rules_from_the_host_binary/the_provider_switches.ts'
import { hookExitCallsIn, hookSwitchesSourceIn, managedFolderFunctionIn, managedSettingsPlaceIn } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import { failedAgentsReportIn } from '../read_what_claude_code_says_of_an_agent/read_a_failed_agents_report.ts'
import { CARRIED, MEMORY_OFF, memoryOffHoldsOf, recordingFrom, type Committed, type Derived } from './carry_over_what_is_restated_by_hand.ts'
import { RECORDING_OF_THE_HOST } from './the_file_that_holds_the_recording.ts'
import { differencesBetween, type Difference } from '../compare_two_host_recordings/compare_two_recordings.ts'
import { Unreadable } from '../compare_two_host_recordings/compare_under_renaming.ts'
import { whyTheNoticeHasAged } from './how_long_a_notice_lasts.ts'
import { calleesOfTheCodeFields } from '../follow_what_host_code_calls/record_what_the_code_fields_call.ts'
import { modelsTheHostAccepts } from './the_models_the_host_accepts.ts'
import { fileModeGuardCallsIn, fileModeGuardIn, managedFolderGuardCallsIn } from './what_the_hosts_guards_call.ts'

const MODELS = new URL('../claude_code_host/recorded_claude_code_models.json', import.meta.url)
/** The fact the models recording is named by when the release's declaration accepts others, and the part when it cannot be read. */
const MODELS_FACT = 'models'
const MODELS_PART = 'models the host accepts'
const NPM_PART = "npm's release times or versions"
const VERSION = /^\d+\.\d+\.\d+$/
const CHECK = '--check'
/** Each part the recorder reads from a host's text, by the name a failed read reports. */
const PARTS: ReadonlyArray<{ readonly part: string; readonly read: (text: string) => Partial<Derived> }> = [
  { part: 'session start schema', read: (text) => ({ session_start_schema: sessionStartSchemaIn(text) }) },
  { part: 'hook events a module hears', read: (text) => ({ classic_hook_events: classicHookEventsIn(text) }) },
  { part: 'notification types', read: (text) => ({ notification_types: notificationTypesIn(text) }) },
  { part: 'prompt origins', read: promptOriginsIn },
  { part: 'hook switches', read: hookSwitchesIn },
  { part: 'managed settings place', read: (text) => ({ managed_settings: managedSettingsPlaceIn(text) }) },
  { part: 'markdown the host loads', read: markdownIn },
  { part: 'skills loader', read: theSkillsLoaderIn },
  { part: 'protected config places', read: protectedConfigPlacesIn },
  { part: 'sign-in store', read: signInStoreVariableIn },
  { part: 'provider switches', read: providerSwitchVariablesIn },
  { part: 'file permission rules', read: (text) => ({ file_permission_rules: filePermissionRulesIn(text) }) },
  { part: "a failed agent's report", read: (text) => ({ failed_agents_report: failedAgentsReportIn(text) }) },
  { part: 'file-mode memory guard', read: (text) => ({ file_mode_guard_calls: fileModeGuardCallsIn(text) }) },
]

/** The markdown the host loads, and what its loader's managed-folder guard calls (martha#146, martha#412). */
function markdownIn(text: string): Pick<Derived, keyof MarkdownTheHostLoads | 'managed_folder_guard_calls'> {
  const managed = managedFolderFunctionIn(text)
  return { ...markdownTheHostLoadsIn(text, managed), managed_folder_guard_calls: managedFolderGuardCallsIn(text, managed) }
}

/** The function that builds the hook set, and each function an exit of it calls (martha#122). */
function hookSwitchesIn(text: string): Pick<Derived, 'hooks_switches' | 'hooks_switch_calls'> {
  const hooks_switches = hookSwitchesSourceIn(text)
  return { hooks_switches, hooks_switch_calls: hookExitCallsIn(text, hooks_switches) }
}

/** What a host's text says, part by part, and the parts that could not be read. */
function readHost(text: string): { derived: Partial<Derived>; unreadable: readonly string[] } {
  const read = PARTS.map(({ part, read: readPart }) => {
    try {
      return { part, fields: readPart(text) }
    } catch (error) {
      stderr.write(`${part}: ${error instanceof Error ? error.message : String(error)}\n`)
      return { part, fields: undefined }
    }
  })
  return {
    derived: Object.assign({}, ...read.map(({ fields }) => fields ?? {})) as Partial<Derived>,
    unreadable: read.filter(({ fields }) => fields === undefined).map(({ part }) => part),
  }
}

/** Whether the memory guard restated by hand still holds of the host (martha#412), under renaming (martha#811). */
function memoryOffHolds(committed: Committed, text: string, derived: Partial<Derived>): boolean {
  try {
    const reached = derived.file_mode_guard_calls
    return reached !== undefined && memoryOffHoldsOf(committed.memory_off, text, fileModeGuardIn(text).source, reached)
  } catch {
    return false
  }
}

/** Whether the release's declaration accepts the recorded models; throws Unreadable when it cannot be read. */
function modelsHold(declaration: string): boolean {
  const recorded = (JSON.parse(readFileSync(MODELS, 'utf8')) as { readonly aliases?: unknown }).aliases
  return JSON.stringify(modelsTheHostAccepts(readFileSync(declaration, 'utf8'))) === JSON.stringify(recorded)
}

/**
 * The models fact of a release: whether its declaration accepts other models than the recorded ones, or the part that
 * cannot be read. A release that ships no declaration is unreadable by the file it lacks, never a raw error (martha#811).
 */
function modelsFact(declaration: string): { readonly unreadable?: string; readonly differs?: true } {
  if (!existsSync(declaration)) return { unreadable: `${MODELS_PART}: no declaration at ${declaration}` }
  try {
    return modelsHold(declaration) ? {} : { differs: true }
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error
    return { unreadable: MODELS_PART }
  }
}

/** Each part of a check that cannot be read, and each fact that differs: the version aside. */
function facts(committed: Committed, text: string, derived: Partial<Derived>, unreadableParts: readonly string[], declaration: string): { readonly unreadable: string[]; readonly differ: Difference[] } {
  const unreadable = [...unreadableParts]
  const differ: Difference[] = []
  if (unreadable.length === 0) {
    const { callees, unreadable: uncut } = calleesOfTheCodeFields(text, derived)
    const compared = differencesBetween(committed as unknown as Record<string, unknown>, { ...derived, ...callees }, CARRIED)
    unreadable.push(...uncut, ...compared.unreadable)
    differ.push(...compared.differ)
    if (!memoryOffHolds(committed, text, derived)) differ.push({ field: MEMORY_OFF, at: 'a text it quotes' })
  }
  const models = modelsFact(declaration)
  if (models.unreadable !== undefined) unreadable.push(models.unreadable)
  if (models.differs === true) differ.push({ field: MODELS_FACT, at: 'the names AgentInput.model accepts' })
  return { unreadable, differ: differ.sort((one, other) => one.field.localeCompare(other.field)) }
}

/** --check: what the binary says against the committed recording, as the drift job prints it; its exit status. */
function check(committed: Committed, text: string, host_version: string, declaration: string, npmAnswer: string): number {
  const { derived, unreadable: unreadableParts } = readHost(text)
  const { unreadable, differ } = facts(committed, text, derived, unreadableParts, declaration)
  stdout.write(`recorded ${committed.host_version}, host ${host_version}\n`)
  if (unreadable.length > 0) stdout.write(`unreadable: ${unreadable.join(', ')}\n`)
  if (differ.length > 0) stdout.write(`differs: ${differ.map(({ field }) => field).join(', ')}\n`)
  for (const { field, at } of differ) stdout.write(`first difference: ${field} at ${at}\n`)
  if (unreadable.length > 0 || differ.length > 0) return 1
  if (host_version === committed.host_version) return 0
  return noticeStatus(committed, host_version, npmAnswer)
}

/** A release that moved no fact, as the drift job prints it: 0 while its notice holds, 1 once aged or unreadable. */
function noticeStatus(committed: Committed, host_version: string, npmAnswer: string): number {
  let aged: string | undefined
  try {
    aged = whyTheNoticeHasAged(JSON.parse(readFileSync(npmAnswer, 'utf8')) as unknown, committed.host_version, Date.now())
  } catch (error) {
    if (!(error instanceof Unreadable) && !(error instanceof SyntaxError)) throw error
    stdout.write(`unreadable: ${NPM_PART}\n`)
    return 1
  }
  if (aged !== undefined) {
    stdout.write(`aged: ${aged}: the re-record is overdue\n`)
    return 1
  }
  stdout.write(`notice: Claude Code ${host_version} carries the same facts as the recorded ${committed.host_version}: a routine re-record is due.\n`)
  return 0
}

const checking = argv[2] === CHECK
const [binary, host_version, declaration, npmAnswer] = argv.slice(checking ? 3 : 2)
if (binary === undefined || host_version === undefined || !VERSION.test(host_version) || (checking && (declaration === undefined || npmAnswer === undefined))) {
  stderr.write(`usage: record_claude_code_host.ts <claude binary> <version, as claude --version prints it>\n       record_claude_code_host.ts ${CHECK} <claude binary> <version> <its sdk-tools.d.ts> <npm's answer for time and versions, as JSON>\n`)
  exit(2)
}

const committed = JSON.parse(readFileSync(RECORDING_OF_THE_HOST, 'utf8')) as Committed
const text = readFileSync(binary, 'latin1')

if (checking) exit(check(committed, text, host_version, declaration ?? '', npmAnswer ?? ''))

const { derived, unreadable } = readHost(text)
const { callees, unreadable: uncut } = unreadable.length > 0 ? { callees: {}, unreadable: [] } : calleesOfTheCodeFields(text, derived)
if (unreadable.length > 0 || uncut.length > 0) {
  stderr.write(`record_claude_code_host: not recorded, unreadable: ${[...unreadable, ...uncut].join(', ')}\n`)
  exit(1)
}
const recorded = recordingFrom(committed, host_version, derived as Derived, callees)
writeFileSync(RECORDING_OF_THE_HOST, `${JSON.stringify(recorded, null, 2)}\n`)
