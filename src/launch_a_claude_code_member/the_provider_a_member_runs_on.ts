// The environment a member on a provider's own endpoint is given (gap 4 of martha#957, martha#931, martha#916).
//
// A Claude Code member whose profile's provider names an `endpoint` runs against that provider, on that provider's key
// alone: the base URL, the bearer token, the model and its context window go in this member's environment, and nothing
// else's. A provider with no endpoint is Anthropic's own and keeps martha#916's billing, so this hands nothing for it.
//
// The key is the provider's, read from the variable `key_from` names or from the file `key_file` names (the same read
// the engine's start makes, ../read_a_providers_key_file), and it goes into the spawned process's environment, never
// onto a command line. The credential of the billing this member does NOT use is left out: `ANTHROPIC_API_KEY` and the
// subscription's sign-in store, so no inherited value of either rides along beside the provider's own key.
//
// The refusals are guard code and name the field of the declaration to look at, never the key: an endpoint with no
// key_from and no key_file, a `key_from` the launcher's environment carries no value for, and a key file the shared
// read refuses.

import { API_KEY_VARIABLE, AUTH_TOKEN_VARIABLE } from '../ask_the_host_what_it_loads/host_runs_the_relay.ts'
import { CLAUDE_CODE_SIGN_IN_STORE_VARIABLE } from '../claude_code_host/recorded_claude_code_host.ts'
import { theKeyInTheOwnersFile } from '../read_a_providers_key_file/read_a_providers_key_file.ts'

/** The host's variable for the base URL a session's requests go to. */
export const THE_PROVIDERS_ENDPOINT_VARIABLE = 'ANTHROPIC_BASE_URL'

/** The host's variable for the one model a session runs. */
export const THE_MODELS_VARIABLE = 'ANTHROPIC_MODEL'

/** The host's variable for the smaller model it runs beside it. The provider serves one model, so it is the member's. */
export const THE_SMALL_MODELS_VARIABLE = 'ANTHROPIC_SMALL_FAST_MODEL'

/** The host's variable for the context window a model is given. */
export const THE_CONTEXT_TOKENS_VARIABLE = 'CLAUDE_CODE_MAX_CONTEXT_TOKENS'

/**
 * What the declaration says of the provider a member's profile names (martha#931): its name and the place it is named
 * at, where it is reached and where its key is read from, the model its profile runs, and that model's context window.
 */
export interface TheProviderAMemberRunsOn {
  /** The provider's name, as the declaration writes it. */
  readonly name: string
  /** The place the declaration names it at, `providers.<name>`, so a refusal says which line to look at. */
  readonly named_at: string
  /** The Anthropic-compatible endpoint the member reaches, or null when the provider is Anthropic's own. */
  readonly endpoint: string | null
  /** The variable the key is in, or null when the declaration names no variable. */
  readonly key_from: string | null
  /** The file the key is in, written as the owner typed it, or null when the declaration names no file. */
  readonly key_file: string | null
  /** The model the member's profile names, which is the model the host is told to run. */
  readonly model: string
  /** The model's context window in tokens, or null when the profile names none. */
  readonly context_limit: number | null
}

/** What a member on a provider's endpoint is handed, and the billing's other credential it is never handed. */
export interface AProviderMembersEnvironment {
  readonly env: Readonly<Record<string, string>>
  /** The variables left out whatever the billing's own list allows, so the provider's key is the one credential there is. */
  readonly not_given: readonly string[]
}

/** The credential a member on a provider's endpoint is never handed: the other billing's, both of them. */
export const THE_CREDENTIALS_A_PROVIDER_MEMBER_IS_NOT_GIVEN: readonly string[] = [API_KEY_VARIABLE, CLAUDE_CODE_SIGN_IN_STORE_VARIABLE]

/** What the environment is built from: who runs, on what, with the launcher's own environment and home. */
export interface AMemberOnAProvider {
  readonly member: string
  readonly provider: TheProviderAMemberRunsOn
  readonly inherited: Readonly<Record<string, string | undefined>>
  /** The owner's home, a `~/` key file's path is written out against. */
  readonly home: string
}

/**
 * The environment a member on the provider's endpoint is given, and what it is never given; or why it cannot start.
 * Nothing for a provider with no endpoint: that one is Anthropic's own.
 */
export function theProviderMembersEnvironment(asking: AMemberOnAProvider): AProviderMembersEnvironment | { readonly refusal: string } {
  const { provider } = asking
  if (provider.endpoint === null) return { env: {}, not_given: [] }
  const named = `${provider.named_at}.endpoint`
  if (provider.key_from === null && provider.key_file === null) {
    return { refusal: `${named} is ${provider.endpoint}, and ${provider.named_at} names no key_from and no key_file: a member reaches it with its own key, and there is none` }
  }
  const key = theKeyOf(asking)
  if ('refusal' in key) return key
  return {
    env: {
      [THE_PROVIDERS_ENDPOINT_VARIABLE]: provider.endpoint,
      [AUTH_TOKEN_VARIABLE]: key.key,
      [THE_MODELS_VARIABLE]: provider.model,
      [THE_SMALL_MODELS_VARIABLE]: provider.model,
      ...(provider.context_limit === null ? {} : { [THE_CONTEXT_TOKENS_VARIABLE]: String(provider.context_limit) }),
    },
    not_given: THE_CREDENTIALS_A_PROVIDER_MEMBER_IS_NOT_GIVEN,
  }
}

/** The provider's key, from the file it names (read by the shared check) or from the variable it names; or why not. */
function theKeyOf(asking: AMemberOnAProvider): { readonly key: string } | { readonly refusal: string } {
  const { provider } = asking
  if (provider.key_file !== null) return theKeyInTheOwnersFile(provider.key_file, asking.home, `${provider.named_at}.key_file`)
  const variable = provider.key_from ?? ''
  const key = asking.inherited[variable]
  if (key === undefined || key === '') {
    return { refusal: `${provider.named_at}.key_from names ${variable}, and the environment ${asking.member} is started from holds no value for it` }
  }
  return { key }
}
