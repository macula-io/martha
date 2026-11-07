// Hooks and plugins the owner's user or managed settings declare, which a
// member's host would run with nothing recorded (martha#121, finding 1).
//
// A member is started with `--setting-sources user`, so its host still loads
// the owner's user settings file and the admin-managed settings. A hook there
// prints into the member's session, and a plugin there brings its own hooks,
// agents and servers, and no row records any of it: A7 covers only the hooks
// of the approved --settings copy. The owner picked refusal (Raf, 2026-11-07):
// a member does not start while one of those files declares a hook or enables
// a plugin, and the refusal names the file and what is in it, so the owner
// knows what to move. Martha's own relay hooks are not affected: they reach
// the member through the approved copy and the relay's --plugin-dir, never
// through these files.
//
// What counts as declared, read the way the host reads it (2.1.319):
//   - `hooks`: an event with at least one entry. An empty list runs nothing;
//   - `enabledPlugins`: a plugin whose value is anything but false or null
//     (true, or a version constraint);
//   - a plugin folder: CLAUDE_CODE_PLUGIN_DIRS that is not blank, in a file's
//     env or in the launcher's environment. The host loads plugins from it when
//     it is set and not blank after a trim.
// A `hooks` or `enabledPlugins` value of no shape the host takes is refused as
// cannot-be-told. A file that is not a JSON object is refused by
// settingsTurningHooksOff, which reads every file read here, so it is passed
// here rather than refused twice.
//
// Read by the settings watch of ./settings_that_turn_hooks_off.ts (martha#122)
// at launch and for the member's whole life, so a hook written into one of
// these files while a member runs stops it too.

import type { HookSettingsFile } from './settings_that_turn_hooks_off.ts'

/** The variable from which Claude Code loads plugin folders, when it is set and not blank. */
export const PLUGIN_DIRS_VARIABLE = 'CLAUDE_CODE_PLUGIN_DIRS'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isOff = (value: unknown): boolean => value === undefined || value === false || value === null

/** Whether a plugin folder value loads anything: set, and not blank as the host trims it. */
/** Whether a value of the plugin folder variable makes the host load a folder: set, and not blank. */
export const loadsPlugins = (value: unknown): boolean => value !== undefined && !(typeof value === 'string' && value.trim() === '')

const WHY =
  "a member's host would run them and what they print would reach the member with nothing recorded (martha#121); move them out of that file before starting a member"

/** What one key of a settings file declares, or why it cannot be told. */
type Declared = { readonly declares: string } | { readonly unknown: string } | undefined

function hooksOf(value: unknown): Declared {
  if (isOff(value)) return undefined
  if (!isObject(value)) return { unknown: 'hooks' }
  const events = Object.entries(value)
    .filter(([, entries]) => !isOff(entries) && !(Array.isArray(entries) && entries.length === 0))
    .map(([event]) => event)
  return events.length > 0 ? { declares: `hooks for ${events.join(', ')}` } : undefined
}

function pluginsOf(value: unknown): Declared {
  if (isOff(value)) return undefined
  if (!isObject(value)) return { unknown: 'enabledPlugins' }
  const enabled = Object.entries(value)
    .filter(([, on]) => !isOff(on))
    .map(([plugin]) => plugin)
  return enabled.length > 0 ? { declares: `the plugins ${enabled.join(', ')}` } : undefined
}

function pluginDirsOf(env: unknown): Declared {
  return isObject(env) && loadsPlugins(env[PLUGIN_DIRS_VARIABLE]) ? { declares: `a plugin folder in env.${PLUGIN_DIRS_VARIABLE}` } : undefined
}

/** Why one of the owner's user or managed settings files declares a hook or a plugin, naming the file and each; or undefined. */
export function hooksAndPluginsDeclaredIn(file: HookSettingsFile): string | undefined {
  if (file.text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(file.text)
  } catch {
    return undefined
  }
  if (!isObject(parsed)) return undefined
  const found = [hooksOf(parsed.hooks), pluginsOf(parsed.enabledPlugins), pluginDirsOf(parsed.env)].filter((one) => one !== undefined)
  const unknown = found.flatMap((one) => ('unknown' in one ? [one.unknown] : []))
  if (unknown.length > 0) {
    return `${file.path} sets ${unknown.join(' and ')} in a shape the host's settings do not take, so whether it declares a hook or a plugin cannot be told; fix or remove it`
  }
  const declared = found.flatMap((one) => ('declares' in one ? [one.declares] : []))
  return declared.length > 0 ? `${file.path} declares ${declared.join(' and ')}: ${WHY}` : undefined
}

/** Why the launcher's environment loads a plugin folder into the member's host; or undefined. */
export function pluginDirsIn(environment: Readonly<Record<string, string | undefined>>): string | undefined {
  if (!loadsPlugins(environment[PLUGIN_DIRS_VARIABLE])) return undefined
  return `the launcher's environment sets ${PLUGIN_DIRS_VARIABLE}, which loads plugins into the member's host whose hooks would print into the member's session with nothing recorded (martha#121); unset it before starting a member`
}
