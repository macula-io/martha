// The model an engine member runs (martha#541 package A, design r=1 step 1 and Q1, DECIDED 2026-11-19 "Yes, one crew
// setting (Recommended)"): the member's declared model, reached through the recorded provider at the crew's declared
// endpoint, with the key read from the variable the declaration names and written to the launch's secrets file alone.
// After the config root is written its model is read back from the file, so a root naming another model starts nothing.

import { THE_MODEL_SETTING, type TheModelALaunchRuns } from '../derive_the_config_of_a_goose_launch/derive_the_config_of_a_goose_launch.ts'
import { ENGINE_ENDPOINT, type EngineEndpoint } from '../declare_crew/declare_crew.ts'
import type { RecordedEngine } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'

/** The provider setting the endpoint's host is written under, as the recorded provider reads it. */
export const THE_ENDPOINTS_HOST_SETTING = 'OPENAI_HOST'

/** The provider setting the endpoint's base path is written under. */
export const THE_ENDPOINTS_BASE_PATH_SETTING = 'OPENAI_BASE_PATH'

/** The provider secret the key is written under, in the launch's secrets file. */
export const THE_ENDPOINTS_KEY_SECRET = 'OPENAI_API_KEY'

/** Why a member that names no model is not started: the engine's own default would run, which nobody declared. */
export const AN_ENGINE_MEMBER_NAMES_ITS_MODEL = 'an engine member names its model; the engine’s own default is never run'

/** What the model is built from: the member, its declared model, the crew's endpoint and the launcher's environment. */
export interface AnEngineMembersModelAsked {
  readonly facts: Pick<RecordedEngine, 'openai_provider'>
  readonly member: string
  readonly model: string | null
  readonly endpoint: EngineEndpoint | null
  readonly environment: Readonly<Record<string, string | undefined>>
  /**
   * The key in the file `key_file` names (martha#511 part B), read by the start under the home it runs with; or why it
   * may not be read. Asked only when the endpoint names a key file.
   */
  readonly readTheKeyFile: (key_file: string) => { readonly key: string } | { readonly refusal: string }
}

/**
 * Why a key file may not be read, from what the start found there (martha#511 part B): not a plain file, someone else's,
 * or open to the group or to others. Undefined when it is the owner's own file, closed to everyone else.
 */
export function whyAKeyFileIsNotTheOwners(at: string, found: { readonly plain_file: boolean; readonly owner_is_this_user: boolean; readonly mode: number }): string | undefined {
  if (!found.plain_file) return `${ENGINE_ENDPOINT}.key_file ${at} is not a plain file`
  if (!found.owner_is_this_user) return `${ENGINE_ENDPOINT}.key_file ${at} is not this user's own file`
  if ((found.mode & THE_MODE_BITS_OF_GROUP_AND_OTHERS) !== 0) return `${ENGINE_ENDPOINT}.key_file ${at} is open to the group or to others: close it to its owner`
  return undefined
}

/** The mode bits a key file must have clear: every right of its group and of others. */
export const THE_MODE_BITS_OF_GROUP_AND_OTHERS = 0o077

/**
 * The model one engine member's launch runs, or why it may not start: no model declared, no endpoint declared, a key
 * variable named and empty, or a recording whose provider no longer reads the settings the endpoint is written under.
 * The key's value is never in a refusal.
 */
export function theModelOfAnEngineMember(asked: AnEngineMembersModelAsked): TheModelALaunchRuns | { readonly refusal: string } {
  const { facts, member, model, endpoint } = asked
  if (model === null) return { refusal: `${member} names no model: ${AN_ENGINE_MEMBER_NAMES_ITS_MODEL}` }
  if (endpoint === null) return { refusal: `the crew declares no ${ENGINE_ENDPOINT}, so ${member} has nowhere to reach ${model}` }
  const unread = [THE_ENDPOINTS_HOST_SETTING, THE_ENDPOINTS_BASE_PATH_SETTING].find((setting) => !facts.openai_provider.settings.includes(setting))
  if (unread !== undefined) return { refusal: `the recorded provider ${facts.openai_provider.name} reads no ${unread}, so ${ENGINE_ENDPOINT} cannot be written for it` }
  if (!facts.openai_provider.secrets.includes(THE_ENDPOINTS_KEY_SECRET)) {
    return { refusal: `the recorded provider ${facts.openai_provider.name} reads no secret ${THE_ENDPOINTS_KEY_SECRET}, so the key cannot be written for it` }
  }
  const settings = {
    [THE_ENDPOINTS_HOST_SETTING]: endpoint.host,
    ...(endpoint.base_path === null ? {} : { [THE_ENDPOINTS_BASE_PATH_SETTING]: endpoint.base_path }),
  }
  const key = theSecretsOfAnEndpoint(asked, endpoint, model)
  return 'refusal' in key ? key : { provider: facts.openai_provider.name, model, settings, secrets: key.secrets }
}

/**
 * The secrets the launch writes for the endpoint's key: the key in the file it names (martha#511 part B), or in the
 * variable it names, or none when it names neither; or why the key cannot be had. The key is never in a refusal.
 */
function theSecretsOfAnEndpoint(asked: AnEngineMembersModelAsked, endpoint: EngineEndpoint, model: string): { readonly secrets: Readonly<Record<string, string>> } | { readonly refusal: string } {
  const { member } = asked
  if (endpoint.key_file !== null) {
    const read = asked.readTheKeyFile(endpoint.key_file)
    return 'refusal' in read ? { refusal: `${member} cannot reach ${model}: ${read.refusal}` } : { secrets: { [THE_ENDPOINTS_KEY_SECRET]: read.key } }
  }
  if (endpoint.key_from === null) return { secrets: {} }
  const key = asked.environment[endpoint.key_from]
  if (key === undefined || key === '') {
    return { refusal: `${ENGINE_ENDPOINT}.key_from names ${endpoint.key_from}, and the environment ${member} is started from holds no value for it` }
  }
  return { secrets: { [THE_ENDPOINTS_KEY_SECRET]: key } }
}

/**
 * The model the config root names, read back from its text as the engine will read it: the value of the one line under
 * the model's key, or undefined when no such line is there or it is named twice.
 */
export function theModelTheConfigNames(text: string): string | undefined {
  const lines = text.split('\n').filter((line) => line.startsWith(`${THE_MODEL_SETTING}:`))
  if (lines.length !== 1) return undefined
  const value = (lines[0] ?? '').slice(THE_MODEL_SETTING.length + 1).trim()
  try {
    const read: unknown = JSON.parse(value)
    return typeof read === 'string' ? read : undefined
  } catch {
    return undefined
  }
}

/** Why the config root does not run the declared model, or undefined when it names exactly that one. */
export function whyTheConfigRunsAnotherModel(text: string, at: string, model: string): string | undefined {
  const named = theModelTheConfigNames(text)
  if (named === model) return undefined
  return `the config root at ${at} names the model ${named === undefined ? 'nowhere' : JSON.stringify(named)}, and the member declares ${JSON.stringify(model)}`
}
