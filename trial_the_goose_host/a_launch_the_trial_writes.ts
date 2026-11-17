// The places one line of the trial is run in, and what is planted in them.
//
// This exists so nothing of the trial touches the owner's own home: the driver runs with a stand-in
// owner home (the owner's, for the trial's purposes) full of markers, and Goose is given a home and a
// config root of its own, written per launch. If any marker reaches the model, or Goose opens any path
// under the stand-in home, the per-launch home does not hold and the line fails by name.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
 */
export function aPlaceFor(line: number, evidence: string): Place {
  const base = join(evidence, `line-${line}`)
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
 * commands off, and the model endpoint reached through the recording proxy. Written into the root and
 * not into Goose's environment, because a config key's environment variable wins over this file, and
 * the design says the launcher owns the root.
 */
export function writeTheConfig(place: Place, model: string, endpoint: string): string {
  const config = [
    'GOOSE_PROVIDER: ollama',
    `GOOSE_MODEL: ${model}`,
    'GOOSE_MODE: approve',
    'GOOSE_SLASH_COMMANDS_ENABLED: false',
    `OLLAMA_HOST: ${endpoint}`,
    '',
  ].join('\n')
  const at = join(place.root, 'config', 'config.yaml')
  mkdirSync(dirname(at), { recursive: true })
  writeFileSync(at, config)
  return at
}
