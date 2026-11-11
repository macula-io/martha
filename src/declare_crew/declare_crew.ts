// Declare the crew.
//
// A crew is declared as data, in the project's `.crew/crew.json`: who is on it,
// the mode's table of who may do what, and the house rules as switches. This
// slice reads that declaration once, checks every field, and returns one frozen
// CrewSettings. Every later slice takes CrewSettings, or the part it needs, as an
// argument; none reads a global, an environment variable or a home path for a
// setting (no_setting_outside_the_declaration.ts keeps that true).
//
// Solo and team are not two code paths. A mode is a name and a table: solo is a
// table in which the owner may do everything, team is a table with roles. The
// name is carried for people to read and is never compared here.
//
// Nothing is defaulted silently. A missing or unreadable declaration, a field of
// the wrong shape and a key this slice does not know are each refused with the
// file and the field, so a misspelt switch cannot leave a rule off while the
// declaration looks right. The one default is a house rule the declaration does
// not name: a rule a crew does not switch on does not run.

import { isAbsolute, join, normalize, sep } from 'node:path'

import type { DocumentStore } from '../host_contract/host_contract.ts'

/** Where a crew's declaration lives, relative to the project root. */
export const DECLARATION_DIRECTORY = '.crew'
export const DECLARATION_FILE = 'crew.json'

/** The one declaration version this slice reads. */
export const DECLARATION_VERSION = 1

/** The acts a mode's table assigns, in business words. */
export const ACTS = ['assign_work', 'approve_landing', 'resume_parked_work'] as const
export type Act = (typeof ACTS)[number]

/**
 * The owner, in a mode's table. The owner is a person, not a member, so no
 * member's role may take this name.
 */
export const OWNER = 'owner'

/**
 * The house rules a crew can switch on. Each is off unless the declaration says true, so a crew that names none of
 * them opens no pane and reports nothing (martha#254's `dashboard` among them).
 */
export const HOUSE_RULE_SWITCHES = ['owner_items', 'workspace_layout', 'member_work', 'practice', 'dashboard'] as const
export type HouseRuleSwitch = (typeof HOUSE_RULE_SWITCHES)[number]

/** The house rule that names a model rather than switching a rule on. */
export const REVIEW_MODEL = 'review_model'

/** A member's name: what a crew calls it, and what its branches start with. */
export const MEMBER_NAME = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/

export interface Member {
  readonly name: string
  readonly role: string
  readonly model: string | null
}

export interface Mode {
  readonly name: string
  readonly roles: readonly string[]
  /** For each act, the roles (or the owner) that may take it. */
  readonly may: Readonly<Record<Act, readonly string[]>>
}

export type HouseRules = Readonly<Record<HouseRuleSwitch, boolean>> & {
  readonly review_model: string | null
}

export interface CrewPaths {
  readonly root: string
  readonly crew: string
  readonly declaration: string
  /** The crew's conventions document, when it declares one. Read by the slices that render text. */
  readonly conventions: string | null
}

export interface CrewSettings {
  readonly paths: CrewPaths
  readonly owner: string
  readonly members: readonly Member[]
  readonly mode: Mode
  readonly house_rules: HouseRules
}

/** Why a declaration is not one: the file, and the field when one is to blame. */
export class DeclarationRefused extends Error {
  readonly file: string
  readonly field: string | null

  constructor(file: string, field: string | null, why: string) {
    super(field === null ? `${file}: ${why}` : `${file}: ${field} ${why}`)
    this.name = 'DeclarationRefused'
    this.file = file
    this.field = field
  }
}

const TOP_LEVEL_KEYS = ['version', 'owner', 'members', 'mode', 'house_rules', 'conventions'] as const
const REQUIRED_MEMBER_KEYS = ['name', 'role'] as const
const OPTIONAL_MEMBER_KEYS = ['model'] as const
const MEMBER_KEYS = [...REQUIRED_MEMBER_KEYS, ...OPTIONAL_MEMBER_KEYS] as const
const MODE_KEYS = ['name', 'roles', 'may'] as const

// What a field must look like, written from its keys: `{ a, b, c? }`.
const shapeOf = (required: readonly string[], optional: readonly string[] = []) =>
  `{ ${[...required, ...optional.map(key => `${key}?`)].join(', ')} }`
const HOUSE_RULE_KEYS: readonly string[] = [...HOUSE_RULE_SWITCHES, REVIEW_MODEL]

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * Read the crew's declaration under `root` once, through the host's document
 * store, and return its settings. `root` is the project's absolute path, as the
 * composer knows it.
 */
export async function declareCrew(documents: DocumentStore, root: string): Promise<CrewSettings> {
  const crew = join(root, DECLARATION_DIRECTORY)
  const declaration = join(crew, DECLARATION_FILE)
  if (!isAbsolute(root)) throw new DeclarationRefused(declaration, null, 'is not under an absolute project root')
  const text = await readDeclaration(documents, declaration)
  const parsed = parseDeclaration(declaration, text)
  return deepFreeze(settingsOf(new Refuse(declaration), parsed, { root, crew, declaration }))
}

async function readDeclaration(documents: DocumentStore, declaration: string): Promise<string> {
  try {
    return await documents.read(declaration)
  } catch (error) {
    const code = (error as { code?: unknown }).code
    if (code === 'ENOENT') throw new DeclarationRefused(declaration, null, 'is missing')
    throw new DeclarationRefused(declaration, null, `could not be read (${String(code ?? error)})`)
  }
}

function parseDeclaration(declaration: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new DeclarationRefused(declaration, null, `is not JSON: ${(error as Error).message}`)
  }
}

// Throws a refusal for the declaration being read, naming the field.
class Refuse {
  readonly file: string

  constructor(file: string) {
    this.file = file
  }

  at(field: string | null, why: string): never {
    throw new DeclarationRefused(this.file, field, why)
  }

  unknownKeys(value: Json, known: readonly string[], prefix: string): void {
    const unknown = Object.keys(value).find(key => !known.includes(key))
    if (unknown !== undefined) this.at(`${prefix}${unknown}`, `is not a field here (they are ${known.join(', ')})`)
  }
}

function settingsOf(refuse: Refuse, value: unknown, paths: Omit<CrewPaths, 'conventions'>): CrewSettings {
  if (!isObject(value)) return refuse.at(null, 'is not a JSON object')
  refuse.unknownKeys(value, TOP_LEVEL_KEYS, '')
  if (value['version'] !== DECLARATION_VERSION) refuse.at('version', `is not ${DECLARATION_VERSION}`)
  if (!isText(value['owner'])) refuse.at('owner', 'is not a name')
  const mode = modeOf(refuse, value['mode'])
  return {
    paths: { ...paths, conventions: conventionsOf(refuse, value['conventions'], paths.crew) },
    owner: value['owner'].trim(),
    members: membersOf(refuse, value['members'], mode.roles),
    mode,
    house_rules: houseRulesOf(refuse, value['house_rules']),
  }
}

function modeOf(refuse: Refuse, value: unknown): Mode {
  if (!isObject(value)) return refuse.at('mode', `is not ${shapeOf(MODE_KEYS)}`)
  refuse.unknownKeys(value, MODE_KEYS, 'mode.')
  if (!isText(value['name'])) refuse.at('mode.name', 'is not a name')
  const roles = rolesOf(refuse, value['roles'])
  return { name: value['name'], roles, may: mayOf(refuse, value['may'], roles) }
}

function rolesOf(refuse: Refuse, value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return refuse.at('mode.roles', 'is not a list of role names')
  value.forEach((role: unknown, i) => {
    if (!isText(role)) refuse.at(`mode.roles[${i}]`, 'is not a name')
    if (role === OWNER) refuse.at(`mode.roles[${i}]`, `is the owner, who is a person and not a member's role`)
    if (value.indexOf(role) !== i) refuse.at(`mode.roles[${i}]`, 'is named twice')
  })
  return value as string[]
}

function mayOf(refuse: Refuse, value: unknown, roles: readonly string[]): Record<Act, string[]> {
  if (!isObject(value)) return refuse.at('mode.may', `is not ${shapeOf(ACTS)}`)
  refuse.unknownKeys(value, ACTS, 'mode.may.')
  const allowed = [OWNER, ...roles]
  const whoMay = (act: Act): string[] => {
    const who = value[act]
    if (!Array.isArray(who) || who.length === 0) return refuse.at(`mode.may.${act}`, 'names nobody')
    who.forEach((name: unknown, i) => {
      if (typeof name !== 'string' || !allowed.includes(name)) {
        refuse.at(`mode.may.${act}[${i}]`, `is not the owner or a role of this mode (${allowed.join(', ')})`)
      }
    })
    return who as string[]
  }
  return Object.fromEntries(ACTS.map(act => [act, whoMay(act)])) as Record<Act, string[]>
}

function membersOf(refuse: Refuse, value: unknown, roles: readonly string[]): Member[] {
  if (!Array.isArray(value)) return refuse.at('members', 'is not a list of members')
  const seen = new Set<string>()
  return value.map((member: unknown, i) => memberOf(refuse, member, `members[${i}]`, roles, seen))
}

function memberOf(refuse: Refuse, member: unknown, at: string, roles: readonly string[], seen: Set<string>): Member {
  if (!isObject(member)) return refuse.at(at, `is not ${shapeOf(REQUIRED_MEMBER_KEYS, OPTIONAL_MEMBER_KEYS)}`)
  refuse.unknownKeys(member, MEMBER_KEYS, `${at}.`)
  const { role, model } = member
  const name = memberNameOf(refuse, member.name, at, seen)
  if (typeof role !== 'string' || !roles.includes(role)) refuse.at(`${at}.role`, `is not a role of this mode (${roles.join(', ')})`)
  if (model !== undefined && model !== null && !isText(model)) refuse.at(`${at}.model`, 'is not a model name, or null for the host\'s own')
  return { name, role, model: model ?? null }
}

function memberNameOf(refuse: Refuse, name: unknown, at: string, seen: Set<string>): string {
  if (typeof name !== 'string' || !MEMBER_NAME.test(name)) refuse.at(`${at}.name`, `is not a name matching ${MEMBER_NAME}`)
  // Names are compared case-folded: Terra and terra would share branches and a mailbox.
  const folded = name.toLowerCase()
  if (seen.has(folded)) refuse.at(`${at}.name`, 'is on the crew twice (names are compared ignoring case)')
  seen.add(folded)
  return name
}

function houseRulesOf(refuse: Refuse, value: unknown): HouseRules {
  if (value === undefined) return houseRulesFrom({})
  if (!isObject(value)) return refuse.at('house_rules', `is not ${shapeOf(HOUSE_RULE_KEYS)}`)
  refuse.unknownKeys(value, HOUSE_RULE_KEYS, 'house_rules.')
  for (const name of HOUSE_RULE_SWITCHES) {
    if (value[name] !== undefined && typeof value[name] !== 'boolean') refuse.at(`house_rules.${name}`, 'is not true or false')
  }
  const model = value[REVIEW_MODEL]
  if (model !== undefined && !isText(model)) refuse.at(`house_rules.${REVIEW_MODEL}`, 'is not a model name')
  return houseRulesFrom(value)
}

function houseRulesFrom(value: Json): HouseRules {
  const switches = Object.fromEntries(HOUSE_RULE_SWITCHES.map(name => [name, value[name] === true]))
  const model = value[REVIEW_MODEL]
  return { ...(switches as Record<HouseRuleSwitch, boolean>), review_model: typeof model === 'string' ? model : null }
}

// The conventions document is named relative to the crew directory and must stay inside it.
function conventionsOf(refuse: Refuse, value: unknown, crew: string): string | null {
  if (value === undefined) return null
  if (!isText(value) || isAbsolute(value)) return refuse.at('conventions', 'is not a path relative to the crew directory')
  const path = normalize(join(crew, value))
  if (!path.startsWith(crew + sep)) refuse.at('conventions', 'leaves the crew directory')
  return path
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}
