// The places one line of the trial is run in, and what is planted in them.
//
// This exists so nothing of the trial touches the owner's own home: the driver runs with a stand-in
// owner home (the owner's, for the trial's purposes) full of markers, and Goose is given a home and a
// config root of its own, written per launch. If any marker reaches the model, or Goose opens any path
// under the stand-in home, the per-launch home does not hold and the line fails by name.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** Where one line of the trial runs: the owner's stand-in home, and the three places Goose gets. */
export interface Place {
  readonly base: string
  readonly ownerHome: string
  readonly root: string
  readonly home: string
  readonly checkout: string
}

/** A file planted to be found if something reads it, with the token the trial looks for. */
export interface Marker {
  readonly at: string
  readonly token: string
  readonly text: string
}

/**
 * A fresh set of places for one line. The owner's stand-in home is one directory for the whole trial —
 * the home the driver itself is started from — so every launch is held to the same owner, and each launch
 * gets a home, a config root and a checkout of its own.
 *
 * The launch root is given and deliberately not under the owner's real home: a process looking for a
 * checkout's repository walks up from the checkout to the filesystem root, opening every ancestor on the
 * way, so a launch root inside the home is a trespass on the home whatever the checkout holds.
 */
export function aPlaceFor(line: number, evidence: string, launchRoot: string): Place {
  const base = join(launchRoot, `line-${line}`)
  rmSync(base, { recursive: true, force: true })
  const place = {
    base,
    ownerHome: join(evidence, 'owner-home'),
    root: join(base, 'goose-root'),
    home: join(base, 'goose-home'),
    checkout: join(base, 'checkout'),
  }
  for (const dir of [place.ownerHome, place.root, place.home, place.checkout]) mkdirSync(dir, { recursive: true })
  return place
}

/** Writes each marker under a directory, and says which files it made. */
export function plant(under: string, markers: readonly Marker[]): string[] {
  const written: string[] = []
  for (const marker of markers) {
    const path = join(under, marker.at)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, marker.text)
    written.push(path)
  }
  return written
}

/** The token in each marker, for a search of what the model was sent and what the session said. */
export function tokensOf(markers: readonly Marker[]): string[] {
  return markers.map((marker) => marker.token)
}

const homeMarker = (at: string, token: string): Marker => ({ at, token, text: `${token}\n` })

/** What the owner's own home holds when the trial starts: one file in every place Goose reads a home. */
export const HOME_MARKERS: readonly Marker[] = [
  homeMarker('.agents/skills/trial_skill/SKILL.md', 'MARTHA-TRIAL-HOME-SKILL-AGENTS'),
  homeMarker('.claude/skills/trial_skill/SKILL.md', 'MARTHA-TRIAL-HOME-SKILL-CLAUDE'),
  homeMarker('.config/agents/skills/trial_skill/SKILL.md', 'MARTHA-TRIAL-HOME-SKILL-CONFIG-AGENTS'),
  homeMarker('.agents/recipes/trial_recipe.yaml', 'MARTHA-TRIAL-HOME-RECIPE-AGENTS'),
  homeMarker('.config/goose/recipes/trial_recipe.yaml', 'MARTHA-TRIAL-HOME-RECIPE-GOOSE'),
  homeMarker('.agents/agents/trial_agent.md', 'MARTHA-TRIAL-HOME-AGENT-AGENTS'),
  homeMarker('.claude/agents/trial_agent.md', 'MARTHA-TRIAL-HOME-AGENT-CLAUDE'),
  homeMarker('.config/goose/config.yaml', 'MARTHA-TRIAL-HOME-CONFIG'),
  homeMarker('.config/goose/settings.json', 'MARTHA-TRIAL-HOME-SETTINGS'),
  homeMarker('.agents/plugins/trial_plugin/plugin.json', 'MARTHA-TRIAL-HOME-PLUGIN'),
]

/** What an unapproved checkout holds: every place the design lists, one marker in each. */
export const CHECKOUT_MARKERS: readonly Marker[] = [
  homeMarker('.agents/plugins/trial_plugin/plugin.json', 'MARTHA-TRIAL-CHECKOUT-PLUGIN'),
  homeMarker('.config/goose/settings.json', 'MARTHA-TRIAL-CHECKOUT-SETTINGS'),
  homeMarker('.config/goose/settings.local.json', 'MARTHA-TRIAL-CHECKOUT-SETTINGS-LOCAL'),
  homeMarker('.agents/skills/trial_skill/SKILL.md', 'MARTHA-TRIAL-CHECKOUT-SKILL-AGENTS'),
  homeMarker('.goose/skills/trial_skill/SKILL.md', 'MARTHA-TRIAL-CHECKOUT-SKILL-GOOSE'),
  homeMarker('.claude/skills/trial_skill/SKILL.md', 'MARTHA-TRIAL-CHECKOUT-SKILL-CLAUDE'),
  homeMarker('.agents/agents/trial_agent.md', 'MARTHA-TRIAL-CHECKOUT-AGENT-AGENTS'),
  homeMarker('.claude/agents/trial_agent.md', 'MARTHA-TRIAL-CHECKOUT-AGENT-CLAUDE'),
  homeMarker('.goose/agents/trial_agent.md', 'MARTHA-TRIAL-CHECKOUT-AGENT-GOOSE'),
  homeMarker('.goose/recipes/trial_recipe.yaml', 'MARTHA-TRIAL-CHECKOUT-RECIPE-GOOSE'),
  homeMarker('.agents/recipes/trial_recipe.yaml', 'MARTHA-TRIAL-CHECKOUT-RECIPE-AGENTS'),
  homeMarker('.agents/checks/trial_check.md', 'MARTHA-TRIAL-CHECKOUT-CHECK'),
  homeMarker('.agents/REVIEW.md', 'MARTHA-TRIAL-CHECKOUT-REVIEW'),
]

/**
 * The config root the launcher writes: the provider, the model, the mode pinned to approve, slash
 * commands off, the skills switch, the model endpoint reached through the recording proxy, and the
 * extension switches. Written into the root and not into Goose's environment, because a config key's
 * environment variable wins over this file, and the design says the launcher owns the root.
 *
 * The extension switches are what makes the tool list the allow-list: Goose reads its platform
 * extensions in with every one at its own default, and Analyze, Apps and Extension Manager default to
 * on, so a root that names none of them offers their tools to the member's model as well. Skills are
 * the same list by a different door once the engine has no Skills extension to switch off (#614).
 */
export function writeTheConfig(place: Place, model: string, endpoint: string, gooseSource: string): string {
  const config = [
    'GOOSE_PROVIDER: ollama',
    `GOOSE_MODEL: ${model}`,
    'GOOSE_MODE: approve',
    'GOOSE_SLASH_COMMANDS_ENABLED: false',
    ...skillsSwitchedOffIn(gooseSource),
    `OLLAMA_HOST: ${endpoint}`,
    extensionsYaml(gooseSource),
    '',
  ].join('\n')
  const at = join(place.root, 'config', 'config.yaml')
  mkdirSync(dirname(at), { recursive: true })
  writeFileSync(at, config)
  return at
}

/** The one extension a member gets; every other platform extension is switched off. */
export const ALLOWED_EXTENSIONS: readonly string[] = ['developer']

/** Every platform extension the pinned build declares, read from its own source, less the allowed ones. */
export function switchedOffExtensionsIn(source: string): string[] {
  return platformExtensionKeysIn(source).filter((name) => !ALLOWED_EXTENSIONS.includes(name))
}

/**
 * The keys of the fork's platform extension map, read from the fork's own source: the config root
 * switches extensions by these keys, and they are not all spelled like the extensions' display names.
 */
export function platformExtensionKeysIn(source: string): string[] {
  const root = join(source, 'crates', 'goose', 'src')
  const names = extensionNamesUnder(root)
  const map = readFileSync(join(root, 'agents', 'platform_extensions', 'mod.rs'), 'utf8')
  return [...map.matchAll(/map\.insert\(\s*([^,\n]+),\s*PlatformExtensionDef/g)].map((found) => {
    const key = (found[1] ?? '').trim()
    if (key.startsWith('"')) return key.slice(1, -1)
    const path = key.split('::').filter((part) => part !== 'crate')
    const name = names.get(path.at(-2) ?? '')
    if (name === undefined) throw new Error(`the fork names an extension the trial cannot resolve: ${key}`)
    return name
  })
}

/** Each module under the source that declares an EXTENSION_NAME, by the module's own name. */
function extensionNamesUnder(root: string): Map<string, string> {
  const names = new Map<string, string>()
  for (const file of rustFilesUnder(root)) {
    const text = readFileSync(file, 'utf8')
    for (const found of text.matchAll(/EXTENSION_NAME: &str = "([^"]+)"/g)) {
      names.set(moduleNameOf(file), found[1] ?? '')
    }
  }
  return names
}

const moduleNameOf = (file: string): string => {
  const stem = basename(file, '.rs')
  return stem === 'mod' || stem === 'client' ? basename(dirname(file)) : stem
}

function rustFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return rustFilesUnder(path)
    return entry.name.endsWith('.rs') ? [path] : []
  })
}

function extensionsYaml(gooseSource: string): string {
  const entries = [
    ...ALLOWED_EXTENSIONS.map((name) => [`  ${name}:`, '    enabled: true']),
    ...switchedOffExtensionsIn(gooseSource).map((name) => [`  ${name}:`, '    enabled: false']),
  ]
  return ['extensions:', ...entries.flat()].join('\n')
}

/** Where in the engine's source it decides whether the model is offered skills (martha#614). */
export const SKILLS_SWITCH_SOURCE = 'agents/services.rs'

/**
 * The setting that keeps skills away from the model, with what the engine does when it is unset; or
 * undefined when the engine declares no such setting.
 *
 * Skills used to be a platform extension and the extensions mapping switched them off; the engine now
 * serves them from a setting of its own, and the model is offered them unless the setting says otherwise
 * (#614). Its name and its unset value are read from the engine's own source the way the extension keys
 * are, so a launch cannot restate either by hand, and a rename is a launch that says so rather than one
 * that silently offers the member's model every skill on the box.
 */
export function skillsSwitchIn(source: string): { setting: string; whenUnset: boolean } | undefined {
  const path = join(source, 'crates', 'goose', 'src', SKILLS_SWITCH_SOURCE)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  const body = /fn skills_advertised\([^)]*\)\s*->\s*bool\s*\{([\s\S]*?)\n\}/.exec(text)?.[1]
  if (body === undefined) return undefined
  const read = /get_param::<bool>\(\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*\)/.exec(body)
  if (read === null) throw new Error(`${path} names no setting for the skills switch`)
  const setting = read[1] ?? constantValueIn(text, read[2] ?? '', path)
  const whenUnset = /unwrap_or\(\s*(true|false)\s*\)/.exec(body)
  if (whenUnset === null) throw new Error(`${path} says nothing of what a skills switch left unset does`)
  return { setting, whenUnset: whenUnset[1] === 'true' }
}

/** What a `&str` constant in the engine's own file is set to, or a throw naming the constant it never defines. */
function constantValueIn(text: string, name: string, path: string): string {
  const value = new RegExp(`const ${name}: &str = "([^"]+)"`).exec(text)?.[1]
  if (value === undefined) throw new Error(`${path} reads ${name}, which it never defines`)
  return value
}

/** The platform extension that served skills before the engine's own setting did (martha#614). */
export const SKILLS_EXTENSION = 'skills'

/**
 * The config root's line switching skills off the model, for an engine that declares the switch and
 * leaves skills on when it is unset; an engine with no such setting is left to the extensions mapping,
 * and one whose unset value already keeps skills away needs no line at all. An engine with neither the
 * setting nor the extension offers the model every skill with nothing to switch off: that is refused by
 * name, never launched in silence (upstream removed the extension, and a sync without the port is that).
 */
export function skillsSwitchedOffIn(source: string): string[] {
  const skills = skillsSwitchIn(source)
  if (skills === undefined) {
    if (!platformExtensionKeysIn(source).includes(SKILLS_EXTENSION)) {
      throw new Error(
        `the engine declares no skills switch in ${SKILLS_SWITCH_SOURCE} and no ${SKILLS_EXTENSION} extension: ` +
          'its model would be offered every skill with nothing to switch off',
      )
    }
    return []
  }
  return skills.whenUnset ? [`${skills.setting}: false`] : []
}
