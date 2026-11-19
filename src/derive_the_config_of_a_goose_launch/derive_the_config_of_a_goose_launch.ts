// The config one Goose launch writes into its own root (martha#541, packages 7-8 C3): the provider and the model the
// member's declaration names, the provider's own settings, the mode that brings every tool call to Martha, slash
// commands off, one switch for every platform extension the pinned build declares, every one off but the one a
// member keeps, and the crew's own tool server, the one server the root names (../serve_the_crews_tools_to_an_engine,
// martha#541 part C, C1).
//
// It is a decision of its own, so it lives in a slice and the launch composes it: what it writes is read from the
// recording (../know_the_goose_engines_facts), never typed beside it. Two values the recording cannot supply are
// Martha's own decisions, and they are declared here, once, and read from here everywhere:
//
//   - THE_EXTENSION_A_MEMBER_KEEPS, the one extension whose tools a member's model is offered;
//   - THE_MODE_THAT_ASKS_THE_CLIENT, the mode in which the engine brings a tool call to its client rather than
//     running it, which is the whole of Martha's gate over the engine.
//
// This matters more than it looks: a malformed mode falls back to `auto` in the engine, which runs every call with
// nothing asking. The test beside this file holds both to the recording, so a renamed extension key or a dropped
// mode fails a test instead of writing a switch the engine ignores.
//
// It returns the text alone. Where the text is written, and under which root, is the launch's, so no path is named
// here.

import type { RecordedEngine } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'

/** The one platform extension a member's model is offered: Developer, whose shell and file edits are gated. */
export const THE_EXTENSION_A_MEMBER_KEEPS = 'developer'

/** The mode in which the engine brings every tool call to its client instead of running it. */
export const THE_MODE_THAT_ASKS_THE_CLIENT = 'approve'

/**
 * What the engine's slash-commands switch is set to: the setting turns them on, so off is `false` in every
 * recording, whatever the engine would do with a config that does not name it (martha#541, shape 2 and 3).
 */
export const SLASH_COMMANDS_OFF = false

/** The config key the engine reads the provider from. */
export const THE_PROVIDER_SETTING = 'GOOSE_PROVIDER'

/** The config key the engine reads the model from. */
export const THE_MODEL_SETTING = 'GOOSE_MODEL'

/** The config key every extension's switch sits under. */
export const THE_EXTENSIONS_SETTING = 'extensions'

/** What the member's model is, as the crew's declaration for that member names it. */
export interface TheModelALaunchRuns {
  /** The provider the engine reaches the model through, by the name the engine knows it by. */
  readonly provider: string
  /** The model, by the name that provider accepts. */
  readonly model: string
  /** The settings that provider needs to reach its endpoint, written into the config root, never inherited. */
  readonly settings: Readonly<Record<string, string>>
}

/** One value of a tool server's entry as the config writes it: a word or a number on its line, a list as items, a mapping as keys. */
export type AServersValue = string | number | readonly string[] | Readonly<Record<string, string>>

/**
 * A tool server the config switches on: the key it sits under in `extensions`, and its entry, key by key, in order.
 * The launch names it; this slice only writes it, so the server's own slice is never this one's to import.
 */
export interface AToolServerTheConfigNames {
  readonly key: string
  readonly entry: ReadonlyArray<readonly [string, AServersValue]>
}

/**
 * The config root's text for one launch: the provider, the model, the provider's own settings, the mode
 * that asks the client, slash commands off, one switch for every platform extension the pinned build
 * declares, and the crew's tool server, switched on. Throws when the recording does not name the mode or
 * the extension a member keeps, because a config naming a mode the engine does not know runs every call
 * with nothing asking, and when the server's key is a platform extension's, which would switch that one.
 */
export function theConfigOfALaunch(facts: RecordedEngine, model: TheModelALaunchRuns, server: AToolServerTheConfigNames): string {
  if (!facts.mode.values.includes(THE_MODE_THAT_ASKS_THE_CLIENT)) {
    throw new Error(`the recorded engine names no mode ${THE_MODE_THAT_ASKS_THE_CLIENT}, so a launch cannot pin it to one that asks`)
  }
  if (!facts.platform_extensions.some((extension) => extension.key === THE_EXTENSION_A_MEMBER_KEEPS)) {
    throw new Error(`the recorded engine names no platform extension ${THE_EXTENSION_A_MEMBER_KEEPS}, so a launch cannot keep one`)
  }
  if (facts.platform_extensions.some((extension) => extension.key === server.key)) {
    throw new Error(`the tool server is keyed ${server.key}, which is a platform extension's key in the recorded engine`)
  }
  const switches = facts.platform_extensions.flatMap((extension) => [
    aLine(`  ${extension.key}`, ''),
    aLine('    enabled', extension.key === THE_EXTENSION_A_MEMBER_KEEPS),
  ])
  // A provider's own settings are what the model declaration names for its endpoint. A setting under the
  // engine's own prefix is the engine's, read before the session's model: the subagent model and provider
  // live there, and either one set in this root moves a delegate's model without Martha naming it
  // (martha#541 package 6, Neptunus's scope item 1). The launch's environment is built from nothing, so
  // no such variable can reach the engine either; this closes the config root the same way.
  const enginePrefix = theEnginesOwnPrefix(facts)
  const borrowed = Object.keys(model.settings).find((setting) => setting.startsWith(enginePrefix))
  if (borrowed !== undefined) {
    throw new Error(`a provider setting ${borrowed} carries the engine's own prefix ${enginePrefix}, and only the engine's settings the launcher derives are written to its config root`)
  }
  return [
    aLine(THE_PROVIDER_SETTING, model.provider),
    aLine(THE_MODEL_SETTING, model.model),
    aLine(facts.mode.setting, THE_MODE_THAT_ASKS_THE_CLIENT),
    // Not the opposite of the engine's default: the setting turns slash commands ON, so off is `false`
    // whether the engine would have them on or off in a config that does not name it.
    aLine(facts.slash_commands.setting, SLASH_COMMANDS_OFF),
    ...Object.entries(model.settings).map(([setting, value]) => aLine(setting, value)),
    aLine(THE_EXTENSIONS_SETTING, ''),
    ...switches,
    aLine(`  ${server.key}`, ''),
    aLine('    enabled', true),
    ...server.entry.flatMap(([key, value]) => theEntrysLines(`    ${key}`, value)),
    '',
  ].join('\n')
}

/** A key of the config, indentation included: a word, so no key can start a line of its own. */
const A_WORD_OF_A_KEY = /^[A-Za-z0-9_-]+$/

/** The prefix the engine's own settings carry, from the variable that moves its root: `GOOSE_` from `GOOSE_PATH_ROOT`. */
function theEnginesOwnPrefix(facts: RecordedEngine): string {
  const variable = facts.path_root_variable
  return variable.slice(0, variable.indexOf('_') + 1)
}

/** One line of the config: a key and its value, a string quoted so no character of it starts a new one. */
function aLine(key: string, value: string | boolean | number): string {
  if (!A_WORD_OF_A_KEY.test(key.trim())) throw new Error(`a config key ${JSON.stringify(key)} is not a word, and no key may carry a line of its own`)
  if (typeof value !== 'string') return `${key}: ${String(value)}`
  if (value === '') return `${key}:`
  return `${key}: ${quoted(value)}`
}

/** A string as the config writes it: quoted, so no character of it starts a new line or ends the value. */
function quoted(value: string): string {
  if (/[\n\r]/.test(value)) throw new Error(`a value written to the config root holds a line break, which no config key may carry`)
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The lines of one key of the server's entry: a value on its own line, a list as items, a mapping as keys under it. */
function theEntrysLines(key: string, value: AServersValue): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [aLine(key, value)]
  const under = `${' '.repeat(key.length - key.trimStart().length)}  `
  if (Array.isArray(value)) return [aLine(key, ''), ...(value as readonly string[]).map((item) => `${under}- ${quoted(item)}`)]
  return [aLine(key, ''), ...Object.entries(value).map(([name, text]) => aLine(`${under}${name}`, text))]
}
