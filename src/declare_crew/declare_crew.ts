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
// declaration looks right. What a release's init did not write is another matter,
// and each such field reads as the value init writes today: a house rule the
// declaration does not name is off, a table that names no act grants it to the
// owner alone (whoTheTableGrants), and a declaration that names no
// channel_read_seconds reads that value too (martha#374), so a file an earlier
// release wrote still declares.

import { isAbsolute, join, normalize, sep } from 'node:path'

import type { DocumentStore } from '../host_contract/host_contract.ts'

/** Where a crew's declaration lives, relative to the project root. */
export const DECLARATION_DIRECTORY = '.crew'
export const DECLARATION_FILE = 'crew.json'

/** The one declaration version this slice reads. */
export const DECLARATION_VERSION = 1

/**
 * The act that lets a member take the owner's queued asks and settle a batch of them (martha#313): one act for both
 * tools, so a crew cannot let a session take asks it may not settle.
 */
export const OFFER_OWNER_ASKS = 'offer_owner_asks'

/**
 * How often a session reads the crew's channel for a message it has not taken in (martha#253), for a declaration that
 * does not say (martha#374, the owner's 2026-11-13 ruling "use init's value"). One definition, and both sides use it:
 * `martha init` writes it into a new crew's file (../declare_a_solo_crew), and this slice reads a file an earlier
 * release's init wrote as that same value, so a crew declared before the field existed reads as one declared today.
 */
export const CHANNEL_READ_SECONDS_WHEN_UNNAMED = 30

/**
 * How long, in minutes, a handover waits behind a member's running turn before that turn is ended so the handover can
 * run (martha#311), for a declaration that does not say: the draft crew's ten.
 */
export const HANDOVER_CEILING_MINUTES_WHEN_UNNAMED = 10

/**
 * The range a declared ceiling must fall in (martha#311): below it every running turn would be ended at once, and above
 * it the end would never come inside one session.
 */
export const HANDOVER_CEILING_MINUTES_LEAST = 1
export const HANDOVER_CEILING_MINUTES_MOST = 60

/**
 * The act that lets a role's members end another member's session and start it again (martha#312): ending a session
 * mid-turn is a stronger act than unparking one, so it is granted on its own.
 */
export const RESTART_MEMBER = 'restart_member'

/** The acts a mode's table assigns, in business words. */
export const ACTS = ['assign_work', 'approve_landing', 'resume_parked_work', OFFER_OWNER_ASKS, RESTART_MEMBER] as const
export type Act = (typeof ACTS)[number]

/**
 * The owner, in a mode's table. The owner is a person, not a member, so no
 * member's role may take this name.
 */
export const OWNER = 'owner'

/**
 * The house rule that opens the crew's pane at a session's start and keeps its rows (martha#254). Off unless the
 * declaration names it, as every switch is: a crew that names no dashboard opens no pane and reports nothing.
 */
export const DASHBOARD = 'dashboard'

/** The house rule that runs the strict shell gate (martha#259): a session that took in text it cannot trace executes
 * nothing until it is replaced. Off unless the declaration names it, as every switch is, so an owner who wrote no
 * `house_rules` gets a member that keeps its shell (DECIDED 2026-11-11 "make the guard opt-in").
 */
export const STRICT_GATE = 'strict_gate'

/**
 * Whether the owner's bells ring when a member's host starts asking them something (martha#313): a bell in the member's
 * terminal and a desktop notification beside it, off unless the declaration turns it on. A member's own report never
 * rings it, so a member cannot make it a nuisance; the owner can mute one member's bells without touching the others.
 */
export const OWNER_BELL = 'owner_bell'

/** Whether a member hands over after a finished task (martha#255): off unless the declaration says true. */
export const REFRESH_BETWEEN_TASKS = 'refresh_between_tasks'

/**
 * The house rule that has the crew tell its Supervisor when work stalls (martha#320): a quiet member, a HANDOFF nobody
 * answered, a wait on a person, and a cycle of waits. Off unless the declaration names it, as every switch is, and it
 * takes three windows with it, so a crew that turns nudges on and names no window is refused rather than given one in
 * code.
 */
export const NUDGES = 'nudges'

/** The three windows a crew that reads nudges names, each in whole minutes: how long a stall, a review and a wait on a
 * person are allowed to last. Zero is a number a crew may mean — it turns that kind of nudge off. */
export const STALLED_MINUTES = 'stalled_minutes'
export const REVIEW_MINUTES = 'review_minutes'
export const PERSON_MINUTES = 'person_minutes'
export const HOUSE_RULE_MINUTES = [STALLED_MINUTES, REVIEW_MINUTES, PERSON_MINUTES] as const
export type HouseRuleMinutes = (typeof HOUSE_RULE_MINUTES)[number]

/** How many milliseconds a minute is: the unit these windows are named in, and the one the rules read them as. */
export const MINUTE_MS = 60_000

/** The house rules a crew can switch on. Each is off unless the declaration says true. */
export const HOUSE_RULE_SWITCHES = ['owner_items', 'workspace_layout', 'member_work', 'practice', STRICT_GATE, DASHBOARD, REFRESH_BETWEEN_TASKS, OWNER_BELL, NUDGES] as const
export type HouseRuleSwitch = (typeof HOUSE_RULE_SWITCHES)[number]

/** The house rule that names a model rather than switching a rule on. */
export const REVIEW_MODEL = 'review_model'

/**
 * The house rules that name a place rather than switching a rule on (martha#256): where a crew keeps its clones,
 * and where it keeps the worktrees its members branch in. They belong to `workspace_layout`, so that rule being on
 * means both are named: a crew that turned the layout on and named no places would have members making worktrees
 * wherever they happened to be.
 */
export const CLONES = 'clones'
export const WORKTREES = 'worktrees'
export const HOUSE_RULE_PLACES = [CLONES, WORKTREES] as const
export type HouseRulePlace = (typeof HOUSE_RULE_PLACES)[number]

/**
 * The two directories a role's text and a mode's text sit in (martha#306), named once here because two trees use the
 * same layout: a crew writes its own under its crew directory, and Martha ships the ones a crew has not written under
 * the same two names, so a crew overrides a shipped text by putting a file of the same name in the same place.
 */
export const ROLE_TEXTS_DIRECTORY = 'roles'
export const MODE_TEXTS_DIRECTORY = 'modes'

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
  readonly clones: string | null
  readonly worktrees: string | null
} & Readonly<Record<HouseRuleMinutes, number | null>>

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
  /**
   * How often, in seconds, a member's session reads the crew's channel for a message it has not taken in (martha#253).
   * A declaration that names none reads as the value `martha init` writes (martha#374), so a crew declared by an
   * earlier release carries messages without its owner editing the file.
   */
  readonly channel_read_seconds: number
  /**
   * How long a handover may wait behind a running turn before that turn is ended (martha#311): whole minutes, from
   * HANDOVER_CEILING_MINUTES_LEAST to HANDOVER_CEILING_MINUTES_MOST, and HANDOVER_CEILING_MINUTES_WHEN_UNNAMED when the
   * declaration names none.
   */
  readonly handover_ceiling_minutes: number
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

const TOP_LEVEL_KEYS = ['version', 'owner', 'members', 'mode', 'house_rules', 'conventions', 'channel_read_seconds', 'handover_ceiling_minutes'] as const
const REQUIRED_MEMBER_KEYS = ['name', 'role'] as const
const OPTIONAL_MEMBER_KEYS = ['model'] as const
const MEMBER_KEYS = [...REQUIRED_MEMBER_KEYS, ...OPTIONAL_MEMBER_KEYS] as const
const MODE_KEYS = ['name', 'roles', 'may'] as const

// What a field must look like, written from its keys: `{ a, b, c? }`.
const shapeOf = (required: readonly string[], optional: readonly string[] = []) =>
  `{ ${[...required, ...optional.map(key => `${key}?`)].join(', ')} }`
const HOUSE_RULE_KEYS: readonly string[] = [...HOUSE_RULE_SWITCHES, REVIEW_MODEL, ...HOUSE_RULE_PLACES, ...HOUSE_RULE_MINUTES]

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * Read the crew's declaration under `root` once, through the host's document
 * store, and return its settings. `root` is the project's absolute path, as the
 * composer knows it.
 *
 * `models` is the vocabulary the host runs, as its adapter records it (martha#315): a `review_model` must be one of
 * these, because the host publishes no other name it would accept for a subagent's model, and a crew that named one
 * Martha cannot spell would hold every review to a model nothing ever matches.
 */
export async function declareCrew(documents: DocumentStore, root: string, models: readonly string[]): Promise<CrewSettings> {
  const crew = join(root, DECLARATION_DIRECTORY)
  const declaration = join(crew, DECLARATION_FILE)
  if (!isAbsolute(root)) throw new DeclarationRefused(declaration, null, 'is not under an absolute project root')
  const text = await readDeclaration(documents, declaration)
  const parsed = parseDeclaration(declaration, text)
  return deepFreeze(settingsOf(new Refuse(declaration), parsed, { root, crew, declaration }, models))
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

function settingsOf(refuse: Refuse, value: unknown, paths: Omit<CrewPaths, 'conventions'>, models: readonly string[]): CrewSettings {
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
    house_rules: houseRulesOf(refuse, value['house_rules'], models),
    channel_read_seconds: channelReadSecondsOf(refuse, value['channel_read_seconds']),
    handover_ceiling_minutes: handoverCeilingOf(refuse, value['handover_ceiling_minutes']),
  }
}

/**
 * How often a session reads the channel for a message: a positive whole number of seconds. A declaration that names
 * none reads as the value `martha init` writes today (martha#374), the same way a mode's table that does not name an
 * act reads it as the owner's: a file an earlier release wrote still declares after an upgrade.
 */
function channelReadSecondsOf(refuse: Refuse, value: unknown): number {
  if (value === undefined) return CHANNEL_READ_SECONDS_WHEN_UNNAMED
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return refuse.at('channel_read_seconds', 'is not a whole number of seconds, at least 1')
  return value
}

/**
 * How long a handover waits behind a running turn (martha#311): a whole number of minutes inside the range, or the
 * draft's ten when the declaration names none. A value someone wrote outside the range is refused by name, never read as
 * the default: 0 would end every running turn at once.
 */
function handoverCeilingOf(refuse: Refuse, value: unknown): number {
  if (value === undefined) return HANDOVER_CEILING_MINUTES_WHEN_UNNAMED
  const inRange = typeof value === 'number' && Number.isInteger(value) && value >= HANDOVER_CEILING_MINUTES_LEAST && value <= HANDOVER_CEILING_MINUTES_MOST
  if (!inRange) return refuse.at('handover_ceiling_minutes', `is not a whole number of minutes from ${HANDOVER_CEILING_MINUTES_LEAST} to ${HANDOVER_CEILING_MINUTES_MOST}`)
  return value
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
  return Object.fromEntries(ACTS.map(act => [act, whoMayOf(refuse, value[act], act, allowed)])) as Record<Act, string[]>
}

/**
 * Who a mode's table grants one act to, read from what its `may` holds for that act.
 *
 * An act the table does not name at all is the owner's alone (martha#313, martha#312). One rule for every act, so the
 * acts cannot drift apart, and the one reading that still lets a crew file written before an act existed declare after
 * an upgrade: `martha init` in v0.1.0 wrote no offer_owner_asks, and a refusal here would leave every verb refusing
 * until the owner edited the file by hand. The owner's own sessions are what the act then reaches, which is what a solo
 * crew has.
 *
 * An act that is there and names nobody reads as nobody here, and is refused where the declaration is read; so is a
 * grant that names something that is not the owner or a role of this mode.
 */
export function whoTheTableGrants(entry: unknown): readonly string[] {
  return entry === undefined ? [OWNER] : Array.isArray(entry) ? (entry as readonly string[]) : []
}

function whoMayOf(refuse: Refuse, entry: unknown, act: Act, allowed: readonly string[]): string[] {
  const who = [...whoTheTableGrants(entry)]
  if (who.length === 0) return refuse.at(`mode.may.${act}`, 'names nobody')
  who.forEach((name: unknown, i) => {
    if (typeof name !== 'string' || !allowed.includes(name)) {
      refuse.at(`mode.may.${act}[${i}]`, `is not the owner or a role of this mode (${allowed.join(', ')})`)
    }
  })
  return who
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

function houseRulesOf(refuse: Refuse, value: unknown, models: readonly string[]): HouseRules {
  if (value === undefined) return houseRulesFrom({})
  if (!isObject(value)) return refuse.at('house_rules', `is not ${shapeOf(HOUSE_RULE_KEYS)}`)
  refuse.unknownKeys(value, HOUSE_RULE_KEYS, 'house_rules.')
  refuseSwitches(refuse, value, models)
  refusePlaces(refuse, value)
  refuseMinutes(refuse, value)
  return houseRulesFrom(value)
}

function refuseSwitches(refuse: Refuse, value: Json, models: readonly string[]): void {
  for (const name of HOUSE_RULE_SWITCHES) {
    if (value[name] !== undefined && typeof value[name] !== 'boolean') refuse.at(`house_rules.${name}`, 'is not true or false')
  }
  refuseTheReviewModel(refuse, value[REVIEW_MODEL], models)
}

/**
 * The reviewer model, read against the models the host runs (martha#315): a name the host cannot spell is refused here,
 * where the owner sees which model it does run, rather than left as a rule nothing could ever match.
 */
function refuseTheReviewModel(refuse: Refuse, model: unknown, models: readonly string[]): void {
  if (model === undefined) return
  if (!isText(model)) return refuse.at(`house_rules.${REVIEW_MODEL}`, 'is not a model name')
  if (models.includes(model.trim())) return
  refuse.at(
    `house_rules.${REVIEW_MODEL}`,
    `is not a model this host runs (it runs ${models.length === 0 ? 'none Martha can name' : models.join(', ')}), so a review could never be held to it`,
  )
}

/**
 * The places a crew keeps its clones and worktrees in: each an absolute path when it is named, and both named when
 * the workspace layout is on, so a member is never left to make a worktree wherever it is.
 */
function refusePlaces(refuse: Refuse, value: Json): void {
  for (const place of HOUSE_RULE_PLACES) {
    const named = value[place]
    if (named !== undefined && (!isText(named) || !isAbsolute(named))) refuse.at(`house_rules.${place}`, 'is not an absolute path')
  }
  if (value['workspace_layout'] !== true) return
  const missing = HOUSE_RULE_PLACES.find((place) => value[place] === undefined)
  if (missing !== undefined) {
    refuse.at(`house_rules.${missing}`, 'is missing, and house_rules.workspace_layout is on in this declaration')
  }
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * The three windows a crew that reads nudges names (martha#320): each a whole number of minutes, zero or more, and all
 * three named, so a member is never nudged on a window the code made up. A crew that turns nudges off names none of
 * them and reads no nudge.
 */
function refuseMinutes(refuse: Refuse, value: Json): void {
  for (const minutes of HOUSE_RULE_MINUTES) {
    const named = value[minutes]
    if (named !== undefined && (typeof named !== 'number' || !Number.isInteger(named) || named < 0)) {
      refuse.at(`house_rules.${minutes}`, 'is not a whole number of minutes, zero or more')
    }
  }
  if (value[NUDGES] !== true) return
  const missing = HOUSE_RULE_MINUTES.find((minutes) => value[minutes] === undefined)
  if (missing !== undefined) {
    refuse.at(`house_rules.${missing}`, `is missing, and house_rules.${NUDGES} is on in this declaration`)
  }
}

function houseRulesFrom(value: Json): HouseRules {
  const switches = Object.fromEntries(HOUSE_RULE_SWITCHES.map(name => [name, value[name] === true]))
  const places = Object.fromEntries(HOUSE_RULE_PLACES.map(place => [place, textOrNull(value[place])]))
  const minutes = Object.fromEntries(HOUSE_RULE_MINUTES.map(name => [name, minuteOrNull(value[name])]))
  return {
    ...(switches as Record<HouseRuleSwitch, boolean>),
    ...(places as Record<HouseRulePlace, string | null>),
    ...(minutes as Record<HouseRuleMinutes, number | null>),
    review_model: textOrNull(value[REVIEW_MODEL]),
  }
}

/** A window in minutes as it is kept, or null when the declaration names none. A missing one is never zero: zero is a
 * crew turning a kind of nudge off, which is a decision, and no window at all is a crew that reads no nudge. */
const minuteOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null)

// The conventions document is named relative to the crew directory and must stay inside it.
function conventionsOf(refuse: Refuse, value: unknown, crew: string): string | null {
  if (value === undefined) return null
  if (!isText(value) || isAbsolute(value)) return refuse.at('conventions', 'is not a path relative to the crew directory')
  const path = normalize(join(crew, value))
  if (!path.startsWith(crew + sep)) refuse.at('conventions', 'leaves the crew directory')
  return path
}

/**
 * The crew's own text files, as the owner's approval names and fingerprints them (martha#306): a role's text for every
 * role of its mode, its mode's text, and its conventions when it names one. A file the crew has not written is named
 * all the same, so the approval records that it is absent rather than leaving it out.
 */
export function crewTextFilesOf(settings: CrewSettings): readonly string[] {
  const crew = settings.paths.crew
  return [
    ...settings.mode.roles.map((role) => join(crew, ROLE_TEXTS_DIRECTORY, `${role}.md`)),
    join(crew, MODE_TEXTS_DIRECTORY, `${settings.mode.name}.md`),
    ...(settings.paths.conventions === null ? [] : [settings.paths.conventions]),
  ]
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}
