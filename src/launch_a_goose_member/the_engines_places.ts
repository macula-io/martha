// The engine's entry places (#541 package A, design G1, PASS r=7 issuecomment-7010033523): what the host-neutral entry
// (../answer_what_a_host_reports, `answersOver`) is given for an engine launch, so the engine's calls are judged by the
// same gates, the same record and the same recheck as a Claude Code member's, through the engine's own names.
//
// The launch builds its entry once, from these places, and hands that one entry to both of its callers: the ACP client
// (the session, the turns, the tool calls and the results) and the crew's tool relay (`anEngineRelay`). Both go through
// the entry's one queue, so a crew tool call and an ACP event are answered in one order.
//
// What is the engine's own here, each from the design table's row, and nothing typed: the file tools and the resolver
// (`theEnginesFileTools`), the root's folders (`theRootsFolders`), the owner's engine folders (`theOwnersEngineFolders`),
// the result rows (`theEnginesToolResultRows`), and the re-check after every result: the launch's own watch first, then
// the session store read back against the snapshot taken at `session/new` (`theSessionStillHolds`). What the entry
// shares with every host (the record, the launch the owner approved, the crew, the policy) is the caller's, handed in.
//
// Said plainly: `read_attaches_nothing` and `started_with` are undefined, and `wordless_answers` is absent (design G1:
// the engine has no switch under which a read attaches nothing, nothing reads started_with without switches, and the
// config's only server is the crew's, so no mesh answer comes back).

import type { ThePlacesAHostReportsOver } from '../answer_what_a_host_reports/answer_what_a_host_reports.ts'
import type { EngineFacts } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { rememberOwnWriteOfCall } from '../launch_a_claude_code_member/remember_own_write_of_a_call.ts'
import { writesTheOwnersMemory, type OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { namesTheOwnersSettings } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import { gooseToolNames } from '../speak_acp_to_an_agent/answer_a_goose_call_by_the_entry.ts'
import { namesTheLaunchsRoot, theEnginesFileTools, theEnginesToolResultRows, theOwnersEngineFolders, theRootsFolders } from './the_engines_decisions.ts'
import { theSessionStillHolds, theSessionStoreOf, type TheSessionsGate } from './the_session_store_read_back.ts'

/** The recorded facts the engine's places are built from. */
export type TheFactsThePlacesRead = Pick<EngineFacts, 'developer_tools' | 'shell_tool' | 'path_resolution' | 'engine_folders' | 'engine_name' | 'tool_naming' | 'session_store'>

/** What every host's entry is given alike: the caller's, handed in unchanged. */
export type TheSharedPlaces = Omit<ThePlacesAHostReportsOver, 'refusesAWriteToTheOwnersSettings' | 'refusesAWriteToTheOwnersMemory' | 'results' | 'names'>

/** What the engine's own places are built over: the launch's root and watch, and the owner's places on this machine. */
export interface TheEnginesOwnPlaces {
  readonly facts: TheFactsThePlacesRead
  /** The launch's engine root (`GOOSE_PATH_ROOT`). */
  readonly root: string
  /** The owner's home. */
  readonly home: string
  /** The owner's Claude Code user settings file: the same file a Claude Code launch guards (design G1 row (a)). */
  readonly owners_settings_file: string
  /** The owner's memory places as a Claude Code launch tells them today; the owner's engine folders are added here. */
  readonly owner_memory: OwnerMemoryPlaces
  /** The launcher's environment, which places the owner's engine folders (XDG). */
  readonly launcher_env: Readonly<Record<string, string | undefined>>
  /** The launch's own re-check (`AGooseLaunch.settings_still_hold`): the owner's watch, the root as written, the folders whole. */
  readonly settings_still_hold: () => string | undefined
  /** The session's gate fields as the launch first read them after `session/new`; undefined until then. */
  readonly the_sessions_gate: () => TheSessionsGate | undefined
}

/** Why a result came while the launch had read no session back: nothing can be held against it, so the member stops. */
export const NO_SESSION_READ_BACK = 'a result came before the launch read its session back from the engine’s store, so nothing it ran can be held against the session the launch made (#541 package A)'

/** The engine's entry places, or why they cannot be built (a recording the engine's values cannot be built from). */
export function theEnginesPlaces(shared: TheSharedPlaces, own: TheEnginesOwnPlaces): ThePlacesAHostReportsOver | { readonly refusal: string } {
  const built = theEnginesFileTools(own.facts)
  if ('refusal' in built) return built
  const engineFolders = theOwnersEngineFolders(own.facts, own.launcher_env, own.home)
  if ('refusal' in engineFolders) return engineFolders
  const { tools } = built
  const launch_dir = shared.launch.launch_dir
  const rootFolders = theRootsFolders(own.facts, own.root)
  const ownerMemory: OwnerMemoryPlaces = { ...own.owner_memory, folders: [...own.owner_memory.folders, ...engineFolders.folders] }
  const store = theSessionStoreOf(own.facts, own.root)
  return {
    ...shared,
    names: gooseToolNames(own.facts.tool_naming),
    refusesAWriteToTheOwnersSettings: (input) =>
      namesTheOwnersSettings(input, own.owners_settings_file, launch_dir, own.home, tools) ?? namesTheLaunchsRoot(input, rootFolders, launch_dir, own.home, tools),
    refusesAWriteToTheOwnersMemory: (tool, input) => writesTheOwnersMemory(tool, input, ownerMemory, launch_dir, own.home, shared.machine, tools),
    results: {
      tool_result_rows: theEnginesToolResultRows(own.facts),
      read_attaches_nothing: undefined,
      started_with: undefined,
      noteWhatThisCallWrote: (call) => rememberOwnWriteOfCall(shared.launch, { ...call, home: own.home }, shared.machine, tools),
      checkTheSettingsStillHold: () => {
        const watch = own.settings_still_hold()
        if (watch !== undefined) return watch
        const gate = own.the_sessions_gate()
        return gate === undefined ? NO_SESSION_READ_BACK : theSessionStillHolds(own.facts, store, gate)
      },
    },
  }
}
