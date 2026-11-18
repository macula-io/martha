// What the launcher settles about the settings its host reads, before any member runs: the mesh server the approved
// config installs must be a recorded one (martha#49); the settings files' environment may name only what the mesh
// server may be given (martha#65 r=3); no settings file, no environment and no argument of the owner's may turn
// Martha's relay off (martha#122); and the settings the host starts with carry the rules that refuse the host's own
// writes into the owner's memory, which the host is then asked to confirm it honours (martha#136, martha#226).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { CLAUDE_CODE_HOOK_SWITCHES, CLAUDE_CODE_OUTPUT_STYLES_FOLDER, CLAUDE_CODE_OWNERS_MARKDOWN, RECORDED_HOST } from '../claude_code_host/recorded_claude_code_host.ts'
import type { ManagedSettingsPlace } from '../cut_the_rules_from_the_host_binary/the_rules_a_hosts_binary_carries.ts'
import { dropInFiles, hookSettingsWatch, safeModeIn, type HookSettingsWatch } from '../refuse_settings_that_turn_hooks_off/settings_that_turn_hooks_off.ts'
import { pluginDirsIn } from '../load_the_hosts_markdown/hooks_and_plugins_the_owner_declares.ts'
import { environmentFromSettings, userSettingsPath } from '../load_the_hosts_markdown/settings_env_reaching_servers.ts'
import { meshServerInstallsIn } from '../install_the_mesh_server_for_claude_code/mesh_server_install.ts'
import { placeRecordedMeshServers, SERVER_NEEDS } from '../install_the_recorded_mesh_server/install_the_recorded_mesh_server.ts'
import { MESH_SERVER_PACKAGE, refusalOfInstalledMeshServers } from '../read_a_room_through_its_gate/mesh_server_tools.ts'
import { memoryDenyRules, ownerMemoryPlaces, settingsWithMemoryDenied, type OwnerMemoryPlaces } from '../refuse_a_member_writing_owner_memory/refuse_a_member_writing_owner_memory.ts'
import { CLAUDE_SERVERS, CLAUDE_SETTINGS, claudeSettingsSwitches, type PreparedLaunch } from '../refuse_launch_of_unapproved_config/refuse_launch_of_unapproved_config.ts'
import type { ClaudeCodeMemberLaunch } from '../launch_a_claude_code_member/launch_a_claude_code_member.ts'

/**
 * Why the mesh server the approved server config installs is not proved, or
 * undefined when it is a recorded version started as a bin it has, or none is
 * installed (martha#49).
 */
export function meshServerUnproved(serverConfig: Uint8Array | undefined): string | undefined {
  if (serverConfig === undefined) return undefined
  const installed = meshServerInstallsIn(new TextDecoder().decode(serverConfig), MESH_SERVER_PACKAGE)
  return 'refusal' in installed ? installed.refusal : refusalOfInstalledMeshServers(installed.installs)
}

/**
 * Rewrites the approved server config in the snapshot so each mesh server
 * starts from its recorded tree by path, with an environment built from the
 * one the host is given; why it cannot, or undefined (martha#65).
 */
export function meshServersPlaced(
  serverConfig: Uint8Array | undefined,
  launch: ClaudeCodeMemberLaunch,
  snapshotDir: string,
  hostEnvironment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (serverConfig === undefined) return undefined
  const placed = placeRecordedMeshServers({
    serverConfig: new TextDecoder().decode(serverConfig),
    root: launch.places.mesh_servers,
    hostEnvironment,
    ...(launch.mesh_trees === undefined ? {} : { recording: launch.mesh_trees }),
  })
  if ('refusal' in placed) return placed.refusal
  writeFileSync(join(snapshotDir, CLAUDE_SERVERS), placed.config)
  return undefined
}

/**
 * What the settings files the host loads add to every server's environment:
 * the owner's user settings, then the approved --settings copy; or why the
 * launch is refused (martha#65 r=3, ../claude_code_host/settings_env_reaching_servers).
 */
export function settingsEnvironment(
  hostEnv: Readonly<Record<string, string | undefined>>,
  approvedSettings: Uint8Array | undefined,
  snapshotDir: string,
  knownSettings: readonly string[],
): { readonly env: Readonly<Record<string, string>> } | { readonly refusal: string } {
  const user = userSettingsPath(hostEnv)
  if ('refusal' in user) return user
  return environmentFromSettings(
    [
      { path: user.path, text: existsSync(user.path) ? readFileSync(user.path, 'utf8') : undefined },
      { path: join(snapshotDir, CLAUDE_SETTINGS), text: approvedSettings === undefined ? undefined : new TextDecoder().decode(approvedSettings) },
    ],
    [...SERVER_NEEDS, ...knownSettings],
  )
}

/**
 * The settings files the member's host reads, watched for a key that turns
 * Martha's relay off: the owner's user settings, the --settings copy the host
 * starts with (the approved one, or the launch's own, settingsDenyingOwnerMemory),
 * and the managed settings (martha#122), and for a hook or plugin the owner's
 * or the managed ones declare (martha#121); or why the launch is refused: one
 * of them sets such a key or declares one, the environment or the owner's
 * arguments switch safe mode on or name a plugin folder, or the user settings
 * file cannot be told. Exported so npm run probe:launch runs this very gate.
 */
export function hookSettingsOf(
  hostEnv: Readonly<Record<string, string | undefined>>,
  args: readonly string[],
  prepared: Extract<PreparedLaunch, { readonly allow: true }>,
  managed: ManagedSettingsPlace = RECORDED_HOST.managed_settings,
  approved: string | undefined = prepared.carried_files[CLAUDE_SETTINGS] === undefined ? undefined : join(prepared.snapshot_dir, CLAUDE_SETTINGS),
): HookSettingsWatch | string {
  const user = userSettingsPath(hostEnv)
  if ('refusal' in user) return user.refusal
  const safeMode = safeModeIn(hostEnv, args, CLAUDE_CODE_HOOK_SWITCHES.safe_mode)
  if (safeMode !== undefined) return safeMode
  const pluginDirs = pluginDirsIn(hostEnv)
  if (pluginDirs !== undefined) return pluginDirs
  const watch = hookSettingsWatch({
    user: user.path,
    home: hostHome(hostEnv),
    approved,
    managed,
    switches: CLAUDE_CODE_HOOK_SWITCHES,
    markdown: CLAUDE_CODE_OWNERS_MARKDOWN,
  })
  return watch.check() ?? watch
}

/** The host's home, which a leading `~` resolves against: its HOME, as userSettingsPath reads it. */
const hostHome = (hostEnv: Readonly<Record<string, string | undefined>>): string => hostEnv.HOME ?? homedir()

/**
 * Where the owner's sessions load memory, instructions and their own text from: the launcher's config dir and the
 * member's, each project's own folder, the folders the host loads markdown and output styles from, the folder the
 * member's own session init reported for output styles, the folders the launcher's environment moves memory to, and
 * each memory folder the policy, user and carried settings name (martha#136, martha#154); or why the user settings
 * file cannot be told.
 */
export function ownerMemoryOf(
  launch: ClaudeCodeMemberLaunch,
  hostEnv: Readonly<Record<string, string | undefined>>,
  prepared: Extract<PreparedLaunch, { readonly allow: true }>,
  reported_output_styles_dir: string,
): OwnerMemoryPlaces | string {
  const user = userSettingsPath(hostEnv)
  if ('refusal' in user) return user.refusal
  const managed = launch.managed_settings ?? RECORDED_HOST.managed_settings
  return ownerMemoryPlaces({
    launcher_env: launch.inherited,
    member_env: hostEnv,
    home: hostHome(hostEnv),
    launch_dir: launch.place.launch_dir,
    martha_state_root: launch.places.state_root,
    settings_files: [
      join(managed.dir, managed.file),
      ...dropInFiles(join(managed.dir, managed.drop_in)),
      user.path,
      ...(prepared.carried_files[CLAUDE_SETTINGS] === undefined ? [] : [join(prepared.snapshot_dir, CLAUDE_SETTINGS)]),
    ],
    user_scope: {
      markdown_kinds: RECORDED_HOST.markdown_kinds,
      output_styles_folder: CLAUDE_CODE_OUTPUT_STYLES_FOLDER,
      reported_output_styles_dir,
    },
  })
}

/**
 * Writes the settings the host starts with into the snapshot: the approved
 * --settings copy, or a file of its own when none is carried, with the rules
 * that refuse the host's own writes into the owner's memory added to its
 * permissions.deny (martha#136). Returns the file and the switches that name it
 * when none was carried; or why the approved copy cannot take the rules.
 */
export function settingsDenyingOwnerMemory(
  prepared: Extract<PreparedLaunch, { readonly allow: true }>,
  ownerMemory: OwnerMemoryPlaces,
): { readonly path: string; readonly args: readonly string[] } | { readonly refusal: string } {
  const path = join(prepared.snapshot_dir, CLAUDE_SETTINGS)
  const approved = prepared.carried_files[CLAUDE_SETTINGS]
  const settings = settingsWithMemoryDenied(
    approved === undefined ? undefined : new TextDecoder().decode(approved),
    memoryDenyRules(ownerMemory),
    CLAUDE_SETTINGS,
  )
  if ('refusal' in settings) return settings
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, settings.text)
  return { path, args: approved === undefined ? claudeSettingsSwitches(path).args : [] }
}

/**
 * The watch on every settings file for a key that turns Martha's relay off (martha#122); or the refusal. The launch's
 * own --settings copy is watched at the path it is written to, whether or not the host is started with it.
 */
export function hostSettingsOf(
  launch: ClaudeCodeMemberLaunch,
  hostEnv: Readonly<Record<string, string | undefined>>,
  prepared: Extract<PreparedLaunch, { readonly allow: true }>,
): HookSettingsWatch | string {
  return hookSettingsOf(hostEnv, launch.args, prepared, launch.managed_settings, join(prepared.snapshot_dir, CLAUDE_SETTINGS))
}
