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

// --- hooks in an agent's, a skill's or a command's frontmatter (martha#146) ---
//
// The owner's user scope and the managed scope hold agents, skills and
// commands whose frontmatter can carry hooks, and a member started on Martha's
// switches runs them (probed live on 2.1.319). Martha has no YAML parser and
// takes none for this, so a frontmatter counts as declaring hooks when it holds
// one of these spellings (Pluto's reviews, r=1 to r=3). They are the spellings
// this refuses, not a claim to hold every way YAML has to write the key: r=3
// found one this list was missing, and a spelling that turns up later is
// another round of the same work.
//
// Nor does it hold every spelling that looks like the key, and it must not
// refuse the ones the host does not read as one: #174 asked the host about two
// of those, and it reads neither as `hooks`. It names the frontmatter key of a
// binary-tagged scalar by the base64 text it was written as, and it does not
// parse a flow sequence key whose colon the next line opens, so that whole file
// is ignored. `npm run probe:launch` carries a row for each, beside a control
// that writes the key itself and whose hooks run, so a host that starts reading
// one of them fails its row instead of passing quietly, and a test beside this
// module pins that the list goes on passing both (martha#174).
//   - the text `hooks` with a colon after it, anywhere: bare, quoted, tagged
//     (`!<tag:yaml.org,2002:str>"hooks":`), in flow style, or with a line break
//     before the colon. `githooks:` counts too, a refusal the owner can read;
//   - a collection used as a key, `]` or `}` with a colon after it: a flow
//     sequence used as the key reaches the host as the key itself (`[hooks]:
//     {...}` is live on 2.1.319 and declares hooks like `hooks:` does), and
//     this rule takes that whole class — `[hooks,]:`, `[[hooks]]:` and
//     `{hooks: x}:` with it;
//   - a backslash where YAML gives it a meaning, which is inside a double-quoted
//     scalar: a double-quoted escape (`"hoo\x6bs"`) or a line continuation can
//     build the key with no `hooks` in the text. A scalar can only be the key
//     when it opens where a key opens, so the scan is inside one only where a
//     value opens — a plain block key, its colon, and blanks (martha#243). A
//     backslash anywhere else refuses, as does a quoted value that never closes;
//   - an explicit key (`?` as a line's first character after blanks);
//   - a merge key (`<<`);
//   - an alias used as a key (`*name:`), which can copy `hooks` from an anchor
//     on a value elsewhere.
// A false positive costs a refusal that names the file and the rule. The refusal
// names the remedy the file allows: a file the owner keeps is theirs to move,
// while a file the host syncs from their account is re-created at every start,
// so its remedy is on claude.ai or the host's own `syncClaudeAiSkills` setting
// (martha#243).
//
// The frontmatter is found where the host finds it: one leading byte-order mark
// stripped, then the host's own pattern from the recording, its group 1. A file
// whose opening the host's pattern takes but which never closes is refused as
// cannot-be-told.

/** The spellings by which a frontmatter can declare hooks, each with the words a refusal names it by. */
export const HOOKS_SPELLINGS: ReadonlyArray<{ readonly rule: string; readonly found: (frontmatter: string) => boolean }> = [
  { rule: 'the key hooks', found: (frontmatter) => /hooks["']?\s*:/.test(frontmatter) },
  { rule: 'a collection used as a key', found: (frontmatter) => /[\]}]\s*:/.test(frontmatter) },
  { rule: 'a backslash outside a double-quoted value', found: (frontmatter) => backslashesOutsideValues(frontmatter).outside },
  { rule: 'an explicit key (?)', found: (frontmatter) => /^\s*\?/m.test(frontmatter) },
  { rule: 'a merge key (<<)', found: (frontmatter) => /<</.test(frontmatter) },
  { rule: 'an alias used as a key', found: (frontmatter) => /(^|[\s{,[])\*[^\s,:{}[\]]+\s*:/.test(frontmatter) },
]

/** The folder under the owner's skills folder that Claude Code fills from their Claude account (martha#243). */
export const SYNCED_SKILLS_FOLDER = 'synced'

/** The kind of the owner's markdown the host syncs into: the recording names it, and a test fails if it stops. */
export const SKILLS_KIND = 'skills'

/** The folder the host moves skills it no longer runs into. It loads a SKILL.md directly in it, and nothing below an entry (martha#243). */
export const TRASH_FOLDER = '.trash'

/** The setting with which the owner or the admin turns account skill sync off, which the host reads as `=== false`. */
export const SYNC_OFF_SETTING = 'syncClaudeAiSkills'

/** What the launcher reads the owner's and the managed markdown by: the host's frontmatter pattern and the folders it loads, from the recording. */
export interface OwnersMarkdown {
  readonly frontmatter_pattern: string
  readonly kinds: readonly string[]
}

/** The folder under the managed folder that holds its markdown folders, as the recorded loader joins it. */
export const MANAGED_MARKDOWN_FOLDER = '.claude'

const BYTE_ORDER_MARK = 0xfeff

/** What a scan of the frontmatter found: a backslash outside a value, and a quoted value that never closes. */
interface Backslashes {
  readonly outside: boolean
  readonly unclosed: boolean
}

/**
 * Where a double-quoted scalar opens as a value: a plain block key, its colon,
 * and at least one blank, and nothing else before the quote. An anchor (`&x:`),
 * a local tag (`!x:`), a bracket or a comma can end in a colon too, and each
 * leaves a key behind it (measured on 2.1.322, martha#243).
 */
const VALUE_OPENING = /^[ \t]*[A-Za-z0-9_-]+:[ \t]+$/

/** One step inside a double-quoted scalar: whether it goes on, and where the next step starts (an escape takes two characters). */
function stepInsideScalar(frontmatter: string, at: number): { readonly inside: boolean; readonly next: number } {
  return frontmatter[at] === '\\' ? { inside: true, next: at + 2 } : { inside: frontmatter[at] !== '"', next: at + 1 }
}

/**
 * Whether the frontmatter holds a backslash where YAML gives it a meaning, and
 * whether a double-quoted scalar it opened never closes.
 *
 * A backslash is an escape only inside a double-quoted scalar, and that scalar
 * can only build the key `hooks` when it is the key. So the scan is inside a
 * scalar only where a value opens; every other backslash is one YAML reads as an
 * escape in a place a key can be. A scalar that never closes is refused by the
 * caller: it cannot be told (martha#243).
 */
function backslashesOutsideValues(frontmatter: string): Backslashes {
  let inside = false
  let lineStart = 0
  let at = 0
  while (at < frontmatter.length) {
    if (inside) {
      const step = stepInsideScalar(frontmatter, at)
      inside = step.inside
      at = step.next
      continue
    }
    const character = frontmatter[at]
    if (character === '\n') lineStart = at + 1
    else if (character === '\\') return { outside: true, unclosed: false }
    else if (character === '"') inside = VALUE_OPENING.test(frontmatter.slice(lineStart, at))
    at += 1
  }
  return { outside: false, unclosed: inside }
}

/** What the hooks of a file the owner keeps would cost: it is theirs to move (martha#146). */
const FRONTMATTER_WHY =
  "a member's host would run them while that agent, skill or command runs, and what they print would reach the member with nothing recorded (martha#146); move the hooks out of that file before starting a member"

/**
 * What the hooks of a file Claude Code syncs from the owner's account would cost,
 * and what the owner can do about it (martha#243). Editing the file does not
 * hold: the host writes it again at every start. So the refusal names the two
 * steps that do hold, each of which the owner carries out without Martha.
 */
const SYNCED_FRONTMATTER_WHY =
  "a member's host would run them while that skill runs, and what they print would reach the member with nothing recorded (martha#146). " +
  'Claude Code writes this file again from your account at every start, so editing or moving it does not hold: ' +
  'turn that skill off on claude.ai, whose removal reaches this machine at the next sync, which the host does while one of your own sessions runs, so start Claude Code once yourself first; ' +
  `or stop syncing your account's skills by putting "${SYNC_OFF_SETTING}": false in your user settings file, which the host honours for every session and this gate reads too`

/** The opening of a frontmatter pattern: everything before its first group. */
const openingOf = (pattern: string): RegExp => new RegExp(pattern.slice(0, pattern.indexOf('(')))

/** A file's frontmatter as the host finds it: its text, none, or an opening that never closes. */
function frontmatterOf(text: string, pattern: string): { readonly frontmatter: string } | 'none' | 'unclosed' {
  const stripped = text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text
  const found = new RegExp(pattern).exec(stripped)
  if (found !== null) return { frontmatter: found[1] ?? '' }
  return openingOf(pattern).test(stripped) ? 'unclosed' : 'none'
}

/** Why an agent, skill or command file in the owner's or the managed scope brings hooks into a member, naming the file and the rule; or undefined. */
export function hooksInFrontmatterOf(file: HookSettingsFile, pattern: string): string | undefined {
  if (file.text === undefined) return undefined
  const found = frontmatterOf(file.text, pattern)
  if (found === 'none') return undefined
  if (found === 'unclosed') {
    return `${file.path} opens a frontmatter that never closes, so whether it declares hooks cannot be told; close it or remove the file`
  }
  const scanned = backslashesOutsideValues(found.frontmatter)
  if (scanned.unclosed) {
    return `${file.path} opens a double-quoted value that never closes, so whether it declares hooks cannot be told; close it or remove the file`
  }
  const rules = HOOKS_SPELLINGS.filter(({ found: spelled }) => spelled(found.frontmatter)).map(({ rule }) => rule)
  if (rules.length === 0) return undefined
  const why = file.synced === true ? SYNCED_FRONTMATTER_WHY : FRONTMATTER_WHY
  return `${file.path} has frontmatter holding ${rules.join(' and ')}, so it can declare hooks: ${why}`
}
