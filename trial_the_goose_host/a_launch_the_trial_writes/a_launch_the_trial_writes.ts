// The places one line of the trial is run in, and what is planted in them.
//
// This exists so nothing of the trial touches the owner's own home: the driver runs with a stand-in
// owner home (the owner's, for the trial's purposes) full of markers, and Goose is given a home and a
// config root of its own, written per launch. If any marker reaches the model, or Goose opens any path
// under the stand-in home, the per-launch home does not hold and the line fails by name.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { RECORDED_GOOSE_ENGINE } from '../../src/know_the_goose_engines_facts/recorded_goose_engine.ts'
import { engineFactsIn } from '../../src/know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
import { anEngineCheckoutOnDisk } from '../../src/record_the_goose_engine/an_engine_checkout_on_disk.ts'

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

/** The skill the trial's owner approves in line 9's checkout (martha#614): its name, the word typed after the slash. */
export const THE_APPROVED_SKILL = 'martha-trial-approved'

/**
 * Line 9's approved skill, in the first skill folder the engine reads from a checkout (as recorded from its source),
 * with the front matter the engine lists a skill by. Line 9 types `/` and its name, and looks for it in the request.
 */
export const THE_APPROVED_SKILLS_FILE: Marker = {
  at: join(RECORDED_GOOSE_ENGINE.checkout_skill_roots.skill_folders[0] ?? '', THE_APPROVED_SKILL, 'SKILL.md'),
  token: THE_APPROVED_SKILL,
  text: `---\nname: ${THE_APPROVED_SKILL}\ndescription: The skill the Martha trial approved, so its name is listed to the model.\n---\nAnswer with the single word: loaded.\n`,
}

/**
 * The config root the launcher writes: the provider, the model, the mode pinned to approve, slash
 * commands off, the two skills switches, the model endpoint reached through the recording proxy, and the
 * extension switches. Written into the root and not into Goose's environment, because a config key's
 * environment variable wins over this file, and the design says the launcher owns the root.
 *
 * The extension switches are what makes the tool list the allow-list: Goose reads its platform
 * extensions in with every one at its own default, and Analyze, Apps and Extension Manager default to
 * on, so a root that names none of them offers their tools to the member's model as well. Skills are not an
 * extension any more: the engine's own switches carry them (#614).
 */
export function writeTheConfig(place: Place, model: string, endpoint: string, gooseSource: string): string {
  const config = [
    'GOOSE_PROVIDER: ollama',
    `GOOSE_MODEL: ${model}`,
    'GOOSE_MODE: approve',
    'GOOSE_SLASH_COMMANDS_ENABLED: false',
    ...theSkillsLinesIn(gooseSource),
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

/** The two skills parts of the engine's facts the trial's config root writes (martha#614). */
const THE_SKILLS_PARTS = { skills_advertised: 'skills switch', builtin_skills_advertised: 'built-in skills switch' } as const

/** The approved checkout's skills reach the model: the engine's skills switch is written on, never left to its default. */
export const CHECKOUT_SKILLS_ON = true

/** The engine's compiled-in skills reach no model: its built-ins switch is written off (DECIDED 2026-11-18). */
export const BUILTIN_SKILLS_OFF = false

/**
 * The config root's skills lines (martha#614, DECIDED 2026-11-18 "Approved skills on" and "Switch built-ins off"): the
 * engine's skills switch on, so the skills of the checkout the trial launches in reach the model, and its built-ins
 * switch off. Both names are read from the engine at hand through the reader the recording is made with, so the trial
 * keeps no resolver of its own, and an engine that renames or drops either switch is refused by that part's name.
 */
export function theSkillsLinesIn(gooseSource: string): string[] {
  const { facts, unreadable } = engineFactsIn(anEngineCheckoutOnDisk(gooseSource))
  const parts: readonly string[] = Object.values(THE_SKILLS_PARTS)
  const missing = unreadable.filter(({ part }) => parts.includes(part))
  if (missing.length > 0) throw new Error(`the engine's ${missing.map(({ part, why }) => `${part} cannot be read: ${why}`).join('; ')}`)
  const { skills_advertised: skills, builtin_skills_advertised: builtins } = facts
  if (skills === undefined || builtins === undefined) throw new Error(`the engine answered no ${parts.join(' and no ')}`)
  return [`${skills.setting}: ${String(CHECKOUT_SKILLS_ON)}`, `${builtins.setting}: ${String(BUILTIN_SKILLS_OFF)}`]
}
