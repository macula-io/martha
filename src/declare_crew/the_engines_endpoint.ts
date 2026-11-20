// Where an engine member's model is reached (martha#541 package A; martha#931): the declaration's own `engine_endpoint`,
// or the provider the engine's profiles name. Read here, beside declare_crew, which hands it the declaration and its own
// refusal. It takes no host and reads no file: the key itself is never in the declaration, and only the start reads it.

import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'
import { aProvidersField, theProviderOfAHost, type Provider, type TheProfiles } from './the_crews_profiles.ts'

/** How a field of the endpoint is refused: the field, and why. */
export type RefuseAnEndpoint = (field: string, why: string) => never

/** How a field the endpoint does not know is said and read past (martha#601): the field, and why. */
export type SayOfAnEndpoint = (field: string, why: string) => void

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

// What a field must look like, written from its keys: `{ a, b, c? }`.
const shapeOf = (required: readonly string[], optional: readonly string[] = []) => `{ ${[...required, ...optional.map((key) => `${key}?`)].join(', ')} }`

/**
 * Where an engine member's model is reached (martha#541 package A, Q1, DECIDED 2026-11-19 "Yes, one crew setting
 * (Recommended)"): the top-level key, the endpoint's host, its base path, and the name of the variable that holds the
 * key in the owner's environment. The key itself is never in the declaration: the start reads that variable and writes
 * its value into the launch's secrets file alone. A declaration without the key has no endpoint, and an engine member
 * of that crew is refused at its start, by name.
 */
export const ENGINE_ENDPOINT = 'engine_endpoint'
export const ENGINE_ENDPOINT_REQUIRED_KEYS = ['host'] as const
export const ENGINE_ENDPOINT_OPTIONAL_KEYS = ['base_path', 'key_from', 'key_file'] as const

/** A name `key_from` may hold: an environment variable's, as a shell spells one. */
export const AN_ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** The schemes an endpoint's host may be reached on. */
export const ENDPOINT_SCHEMES: readonly string[] = ['http:', 'https:']

/**
 * The scheme a provider's endpoint is reached on when it names a bare host, as Raf's draft writes `api.deepseek.com`
 * (martha#931): the one of ENDPOINT_SCHEMES a key may travel over.
 */
export const THE_SCHEME_OF_A_BARE_HOST = ENDPOINT_SCHEMES[1]!

/**
 * A declared engine endpoint: the host as a URL, the base path when one is named, and where the key is read from when
 * one is named: the variable it is in, or the file it is in (martha#511 part B), never both.
 */
export interface EngineEndpoint {
  readonly host: string
  readonly base_path: string | null
  readonly key_from: string | null
  /**
   * The file the key is in. Declared under `engine_endpoint`, it is an absolute path: a path the owner types at
   * `martha up` is written out against their home before it lands there, and the reader refuses any other. Taken from a
   * provider (martha#931), it is kept as the owner wrote it, and the start writes a path under the home out and refuses
   * one that is still not absolute. The start reads it, and only the start.
   */
  readonly key_file: string | null
}

/**
 * Where an engine member's model is reached (martha#931): the declaration's own `engine_endpoint`, or the provider the
 * engine's profiles name, with a bare host reached on THE_SCHEME_OF_A_BARE_HOST. Both at once is refused: one file never
 * names the endpoint twice.
 */
export function theEnginesEndpointOf(refuse: RefuseAnEndpoint, value: Readonly<Record<string, unknown>>, read: TheProfiles, say: SayOfAnEndpoint = () => {}): EngineEndpoint | null {
  const declared = engineEndpointOf(refuse, value[ENGINE_ENDPOINT], say)
  const engines = theProviderOfAHost(read, value['members'], RECORDED_GOOSE_ENGINE.engine_name, refuse)
  if (engines === null || engines.provider.endpoint === null) return declared
  if (declared !== null) refuse(ENGINE_ENDPOINT, `is named beside ${aProvidersField(engines.name, 'endpoint')}, which the engine's profiles reach`)
  return theProvidersEndpoint(refuse, engines.name, engines.provider)
}

/** A provider's endpoint as the engine's start reads one; its key file kept as written, for the start to write out. */
function theProvidersEndpoint(refuse: RefuseAnEndpoint, name: string, provider: Provider): EngineEndpoint {
  const endpoint = provider.endpoint!
  const checked = anEndpointsHost(endpoint.includes('//') ? endpoint : `${THE_SCHEME_OF_A_BARE_HOST}//${endpoint}`)
  if ('why' in checked) return refuse(aProvidersField(name, 'endpoint'), checked.why)
  return { host: checked.host, base_path: null, key_from: provider.key_from, key_file: provider.key_file }
}

/**
 * The fields a key itself is written in (martha#601): a field this reader does not know is one notice and the crew is
 * read on, but a key written into the declaration is the leaked key the cut keeps, so it is still refused by name.
 */
const FIELDS_A_KEY_IS_WRITTEN_IN = ['key', 'token'] as const

/** The declared engine endpoint, or null when there is none: a host reached over http or https, a base path, and a variable's name. */
function engineEndpointOf(refuse: RefuseAnEndpoint, value: unknown, say: SayOfAnEndpoint): EngineEndpoint | null {
  if (value === undefined) return null
  if (!isObject(value)) return refuse(ENGINE_ENDPOINT, `is not ${shapeOf(ENGINE_ENDPOINT_REQUIRED_KEYS, ENGINE_ENDPOINT_OPTIONAL_KEYS)}`)
  const writtenKey = FIELDS_A_KEY_IS_WRITTEN_IN.find((field) => field in value)
  if (writtenKey !== undefined) refuse(`${ENGINE_ENDPOINT}.${writtenKey}`, 'never goes in the declaration: key_from names the environment variable that holds it')
  const known: readonly string[] = [...ENGINE_ENDPOINT_REQUIRED_KEYS, ...ENGINE_ENDPOINT_OPTIONAL_KEYS]
  const unknown = Object.keys(value).find((key) => !known.includes(key))
  if (unknown !== undefined) say(`${ENGINE_ENDPOINT}.${unknown}`, `is not a field here (they are ${known.join(', ')}); ignoring it`)
  const checked = anEndpointsHost(value['host'])
  if ('why' in checked) return refuse(`${ENGINE_ENDPOINT}.host`, checked.why)
  const { host } = checked
  const base_path = value['base_path']
  if (!isAbsentOrText(base_path)) return refuse(`${ENGINE_ENDPOINT}.base_path`, 'is not a path')
  return { host, base_path: base_path ?? null, ...theKeysPlaceOf(refuse, value) }
}

/** Where an endpoint's key is read from: the variable it is in, the file it is in (martha#511 part B), or neither; never both. */
function theKeysPlaceOf(refuse: RefuseAnEndpoint, value: Readonly<Record<string, unknown>>): Pick<EngineEndpoint, 'key_from' | 'key_file'> {
  const key_from = value['key_from']
  if (!isAbsentOrAVariablesName(key_from)) return refuse(`${ENGINE_ENDPOINT}.key_from`, 'is not the name of an environment variable: the key itself never goes in the declaration')
  const key_file = value['key_file']
  if (!isAbsentOrAKeyFilesPath(key_file)) return refuse(`${ENGINE_ENDPOINT}.key_file`, 'is not an absolute path: the key itself never goes in the declaration')
  if (key_from !== undefined && key_file !== undefined) return refuse(`${ENGINE_ENDPOINT}.key_file`, 'is named beside key_from: the key is read from one place')
  return { key_from: key_from ?? null, key_file: key_file ?? null }
}

/** Whether a value is absent or a key file's path: absolute, with no `..` part. */
function isAbsentOrAKeyFilesPath(value: unknown): value is string | undefined {
  return value === undefined || isAKeyFilesPath(value)
}

/**
 * Whether a value is a key file's path (martha#511 part B): absolute, with no `..` part. The declaration is this
 * machine's own, so a path the owner typed under their home is written out in full by `martha up` before it lands here.
 */
export function isAKeyFilesPath(value: unknown): value is string {
  if (!isText(value) || !value.startsWith('/')) return false
  return !value.split('/').includes('..')
}

/**
 * The parts of a URL a key can ride in, by the name the refusal gives each: a user name, a password, a query and a
 * fragment. An endpoint's host carries none of them, so a key never reaches the declaration or the config the launch
 * writes through the host (Q1, design r=2 R1). A key spelled into the URL's path cannot be told from a path, and is
 * not caught here.
 */
const PARTS_A_KEY_RIDES_IN = { username: 'a user name', password: 'a password', search: 'a query', hash: 'a fragment' } as const

/** The host an endpoint names, or why the value is not one: a URL on a scheme it is reached over, with no part a key rides in. */
function anEndpointsHost(value: unknown): { readonly host: string } | { readonly why: string } {
  const url = isText(value) ? aUrl(value) : undefined
  if (!isText(value) || url === undefined || !ENDPOINT_SCHEMES.includes(url.protocol)) return { why: `is not a URL on ${ENDPOINT_SCHEMES.join(' or ')}` }
  const carried = Object.entries(PARTS_A_KEY_RIDES_IN).filter(([part]) => url[part as keyof typeof PARTS_A_KEY_RIDES_IN] !== '')
  if (carried.length === 0) return { host: value }
  return { why: `carries ${carried.map(([, named]) => named).join(' and ')}, where a key can ride: the key itself never goes in the declaration` }
}

/** Nothing written, or text. */
const isAbsentOrText = (value: unknown): value is string | undefined => value === undefined || isText(value)

/** Nothing written, or the name of an environment variable. */
const isAbsentOrAVariablesName = (value: unknown): value is string | undefined => value === undefined || (typeof value === 'string' && AN_ENVIRONMENT_NAME.test(value))

/** The text read as a URL, or undefined when it is not one. */
function aUrl(text: string): URL | undefined {
  try {
    return new URL(text)
  } catch {
    return undefined
  }
}
