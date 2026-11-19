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
// The declaration itself is held to the recording in four refusals, before anything is written (martha#797): the
// provider must be the one recorded, no setting may name the setting that replaces the engine's hint files, no
// setting may carry the engine's own prefix, and every remaining setting must be one the provider's recording
// names. A declaration is therefore never wider than the facts beside this file.
//
// The provider's secrets never go into that root (#541 package A, design r=2 R1): the engine reads a secret from the
// environment or its secret storage and never from config.yaml, so the root switches the system keyring off by the
// recorded name and the secrets are written as a text of their own, which the launch puts in the file the recording
// names beside the config file. A secret named among the settings is refused, never written where it is not read.
//
// It returns the text alone. Where the text is written, and under which root, is the launch's, so no path is named
// here.

import { ENGINE_PLACES } from '../know_the_goose_engines_facts/the_engines_facts_in_its_source.ts'
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

/**
 * What both skills switches are set to (martha#839): each setting offers skills when true and the engine reads an unset
 * one as true, so a launch writes `false` for both and no skill reaches the model. Approved skills are #614's to turn on.
 */
export const SKILLS_OFF = false

/** What the keyring switch is set to: the engine reads a YAML true as off, so the secrets come from the file beside the config (#541 package A). */
export const KEYRING_OFF = true

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
  /** The settings the provider reads as secrets, by their recorded names: written to the secrets file alone, never the root (#541 package A). */
  readonly secrets: Readonly<Record<string, string>>
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
  // The provider is judged first: a declaration is a provider and a model, and the recording holds the
  // settings of one provider. A declaration naming another would launch a provider nothing recorded, with
  // settings nothing checked, so the refusal is what holds the bound until a recording package adds one
  // (martha#797, Neptunus's R1).
  if (model.provider !== facts.openai_provider.name) {
    throw new Error(`a launch names the provider ${JSON.stringify(model.provider)}, and only ${facts.openai_provider.name} is recorded: no other provider can be launched until a recording package adds it`)
  }
  // A setting that replaces the files the engine reads into every prompt is refused by the name the recording
  // gives it (martha#797, #785). Its value is quoted as it is written and never parsed: the engine reads the
  // value through `parse_env_value`, so only a value it can parse would load anything, and a refusal that said
  // what the files "would be" would claim more than an unparsable value earns (Neptunus's R3).
  const namesTheHintFiles = Object.entries(model.settings).find(([setting]) => setting === facts.hint_files.setting)
  if (namesTheHintFiles !== undefined) {
    throw new Error(`a provider setting ${facts.hint_files.setting} is written as ${JSON.stringify(namesTheHintFiles[1])}, and the engine would load the files it names in place of the ${facts.hint_files.when_unset.join(' and ')} a launch records`)
  }
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
  // A secret among the settings is refused by name (#541 package A, design r=2 R1): the engine never reads a secret from
  // the config file, so it would be written where nothing reads it, and the provider would run with no key.
  const aSecret = Object.keys(model.settings).find((setting) => facts.openai_provider.secrets.includes(setting))
  if (aSecret !== undefined) {
    throw new Error(`a provider setting ${aSecret} is one ${facts.openai_provider.name} reads as a secret, which goes to ${facts.secret_storage.file} and never into the config root`)
  }
  // Every other setting must be one the provider's own recording names: an allow-list, because a deny-list is
  // the settings someone has found so far and this root is otherwise open (martha#797). The comparison is
  // exact: the engine reads a config-root key as it is spelled, so another case is another key it never reads.
  const notRecorded = Object.keys(model.settings).find((setting) => !facts.openai_provider.settings.includes(setting))
  if (notRecorded !== undefined) {
    throw new Error(`a provider setting ${notRecorded} is none of the settings ${facts.openai_provider.name} reads, which ${ENGINE_PLACES.openai_provider} records: ${facts.openai_provider.settings.join(', ')}`)
  }
  return [
    aLine(THE_PROVIDER_SETTING, model.provider),
    aLine(THE_MODEL_SETTING, model.model),
    aLine(facts.mode.setting, THE_MODE_THAT_ASKS_THE_CLIENT),
    // Not the opposite of the engine's default: the setting turns slash commands ON, so off is `false`
    // whether the engine would have them on or off in a config that does not name it.
    aLine(facts.slash_commands.setting, SLASH_COMMANDS_OFF),
    aLine(facts.skills_advertised.setting, SKILLS_OFF),
    aLine(facts.builtin_skills_advertised.setting, SKILLS_OFF),
    aLine(facts.secret_storage.keyring_switch, KEYRING_OFF),
    ...Object.entries(model.settings).map(([setting, value]) => aLine(setting, value)),
    aLine(THE_EXTENSIONS_SETTING, ''),
    ...switches,
    aLine(`  ${server.key}`, ''),
    aLine('    enabled', true),
    ...server.entry.flatMap(([key, value]) => theEntrysLines(`    ${key}`, value)),
    '',
  ].join('\n')
}

/**
 * The secrets file's text for one launch (#541 package A, design r=2 R1): each secret on a line of its own, under the
 * name the provider reads it by, its value quoted as the config's are. A secret the provider does not read is refused
 * by name: written under any other key it is a key nothing reads, and the provider runs without it.
 */
export function theSecretsOfALaunch(facts: RecordedEngine, model: TheModelALaunchRuns): string {
  const unread = Object.keys(model.secrets).find((secret) => !facts.openai_provider.secrets.includes(secret))
  if (unread !== undefined) {
    throw new Error(`a secret ${unread} is none of the secrets ${facts.openai_provider.name} reads, which ${ENGINE_PLACES.openai_secrets} records: ${facts.openai_provider.secrets.join(', ')}`)
  }
  return [...Object.entries(model.secrets).map(([secret, value]) => aLine(secret, value)), ''].join('\n')
}

/**
 * A key of the config, indentation included: a word, so no key can start a line of its own. It is a defence
 * of the keys the launch writes itself, which are constants above: since #797 a model setting cannot reach
 * this check, because every one of them is refused by name before it is written, and the check stays for what
 * it still holds rather than being deleted with the case that used to exercise it.
 */
const A_WORD_OF_A_KEY = /^[A-Za-z0-9_-]+$/

/** The prefix the engine's own settings carry, from the variable that moves its root: `GOOSE_` from `GOOSE_PATH_ROOT`. */
function theEnginesOwnPrefix(facts: RecordedEngine): string {
  const variable = facts.path_root_variable
  return variable.slice(0, variable.indexOf('_') + 1)
}

/** The indentation a key directly under `extensions` is written with, by this slice: one server or switch per key. */
const AN_EXTENSIONS_KEY = /^ {2}([^\s:][^:]*):/

/**
 * The tool servers a config root's text names (martha#541 C1, guard row 3): every key directly under `extensions` that is
 * no platform extension of the recorded engine, in the order the text holds them. It reads the layout this slice writes,
 * and only that one: the launch reads its root back through this and also holds the bytes to the ones it wrote, so a
 * root reshaped into a layout this reader does not follow is refused by the bytes, never read as naming nothing.
 */
export function theServersAConfigNames(facts: RecordedEngine, text: string): readonly string[] {
  const platform = new Set(facts.platform_extensions.map((extension) => extension.key))
  const lines = text.split('\n')
  const from = lines.indexOf(`${THE_EXTENSIONS_SETTING}:`)
  if (from < 0) return []
  const servers: string[] = []
  for (const line of lines.slice(from + 1)) {
    if (line !== '' && !line.startsWith(' ')) break
    const key = AN_EXTENSIONS_KEY.exec(line)?.[1]
    if (key !== undefined && !platform.has(key)) servers.push(key)
  }
  return servers
}

/**
 * A config root read back just before the engine reads it (martha#541 C1, guard row 3): the tool servers it names, which
 * must be `server` alone, and its bytes, which must be the ones the launch wrote; or why the engine is not started on
 * it. The servers are judged first, so a second server is refused by its name; the bytes then catch any edit the
 * reader's one layout would not follow.
 */
export function theRootReadBack(facts: RecordedEngine, root: { readonly at: string; readonly text: string; readonly written: string }, server: string): { readonly servers: readonly string[] } | { readonly refusal: string } {
  const servers = theServersAConfigNames(facts, root.text)
  if (servers.length !== 1 || servers[0] !== server) {
    return { refusal: `the config root at ${root.at} names the tool servers [${servers.join(', ')}], and a launch starts with ${server} alone.` }
  }
  if (root.text !== root.written) return { refusal: `the config root at ${root.at} is not the text this launch wrote, so the engine is not started on it.` }
  return { servers }
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
