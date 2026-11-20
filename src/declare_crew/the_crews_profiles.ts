// The crew's harnesses, providers and profiles (martha#931, Raf's draft on issuecomment-7033712899): a profile names a
// model, the harness that runs it and the provider that serves it, and a member that names a profile runs on that
// profile's host and model. One profile is written once for every member on it, so changing a crew's model is one edit.
//
// The parse lives here, beside declare_crew, which hands it the three blocks and its own refusal, as the thresholds are
// read (./the_crews_thresholds.ts). It takes no host and reads no file. A key file's path is kept as the owner wrote it:
// a path under the owner's home is written out by the engine's start, which knows the home (../start_an_engine_member).

import { CLAUDE, CLAUDE_CODE } from '../know_claude_codes_own_facts/claude_code_facts.ts'
import { RECORDED_GOOSE_ENGINE } from '../know_the_goose_engines_facts/recorded_goose_engine.ts'

/** The declaration's keys for the three blocks, read through the lists at the end of this file, and the member key that names a profile. */
const HARNESSES = 'harnesses'
const PROVIDERS = 'providers'
const PROFILES = 'profiles'
export const PROFILE = 'profile'

/**
 * Which credential a Claude Code member on a provider is billed through (martha#916, DECIDED 2026-11-20 "Crew setting
 * (Recommended)", placed under `providers.<name>.billing` by the Supervisor's ruling on #931): the owner's subscription
 * sign-in, or the API key. Only the chosen credential reaches a member; the other is left out of its environment and its
 * config. A provider that names none reads as null, and the launch then picks the subscription when the owner is signed
 * in, else the key when the launcher carries one (../give_a_member_its_own_config). Any other value is refused by name.
 * These are the declaration's words, not the host's own account of how a session was billed (../keep_what_a_session_spent).
 */
export const BILLED_BY_SUBSCRIPTION = 'subscription'
export const BILLED_BY_API_KEY = 'api_key'
export const BILLINGS = [BILLED_BY_SUBSCRIPTION, BILLED_BY_API_KEY] as const
export type Billing = (typeof BILLINGS)[number]

/** The fields a harness may name: where its own configuration sits. Read by no part of Martha today. */
export const HARNESS_KEYS = ['config'] as const

/**
 * The fields a provider may name: where it is reached, where its key is read from (a variable's name or a file's path,
 * never the key), the account it bills, and how it bills.
 */
export const PROVIDER_KEYS = ['endpoint', 'key_from', 'key_file', 'account', 'billing'] as const

/** The fields a profile names: the model, its harness and its provider, and optionally the model's context in tokens. */
export const PROFILE_REQUIRED_KEYS = ['model', 'harness', 'provider'] as const
export const PROFILE_OPTIONAL_KEYS = ['context_limit'] as const

/**
 * The harnesses Martha knows, by the name a declaration writes, each with the host a member on it is started on: the
 * draft names Claude Code by its program, and either host may also be named as the host is.
 */
export const HARNESSES_IT_KNOWS: ReadonlyMap<string, string> = new Map([
  [CLAUDE, CLAUDE_CODE],
  [CLAUDE_CODE, CLAUDE_CODE],
  [RECORDED_GOOSE_ENGINE.engine_name, RECORDED_GOOSE_ENGINE.engine_name],
])

/** A provider as declared: each field as written, null when it is not. */
export interface Provider {
  readonly endpoint: string | null
  readonly key_from: string | null
  readonly key_file: string | null
  /** The credential a Claude Code member on this provider is billed through, or null when the provider names none. */
  readonly billing: Billing | null
}

/** A profile as read: the model, the host its harness starts, its provider's name, and the context in tokens or null. */
export interface Profile {
  readonly model: string
  readonly host: string
  readonly provider: string
  readonly context_limit: number | null
}

/** What the three blocks declare: the providers and the profiles, by name. */
export interface TheProfiles {
  readonly providers: ReadonlyMap<string, Provider>
  readonly profiles: ReadonlyMap<string, Profile>
}

/** How a field of the three blocks is refused: the field, dotted under its block, and why. */
export type RefuseAProfile = (field: string, why: string) => never

type Block = Readonly<Record<string, unknown>>

const isBlock = (value: unknown): value is Block => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** A name a variable may hold, as a shell spells one. */
const A_VARIABLES_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The three blocks as declared. A declaration without them names no profile, and its members name their own host and
 * model, as every declaration before martha#931 did.
 */
export function profilesOf(declaration: Block, refuse: RefuseAProfile): TheProfiles {
  const harnesses = harnessesOf(declaration[HARNESSES], refuse)
  const providers = providersOf(declaration[PROVIDERS], refuse)
  return { providers, profiles: theProfilesOf(declaration[PROFILES], { harnesses, providers }, refuse) }
}

/** Each entry of a block, refused by the block's name when the block is not an object of named entries. */
function entriesOf(value: unknown, block: string, refuse: RefuseAProfile): ReadonlyArray<[string, Block]> {
  if (value === undefined) return []
  if (!isBlock(value)) return refuse(block, 'is not an object of named entries')
  return Object.entries(value).map(([name, entry]) => {
    if (!isBlock(entry)) refuse(`${block}.${name}`, 'is not an object')
    return [name, entry]
  })
}

function refuseUnknownKeys(entry: Block, known: readonly string[], at: string, refuse: RefuseAProfile): void {
  const unknown = Object.keys(entry).find((key) => !known.includes(key))
  if (unknown !== undefined) refuse(`${at}.${unknown}`, `is not a field here (they are ${known.join(', ')})`)
}

/** The harnesses declared, each by the host it starts; a harness Martha does not know is refused by name. */
function harnessesOf(value: unknown, refuse: RefuseAProfile): ReadonlyMap<string, string> {
  const harnesses = new Map<string, string>()
  for (const [name, entry] of entriesOf(value, HARNESSES, refuse)) {
    const at = `${HARNESSES}.${name}`
    const host = HARNESSES_IT_KNOWS.get(name)
    if (host === undefined) refuse(at, `is not a harness Martha knows (they are ${[...HARNESSES_IT_KNOWS.keys()].join(', ')})`)
    refuseUnknownKeys(entry, HARNESS_KEYS, at, refuse)
    if (entry['config'] !== undefined && !isText(entry['config'])) refuse(`${at}.config`, 'is not a path')
    harnesses.set(name, host)
  }
  return harnesses
}

/** The providers declared: each field text when it is named, and a key's place never the key itself. */
function providersOf(value: unknown, refuse: RefuseAProfile): ReadonlyMap<string, Provider> {
  const providers = new Map<string, Provider>()
  for (const [name, entry] of entriesOf(value, PROVIDERS, refuse)) {
    const at = `${PROVIDERS}.${name}`
    refuseUnknownKeys(entry, PROVIDER_KEYS, at, refuse)
    providers.set(name, aProviderOf(entry, at, refuse))
  }
  return providers
}

function aProviderOf(entry: Block, at: string, refuse: RefuseAProfile): Provider {
  for (const key of ['endpoint', 'account'] as const) {
    if (entry[key] !== undefined && !isText(entry[key])) refuse(`${at}.${key}`, 'is not text')
  }
  refuseTheKeysPlace(entry, at, refuse)
  return { endpoint: textOrNull(entry['endpoint']), key_from: textOrNull(entry['key_from']), key_file: textOrNull(entry['key_file']), billing: aBillingOf(entry['billing'], at, refuse) }
}

/** A provider's billing, or null when it names none; any other value is refused by name, never read as the default. */
function aBillingOf(value: unknown, at: string, refuse: RefuseAProfile): Billing | null {
  if (value === undefined) return null
  const billing = BILLINGS.find((known) => known === value)
  return billing ?? refuse(`${at}.billing`, `is not one of ${BILLINGS.join(', ')}`)
}

/** Where a provider's key is read from: a variable's name or a file's path, never both, and never the key. */
function refuseTheKeysPlace(entry: Block, at: string, refuse: RefuseAProfile): void {
  const { key_from, key_file } = entry
  if (key_from !== undefined && (typeof key_from !== 'string' || !A_VARIABLES_NAME.test(key_from))) refuse(`${at}.key_from`, 'is not the name of an environment variable: the key itself never goes in the declaration')
  if (key_file !== undefined && !isAKeyFilesPathAsWritten(key_file)) refuse(`${at}.key_file`, 'is not a path with no `..` part: the key itself never goes in the declaration')
  if (key_from !== undefined && key_file !== undefined) refuse(`${at}.key_file`, 'is named beside key_from: the key is read from one place')
}

/**
 * Whether a value is a key file's path as the owner wrote it: text with no `..` part and no white space a pasted key
 * would bring. Whether it is absolute, or under the owner's home, is the start's to say: it writes the home out.
 */
const isAKeyFilesPathAsWritten = (value: unknown): value is string => isText(value) && !/\s/.test(value) && !value.split('/').includes('..')

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** What a profile is read against: the harnesses and providers the declaration names. */
interface TheNamesDeclared {
  readonly harnesses: ReadonlyMap<string, string>
  readonly providers: ReadonlyMap<string, Provider>
}

/** The profiles declared, each naming a harness and a provider this declaration names. */
function theProfilesOf(value: unknown, declared: TheNamesDeclared, refuse: RefuseAProfile): ReadonlyMap<string, Profile> {
  const profiles = new Map<string, Profile>()
  for (const [name, entry] of entriesOf(value, PROFILES, refuse)) {
    const at = `${PROFILES}.${name}`
    refuseUnknownKeys(entry, [...PROFILE_REQUIRED_KEYS, ...PROFILE_OPTIONAL_KEYS], at, refuse)
    profiles.set(name, aProfileOf(entry, at, declared, refuse))
  }
  return profiles
}

/** The names a declaration's own list holds, for a refusal to say: `none` when it holds none. */
const theNamesIn = (names: ReadonlyMap<string, unknown>): string => [...names.keys()].join(', ') || 'none'

function aProfileOf(entry: Block, at: string, declared: TheNamesDeclared, refuse: RefuseAProfile): Profile {
  const { model, harness, provider, context_limit } = entry
  if (!isText(model)) refuse(`${at}.model`, 'is not a model name')
  const host = typeof harness === 'string' ? declared.harnesses.get(harness) : undefined
  if (host === undefined) refuse(`${at}.harness`, `is not a harness this declaration names (it names ${theNamesIn(declared.harnesses)})`)
  if (typeof provider !== 'string' || !declared.providers.has(provider)) refuse(`${at}.provider`, `is not a provider this declaration names (it names ${theNamesIn(declared.providers)})`)
  if (context_limit !== undefined && !isAWholeNumberOfTokens(context_limit)) refuse(`${at}.context_limit`, 'is not a whole number of tokens, at least 1')
  return { model: model.trim(), host, provider, context_limit: context_limit ?? null }
}

const isAWholeNumberOfTokens = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1

/**
 * A member's model and host from the profile it names (martha#931), and the billing of that profile's provider
 * (martha#916), or null when it names none. A member that names a
 * profile and one of `own` (its own model or host) is refused, so the two never disagree.
 */
export function theProfileOfAMember(member: Block, at: string, read: TheProfiles, own: readonly string[], refuse: RefuseAProfile): (Pick<Profile, 'model' | 'host'> & Pick<Provider, 'billing'>) | null {
  const profile = member[PROFILE]
  if (profile === undefined) return null
  const declared = typeof profile === 'string' ? read.profiles.get(profile) : undefined
  if (declared === undefined) return refuse(`${at}.${PROFILE}`, `is not a profile this declaration names (it names ${theNamesIn(read.profiles)})`)
  const named = own.find((key) => member[key] !== undefined)
  if (named !== undefined) refuse(`${at}.${named}`, `is named beside ${PROFILE}, which names it`)
  return { model: declared.model, host: declared.host, billing: read.providers.get(declared.provider)!.billing }
}

/**
 * The one provider the members on a host reach their model through, by the profiles the declared members name; null
 * when no such member names a profile. The engine's start reaches one endpoint (martha#541 package A), so members on that host
 * whose profiles name two providers are refused by the second one's field.
 */
export function theProviderOfAHost(read: TheProfiles, members: unknown, host: string, refuse: RefuseAProfile): { readonly name: string; readonly provider: Provider } | null {
  const named = Array.isArray(members) ? members.flatMap((member: unknown) => (isBlock(member) && typeof member[PROFILE] === 'string' ? [member[PROFILE]] : [])) : []
  let found: { readonly name: string; readonly provider: Provider } | null = null
  for (const profile of new Set(named)) {
    const declared = read.profiles.get(profile)
    if (declared === undefined || declared.host !== host) continue
    if (found !== null && found.name !== declared.provider) refuse(`${PROFILES}.${profile}.provider`, `is ${declared.provider}, and another ${host} profile names ${found.name}: this release reaches one provider for ${host}`)
    found = { name: declared.provider, provider: read.providers.get(declared.provider)! }
  }
  return found
}

/** A field of a provider, as a refusal names it: `providers.<name>.<field>`. */
export const aProvidersField = (name: string, field: string): string => `${PROVIDERS}.${name}.${field}`

/** The top-level keys this file reads, for declare_crew's list of the keys a declaration may hold. */
export const PROFILE_TOP_LEVEL_KEYS: readonly string[] = [HARNESSES, PROVIDERS, PROFILES]

/** The fields of each block this file reads, by the block's key, for the declaration's page (docs/the-declaration.md). */
export const PROFILE_BLOCK_FIELDS: Readonly<Record<string, readonly string[]>> = {
  [HARNESSES]: HARNESS_KEYS,
  [PROVIDERS]: PROVIDER_KEYS,
  [PROFILES]: [...PROFILE_REQUIRED_KEYS, ...PROFILE_OPTIONAL_KEYS],
}
